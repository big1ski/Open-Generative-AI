# Plan: Replace MuAPI with fal.ai (user-supplied key, all model categories)

## Context

The site (Open-Generative-AI Studio) currently routes **100% of generation through MuAPI**
(`api.muapi.ai`). There is **no fal.ai code anywhere** — the only fal artifact is a research/
verification doc mapping which MuAPI t2i models have fal equivalents. Nothing is "converted."

The user wants a **full replacement of MuAPI with fal.ai** across **all model categories**
(t2i, i2i, t2v, i2v, v2v, lipsync, audio), using a **bring-your-own-key model**: each user
pastes their own fal key and pays their own fal usage (mirroring how MuAPI works today — the
key lives in `localStorage`, is sent per-request, and the proxy only bypasses CORS).

Outcome: every model in the catalog that has a fal equivalent generates via
`queue.fal.run/<fal-slug>`; MuAPI is removed as the generation backend.

### Key constraint discovered
- Verification so far only covered **t2i (33 exact matches, 7 partial, 11 none)**. Full
  replacement across all categories requires **re-crawling fal's catalog for video / i2i /
  audio / lipsync** and producing a per-model mapping. This re-crawl is the gating first step
  and is the literal "continue the fal.ai verification — re-crawl and match the MuAPI catalog"
  task.
- fal model IDs are **namespaced** (`fal-ai/flux/dev`, `fal-ai/flux-pro/kontext`,
  `fal-ai/kling-video/v2/master/image-to-video`, …), not flat endpoint names. Each model needs
  its real fal slug **and** an input-field mapping (fal schemas differ from MuAPI: e.g.
  `image_size` enum vs `width`/`height`, `num_inference_steps`, `num_frames`, etc.).
- fal's submit/poll/output shape differs from MuAPI (see below).
- **Consequence of full replacement (must accept):** MuAPI-only features — Workflows, Agents,
  account Balance, `upload_file`, dynamic cost, clipping/motion-graphics — have **no fal
  equivalent**. They will be disabled/removed or stubbed. Models with no fal match are dropped
  from the catalog.

## fal.ai request pattern (replaces MuAPI's submitAndPoll)

- **Submit:** `POST https://queue.fal.run/<fal-slug>` with `Authorization: Key <FAL_KEY>` and a
  JSON body of fal inputs → returns `{ request_id, status_url, response_url }`.
- **Poll:** `GET <status_url>` → `{ status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" }`.
- **Result:** on `COMPLETED`, `GET <response_url>` → outputs, e.g.
  `{ images: [{ url }] }` (image), `{ video: { url } }` (video), `{ audio: { url } }` (audio).
- Auth header is `Authorization: Key ...` (NOT `x-api-key`).

## Implementation

### Phase 0 — Re-crawl & build the mapping (gating; the "verification" task)
- Re-crawl fal.ai's catalog (fal.ai/models) for every MuAPI model in `models_dump.json` /
  `packages/studio/src/models.js`, across all categories.
- Produce a **mapping table** per model: `{ muapiId, falSlug, category, inputMap, status }`
  where `status ∈ {exact, partial, none}` and `inputMap` maps MuAPI param → fal param
  (incl. value transforms like aspect_ratio→image_size).
- Persist as `docs/fal-muapi-mapping.json` (extends the existing verification doc). Models with
  `status: none` are flagged for removal.

### Phase 1 — fal client (replace the MuAPI client core)
- Rewrite `packages/studio/src/muapi.js` core (`submitAndPoll`, `pollForResult`) into a fal
  flow: POST to `BASE_URL + /api/fal/<falSlug>`, read `status_url`/`response_url`, poll, parse
  fal output shape into the existing `{ url }` return contract so callers stay unchanged.
- Drive payload construction from each model's `inputMap` (from Phase 0) instead of the
  hardcoded MuAPI field names in `generateImage`/`generateI2I`/`generateVideo`/`generateI2V`/
  `processV2V`/`processLipSync`/`generateAudio`.
