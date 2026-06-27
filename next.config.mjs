// Content-Security-Policy.
// Notes on the deliberately-permissive directives:
//  - script-src/style-src keep 'unsafe-inline' because Next.js injects inline
//    bootstrap/hydration without a nonce; tightening needs nonce-based CSP.
//  - img-src/media-src/connect-src allow https: because generated results are
//    served from (and downloaded cross-origin from) fal's CDN, whose exact
//    domains aren't enumerated here. Locking these to specific fal hosts is the
//    remaining hardening step (harvest the real domains from the Network tab).
// The strict directives below still close real vectors: object-src 'none'
// (no plugins), base-uri 'self' (no <base> hijack), form-action 'self' (an
// injected <form> can't POST the key off-site), frame-ancestors 'none' (clickjacking).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['studio'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
