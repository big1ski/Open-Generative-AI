import {
    getModelById,
    getVideoModelById,
    getI2IModelById,
    getI2VModelById,
    getV2VModelById,
    getLipSyncModelById,
    getAudioModelById,
} from './models.js';

const FAL_PROXY = (typeof window !== 'undefined' && window.location?.protocol?.startsWith('http'))
    ? '/api/fal'
    : 'https://queue.fal.run';

function notifyAuthRequired(status, detail) {
    if (typeof window === 'undefined') return;
    if (status !== 401 && status !== 403) return;
    window.dispatchEvent(new CustomEvent('muapi:auth-required', { detail: { status, message: detail } }));
}

function toProxy(url) {
    if (FAL_PROXY.startsWith('/') && url?.startsWith('https://queue.fal.run/')) {
        return FAL_PROXY + url.slice('https://queue.fal.run'.length);
    }
    return url;
}

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

function extractOutput(data, outputField) {
    if (!outputField || outputField === 'images[0].url') return data?.images?.[0]?.url;
    if (outputField === 'video.url') return data?.video?.url;
    if (outputField === 'audio.url') return data?.audio?.url;
    if (outputField === 'custom_voice_id') return data?.custom_voice_id;
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
        } catch (err) {
            if (attempt === maxAttempts) throw err;
        }
    }
    throw new Error('Generation timed out after polling.');
}

async function falSubmitAndPoll(falSlug, payload, key, onRequestId, maxAttempts, interval) {
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
    if (!request_id) return submitData;
    if (onRequestId) onRequestId(request_id);
    return await falPoll(status_url, response_url, key, maxAttempts, interval);
}

export class MuapiClient {
    getKey() {
        // Phase 3 will rename this to 'fal_key'
        const key = window.__MUAPI_KEY__ || localStorage.getItem('fal_key');
        if (!key) throw new Error('API Key missing. Please set it in Settings.');
        return key;
    }

    async generateImage(params) {
        const key = this.getKey();
        const modelInfo = getModelById(params.model);
        const falSlug = modelInfo?.falSlug;
        if (!falSlug) throw new Error(`No fal slug configured for model: ${params.model}`);
        const payload = applyInputMap(params, modelInfo.inputMap);
        const result = await falSubmitAndPoll(falSlug, payload, key, params.onRequestId, 60, 2000);
        return { ...result, url: extractOutput(result, modelInfo.outputField || 'images[0].url') };
    }

    async generateI2I(params) {
        const key = this.getKey();
        const modelInfo = getI2IModelById(params.model);
        const falSlug = modelInfo?.falSlug;
        if (!falSlug) throw new Error(`No fal slug configured for model: ${params.model}`);
        const imageField = modelInfo?.imageField || 'image_url';
        const src = params.images_list?.[0] ?? params.image_url ?? null;
        const merged = { ...params };
        if (src) {
            if (imageField === 'images_list') merged.images_list = params.images_list || [src];
            else merged[imageField] = src;
        }
        const payload = applyInputMap(merged, modelInfo.inputMap);
        const result = await falSubmitAndPoll(falSlug, payload, key, params.onRequestId, 60, 2000);
        return { ...result, url: extractOutput(result, modelInfo.outputField || 'images[0].url') };
    }

    async generateVideo(params) {
        const key = this.getKey();
        const modelInfo = getVideoModelById(params.model);
        const falSlug = modelInfo?.falSlug;
        if (!falSlug) throw new Error(`No fal slug configured for model: ${params.model}`);
        const payload = applyInputMap(params, modelInfo.inputMap);
        const result = await falSubmitAndPoll(falSlug, payload, key, params.onRequestId, 900, 2000);
        return { ...result, url: extractOutput(result, modelInfo.outputField || 'video.url') };
    }

    async generateI2V(params) {
        const key = this.getKey();
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
        const result = await falSubmitAndPoll(falSlug, payload, key, params.onRequestId, 900, 2000);
        return { ...result, url: extractOutput(result, modelInfo.outputField || 'video.url') };
    }

    async processV2V(params) {
        const key = this.getKey();
        const modelInfo = getV2VModelById(params.model);
        const falSlug = modelInfo?.falSlug;
        if (!falSlug) throw new Error(`No fal slug configured for model: ${params.model}`);
        const payload = applyInputMap(params, modelInfo.inputMap);
        const result = await falSubmitAndPoll(falSlug, payload, key, params.onRequestId, 900, 2000);
        return { ...result, url: extractOutput(result, modelInfo.outputField || 'video.url') };
    }

    async processLipSync(params) {
        const key = this.getKey();
        const modelInfo = getLipSyncModelById(params.model);
        const falSlug = modelInfo?.falSlug;
        if (!falSlug) throw new Error(`No fal slug configured for model: ${params.model}`);
        const payload = applyInputMap(params, modelInfo.inputMap);
        const result = await falSubmitAndPoll(falSlug, payload, key, params.onRequestId, 900, 2000);
        return { ...result, url: extractOutput(result, modelInfo.outputField || 'video.url') };
    }

    async generateAudio(params) {
        const key = this.getKey();
        const modelId = params._modelId || params.model;
        const modelInfo = getAudioModelById(modelId);
        const falSlug = modelInfo?.falSlug;
        if (!falSlug) throw new Error(`No fal slug configured for model: ${modelId}`);
        const payload = applyInputMap(params, modelInfo.inputMap);
        const result = await falSubmitAndPoll(falSlug, payload, key, params.onRequestId, 900, 2000);
        return { ...result, url: extractOutput(result, modelInfo.outputField || 'audio.url') };
    }

    async uploadFile(file, onProgress) {
        const key = this.getKey();
        return new Promise((resolve, reject) => {
            const uploadUrl = (typeof window !== 'undefined' && window.location?.protocol?.startsWith('http'))
                ? '/api/fal-storage/upload'
                : 'https://fal.run/storage/upload';
            const xhr = new XMLHttpRequest();
            xhr.open('POST', uploadUrl);
            xhr.setRequestHeader('Authorization', `Key ${key}`);
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
}

export const muapi = new MuapiClient();
