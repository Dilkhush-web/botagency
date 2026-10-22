// bot/index.js
require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Global crash protectors
process.on('uncaughtException', (err) => {
    const msg = err && err.message ? err.message : String(err);

    if (
        msg.includes('Execution context was destroyed') ||
        msg.includes('Protocol error') ||
        msg.includes('Navigation') ||
        msg.includes('getaddrinfo ENOTFOUND') ||
        msg.includes('MongoNetworkError')
    ) {
        console.warn('⚠️ Runtime warning:', msg);
        return;
    }

    console.error('⚠️ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
    const msg =
        reason && reason.message ? reason.message : String(reason);

    if (
        msg.includes('Execution context was destroyed') ||
        msg.includes('Protocol error') ||
        msg.includes('MongoNetworkError')
    ) {
        console.warn('⚠️ Async warning:', msg);
        return;
    }

    console.error('⚠️ Unhandled Rejection:', reason);
});

// Must match the actual Railway volume mount path.
// Local development can set AUTH_DATA_PATH separately.
const authDir = path.resolve(
    process.env.AUTH_DATA_PATH || '/app/.wwebjs_auth'
);

const CLIENT_ID = 'AUG_CORE_SESSION';
const sessionFolder = path.join(
    authDir,
    `session-${CLIENT_ID}`
);

let client = null;
let whatsappReady = false;
let shuttingDown = false;
let server = null;

// Remove only Chromium's profile-root singleton entries.
// Never recursively remove database/storage lock files.
// Run automatically on startup to prevent Code: 21 errors.
function removeAllLocksDeep(dir) {
    const allowedDir = path.resolve(sessionFolder);

    if (path.resolve(dir) !== allowedDir) {
        console.warn('⚠️ Refusing cleanup outside the configured session.');
        return;
    }

    if (!fs.existsSync(dir)) {
        console.log('ℹ️ No existing session folder to clean.');
        return;
    }

    const lockNames = [
        'SingletonLock',
        'SingletonSocket',
        'SingletonCookie'
    ];

    for (const name of lockNames) {
        const lockPath = path.join(dir, name);

        try {
            // unlink also handles dangling symlinks.
            fs.unlinkSync(lockPath);
            console.log(`🗑️ Removed Chromium lock: ${name}`);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.warn(`⚠️ Lock removal note for ${name}:`, err.message);
            }
        }
    }
}

// Automatic lock removal on every startup (Fixed)
function unlockBrowserProfile() {
    console.log('🧹 Automatic Chromium session lock cleanup...');
    try {
        removeAllLocksDeep(sessionFolder);
        console.log('✨ Chromium lock cleanup finished.');
    } catch (err) {
        console.warn('⚠️ Lock cleanup warning:', err.message);
    }
}

console.log(
    '🚀 AUG Master Bot Initializing ' +
    '[Engine: LocalAuth + Persistent Storage]...'
);

async function connectDatabase() {
    if (!process.env.MONGODB_URI) {
        console.warn('⚠️ MONGODB_URI missing. Lead database is unavailable.');
        return;
    }

    try {
        console.log('🔄 Connecting to MongoDB for lead tracking...');

        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 20000,
            socketTimeoutMS: 45000,
            family: 4
        });

        console.log('✅ MongoDB Connected successfully!');
    } catch (err) {
        console.warn(
            '⚠️ Database connection warning:',
            err.message
        );
    }
}

// Close Chromium cleanly when Railway stops the container.
async function shutdown(signal, exitCode = 0) {
    if (shuttingDown) return;

    shuttingDown = true;
    whatsappReady = false;

    console.log(`🛑 Shutting down: ${signal}`);

    const forceExit = setTimeout(() => {
        console.error('⚠️ Shutdown timed out.');
        process.exit(1);
    }, 15000);

    forceExit.unref();

    if (server) {
        server.close();
    }

    if (client) {
        try {
            // destroy closes the browser; it does not log out.
            await client.destroy();
        } catch (err) {
            console.warn('⚠️ Browser shutdown:', err.message);
        }
    }

    try {
        await mongoose.disconnect();
    } catch (err) {
        console.warn('⚠️ MongoDB shutdown:', err.message);
    }

    clearTimeout(forceExit);
    process.exit(exitCode);
}

process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
});

process.once('SIGINT', () => {
    void shutdown('SIGINT');
});

