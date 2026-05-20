const redis = require('redis');
const dotenv = require('dotenv');

dotenv.config();

const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
        // Sends a ping packet every 30 seconds to prevent Upstash from closing the connection
        pingInterval: 30000,
        // Auto-reconnect configuration to handle network hiccups gracefully
        reconnectStrategy: (retries) => {
            return Math.min(retries * 50, 2000);
        }
    }
});

// Update error handler to ignore standard idle socket drops
redisClient.on('error', (err) => {
    if (err.message && err.message.includes('Socket closed unexpectedly')) {
        return; // Mutes the idle connection drops
    }
    console.error('Redis Client Error:', err);
});

(async () => {
    try {
        await redisClient.connect();
    } catch (err) {
        console.error('Failed to connect to Redis:', err);
    }
})();

module.exports = redisClient;
