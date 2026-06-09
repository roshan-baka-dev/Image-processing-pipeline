// utils/aiService.js
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Job 1: Vision — describe what's in the image
async function generateCaption(imageBuffer, mimeType = 'image/jpeg') {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const imagePart = {
        inlineData: {
            data: imageBuffer.toString('base64'),
            mimeType,
        },
    };

    const result = await model.generateContent([
        'Describe this image in 2-3 sentences. Focus on the main subject, scene, colors, and mood. Be specific and descriptive.',
        imagePart,
    ]);

    return result.response.text();
}

// Job 2: Embeddings — convert text to vector
async function generateEmbedding(text) {
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(text);
    return result.embedding.values; // returns float[]
}

module.exports = { generateCaption, generateEmbedding };
