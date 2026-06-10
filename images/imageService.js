const sharp = require('sharp');
const crypto = require('crypto');
const { isImageSafeFromS3, detectGeneralLabelsS3 } = require('../utils/rekognition');
const {
  uploadToS3,
  uploadBufferToS3,
  getFromS3,
  deleteFromS3,
} = require('../utils/s3Upload');
const Image = require('../models/image');
const { redisClient, isRedisReady } = require('../configs/redis');

const { generateCaption, generateEmbedding } = require('../utils/aiService');

const streamToBuffer = async (body) => {
  if (!body) {
    return null;
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    body.on('data', (chunk) => chunks.push(chunk));
    body.on('end', () => resolve(Buffer.concat(chunks)));
    body.on('error', (error) => reject(error));
  });
};

// Upload image to S3 bucket
const uploadImage = async (file, userId) => {
  // ✅ Read buffer FIRST — uploadToS3 deletes the temp file in its finally block,
  // so we must capture the bytes before calling it or we'll get ENOENT.
  const fs = require('fs');
  let imageBuffer = null;
  try {
    imageBuffer = fs.readFileSync(file.path);
  } catch (e) {
    console.error('Could not read temp file for AI enrichment:', e.message);
  }

  const uploadRes = await uploadToS3(file); // deletes file.path internally
  if (!uploadRes) throw new Error('Failed to upload image to S3');
  const s3Key = file.filename;
  const bucket = process.env.AWS_BUCKET_NAME;
  const { safe, blocked, labels } = await isImageSafeFromS3(bucket, s3Key);
  if (!safe) {
    await deleteFromS3(s3Key).catch(() => { });
    const reasons = blocked.map((b) => `${b.Name} (${Math.round(b.Confidence)}%)`).join(', ');
    const err = new Error(`Image blocked by content policy: ${reasons}`);
    err.isBlocked = true;
    throw err;
  }
  // Get general object/scene labels for caption + search tags.
  // Wrapped in try-catch — if DetectLabels fails (e.g. IAM permission not set),
  // the upload still succeeds; AI enrichment will just get an empty tag list.
  let generalTags = [];
  try {
    generalTags = await detectGeneralLabelsS3(bucket, s3Key);
  } catch (e) {
    console.error('DetectLabels failed (check IAM rekognition:DetectLabels permission):', e.message);
  }

  const image = new Image({ url: uploadRes.url, s3Key, userId, tags: generalTags });
  await image.save();

  // ✨ Fire-and-forget AI enrichment (non-blocking)
  if (imageBuffer) {
    enrichImageWithAI(image._id, imageBuffer, generalTags, file.mimetype).catch((err) =>
      console.error('AI enrichment failed:', err.message)
    );
  }
  return { url: uploadRes.url, s3Key };
};


// Transform image and cache it
const transformImage = async (id, transformations) => {
  transformations = transformations || {};

  // create a short hash of the transformation params so different
  // transforms don't collide in Redis cache
  const transformHash = crypto
    .createHash('md5')
    .update(JSON.stringify(transformations))
    .digest('hex');

  const cacheKey = `transform:${id}:${transformHash}`;

  if (isRedisReady()) {
    try {
      const cachedImage = await redisClient.get(cacheKey);
      if (cachedImage) {
        return JSON.parse(cachedImage);
      }
    } catch (err) {
      console.error('Redis GET failed, skipping cache:', err.message);
    }
  }

  // Get the image from MongoDB and fetch its bytes from S3
  const image = await Image.findById(id);
  if (!image) {
    throw new Error('Image not found');
  }

  // prefer explicit s3Key stored in DB, fall back to URL parsing
  const s3Key = image.s3Key || image.url.split('.amazonaws.com/')[1];
  if (!s3Key) {
    throw new Error('Invalid S3 image URL or missing s3Key');
  }

  const s3Response = await getFromS3(s3Key);
  if (!s3Response?.data?.Body) {
    throw new Error('Failed to fetch image from S3');
  }

  const imageBuffer = await streamToBuffer(s3Response.data.Body);
  if (!imageBuffer) {
    throw new Error('Failed to read image from S3');
  }

  let imagePipeline = sharp(imageBuffer);

  if (transformations.resize) {
    imagePipeline = imagePipeline.resize(transformations.resize);
  }

  if (transformations.rotate) {
    imagePipeline = imagePipeline.rotate(transformations.rotate);
  }

  if (transformations.blackAndWhite) {
    imagePipeline = imagePipeline.grayscale().threshold(128);
  }

  const transformedImageBuffer = await imagePipeline.toBuffer();

  const transformedKey = `transformed-${Date.now()}-${s3Key}`;
  const transformedImageUrl = await uploadBufferToS3(
    transformedImageBuffer,
    transformedKey,
  );
  if (isRedisReady()) {
    try {
      await redisClient.set(cacheKey, JSON.stringify(transformedImageUrl), {
        EX: 3600,
      });
    } catch (err) {
      console.error('Redis SET failed, skipping cache write:', err.message);
    }
  }

  return transformedImageUrl;
};

