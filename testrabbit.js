const amqp = require("amqplib");

const url = "amqps://rbkvxtjk:jV3oMgZsRZgQ6vrXz5gTq2Hgrdazu1zX@puffin.rmq2.cloudamqp.com/rbkvxtjk";

async function test() {
    try {
        const conn = await amqp.connect(url);
        console.log("✅ Connected successfully!");
        await conn.close();
    } catch (err) {
        console.error("❌ Connection failed:");
        console.error(err);
    }
}

test();
