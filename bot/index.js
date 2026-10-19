// bot/index.js
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const qrcode = require('qrcode-terminal');

// Global crash protectors
process.on('uncaughtException', (err) => {
    const msg = (err && err.message) ? err.message : String(err);
    if (
        msg.includes('File not found for id') ||
        msg.includes('getaddrinfo ENOTFOUND') ||
        msg.includes('MongoNetworkError') ||
        msg.includes('timed out') ||
        msg.includes('Execution context was destroyed') ||
        msg.includes('Protocol error') ||
        msg.includes('ENOENT') ||
        msg.includes('RemoteAuth')
    ) {
        console.warn('⚠️ Safe warning handled. Client continuing...');
        return;
    }
    console.error('⚠️ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
    const msg = (reason && reason.message) ? reason.message : String(reason);
    if (
        msg.includes('File not found for id') ||
        msg.includes('getaddrinfo ENOTFOUND') ||
        msg.includes('MongoNetworkError') ||
        msg.includes('Execution context was destroyed') ||
        msg.includes('Protocol error')
    ) {
        console.warn('⚠️ Async session update handled safely.');
        return;
    }
    console.error('⚠️ Unhandled Rejection:', reason);
});

const BOT_SESSION_ID = 'AUG_CORE_SESSION';

const authDir = path.join(__dirname, '.wwebjs_auth');
if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

console.log(`🚀 AUG Master Bot Initializing [RemoteAuth Session: ${BOT_SESSION_ID}]...`);

async function startBot() {
    try {
        console.log(`🔄 Connecting to MongoDB Atlas...`);
        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 20000,
            socketTimeoutMS: 45000,
            family: 4
        });
        console.log('✅ MongoDB Connected! Session state synchronized.');

        const store = new MongoStore({ mongoose });

        const client = new Client({
            authStrategy: new RemoteAuth({
                clientId: BOT_SESSION_ID,
                store: store,
                backupSyncIntervalMs: 300000,
                dataPath: authDir
            }),
            puppeteer: {
                headless: true,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-default-apps',
                    '--mute-audio',
                    '--disable-component-update',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-breakpad',
                    '--disable-client-side-phishing-detection',
                    '--disable-sync',
                    '--disable-translate',
                    '--metrics-recording-only',
                    '--no-default-browser-check',
                    '--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,AudioServiceOutOfProcess',
                    '--blink-settings=imagesEnabled=false'
                ]
            }
        });

        client.on('qr', async (qr) => {
            const rawPairing = process.env.PAIRING_NUMBER || '918002468432';
            const cleanNumber = String(rawPairing).replace(/\D/g, '');

            if (cleanNumber && typeof client.requestPairingCode === 'function') {
                try {
                    await new Promise(r => setTimeout(r, 2000));
                    const code = await client.requestPairingCode(cleanNumber);
                    console.log('\n==================================================');
                    console.log(`📱 WHATSAPP PAIRING CODE: [ ${code} ]`);
                    console.log(`👉 Phone WhatsApp > Linked Devices > Link with phone number par yeh code enter karein!`);
                    console.log('==================================================\n');
                    return;
                } catch (e) {
                    console.log('⚠️ Pairing request failed, fallback to QR:', e.message || e);
                }
            }

            console.log('\n👇 Fallback QR Code:');
            qrcode.generate(qr, { small: true });
        });

        let isReadyInitialized = false;

        client.on('ready', () => {
            if (isReadyInitialized) return;
            isReadyInitialized = true;

            console.log(`\n✅ SUCCESS: WhatsApp Client is READY! (${BOT_SESSION_ID} connected)\n`);
            console.log('==================================================');
            console.log('🤖 AUG BOT IS LIVE & READY FOR ACTION!');
            console.log('==================================================\n');

            const { setupListeners } = require('./src/listener');
            setupListeners(client);

            const { startDailyCron } = require('./src/scheduler');
            startDailyCron(client);

            console.log('✅ Sabhi engines live ho chuke hain.');
        });

        client.on('authenticated', () => {
            console.log('🔐 Authenticated successfully.');
        });

        client.on('remote_session_saved', () => {
            console.log(`💾 Remote session [${BOT_SESSION_ID}] permanently saved to MongoDB Atlas!`);
        });

        client.on('auth_failure', (msg) => {
            console.error('❌ Auth failure detected:', msg);
        });

        client.initialize();

    } catch (error) {
        console.error('❌ Fatal Bot Initialization Error:', error.message || error);
    }
}

// Keep-alive HTTP server for Railway
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('AUG Consultancy Autonomous Bot Worker is Active\n');
}).listen(PORT, () => {
    console.log(`🌐 Keep-alive server active on port ${PORT}`);
});

startBot();