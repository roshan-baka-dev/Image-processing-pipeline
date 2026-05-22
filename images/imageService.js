const sharp = require('sharp');
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
  const imageUrl = await uploadToS3(file);
  if (!imageUrl) {
    throw new Error('Failed to upload image to S3');
  }

  const image = new Image({ url: imageUrl.url, userId });
  await image.save();
  return imageUrl;
};

// Transform image and cache it
const transformImage = async (id, transformations) => {
  if (isRedisReady()) {
    try {
      const cachedImage = await redisClient.get(id);
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

  const s3Key = image.url.split('.amazonaws.com/')[1];
  if (!s3Key) {
    throw new Error('Invalid S3 image URL');
  }

  const s3Response = await getFromS3(s3Key);
  if (!s3Response?.data?.Body) {
    throw new Error('Failed to fetch image from S3');
  }

  const imageBuffer = await streamToBuffer(s3Response.data.Body);
  if (!imageBuffer) {
    throw new Error('Failed to read image from S3');
  }

  const transformedImageBuffer = await sharp(imageBuffer)
    .resize(transformations.resize)
    .rotate(transformations.rotate)
    .toBuffer();

  const transformedKey = `transformed-${Date.now()}-${s3Key}`;
  const transformedImageUrl = await uploadBufferToS3(
    transformedImageBuffer,
    transformedKey,
  );
  if (isRedisReady()) {
    try {
      await redisClient.set(id, JSON.stringify(transformedImageUrl), { EX: 3600 });
    } catch (err) {
      console.error('Redis SET failed, skipping cache write:', err.message);
    }
  }

  return transformedImageUrl;
};

// Get image from S3 bucket
const getImage = async (id) => {
  const s3Response = await getFromS3(id);
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
