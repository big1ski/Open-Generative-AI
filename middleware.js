import { NextResponse } from 'next/server';
import { GATE_COOKIE, gateToken } from './lib/siteGate.js';

// Shared site-password gate. Activated only when the SITE_PASSWORD env var is
// set — otherwise it fails open so the app works normally (and a deploy can
// never lock everyone out before the password is configured).
export async function middleware(request) {
    const password = process.env.SITE_PASSWORD;
    if (!password) return NextResponse.next();

    const cookie = request.cookies.get(GATE_COOKIE)?.value;
    const expected = await gateToken(password);
    if (cookie === expected) return NextResponse.next();

    const { pathname, search } = request.nextUrl;

    // API calls get a clean 401 rather than an HTML redirect.
    if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized — site password required' }, { status: 401 });
    }

    // Everything else -> the password page, remembering the intended destination.
    const url = request.nextUrl.clone();
    const dest = pathname + search;
    url.pathname = '/gate';
    url.search = dest && dest !== '/' ? `?from=${encodeURIComponent(dest)}` : '';
    return NextResponse.redirect(url);
}

export const config = {
    // Run on all routes except Next internals, the gate page/api, and favicon.
    matcher: ['/((?!_next/static|_next/image|favicon.ico|gate|api/gate).*)'],
};
