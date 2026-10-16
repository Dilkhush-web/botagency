// bot/index.js
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const qrcode = require('qrcode-terminal');

// Global crash protectors (Navigation, GridFS & DNS drops ko absorb karenge)
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
        console.warn('⚠️ Safe warning handled (Sync/Navigation/Network). Client continuing smoothly...');
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
        msg.includes('timed out') ||
        msg.includes('Execution context was destroyed') ||
        msg.includes('Protocol error') ||
        msg.includes('ENOENT') ||
        msg.includes('RemoteAuth')
    ) {
        console.warn('⚠️ Async session/navigation update handled safely.');
        return;
    }
    console.error('⚠️ Unhandled Rejection:', reason);
});

// Single Permanent Session ID across Local and Render (Unified Lock)
const BOT_SESSION_ID = process.env.SESSION_CLIENT_ID || 'AUG_CORE_SESSION';

const authDir = path.join(__dirname, '.wwebjs_auth');
if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

const sessionDir = path.join(authDir, `session-${BOT_SESSION_ID}`);
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

const cacheDir = path.join(__dirname, '.wwebjs_cache');
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

console.log(`🚀 AUG Master Bot Initializing [Permanent Session: ${BOT_SESSION_ID}]...`);

async function connectWithRetry(maxWaitMinutes = 15) {
    const intervalMs = 30000;
    const maxAttempts = (maxWaitMinutes * 60 * 1000) / intervalMs;
    let attempts = 0;

    while (attempts < maxAttempts) {
        try {
            attempts++;
            console.log(`🔄 [Attempt ${attempts}/${maxAttempts}] MongoDB Atlas se connect ho rahe hain...`);
            await mongoose.connect(process.env.MONGODB_URI, {
                serverSelectionTimeoutMS: 20000,
                socketTimeoutMS: 45000,
                family: 4
            });
            console.log('✅ MongoDB Connected! Session state synchronized.');
            return true;
        } catch (error) {
            console.warn(`⚠️ Internet / Database Connection drop: ${error.message}`);
            if (attempts >= maxAttempts) {
                console.error('❌ Connection error: 15 min wait over. Bot stopping.');
                return false;
            }
            await new Promise(res => setTimeout(res, intervalMs));
        }
    }
    return false;
}

async function startBot() {
    try {
        const isConnected = await connectWithRetry(15);
        if (!isConnected) return;

        const store = new MongoStore({ mongoose });

        const originalSave = store.save.bind(store);
        store.save = async function (options) {
            try {
                return await originalSave(options);
            } catch (err) {
                if (err.message && err.message.includes('File not found for id')) {
                    console.log('ℹ️ Session ID overwrite handled safely.');
                    return;
                }
                console.warn('⚠️ Session save warning handled:', err.message);
            }
        };

        const client = new Client({
            authStrategy: new RemoteAuth({
                clientId: BOT_SESSION_ID,
                store: store,
                backupSyncIntervalMs: 300000, // 5 min interval to reduce GridFS lock & disk churn
                dataPath: authDir
            }),
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
            },
            puppeteer: {
                headless: true,
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
        '--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider',
        '--blink-settings=imagesEnabled=false',
        '--js-flags=--max-old-space-size=200'  ]
            }
        });

        client.on('qr', async (qr) => {
            const pairingNumber = process.env.PAIRING_NUMBER;
            if (pairingNumber && typeof client.requestPairingCode === 'function') {
                try {
                    const code = await client.requestPairingCode(pairingNumber.replace(/\D/g, ''));
                    console.log('\n==================================================');
                    console.log(`📱 WHATSAPP PAIRING CODE: [ ${code} ]`);
                    console.log(`👉 Apne phone WhatsApp > Linked Devices > Link with phone number par jaakar yeh code enter karein!`);
                    console.log('==================================================\n');
                } catch (e) {
                    console.log('⚠️ Pairing code request error, fallback to QR:');
                    qrcode.generate(qr, { small: true });
                }
            } else {
                console.log('\n👇 QR Code aa gaya hai! Apne WhatsApp se isko scan karein:');
                qrcode.generate(qr, { small: true });
            }
        });

        let isReadyInitialized = false;

        client.on('ready', () => {
            if (isReadyInitialized) {
                console.log('ℹ️ WhatsApp Client reconnected/re-synced.');
                return;
            }
            isReadyInitialized = true;

            console.log(`\n✅ SUCCESS: WhatsApp Client is READY! (${BOT_SESSION_ID} permanently connected)\n`);
            console.log('==================================================');
            console.log('🤖 AUG BOT IS LIVE & READY FOR ACTION!');
            console.log('==================================================\n');

            const { setupListeners } = require('./src/listener');
            setupListeners(client);

            const { startDailyCron } = require('./src/scheduler');
            startDailyCron(client);

            console.log('✅ Sabhi engines (Scheduler + Inbound Listener) live ho chuke hain.');
            console.log('📡 Bot ab background mein permanently autonomous run kar raha hai.\n');
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

// Keep-alive HTTP server for Render Web Service Port Binding
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('AUG Consultancy Autonomous Bot Worker is Active\n');
}).listen(PORT, () => {
    console.log(`🌐 Keep-alive server active on port ${PORT}`);
});

startBot();