const redis = require('redis');
const dotenv = require('dotenv');

dotenv.config({ override: true });

let isRedisReady = false;

const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    pingInterval: 10000,
    reconnectStrategy: (retries) => {
      if (retries > 20) {
        return new Error('Redis max retries exceeded');
      }
      return Math.min(retries * 50, 2000);
    },
  },
});

redisClient.on('ready', () => {
  isRedisReady = true;
  console.log('Redis client ready');
});

redisClient.on('end', () => {
  isRedisReady = false;
  console.log('Redis client disconnected');
});

redisClient.on('reconnecting', () => {
  console.log('Redis client reconnecting...');
});

redisClient.on('error', (err) => {
  if (err.message?.includes('Socket closed unexpectedly')) {
    return;
  }
  if (err.message?.includes('Connection timeout')) {
    return;
  }
  console.error('Redis Client Error:', err.message);
});

(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    isRedisReady = false;
    console.error('Failed to connect to Redis:', err.message);
  }
})();

module.exports = { redisClient, isRedisReady: () => isRedisReady };