// Get image from S3 bucket
const getImage = async (id) => {
  // id may be either an Image document id or an S3 key. Prefer resolving
  // an Image document to obtain the stored s3Key, otherwise treat the
  // input as a direct S3 key.
  let s3Key = id;
  try {
    const imageDoc = await Image.findById(id);
    if (imageDoc) {
      s3Key = imageDoc.s3Key || imageDoc.url.split('.amazonaws.com/')[1];
    }
  } catch (e) {
    // not a mongo id or lookup failed; fall back to treating id as key
  }

  const s3Response = await getFromS3(s3Key);
  if (!s3Response?.data?.Body) {
    throw new Error('Failed to fetch image from S3');
  }

  const imageBuffer = await streamToBuffer(s3Response.data.Body);
  if (!imageBuffer) {
    throw new Error('Failed to read image from S3');
  }

  return {
    buffer: imageBuffer,
    contentType: s3Response.data.ContentType,
  };
};

// Delete image from S3 bucket
const deleteImage = async (id) => {
  await deleteFromS3(id);
  await Image.findByIdAndDelete(id);
};

// List all images
const listImages = async (userId, page, limit) => {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const images = await Image.find({ userId })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit);
  return images;
};

// NEW: background AI enrichment
async function enrichImageWithAI(imageId, imageBuffer, existingTags, mimeType = 'image/jpeg') {
  // Pass existingTags as fallback so caption never fails even if HF vision API is down
  const caption = await generateCaption(imageBuffer, mimeType, existingTags);
  const textToEmbed = `${caption} ${existingTags.join(' ')}`;
  const embedding = await generateEmbedding(textToEmbed);
  await Image.findByIdAndUpdate(imageId, {
    caption,
    embedding,
    aiProcessed: true,
  });
  console.log(`✅ AI enrichment done for image ${imageId}: "${caption.slice(0, 60)}..."`);
}

// Semantic search using MongoDB Atlas $vectorSearch
const searchImages = async (userId, queryText, topK = 10) => {
  // generateEmbedding is already imported at the top of this file

  // 1. Embed the user's query
  const queryEmbedding = await generateEmbedding(queryText);

  // 2. Run Atlas Vector Search
  const results = await Image.aggregate([
    {
      $vectorSearch: {
        index: 'vector_index',
        path: 'embedding',
        queryVector: queryEmbedding,
        numCandidates: 100,        // search pool size
        limit: topK,
        filter: { userId: userId } // only search user's own images
      },
    },
    {
      $project: {
        url: 1,
        caption: 1,
        tags: 1,
        s3Key: 1,
        score: { $meta: 'vectorSearchScore' }, // relevance score
      },
    },
  ]);

  return results;
};


module.exports = {
  uploadImage,
  transformImage,
  getImage,
  deleteImage,
  listImages,
  searchImages,
};
