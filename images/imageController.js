const {
  uploadImage,
  transformImage,
  getImage,
  deleteImage,
  listImages,
  searchImages,
} = require('./imageService');
const Image = require('../models/image');
const { getFromS3 } = require('../utils/s3Upload');
const { redisClient, isRedisReady } = require('../configs/redis');

const getFileExtensionFromContentType = (contentType) => {
  const normalizedContentType = (contentType || '').toLowerCase();

  switch (normalizedContentType) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/bmp':
      return 'bmp';
    case 'image/svg+xml':
      return 'svg';
    case 'image/tiff':
      return 'tiff';
    case 'image/avif':
      return 'avif';
    default:
      return 'bin';
  }
};

const uploadImageController = async (req, res) => {
  try {
    const { file } = req;
    const userId = req.userId;

    if (!file || !userId) {
      return res.status(400).json({ message: 'File and userId are required' });
    }

    const imageUrl = await uploadImage(file, userId);
    res.status(201).json({ imageUrl, message: 'Image uploaded successfully' });
  } catch (error) {
    if (error && error.isBlocked) {
      return res.status(403).json({ isBlocked: true, message: error.message });
    }
    // Multer file size limit errors come with code 'LIMIT_FILE_SIZE'
    if (error && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'File too large' });
    }
    res
      .status(500)
      .json({ message: 'Error uploading image', error: error.message });
  }
};

const transformImageController = async (req, res) => {
  try {
    const { id } = req.params;
    const { transformations } = req.body;

    if (!id || !transformations) {
      return res
        .status(400)
        .json({ message: 'Id and transformations are required' });
    }

    const imageUrl = await transformImage(id, transformations);
    res
      .status(200)
      .json({ imageUrl, message: 'Image transformed successfully' });
  } catch (error) {
    res
      .status(500)
      .json({ message: 'Error transforming image', error: error.message });
  }
};

const getImageController = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: 'Id is required' });
    }

    const imageData = await getImage(id);
    res.set(
      'Content-Type',
      imageData.contentType || 'application/octet-stream',
    );
    res.status(200).send(imageData.buffer);
  } catch (error) {
    res
      .status(500)
      .json({ message: 'Error getting image', error: error.message });
  }
};

const deleteImageController = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: 'Id is required' });
    }

    await deleteImage(id);
    res.status(200).json({ message: 'Image deleted successfully' });
  } catch (error) {
    res
      .status(500)
      .json({ message: 'Error deleting image', error: error.message });
  }
};

const listImagesController = async (req, res) => {
  try {
    const { userId } = req;
    const { page, limit } = req.query;

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const images = await listImages(userId, page, limit);
    res.status(200).json({ images, message: 'Images listed successfully' });
  } catch (error) {
    res
      .status(500)
      .json({ message: 'Error listing images', error: error.message });
  }
};

// POST /images/search
const searchImagesController = async (req, res) => {
  try {
    const { query } = req.body;
    const userId = req.userId;
    if (!query) {
      return res.status(400).json({ message: 'Search query is required' });
    }
    const results = await searchImages(userId, query);
    res.status(200).json({ results, message: 'Search completed' });
  } catch (error) {
    res.status(500).json({ message: 'Search failed', error: error.message });
  }
};

module.exports = {
  uploadImageController,
  transformImageController,
  getImageController,
  deleteImageController,
  listImagesController,
  searchImagesController,
  // new download controller
  downloadImageController: async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ message: 'Id is required' });
      }

      // Find image document
      const imageDoc = await Image.findById(id);
      if (!imageDoc) {
        return res.status(404).json({ message: 'Image not found' });
      }

      let url = imageDoc.url;
      if (isRedisReady()) {
        try {
          const cached = await redisClient.get(id);
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              url = parsed.url || parsed;
            } catch (e) {
              url = cached;
            }
          }
        } catch (err) {
          console.error(
            'Redis GET failed in download, using original URL:',
            err.message,
          );
        }
      }

      const s3Key = url.split('.amazonaws.com/')[1];
      if (!s3Key) {
        return res.status(500).json({ message: 'Invalid S3 URL' });
      }

      const s3Response = await getFromS3(s3Key);
      if (!s3Response || !s3Response.data || !s3Response.data.Body) {
        return res
          .status(500)
          .json({ message: 'Failed to fetch file from S3' });
      }

      const contentType =
        s3Response.data.ContentType || 'application/octet-stream';
      const fileExtension = getFileExtensionFromContentType(contentType);
      const filename = `transformed-${id}.${fileExtension}`;

      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );

      const stream = s3Response.data.Body;
      // stream the S3 body to the response
      stream.pipe(res);
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Error downloading image', error: error.message });
    }
  },
};
