// bot/index.js
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const qrcode = require('qrcode-terminal');

// Required auth directories auto-creation for Linux/Render
const authDir = path.join(__dirname, '.wwebjs_auth');
if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
}

// RemoteAuth ke internal extract folder ko bhi ensure karein taaki ENOENT na aaye
const sessionDir = path.join(authDir, 'session-Number_1');
if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
}

// Ensure cache directory also exists
const cacheDir = path.join(__dirname, '.wwebjs_cache');
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}

console.log('🚀 AUG Master Bot Initialize ho raha hai...');

async function startBot() {
    try {
        console.log('🔄 MongoDB Atlas se connect ho rahe hain WhatsApp session ke liye...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ MongoDB Connected successfully! Session database mein sync hoga.');

        const store = new MongoStore({ mongoose: mongoose });

        const client = new Client({
            authStrategy: new RemoteAuth({
                clientId: 'Number_1',
                store: store,
                backupSyncIntervalMs: 60000,
                dataPath: authDir
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ]
            }
        });

        client.on('qr', (qr) => {
            console.log('\n👇 QR Code aa gaya hai! Apne WhatsApp se isko scan karein:');
            qrcode.generate(qr, { small: true });
        });

        let isReadyInitialized = false;

        client.on('ready', () => {
            if (isReadyInitialized) {
                console.log('ℹ️ WhatsApp Client reconnected/re-synced.');
                return;
            }
            isReadyInitialized = true;

            console.log('\n✅ SUCCESS: WhatsApp Client is READY! (Number_1 connected)\n');
            console.log('==================================================');
            console.log('🤖 AUG BOT IS LIVE & READY FOR ACTION!');
            console.log('==================================================\n');

            // Event listener aur scheduler trigger
            const { setupListeners } = require('./src/listener');
            setupListeners(client);

            const { startDailyCron } = require('./src/scheduler');
            startDailyCron(client);

            console.log('✅ Sabhi engines (Scheduler + Inbound Listener) live ho chuke hain.');
            console.log('📡 Bot ab 24/7 background mein fully autonomous run kar raha hai.\n');
        });

        client.on('authenticated', () => {
            console.log('🔐 Authenticated successfully.');
        });

        client.on('remote_session_saved', () => {
            console.log('💾 Remote session successfully saved to MongoDB Atlas!');
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
    res.end('AUG Consultancy Bot Worker is Running\n');
}).listen(PORT, () => {
    console.log(`🌐 Keep-alive server active on port ${PORT}`);
});

startBot();