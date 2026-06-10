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

// ─── Job 1: Image Captioning ──────────────────────────────────────────────────
// Primary:  Salesforce/blip-image-captioning-base  (has HF inference provider)
// Fallback: build a descriptive caption from Rekognition labels
async function generateCaption(imageBuffer, mimeType = 'image/jpeg', fallbackLabels = []) {
    try {
        const blob = new Blob([imageBuffer], { type: mimeType });

        const result = await withRetry(() =>
            hf.imageToText({
                model: 'Salesforce/blip-image-captioning-base',
                data: blob,
            })
        );

        if (result?.generated_text) {
            console.log('✅ HF caption generated:', result.generated_text);
            return result.generated_text;
        }
    } catch (err) {
        console.warn('HF image captioning failed, using label fallback:', err.message?.slice(0, 120));
    }

    // Fallback: build caption from Rekognition labels (always available)
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
