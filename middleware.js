import { NextResponse } from 'next/server';

export function middleware(request) {
    return NextResponse.next();
}

// MuAPI rewrites (api.muapi.ai) removed — generation now routes through
// /api/fal/* → queue.fal.run via app/api/fal/[[...path]]/route.js
export const config = {
    matcher: [],
};