async function startBot() {
    try {
        fs.mkdirSync(authDir, { recursive: true });

        console.log(`📁 Auth data directory: ${authDir}`);
        console.log(`📁 WhatsApp session directory: ${sessionFolder}`);

        await connectDatabase();

        // Automatically clean Chromium profile locks on every boot
        unlockBrowserProfile();

        client = new Client({
            authStrategy: new LocalAuth({
                clientId: CLIENT_ID,
                dataPath: authDir
            }),

            puppeteer: {
                headless: true,

                executablePath:
                    process.env.PUPPETEER_EXECUTABLE_PATH || undefined,

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

        let pairingRequestInProgress = false;
        let authenticated = false;
        let isReadyInitialized = false;

        client.on('qr', async (qr) => {
            if (authenticated || shuttingDown) return;

            const rawPairing =
                process.env.PAIRING_NUMBER || '918002468432';

            const cleanNumber = String(rawPairing).replace(/\D/g, '');

            if (pairingRequestInProgress) return;

            if (
                cleanNumber &&
                typeof client.requestPairingCode === 'function'
            ) {
                pairingRequestInProgress = true;

                try {
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    if (authenticated || shuttingDown) return;

                    const code = await client.requestPairingCode(
                        cleanNumber
                    );

                    console.log('\n==================================================');
                    console.log(`📱 WHATSAPP PAIRING CODE: [ ${code} ]`);
                    console.log(
                        '👉 Phone WhatsApp > Linked Devices > ' +
                        'Link with phone number par yeh code enter karein!'
                    );
                    console.log('==================================================\n');

                    return;
                } catch (err) {
                    console.log(
                        '⚠️ Pairing request failed, displaying QR fallback:',
                        err.message || err
                    );
                } finally {
                    pairingRequestInProgress = false;
                }
            }

            if (!authenticated && !shuttingDown) {
                console.log('\n👇 Fallback QR Code:');
                qrcode.generate(qr, { small: true });
            }
        });

        client.on('ready', () => {
            if (isReadyInitialized || shuttingDown) return;

            try {
                const { setupListeners } = require('./src/listener');
                setupListeners(client);

                const { startDailyCron } = require('./src/scheduler');
                startDailyCron(client);

                isReadyInitialized = true;
                whatsappReady = true;

                console.log('\n✅ SUCCESS: WhatsApp Client is READY!\n');
                console.log('==================================================');
                console.log('🤖 AUG BOT IS LIVE & READY FOR ACTION!');
                console.log('==================================================\n');

                console.log('✅ Sabhi engines live ho chuke hain.');
                console.log(
                    '📡 Bot persistent session storage ke sath run kar raha hai.\n'
                );
            } catch (err) {
                console.error('❌ Bot engine setup failed:', err);
                void shutdown('ENGINE_SETUP_FAILED', 1);
            }
        });

        client.on('authenticated', () => {
            authenticated = true;

            console.log(
                '🔐 Authenticated successfully. ' +
                'LocalAuth is using the configured session directory.'
            );
        });

        client.on('auth_failure', (msg) => {
            authenticated = false;
            whatsappReady = false;

            console.error('❌ Auth failure detected:', msg);
            console.log(
                '👉 Session ko dobara link karna pad sakta hai.'
            );
        });

        client.on('disconnected', (reason) => {
            authenticated = false;
            whatsappReady = false;

            console.warn('⚠️ WhatsApp disconnected:', reason);
        });

        client.on('loading_screen', (percent, message) => {
            console.log(`⏳ WhatsApp loading: ${percent}% — ${message}`);
        });

        // Await is necessary to catch browser startup errors here.
        await client.initialize();

    } catch (error) {
        whatsappReady = false;

        console.error(
            '❌ Fatal Bot Initialization Error:',
            error.stack || error.message || error
        );

        if (
            String(error.message || error).includes(
                'profile appears to be in use'
            )
        ) {
            console.error(
                '👉 Stop every other process using this session.'
            );
        }

        await shutdown('INITIALIZATION_FAILED', 1);
    }
}

// Keep-alive HTTP server for Railway port binding.
const PORT = process.env.PORT || 3000;

server = http.createServer((req, res) => {
    // Optional readiness endpoint.
    if (req.url === '/ready') {
        res.writeHead(whatsappReady ? 200 : 503, {
            'Content-Type': 'application/json'
        });

        res.end(JSON.stringify({
            whatsappReady,
            mongoConnected: mongoose.connection.readyState === 1
        }));

        return;
    }

    res.writeHead(200, {
        'Content-Type': 'text/plain'
    });

    res.end(
        'AUG Consultancy Autonomous Bot Worker is Active\n' +
        `WhatsApp: ${whatsappReady ? 'READY' : 'NOT READY'}\n`
    );
});

server.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
});

void startBot();