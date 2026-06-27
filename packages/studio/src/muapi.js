import { getModelById, getVideoModelById, getI2IModelById, getI2VModelById, getV2VModelById, getLipSyncModelById, getAudioModelById } from './models.js';

// All generation requests route through the Next.js /api/fal/* proxy to
// bypass CORS. In SSR / Electron the proxy is unavailable so we call
// queue.fal.run directly.
const FAL_PROXY = (typeof window !== 'undefined' && window.location?.protocol?.startsWith('http'))
    ? '/api/fal'
    : 'https://queue.fal.run';

function notifyAuthRequired(status, detail) {
    if (typeof window === 'undefined') return;
    if (status !== 401 && status !== 403) return;
    window.dispatchEvent(new CustomEvent('muapi:auth-required', { detail: { status, message: detail } }));
}

// Rewrite absolute queue.fal.run poll/result URLs to go through our proxy.
function toProxy(url) {
    if (FAL_PROXY.startsWith('/') && url?.startsWith('https://queue.fal.run/')) {
        return FAL_PROXY + url.slice('https://queue.fal.run'.length);
    }
    return url;
}

// Apply a model's inputMap to translate MuAPI param names → fal param names.
// inputMap values may use "parent.child" dot notation to produce nested objects.
// If inputMap is empty / absent, all non-internal params are forwarded as-is.
function applyInputMap(params, inputMap) {
    const skip = new Set(['model', '_modelId', 'onRequestId']);
    if (!inputMap || Object.keys(inputMap).length === 0) {
        const p = {};
        for (const [k, v] of Object.entries(params)) {
            if (!skip.has(k) && v !== undefined && v !== null) p[k] = v;
        }
        return p;
    }
    const payload = {};
    for (const [muapiKey, falPath] of Object.entries(inputMap)) {
        const val = params[muapiKey];
        if (val === undefined || val === null) continue;
        const parts = falPath.split('.');
        if (parts.length === 1) {
            payload[parts[0]] = val;
        } else {
            if (!payload[parts[0]]) payload[parts[0]] = {};
            payload[parts[0]][parts[1]] = val;
        }
    }
    return payload;
}

// Extract the result URL (or ID) from a fal response using the model's outputField.
// Special case: outputField "custom_voice_id" returns a string, not a media URL.
function extractOutput(data, outputField) {
    if (!outputField || outputField === 'images[0].url') return data?.images?.[0]?.url;
    if (outputField === 'video.url') return data?.video?.url;
    if (outputField === 'audio.url') return data?.audio?.url;
    if (outputField === 'custom_voice_id') return data?.custom_voice_id;
    // Generic dot/bracket path traversal
    return outputField.split(/[\.\[\]]+/).filter(Boolean).reduce((o, k) => o?.[k], data);
}

async function falPoll(statusUrl, responseUrl, key, maxAttempts, interval) {
    const pollUrl = toProxy(statusUrl);
    const resultUrl = toProxy(responseUrl);
    const authHeaders = { 'Authorization': `Key ${key}` };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(r => setTimeout(r, interval));
        try {
            const res = await fetch(pollUrl, { headers: authHeaders });
            if (!res.ok) {
                const errText = await res.text();
                if (res.status >= 500) continue;
                notifyAuthRequired(res.status, errText);
                throw new Error(`Poll failed: ${res.status} - ${errText.slice(0, 100)}`);
            }
            const { status, error } = await res.json();
            if (status === 'COMPLETED') {
                const resultRes = await fetch(resultUrl, { headers: authHeaders });
                if (!resultRes.ok) throw new Error(`Result fetch failed: ${resultRes.status}`);
                return await resultRes.json();
            }
            if (status === 'FAILED') {
                throw new Error(`Generation failed: ${error?.message || error || 'Unknown error'}`);
            }
            // IN_QUEUE / IN_PROGRESS — keep polling
        } catch (err) {
            if (attempt === maxAttempts) throw err;
        }
    }
    throw new Error('Generation timed out after polling.');
}

