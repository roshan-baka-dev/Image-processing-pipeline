const sharp = require('sharp');
const crypto = require('crypto');
const { isImageSafeFromS3 } = require('../utils/rekognition');
const {
  uploadToS3,
  uploadBufferToS3,
  getFromS3,
  deleteFromS3,
} = require('../utils/s3Upload');
const Image = require('../models/image');
const { redisClient, isRedisReady } = require('../configs/redis');

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
  // upload original to S3 first
  const uploadRes = await uploadToS3(file);
  if (!uploadRes) throw new Error('Failed to upload image to S3');

  const s3Key = file.filename; // uploadToS3 uses file.filename as Key
  const bucket = process.env.AWS_BUCKET_NAME;

  // run Rekognition on the S3 object
  const { safe, blocked, labels } = await isImageSafeFromS3(bucket, s3Key);
  if (!safe) {
    // delete object from S3, leave no trace
    await deleteFromS3(s3Key).catch(() => {});
    const reasons = blocked
      .map((b) => `${b.Name} (${Math.round(b.Confidence)}%)`)
      .join(', ');
    const err = new Error(`Image blocked by content policy: ${reasons}`);
    err.isBlocked = true;
    throw err;
  }

  // Persist record with s3Key
  const image = new Image({ url: uploadRes.url, s3Key, userId });
  await image.save();
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

module.exports = {
  uploadImage,
  transformImage,
  getImage,
  deleteImage,
  listImages,
};
