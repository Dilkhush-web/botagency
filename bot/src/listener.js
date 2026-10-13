// src/listener.js
const { handleIncomingMessage } = require('./reply');

function setupListeners(client) {
    console.log('🎧 Event Listeners active ho gaye hain...');

    // 1. Client se aane wale incoming messages
    client.on('message', async (message) => {
        try {
            await handleIncomingMessage(client, message);
        } catch (err) {
            console.error('❌ Error handling incoming message:', err.message || err);
        }
    });

    // 2. Reconnection guard agar WhatsApp disconnect ho
    client.on('disconnected', (reason) => {
        console.warn(`⚠️ WhatsApp Client disconnected: ${reason}`);
        console.log('🔄 Reconnecting client in 10 seconds...');
        setTimeout(() => {
            client.initialize();
        }, 10000);
    });
}

module.exports = { setupListeners };