// index.js
require('dotenv').config();
const { initializeWhatsApp } = require('./src/auth');
const { startDailyCron } = require('./src/scheduler');
const { setupListeners } = require('./src/listener');

console.log('🚀 AUG Master Bot Initialize ho raha hai...\n');

let isAppInitialized = false; // Duplicate execution guard

async function main() {
    try {
        const client = await initializeWhatsApp();

        client.on('ready', async () => {
            if (isAppInitialized) {
                console.log('ℹ️ WhatsApp Client reconnected/re-synced.');
                return;
            }
            isAppInitialized = true;

            console.log('\n==================================================');
            console.log('🤖 AUG BOT IS LIVE & READY FOR ACTION!');
            console.log('==================================================\n');

            setupListeners(client);
            startDailyCron(client);
            
            console.log('✅ Sabhi engines (Scheduler + Inbound Listener) live ho chuke hain.');
            console.log('📡 Bot ab 24/7 background mein fully autonomous run kar raha hai.\n');
        });

    } catch (error) {
        console.error('❌ Fatal Bot Initialization Error:', error.message || error);
    }
}

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ Uncaught Exception captured:', error.message || error);
});

main();