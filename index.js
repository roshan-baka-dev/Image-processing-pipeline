const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { redisClient } = require('./configs/redis');
const connectToRabbitMQ = require('./configs/rabbitMQ');
const authRoutes = require('./auth/authRoutes');
const imageRoutes = require('./images/imageRoutes');
const cors = require('cors');
dotenv.config();

const PORT = process.env.PORT || 5000;
const app = express();

// Middlewares
const allowedOrigins = [
  'http://localhost:5173',
  'https://image-processing-frontend-xi.vercel.app',
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS not allowed'));
    },
    credentials: true,
  }),
);
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/images', imageRoutes);

mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log('Connected to MongoDB Successfully');

    connectToRabbitMQ();

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.log('Failed to connect to MongoDB', err);
  });

const shutdown = async (signal) => {
  console.log(`${signal} received, shutting down...`);
  try {
    await redisClient.quit();
  } catch (err) {
    console.error('Error closing Redis:', err.message);
  }
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