async function falSubmitAndPoll(falSlug, payload, key, onRequestId, maxAttempts = 900, interval = 2000) {
    // No key yet — nudge the user to enter one instead of sending "Key null" to fal.
    if (!key || !String(key).trim()) {
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('og:api-key-required'));
        }
        throw new Error('Please enter your fal.ai API key first.');
    }
    const res = await fetch(`${FAL_PROXY}/${falSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Key ${key}` },
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const errText = await res.text();
        notifyAuthRequired(res.status, errText);
        throw new Error(`API Request Failed: ${res.status} ${res.statusText} - ${errText.slice(0, 100)}`);
    }
    const submitData = await res.json();
    const { request_id, status_url, response_url } = submitData;
    if (!request_id) return submitData; // Synchronous response (no queue)
    if (onRequestId) onRequestId(request_id);
    return await falPoll(status_url, response_url, key, maxAttempts, interval);
}

// ─── Generation exports ──────────────────────────────────────────────────────

export async function generateImage(apiKey, params) {
    const modelInfo = getModelById(params.model);
    const falSlug = modelInfo?.falSlug;
    if (!falSlug) throw new Error(`No fal slug configured for model: ${params.model}`);
    const payload = applyInputMap(params, modelInfo.inputMap);
    const result = await falSubmitAndPoll(falSlug, payload, apiKey, params.onRequestId, 60);
    return { ...result, url: extractOutput(result, modelInfo.outputField || 'images[0].url') };
}

export async function generateI2I(apiKey, params) {
    const modelInfo = getI2IModelById(params.model);
    const falSlug = modelInfo?.falSlug;
    if (!falSlug) throw new Error(`No fal slug configured for model: ${params.model}`);
    // Normalize: pick primary image from images_list[0] or image_url
    const imageField = modelInfo?.imageField || 'image_url';
    const src = params.images_list?.[0] ?? params.image_url ?? null;
    const merged = { ...params };
    if (src) {
        if (imageField === 'images_list') merged.images_list = params.images_list || [src];
        else merged[imageField] = src;
    }
    const payload = applyInputMap(merged, modelInfo.inputMap);
    const result = await falSubmitAndPoll(falSlug, payload, apiKey, params.onRequestId, 60);
    return { ...result, url: extractOutput(result, modelInfo.outputField || 'images[0].url') };
}

export async function generateVideo(apiKey, params) {
    const modelInfo = getVideoModelById(params.model);
    const falSlug = modelInfo?.falSlug;
    if (!falSlug) throw new Error(`No fal slug configured for model: ${params.model}`);
    const payload = applyInputMap(params, modelInfo.inputMap);
    const result = await falSubmitAndPoll(falSlug, payload, apiKey, params.onRequestId, 900);
    return { ...result, url: extractOutput(result, modelInfo.outputField || 'video.url') };
}

export async function generateI2V(apiKey, params) {
    const modelInfo = getI2VModelById(params.model);
    const falSlug = modelInfo?.falSlug;
    if (!falSlug) throw new Error(`No fal slug configured for model: ${params.model}`);
    const imageField = modelInfo?.imageField || 'image_url';
    const src = params.images_list?.[0] ?? params.image_url ?? null;
    const merged = { ...params };
    if (src) {
        if (imageField === 'images_list') merged.images_list = params.images_list || [src];
        else merged[imageField] = src;
    }
    if (modelInfo?.lastImageField && params.last_image) {
        merged[modelInfo.lastImageField] = params.last_image;
    }
    const payload = applyInputMap(merged, modelInfo.inputMap);
    const result = await falSubmitAndPoll(falSlug, payload, apiKey, params.onRequestId, 900);
    return { ...result, url: extractOutput(result, modelInfo.outputField || 'video.url') };
}

export async function processV2V(apiKey, params) {
    const modelInfo = getV2VModelById(params.model);
    const falSlug = modelInfo?.falSlug;
    if (!falSlug) throw new Error(`No fal slug configured for model: ${params.model}`);
    const payload = applyInputMap(params, modelInfo.inputMap);
    const result = await falSubmitAndPoll(falSlug, payload, apiKey, params.onRequestId, 900);
    return { ...result, url: extractOutput(result, modelInfo.outputField || 'video.url') };
}

