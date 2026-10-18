// bot/index.js
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const mongoose = require('mongoose');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Global crash protectors
process.on('uncaughtException', (err) => {
    const msg = (err && err.message) ? err.message : String(err);
    if (
        msg.includes('Execution context was destroyed') ||
        msg.includes('Protocol error') ||
        msg.includes('Navigation') ||
        msg.includes('getaddrinfo ENOTFOUND') ||
        msg.includes('MongoNetworkError')
    ) {
        console.warn('⚠️ Safe warning handled. Continuing execution...');
        return;
    }
    console.error('⚠️ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
    const msg = (reason && reason.message) ? reason.message : String(reason);
    if (
        msg.includes('Execution context was destroyed') ||
        msg.includes('Protocol error') ||
        msg.includes('MongoNetworkError')
    ) {
        console.warn('⚠️ Safe async warning handled.');
        return;
    }
    console.error('⚠️ Unhandled Rejection:', reason);
});

// Persistent Volume Directory (Railway Mount Path: /app/.wwebjs_auth)
const authDir = path.join(__dirname, '.wwebjs_auth');
if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

// 100% BULLETPROOF FIX: Force delete all Linux Chromium Singleton symlinks and sockets
function forceCleanChromiumLocks(dirPath) {
    if (!fs.existsSync(dirPath)) return;
    try {
        // Kill any rogue chromium/chrome processes if running
        try { execSync('pkill -f "(chrome|chromium)" || true'); } catch (e) {}

        // Delete all Singleton lock files, sockets, and symlinks on disk
        execSync(`find "${dirPath}" -name "Singleton*" -delete 2>/dev/null || true`);
        console.log('🧹 Purane container ke saare stale Chromium locks force clean ho gaye.');
    } catch (err) {
        console.warn('⚠️ Lock cleanup note:', err.message);
    }
}

console.log('🚀 AUG Master Bot Initializing [Engine: LocalAuth + Persistent Storage]...');

async function connectDatabase() {
    if (!process.env.MONGODB_URI) return;
    try {
        console.log('🔄 Connecting to MongoDB for lead tracking...');
        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 20000,
            socketTimeoutMS: 45000,
            family: 4
        });
        console.log('✅ MongoDB Connected successfully!');
    } catch (err) {
        console.warn('⚠️ Database connection warning:', err.message);
    }
}

async function startBot() {
    try {
        await connectDatabase();

        // Browser launch se theek pehle disk locks force clear karo
        forceCleanChromiumLocks(authDir);

        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: 'AUG_CORE_SESSION',
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
                    console.log('⚠️ Pairing request attempt failed, showing QR:', e.message || e);
                }
            }

            console.log('\n👇 Fallback QR Code:');
            qrcode.generate(qr, { small: true });
        });

        let isReadyInitialized = false;

        client.on('ready', () => {
            if (isReadyInitialized) return;
            isReadyInitialized = true;

            console.log('\n✅ SUCCESS: WhatsApp Client is READY & PERMANENTLY CONNECTED!\n');
            console.log('==================================================');
            console.log('🤖 AUG BOT IS LIVE & READY FOR ACTION!');
            console.log('==================================================\n');

            const { setupListeners } = require('./src/listener');
            setupListeners(client);

            const { startDailyCron } = require('./src/scheduler');
            startDailyCron(client);

            console.log('✅ Sabhi engines live ho chuke hain.');
            console.log('📡 Bot background mein persistent storage ke sath run kar raha hai.\n');
        });

        client.on('authenticated', () => {
            console.log('🔐 Authenticated successfully. Session saved directly to persistent volume disk.');
        });

        client.on('auth_failure', (msg) => {
            console.error('❌ Auth failure detected:', msg);
        });

        client.initialize();

    } catch (error) {
        console.error('❌ Fatal Bot Initialization Error:', error.message || error);
    }
}

// Keep-alive HTTP server for Railway Port Binding
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('AUG Consultancy Autonomous Bot Worker is Active\n');
}).listen(PORT, () => {
    console.log(`🌐 Keep-alive server active on port ${PORT}`);
});

startBot();