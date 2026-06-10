// utils/aiService.js
const { HfInference } = require('@huggingface/inference');

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// ─── Retry helper ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, maxAttempts = 3) {
    let delayMs = 3000;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const msg = err?.message || '';
            const isRetryable =
                msg.includes('503') ||
                msg.includes('429') ||
                msg.includes('loading');

            if (!isRetryable || attempt === maxAttempts) throw err;

            // HF sometimes includes estimated_time in 503 response
            const timeMatch = msg.match(/estimated_time["\s:]+(\d+(?:\.\d+)?)/i);
            const waitMs = timeMatch
                ? Math.ceil(parseFloat(timeMatch[1]) * 1000) + 1000
                : delayMs;

            console.warn(
                `HuggingFace transient error — attempt ${attempt}/${maxAttempts}. ` +
                `Retrying in ${(waitMs / 1000).toFixed(1)}s...`
            );
            await sleep(waitMs);
            delayMs = Math.min(delayMs * 2, 20000);
        }
    }
}

// ─── Job 1: Image Captioning — Waterfall Strategy ────────────────────────────
// Tries 3 free HF vision models in order. If a model has no inference provider
// (common on the free tier), it immediately skips to the next one.
// Only falls back to Rekognition labels if ALL models fail.
async function generateCaption(imageBuffer, mimeType = 'image/jpeg', fallbackLabels = []) {
    const blob = new Blob([imageBuffer], { type: mimeType });

    const visionModels = [
        'Salesforce/blip-image-captioning-large',
        'nlpconnect/vit-gpt2-image-captioning',
        'microsoft/git-base-coco',
    ];

    for (const model of visionModels) {
        try {
            const result = await withRetry(() =>
                hf.imageToText({
                    model,
                    data: blob,
                    // Let HF auto-route globally — no provider lock-in
                })
            );

            if (result?.generated_text) {
                console.log(`✅ HF caption generated via [${model}]: "${result.generated_text}"`);
                return result.generated_text;
            }
        } catch (err) {
            console.warn(`[${model}] unavailable, trying next... (${err.message?.slice(0, 80)})`);
        }
    }

    console.warn('All HF vision models failed — using Rekognition label fallback.');
    return buildCaptionFromLabels(fallbackLabels);
}

// Builds a readable description from AWS Rekognition label names
function buildCaptionFromLabels(labels = []) {
    if (!labels || labels.length === 0) return 'An uploaded image';
    const top = labels.slice(0, 10).join(', ');
    return `A photo containing: ${top}`;
}

// ─── Job 2: Text Embeddings ───────────────────────────────────────────────────
// Model: sentence-transformers/all-mpnet-base-v2
// Output: 768-dim float[] — matches MongoDB Atlas vector_index numDimensions.
async function generateEmbedding(text) {
    const result = await withRetry(() =>
        hf.featureExtraction({
            model: 'sentence-transformers/all-mpnet-base-v2',
            inputs: text,
        })
    );

    // featureExtraction returns float[] for single string input.
    // Guard against nested array shape just in case.
    return Array.isArray(result[0]) ? result[0] : Array.from(result);
}

module.exports = { generateCaption, generateEmbedding, buildCaptionFromLabels };