export async function processLipSync(apiKey, params) {
    const modelInfo = getLipSyncModelById(params.model);
    const falSlug = modelInfo?.falSlug;
    if (!falSlug) throw new Error(`No fal slug configured for model: ${params.model}`);
    const payload = applyInputMap(params, modelInfo.inputMap);
    const result = await falSubmitAndPoll(falSlug, payload, apiKey, params.onRequestId, 900);
    return { ...result, url: extractOutput(result, modelInfo.outputField || 'video.url') };
}

export async function generateAudio(apiKey, params) {
    const modelId = params._modelId || params.model;
    const modelInfo = getAudioModelById(modelId);
    const falSlug = modelInfo?.falSlug;
    if (!falSlug) throw new Error(`No fal slug configured for model: ${modelId}`);
    const payload = applyInputMap(params, modelInfo.inputMap);
    const result = await falSubmitAndPoll(falSlug, payload, apiKey, params.onRequestId, 900);
    return { ...result, url: extractOutput(result, modelInfo.outputField || 'audio.url') };
}

// Upload a file to fal storage and return the hosted CDN URL.
// Routes through /api/fal-storage/* proxy (added in Phase 2).
export function uploadFile(apiKey, file, onProgress) {
    return new Promise((resolve, reject) => {
        const uploadUrl = (typeof window !== 'undefined' && window.location?.protocol?.startsWith('http'))
            ? '/api/fal-storage/upload'
            : 'https://fal.run/storage/upload';
        const xhr = new XMLHttpRequest();
        xhr.open('POST', uploadUrl);
        xhr.setRequestHeader('Authorization', `Key ${apiKey}`);
        if (onProgress) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
            };
        }
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    const fileUrl = data.url || data.cdn_url;
                    if (!fileUrl) reject(new Error('No URL returned from fal upload'));
                    else resolve(fileUrl);
                } catch {
                    reject(new Error('Failed to parse fal upload response'));
                }
            } else {
                notifyAuthRequired(xhr.status, xhr.statusText);
                reject(new Error(`File upload failed: ${xhr.status} - ${xhr.statusText}`));
            }
        };
        xhr.onerror = () => reject(new Error('Network error during file upload'));
        const formData = new FormData();
        formData.append('file', file);
        xhr.send(formData);
    });
}

// ─── Stubs for removed MuAPI-only features ───────────────────────────────────
// These exports preserve import compatibility while their UI surfaces are removed
// in Phase 4. List-style stubs return empty arrays to avoid crash-on-load.

const _removed = (name) => () => Promise.reject(new Error(`${name} is not available — MuAPI removed.`));
const _empty = () => Promise.resolve([]);

export const generateMarketingStudioAd = _removed('generateMarketingStudioAd');
export const getUserBalance            = _removed('getUserBalance');
export const calculateDynamicCost     = _removed('calculateDynamicCost');
export const registerAppInterest      = _removed('registerAppInterest');
export const getAppInterests          = _empty;
export const runClipping              = _removed('runClipping');
export const runMotionGraphics        = _removed('runMotionGraphics');
export const runMotionGraphicsEdit    = _removed('runMotionGraphicsEdit');

export const getTemplateWorkflows  = _empty;
export const getUserWorkflows      = _empty;
export const getPublishedWorkflows = _empty;
export const createWorkflow        = _removed('createWorkflow');
export const updateWorkflowName    = _removed('updateWorkflowName');
export const deleteWorkflow        = _removed('deleteWorkflow');
export const getWorkflowInputs     = _removed('getWorkflowInputs');
export const executeWorkflow       = _removed('executeWorkflow');
export const getAllNodeSchemas      = _removed('getAllNodeSchemas');
export const getWorkflowData       = _removed('getWorkflowData');
export const getNodeSchemas        = _removed('getNodeSchemas');
export const runSingleNode         = _removed('runSingleNode');
export const deleteNodeRun         = _removed('deleteNodeRun');
export const getNodeStatus         = _removed('getNodeStatus');

export const getTemplateAgents   = _empty;
export const getUserAgents       = _empty;
export const getPublishedAgents  = _empty;
export const getUserConversations = _empty;
