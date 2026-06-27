// fal.ai pricing snapshot — crawled from public fal.ai model pages (June 2026).
//
// IMPORTANT: this drives a CLIENT-SIDE ESTIMATE only, always shown labelled
// "(est.)". fal has no pre-generation price-quote API, and many models bill by
// actual output (megapixels, video seconds, compute), so the real charge can
// differ. Prices also change over time — update this table when they do.
//
// Keyed by fal slug (model.falSlug). Units:
//   image      -> amount per output image            (× image count)
//   megapixel  -> amount per output megapixel         (× MP × image count)
//   second     -> amount per second of video/audio    (optional audioAmount; optional baseAmount/baseSeconds)
//   minute     -> amount per minute (duration usually unknown pre-gen -> show rate)
//   kchars     -> amount per 1000 characters of input text

export const FAL_PRICES = {
  // ── Image — per image ──────────────────────────────────────────────────────
  'fal-ai/nano-banana': { unit: 'image', amount: 0.039 },
  'fal-ai/flux-pro/kontext': { unit: 'image', amount: 0.04 },
  'fal-ai/flux-pro/kontext/text-to-image': { unit: 'image', amount: 0.04 },
  'fal-ai/bytedance/seedream/v3/text-to-image': { unit: 'image', amount: 0.03 },
  'fal-ai/bytedance/seededit/v3/edit-image': { unit: 'image', amount: 0.03 },

  // ── Image — per megapixel (billed rounded up to nearest MP) ────────────────
  'fal-ai/flux/dev': { unit: 'megapixel', amount: 0.025 },
  'fal-ai/flux/schnell': { unit: 'megapixel', amount: 0.003 },
  'fal-ai/qwen-image': { unit: 'megapixel', amount: 0.02 },
  'fal-ai/clarity-upscaler': { unit: 'megapixel', amount: 0.03 },
  'fal-ai/hidream-i1-fast': { unit: 'megapixel', amount: 0.01 },

  // ── Video — per second (base/audio/typical-resolution noted) ───────────────
  'fal-ai/veo3': { unit: 'second', amount: 0.50, audioAmount: 0.75 },
  'fal-ai/veo3/fast': { unit: 'second', amount: 0.25, audioAmount: 0.40 },
  'fal-ai/veo3/image-to-video': { unit: 'second', amount: 0.50, audioAmount: 0.75 },
  'fal-ai/veo3/fast/image-to-video': { unit: 'second', amount: 0.25, audioAmount: 0.40 },
  'fal-ai/kling-video/v2.5-turbo/pro/text-to-video': { unit: 'second', amount: 0.07, baseAmount: 0.35, baseSeconds: 5 },
  'fal-ai/kling-video/v2.1/master/text-to-video': { unit: 'second', amount: 0.28, baseAmount: 1.40, baseSeconds: 5 },
  'fal-ai/minimax/hailuo-02/standard/image-to-video': { unit: 'second', amount: 0.045 },
  'fal-ai/wan/v2.2-a14b/text-to-video': { unit: 'second', amount: 0.08, note: 'at 720p' },
  'fal-ai/bytedance/seedance/v1/pro/text-to-video': { unit: 'second', amount: 0.124, note: 'at 1080p' },
  'fal-ai/bytedance/seedance/v1/lite/text-to-video': { unit: 'second', amount: 0.036, note: 'at 720p' },
  'fal-ai/pixverse/v4.5/image-to-video': { unit: 'second', amount: 0.04, note: 'at 720p' },

  // ── Lip sync — per minute of processed video ───────────────────────────────
  'fal-ai/sync-lipsync': { unit: 'minute', amount: 0.70 },

  // ── Audio ──────────────────────────────────────────────────────────────────
  'fal-ai/minimax/speech-2.6-hd': { unit: 'kchars', amount: 0.10 },
  'fal-ai/mmaudio-v2/text-to-audio': { unit: 'second', amount: 0.001 },
};

const DEFAULT_VIDEO_SECONDS = 5;
const DEFAULT_MEGAPIXELS = 1; // most t2i default to ~1024² ≈ 1 MP when only an aspect ratio is given

function megapixelsFromParams(params) {
  const w = Number(params?.width);
  const h = Number(params?.height);
  if (w && h) return Math.max(1, Math.ceil((w * h) / 1_000_000));
  return DEFAULT_MEGAPIXELS;
}

/**
 * Estimate the fal cost of a generation.
 * @returns {null | { amount: number|null, exact: boolean, note?: string, rate?: string }}
 *   null            -> no price data for this model (show nothing)
 *   amount: number  -> estimated total in USD
 *   amount: null    -> total can't be known pre-gen; `rate` holds the unit rate
 */
export function estimateCost(model, params = {}) {
  const price = model?.falSlug && FAL_PRICES[model.falSlug];
  if (!price) return null;

  const n = Math.max(1, Number(params.num_images || params.batchSize || 1));

  switch (price.unit) {
    case 'image':
      return { amount: price.amount * n, exact: true };

    case 'megapixel':
      return { amount: price.amount * megapixelsFromParams(params) * n, exact: false, note: price.note };

    case 'second': {
      const secs = Number(params.duration) || DEFAULT_VIDEO_SECONDS;
      const withAudio = params.audio === true || params.generate_audio === true;
      const per = withAudio && price.audioAmount != null ? price.audioAmount : price.amount;
      const total = price.baseAmount != null
        ? price.baseAmount + per * Math.max(0, secs - (price.baseSeconds || 0))
        : per * secs;
      return { amount: total, exact: false, note: price.note };
    }

    case 'minute':
      // Output length depends on the supplied audio/video — unknown pre-gen.
      return { amount: null, rate: `$${price.amount.toFixed(2)}/min`, exact: false };

    case 'kchars': {
      const chars = (params.text || params.prompt || '').length;
      if (!chars) return { amount: null, rate: `$${price.amount.toFixed(2)}/1k chars`, exact: false };
      return { amount: price.amount * (chars / 1000), exact: false };
    }

    default:
      return null;
  }
}

/** Format an estimate for display, e.g. "~$0.04 (est.)" or "~$0.70/min (est.)". */
export function formatCost(est) {
  if (!est) return null;
  if (est.amount == null) return est.rate ? `~${est.rate} (est.)` : null;
  const a = est.amount;
  const money = a < 0.01 ? `$${a.toFixed(4)}` : a < 1 ? `$${a.toFixed(3)}` : `$${a.toFixed(2)}`;
  return `~${money} (est.)`;
}
