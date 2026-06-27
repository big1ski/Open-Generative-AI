import { NextResponse } from 'next/server';
import { GATE_COOKIE, gateToken } from '@/lib/siteGate.js';

// Validates the submitted site password against the SITE_PASSWORD env var and,
// on success, sets an HttpOnly cookie so the middleware lets the user through.
export async function POST(request) {
  const password = process.env.SITE_PASSWORD;

  // Gate not configured — nothing to check. (Middleware also fails open.)
  if (!password) {
    return NextResponse.json({ ok: true, disabled: true });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const submitted = (body?.password ?? '').toString();

  // Compare hashed tokens rather than raw strings.
  const expected = await gateToken(password);
  const got = await gateToken(submitted);
  if (got !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, expected, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
