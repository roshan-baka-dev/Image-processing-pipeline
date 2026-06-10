// utils/aiService.js
const { HfInference } = require('@huggingface/inference');

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// ─── Retry helper ─────────────────────────────────────────────────────────────
// Used for HF embedding calls (503 cold-start, 429 rate-limit).
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

// ─── Job 1: Caption from Rekognition Labels ───────────────────────────────────
// HF free-tier image-to-text models have no inference providers available.
// Instead, we build a rich, natural-language description from AWS Rekognition
// labels — which are already extracted for free during the upload moderation
// check. The resulting text embeds semantically just as well as a vision model
// caption for the purposes of vector search.
//
// Example output for labels ["Dog","Canine","Outdoor","Park","Running","Grass"]:
//   "A photo of a dog, canine, and outdoor scene — including park, running,
//    and grass."
//
function generateCaption(imageBuffer, mimeType = 'image/jpeg', rekognitionLabels = []) {
    // imageBuffer and mimeType kept in signature for API compatibility
    // (backfill script passes a buffer; we no longer use it for captioning)
    return buildCaptionFromLabels(rekognitionLabels);
}

// Builds a natural-sounding description from Rekognition label name strings.
// Splits labels into "subject" (first 3) and "context" (rest up to 10)
// so the sentence reads more naturally.
function buildCaptionFromLabels(labels = []) {
    if (!labels || labels.length === 0) return 'An uploaded image';

    const clean = labels
        .slice(0, 12)
        .map((l) => l.toLowerCase());

    if (clean.length === 1) return `A photo of ${clean[0]}`;

    const subjects = clean.slice(0, 3);
    const context = clean.slice(3);

    let caption = `A photo of ${subjects.join(', ')}`;
    if (context.length > 0) {
        caption += ` — featuring ${context.join(', ')}`;
    }
    return caption;
}

// ─── Job 2: Text Embeddings ───────────────────────────────────────────────────
// Model: sentence-transformers/all-mpnet-base-v2
// Output: 768-dim float[] — matches MongoDB Atlas vector_index numDimensions.
// This is the only HF API call we make; it works reliably on the free tier.
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