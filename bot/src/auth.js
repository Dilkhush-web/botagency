// src/auth.js
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');
require('dotenv').config();

async function initializeWhatsApp() {
    console.log('🔄 MongoDB Atlas se connect ho rahe hain WhatsApp session ke liye...');

    // 1. Await MongoDB Connection (Pehle connection pakka hoga)
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ MongoDB Connected successfully! Session database mein sync hoga.');
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err.message);
        throw err;
    }

    const store = new MongoStore({ mongoose: mongoose });

    // 2. WhatsApp Client with RemoteAuth
    const client = new Client({
        authStrategy: new RemoteAuth({
            clientId: process.env.ASSIGNED_BOT || "Number_1",
            store: store,
            backupSyncIntervalMs: 300000 // Har 5 minute mein session auto-sync karega
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

    // QR Code display in terminal
    client.on('qr', (qr) => {
        console.log('\n👇 QR Code aa gaya hai! Apne WhatsApp se isko scan karein:');
        qrcode.generate(qr, { small: true });
    });

    // Remote session saved confirmation
    client.on('remote_session_saved', () => {
        console.log('💾 WhatsApp session successfully MongoDB Atlas mein save ho gaya hai!');
    });

    client.on('ready', () => {
        console.log(`\n✅ SUCCESS: WhatsApp Client is READY! (${process.env.ASSIGNED_BOT || "Number_1"} connected)`);
    });

    client.on('auth_failure', (msg) => {
        console.error('❌ Authentication fail ho gaya:', msg);
    });

    await client.initialize();
    return client;
}

module.exports = { initializeWhatsApp };