- Keep the same exported function names/signatures so `src/components/*Studio.js` need no
  changes (they call `muapi.generateImage(...)` etc.).
- Mirror in `src/lib/muapi.js` (the class-based duplicate) so both client copies match.

### Phase 2 — Proxy + middleware → fal
- Add `app/api/fal/[[...path]]/route.js` proxying `POST/GET /api/fal/*` → `https://queue.fal.run/*`,
  forwarding the `Authorization` header (pulled from header or a `fal_key` cookie), pattern-matched
  on `app/api/api/v1/[[...path]]/route.js`.
- Update `middleware.js`: replace the `api.muapi.ai` rewrite block with an `/api/fal/*` →
  `queue.fal.run` rewrite (and update the `matcher`). Remove/disable the `/api/workflow` and
  `/api/app` MuAPI rewrites.

### Phase 3 — Settings / key storage
- Replace the `muapi_key` localStorage key with `fal_key` in Settings UI and everywhere it is
  read: `src/lib/muapi.js:10`, `src/components/VideoStudio.js` (301/998/1122), `LipSyncStudio.js:172`,
  and the `muapi:auth-required` event wiring. Update the Settings modal label/help text and the
  auth-required notification copy to point at fal.

### Phase 4 — Catalog cleanup & feature removal
- In `models.js` / `models_dump.json`: add `falSlug` + `inputMap` per model; **remove** models
  with `status: none`; regenerate `models.js` from the dump via the existing generator in
  `scripts/`.
- Disable/remove MuAPI-only surfaces: Workflows, Agents, Balance, file upload (or swap to fal's
  upload endpoint `https://fal.run/storage/upload` if needed for i2i/i2v reference images),
  dynamic cost, clipping, motion-graphics. Hide their UI entry points.

## Critical files
- `packages/studio/src/muapi.js` — client core + all generate* functions (primary rewrite).
- `src/lib/muapi.js` — class-based duplicate client (mirror changes).
- `packages/studio/src/models.js` + `models_dump.json` — catalog: add `falSlug`/`inputMap`, drop unmatched.
- `middleware.js` — rewrite target → `queue.fal.run`.
- `app/api/fal/[[...path]]/route.js` — NEW fal proxy (copy shape of `app/api/api/v1/[[...path]]/route.js`).
- `src/components/VideoStudio.js`, `LipSyncStudio.js`, Settings modal — `muapi_key` → `fal_key`.
- `docs/fal-muapi-mapping.json` — NEW mapping output (extends existing verification doc).

## Verification
1. **Mapping sanity:** every retained model in `models.js` has a non-empty `falSlug`; no
   `status: none` survives. Spot-check 3–4 slugs against fal.ai/models.
2. **Unit/path:** confirm `generateImage`/`generateI2V`/`processLipSync`/`generateAudio` build
   fal payloads via `inputMap` and parse `images[]`/`video.url`/`audio.url` correctly.
3. **Proxy:** with a real fal key in Settings, run the app (`npm run dev`), generate a t2i image,
   an i2v video, and an audio clip; confirm requests hit `/api/fal/*` → `queue.fal.run`, poll to
   COMPLETED, and render. (Use `scripts/test_minimax_provider.js` as a template for a
   `scripts/test_fal_provider.js` live smoke test reading `FAL_KEY`.)
4. **Regression:** Settings no longer references `muapi_key`; removed MuAPI features no longer
   surface broken UI.

## Risks / notes
- **Scope is large.** Phase 0 (the re-crawl/mapping) is mandatory and substantial — the existing
  verification only covered t2i. Recommend landing Phase 0 first and reviewing the mapping before
  the code rewrite.
- **Feature loss is intentional** to "full replacement": workflows/agents/balance go away.
- **Push currently blocked:** this session cannot push to `big1ski/Open-Generative-AI` (egress
  policy `403`). Work lands locally on `claude/nifty-ptolemy-1xlsq5` until pushes are enabled.