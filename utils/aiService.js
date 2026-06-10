// utils/aiService.js
const { HfInference } = require('@huggingface/inference');

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// ─── Retry helper ─────────────────────────────────────────────────────────────
// HF free tier returns 503 (model loading) and 429 (rate limit).
// 503 means the model is cold-starting — wait and retry, it usually resolves.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, maxAttempts = 4) {
    let delayMs = 2000; // start at 2s
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const msg = err?.message || '';
            const isRetryable =
                msg.includes('503') ||   // model loading (cold start)
                msg.includes('429') ||   // rate limit
                msg.includes('loading'); // HF "Model is currently loading"

            if (!isRetryable || attempt === maxAttempts) throw err;

            // HF sometimes returns estimated load time e.g. "estimated_time: 20"
            const timeMatch = msg.match(/estimated_time["\s:]+(\d+(?:\.\d+)?)/i);
            const waitMs = timeMatch
                ? Math.ceil(parseFloat(timeMatch[1]) * 1000) + 1000
                : delayMs;

            console.warn(
                `HuggingFace transient error — attempt ${attempt}/${maxAttempts}. ` +
                `Retrying in ${(waitMs / 1000).toFixed(1)}s... (${msg.slice(0, 80)})`
            );
            await sleep(waitMs);
            delayMs = Math.min(delayMs * 2, 30000); // cap at 30s
        }
    }
}

// ─── Job 1: Image Captioning ──────────────────────────────────────────────────
// Model: Salesforce/blip-image-captioning-large
// Free tier, no quota limits, just cold-start 503s on first use.
async function generateCaption(imageBuffer, mimeType = 'image/jpeg') {
    return withRetry(async () => {
        const blob = new Blob([imageBuffer], { type: mimeType });

        const result = await hf.imageToText({
            model: 'Salesforce/blip-image-captioning-large',
            data: blob,
        });

        return result.generated_text || '';
    });
}

// ─── Job 2: Text Embeddings ───────────────────────────────────────────────────
// Model: sentence-transformers/all-mpnet-base-v2
// Outputs: 768-dim float[] — matches the MongoDB Atlas vector_index numDimensions.
async function generateEmbedding(text) {
    return withRetry(async () => {
        const result = await hf.featureExtraction({
            model: 'sentence-transformers/all-mpnet-base-v2',
            inputs: text,
        });

        // featureExtraction returns float[] for a single string input
        // Guard against nested array just in case
        return Array.isArray(result[0]) ? result[0] : Array.from(result);
    });
}

module.exports = { generateCaption, generateEmbedding };
