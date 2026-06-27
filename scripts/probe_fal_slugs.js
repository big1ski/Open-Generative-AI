#!/usr/bin/env node
/**
 * probe_fal_slugs.js — live slug-EXISTENCE probe (no paid generation).
 *
 * For every retained model's falSlug in docs/fal-muapi-mapping.json, sends a
 * minimal POST {} to https://queue.fal.run/<falSlug> with Authorization: Key
 * $FAL_KEY and classifies by HTTP status:
 *
 *   404 / "not found"        -> slug DOES NOT EXIST   -> FAIL (demote to none)
 *   422 / 400 validation     -> slug EXISTS (bad params, no compute) -> PASS
 *   401 / 403 auth-gated     -> slug EXISTS (see below)              -> PASS
 *   200 / 202 queued         -> EXISTS (request is cancelled immediately)
 *
 * EMPIRICALLY VERIFIED: queue.fal.run resolves the slug BEFORE checking auth.
 * A non-existent slug returns 404 even with a missing/empty key; an existing
 * slug returns 401 with a bad key (and 422 with a valid key). Therefore 401/403
 * positively means the slug EXISTS. This makes existence detection reliable
 * WITHOUT a paid key. To prove the channel is live on every run, the script
 * first probes a SENTINEL fake slug and asserts it returns 404 — if it does
 * not, existence results are flagged untrustworthy.
 *
 * Usage:  [FAL_KEY=xxxxx] node scripts/probe_fal_slugs.js [--concurrency N]
 *
 * Exit code is the number of FAIL slugs (0 = all retained slugs exist).
 */

const fs = require('fs');
const path = require('path');

const MAPPING = path.join(__dirname, '..', 'docs', 'fal-muapi-mapping.json');
const BASE = 'https://queue.fal.run';
const KEY = process.env.FAL_KEY || '';

const argv = process.argv.slice(2);
const concArg = argv.indexOf('--concurrency');
const CONCURRENCY = concArg !== -1 ? parseInt(argv[concArg + 1], 10) || 8 : 8;

const SPOTLIGHT = [
  'openai/gpt-image-2',
  'kling-video/v3/omni',
  'xai/grok-imagine',
  'wan/v2.6',
  'bytedance/seedance-2.0',
  'veed/lipsync',
];

const SENTINEL_SLUG = 'fal-ai/__nonexistent-sentinel-' + Date.now();

function classify(status, bodyText) {
  const body = (bodyText || '').toLowerCase();
  if (status === 404 || body.includes('not found') || body.includes('no endpoint') || body.includes('does not exist')) {
    return 'FAIL';            // slug does not exist (404 precedes auth)
  }
  if (status === 422 || status === 400) return 'EXISTS';        // validation -> exists
  if (status === 401 || status === 403) return 'EXISTS_AUTH';  // slug resolved, auth-gated -> exists
  if (status === 200 || status === 202) return 'QUEUED';       // exists, will cancel
  return `OTHER_${status}`;
}

async function cancelIfQueued(slug, submitJson) {
  try {
    const reqId = submitJson?.request_id;
    const cancelUrl = submitJson?.cancel_url || (reqId ? `${BASE}/${slug}/requests/${reqId}/cancel` : null);
    if (!cancelUrl) return;
    await fetch(cancelUrl, { method: 'PUT', headers: { 'Authorization': `Key ${KEY}` } });
  } catch { /* best-effort */ }
}

async function probe(slug) {
  const url = `${BASE}/${slug}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Key ${KEY}` },
      body: '{}',
    });
    const text = await res.text();
    const verdict = classify(res.status, text);
    if (verdict === 'QUEUED') {
      let json = null;
      try { json = JSON.parse(text); } catch {}
      await cancelIfQueued(slug, json);
    }
    return { slug, status: res.status, verdict, snippet: text.slice(0, 120).replace(/\s+/g, ' ') };
  } catch (err) {
    return { slug, status: 0, verdict: 'NETERR', snippet: err.message };
  }
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return results;
}

(async () => {
  if (!KEY) {
    console.error('⚠  FAL_KEY not set — probing with an empty key.');
    console.error('   Existence detection still holds: 404 = missing, 401 = exists (auth-gated).\n');
  }

  // ── Sentinel self-check: a guaranteed-fake slug MUST return 404, proving the
  //    channel resolves slugs before auth so 401="exists" is trustworthy.
  const sentinel = await probe(SENTINEL_SLUG);
  const sentinelOk = sentinel.verdict === 'FAIL';
  console.log(`Sentinel ${SENTINEL_SLUG} -> [${sentinel.status}] ${sentinel.verdict} ` +
    `(${sentinelOk ? 'OK: 404 detection is live' : 'WARNING: expected 404 — results UNTRUSTWORTHY'})\n`);

  const mapping = JSON.parse(fs.readFileSync(MAPPING, 'utf8'));
  const retained = mapping.models.filter(m => m.status !== 'none' && m.falSlug);

  // Unique slugs, remembering which muapiIds use each.
  const bySlug = new Map();
  for (const m of retained) {
    if (!bySlug.has(m.falSlug)) bySlug.set(m.falSlug, []);
    bySlug.get(m.falSlug).push(`${m.muapiId} (${m.category})`);
  }
  const slugs = [...bySlug.keys()];
  console.log(`Probing ${slugs.length} unique retained slugs (${retained.length} models), concurrency=${CONCURRENCY}\n`);

  const results = await runPool(slugs, probe, CONCURRENCY);

  // Group by verdict
  const groups = {};
  for (const r of results) (groups[r.verdict] ||= []).push(r);

  const order = ['FAIL', 'EXISTS_AUTH', 'EXISTS', 'QUEUED', 'NETERR'];
  const seen = new Set(order);
  const allVerdicts = [...order, ...Object.keys(groups).filter(v => !seen.has(v))];

  for (const v of allVerdicts) {
    const rows = groups[v];
    if (!rows || !rows.length) continue;
    console.log(`\n===== ${v}  (${rows.length}) =====`);
    for (const r of rows.sort((a, b) => a.slug.localeCompare(b.slug))) {
      console.log(`  [${String(r.status).padEnd(3)}] ${r.slug}`);
      if (v === 'FAIL' || v === 'NETERR') console.log(`        ↳ ${r.snippet}`);
    }
  }

  // Spotlight summary
  console.log(`\n===== SPOTLIGHT (suspected slugs) =====`);
  for (const pat of SPOTLIGHT) {
    const matches = results.filter(r => r.slug.includes(pat));
    if (!matches.length) { console.log(`  ${pat} : (no retained slug matches)`); continue; }
    for (const r of matches) console.log(`  ${pat} -> ${r.slug} : [${r.status}] ${r.verdict}`);
  }

  // FAIL list
  const fails = groups['FAIL'] || [];
  console.log(`\n===== RESULT =====`);
  console.log(`FAIL slugs (do not exist): ${fails.length}`);
  for (const r of fails) {
    console.log(`  ${r.slug}  used by: ${bySlug.get(r.slug).join(', ')}`);
  }

  // Emit machine-readable FAIL list for the demotion step
  fs.writeFileSync(
    path.join(__dirname, '..', 'docs', 'fal-slug-probe-fails.json'),
    JSON.stringify({
      probedAt: new Date().toISOString(),
      hadKey: !!KEY,
      sentinelOk,
      fails: fails.map(f => f.slug),
    }, null, 2)
  );

  if (!sentinelOk) {
    console.log('\n⚠  Sentinel did not 404 — existence detection is unreliable this run; ignore results.');
    process.exit(255);
  }
  process.exit(fails.length);
})();
