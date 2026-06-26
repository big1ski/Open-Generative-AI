import { NextResponse } from 'next/server';

const FAL_QUEUE_BASE = 'https://queue.fal.run';

function buildHeaders(request) {
    const headers = new Headers();
    // Forward Authorization from client (already set to "Key <token>" by the fal client)
    const auth = request.headers.get('authorization') || request.headers.get('Authorization');
    if (auth) headers.set('Authorization', auth);
    const ct = request.headers.get('content-type');
    if (ct) headers.set('Content-Type', ct);
    return headers;
}

async function proxy(request, params, method) {
    const slug = await params;
    const path = (slug.path || []).join('/');
    const { search } = new URL(request.url);
    const targetUrl = `${FAL_QUEUE_BASE}/${path}${search}`;

    const headers = buildHeaders(request);

    try {
        const init = { method, headers };
        if (method !== 'GET' && method !== 'HEAD') {
            init.body = await request.arrayBuffer();
        }
        const response = await fetch(targetUrl, init);
        const data = await response.arrayBuffer();
        return new NextResponse(data, {
            status: response.status,
            headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' }
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET(request, { params }) {
    return proxy(request, params, 'GET');
}

export async function POST(request, { params }) {
    return proxy(request, params, 'POST');
}
