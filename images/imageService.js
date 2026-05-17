const sharp = require('sharp');
const {
  uploadToS3,
  uploadBufferToS3,
  getFromS3,
  deleteFromS3,
} = require('../utils/s3Upload');
const Image = require('../models/Image');
const redisClient = require('../configs/redis');

// Upload image to S3 bucket
const uploadImage = async (file, userId) => {
  const imageUrl = await uploadToS3(file);
  const image = new Image({ url: imageUrl.url, userId });
  await image.save();
  return imageUrl;
};

// Transform image and cache it
const transformImage = async (id, transformations) => {
  // Get the cached image from Redis if it exists
  const cachedImage = await redisClient.get(id);
  if (cachedImage) {
    return JSON.parse(cachedImage);
  }

  // Get the image from MongoDB and fetch its bytes from S3
  const image = await Image.findById(id);
  const s3Key = image.url.split('.amazonaws.com/')[1];
  const s3Response = await getFromS3(s3Key);
  const imageBuffer = Buffer.concat(await s3Response.data.Body.toArray());

  const transformedImageBuffer = await sharp(imageBuffer)
    .resize(transformations.resize)
    .rotate(transformations.rotate)
    .toBuffer();

  const transformedKey = `transformed-${Date.now()}-${s3Key}`;
  const transformedImageUrl = await uploadBufferToS3(
    transformedImageBuffer,
    transformedKey,
  );
  await redisClient.set(id, JSON.stringify(transformedImageUrl), { EX: 3600 });

  return transformedImageUrl;
};

// Get image from S3 bucket
const getImage = async (id) => {
  const image = await getFromS3(id);
  return image;
};

// Delete image from S3 bucket
const deleteImage = async (id) => {
  await deleteFromS3(id);
  await Image.findByIdAndDelete(id);
};

// List all images
const listImages = async (userId, page, limit) => {
  const images = await Image.find({ userId })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));
  return images;
};

module.exports = {
  uploadImage,
  transformImage,
  getImage,
  deleteImage,
  listImages,
};
