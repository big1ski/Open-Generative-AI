import { NextResponse } from 'next/server';

const FAL_STORAGE_BASE = 'https://fal.run/storage';

async function proxy(request, params, method) {
    const slug = await params;
    const path = (slug.path || []).join('/');
    const { search } = new URL(request.url);
    const targetUrl = `${FAL_STORAGE_BASE}/${path}${search}`;

    const headers = new Headers();
    const auth = request.headers.get('authorization') || request.headers.get('Authorization');
    if (auth) headers.set('Authorization', auth);

    try {
        const body = await request.arrayBuffer();
        const ct = request.headers.get('content-type');
        if (ct) headers.set('Content-Type', ct);
        const response = await fetch(targetUrl, { method, headers, body: body.byteLength > 0 ? body : undefined });
        const data = await response.arrayBuffer();
        return new NextResponse(data, {
            status: response.status,
            headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' }
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request, { params }) {
    return proxy(request, params, 'POST');
}

export async function GET(request, { params }) {
    return proxy(request, params, 'GET');
}
