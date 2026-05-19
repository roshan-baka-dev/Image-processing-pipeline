const amqp = require('amqplib/callback_api');
const url =
  'amqps://rbkvxtjk:jV3oMgZsRZgQ6vrXz5gTq2Hgrdazu1zX@puffin.rmq2.cloudamqp.com/rbkvxtjk';

console.log('Sending a single connection request to RabbitMQ...');

amqp.connect(url, function (err, conn) {
  if (err) {
    console.error('❌ Connection Failed:', err.message);
    process.exit(1);
  } else {
    console.log('🚀 SUCCESS! Connected to RabbitMQ perfectly.');
    conn.close();
    process.exit(0);
  }
});
