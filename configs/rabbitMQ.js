const dotenv = require('dotenv');
dotenv.config({ override: true });

const amqp = require('amqplib/callback_api');
const { transformImage } = require('../images/imageService');

const rabbitUrl = process.env.RABBITMQ_URL || 'amqp://localhost';
if (!/^amqps?:\/\//.test(rabbitUrl)) {
  throw new Error(`Invalid RABBITMQ_URL: ${rabbitUrl}`);
}

const connectToRabbitMQ = () => {
  amqp.connect(rabbitUrl, (err, connection) => {
    if (err) {
      console.error('Failed to connect to RabbitMQ 🚫', err);
      return;
    }

    console.log('Connected to RabbitMQ Successfully 🚀');

    connection.createChannel((err, channel) => {
      if (err) {
        console.error('Failed to create channel', err);
        return;
      }
      console.log('Channel created 🚀');

      const queue = 'image-processing';
      channel.assertQueue(queue, { durable: true });

      channel.consume(queue, async (message) => {
        if (!message) {
          console.warn('RabbitMQ consumer canceled by server');
          return;
        }

        try {
          const { id, transformations } = JSON.parse(
            message.content.toString(),
          );
          console.log(`Processing image with id: ${id}`);
          await transformImage(id, transformations);
          channel.ack(message);
        } catch (error) {
          console.error('Failed to process image', error);
          channel.reject(message, true);
        }
      });

      console.log('Waiting for messages in the image_processing queue...');
    });
  });
};

module.exports = connectToRabbitMQ;
