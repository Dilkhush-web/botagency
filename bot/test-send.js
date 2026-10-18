// test-send.js
require('dotenv').config();
const mongoose = require('mongoose');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const qrcode = require('qrcode-terminal'); // <-- Yeh add kiya
const { getPendingLeads } = require('./src/sheet');
const { sendOutreachMessages } = require('./src/sender');

async function testSingleSend() {
    console.log('🔄 MongoDB connect ho raha hai...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected.');

    const store = new MongoStore({ mongoose });
    const client = new Client({
        authStrategy: new RemoteAuth({
            clientId: 'Number_1',
            store: store,
            backupSyncIntervalMs: 60000,
            dataPath: './.wwebjs_auth'
        }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    // Sharp visual QR Code print hoga screen par
    client.on('qr', (qr) => {
        console.log('\n👇 QR Code aa gaya hai! WhatsApp se scan karein:');
        qrcode.generate(qr, { small: true });
    });

    client.on('authenticated', () => console.log('🔐 Authenticated successfully!'));
    client.on('remote_session_saved', () => console.log('💾 Remote session saved to MongoDB!'));
    client.on('auth_failure', (m) => console.log('❌ Auth failure:', m));

    client.on('ready', async () => {
        console.log('\n🚀 WhatsApp Client Ready ho gaya hai! Testing 1 lead...');
        try {
            const leads = await getPendingLeads();
            console.log(`📋 Total pending leads: ${leads.length}`);
            if (leads.length > 0) {
                // Sirf 1 lead ko real message shoot karega
                await sendOutreachMessages(client, leads, 1);
                console.log('\n🎯 TEST SUCCESSFUL! Check WhatsApp & Google Sheet.');
            } else {
                console.log('⚠️ Sheet mein koi pending lead nahi mili.');
            }
        } catch (err) {
            console.error('❌ Error sending test lead:', err);
        }
        process.exit(0);
    });

    console.log('⏳ WhatsApp initialize ho raha hai...');
    client.initialize();
}

testSingleSend();