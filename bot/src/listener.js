// src/listener.js
const {
    handleIncomingMessage,
    cancelPendingReply
} = require('./reply');

const {
    getLeadByNumber,
    updateCell,
    cleanPhoneNumber
} = require('./sheet');

const installedClients = new WeakSet();

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isDirectChat(id) {
    return typeof id === 'string' &&
        (id.endsWith('@c.us') || id.endsWith('@lid'));
}

function messageId(message) {
    return message && message.id
        ? message.id._serialized
        : null;
}

function isPaused(status) {
    return [
        'in-discussion',
        'manual',
        'dead',
        'needs review'
    ].includes(String(status || '').trim().toLowerCase());
}

function setupListeners(client) {
    // Prevent duplicate listeners on the same client.
    if (installedClients.has(client)) {
        console.log('ℹ️ Listeners already installed.');
        return;
    }

    installedClients.add(client);

    const startedAt = Math.floor(Date.now() / 1000);
    const sentIds = new Map();
    const incomingIds = new Map();
    const pendingSends = new Set();
    const numberCache = new Map();

    // Immediate in-process pause, even if the Sheet write fails.
    const pausedNumbers = new Set();

    let stopping = false;
    let reconnectTimer = null;
    let reconnecting = false;

    function prune(map, maxAgeMs, limit = 2000) {
        const cutoff = Date.now() - maxAgeMs;

        for (const [key, timestamp] of map) {
            if (timestamp < cutoff) map.delete(key);
        }

        while (map.size > limit) {
            map.delete(map.keys().next().value);
        }
    }

    async function resolvePhone(chatId) {
        if (!isDirectChat(chatId)) return null;

        if (chatId.endsWith('@c.us')) {
            const number = cleanPhoneNumber(
                chatId.split('@')[0]
            );

            return /^\d{10,15}$/.test(number) ? number : null;
        }

        if (numberCache.has(chatId)) {
            return numberCache.get(chatId);
        }

        // An @lid identifier is not a phone number.
        if (typeof client.getContactLidAndPhone !== 'function') {
            console.warn(
                '⚠️ This installed library cannot resolve @lid IDs.'
            );
            return null;
        }

        const mappings = await client.getContactLidAndPhone(
            [chatId]
        );

        const match = Array.isArray(mappings)
            ? mappings.find(item => item.lid === chatId)
            : null;

        const phoneId = match && match.pn;

        if (
            typeof phoneId !== 'string' ||
            !phoneId.endsWith('@c.us')
        ) {
            return null;
        }

        const number = cleanPhoneNumber(
            phoneId.split('@')[0]
        );

        if (!/^\d{10,15}$/.test(number)) return null;

        if (numberCache.size >= 2000) {
            numberCache.delete(numberCache.keys().next().value);
        }

        numberCache.set(chatId, number);
        return number;
    }

    async function pauseLead(lead, status, reason) {
        const number = cleanPhoneNumber(lead.number);

        pausedNumbers.add(number);

        if (typeof cancelPendingReply === 'function') {
            cancelPendingReply(number);
        }

        console.log(`🛑 ${reason}: ${lead.name}`);

        await updateCell(lead.rowIndex, 'F', status);
    }

    // Track sends from sender.js, reply.js and followup.js.
    // Register tracking before the underlying call begins.
    const originalSendMessage = client.sendMessage.bind(client);

    client.sendMessage = async function (...args) {
        let finish;

        const record = {
            done: new Promise(resolve => {
                finish = resolve;
            })
        };

        pendingSends.add(record);

        try {
            if (stopping || reconnecting) {
                throw new Error('WhatsApp is stopping/reconnecting.');
            }

            const number = await resolvePhone(args[0]);

            if (!number) {
                throw new Error(
                    'Cannot resolve recipient phone number; send blocked.'
                );
            }

            if (pausedNumbers.has(number)) {
                throw new Error(
                    'Automation paused for this lead; send blocked.'
                );
            }

            const result = await originalSendMessage(...args);
            const id = messageId(result);

            if (id) {
                sentIds.set(id, Date.now());
                prune(sentIds, 24 * 60 * 60 * 1000);
            }

            return result;
        } finally {
            pendingSends.delete(record);
            finish();
        }
    };

    // message_create can fire before sendMessage returns.
    async function isTrackedBotMessage(message) {
        const id = messageId(message);

        if (id && sentIds.has(id)) return true;

        const activeSends = [...pendingSends];

        if (activeSends.length > 0) {
            await Promise.race([
                Promise.all(activeSends.map(item => item.done)),
                sleep(15000)
            ]);
        }

        return Boolean(id && sentIds.has(id));
    }

    client.on('message_create', async message => {
        try {
            if (
                stopping ||
                !message.fromMe ||
                !isDirectChat(message.to)
            ) {
                return;
            }

            // Ignore older synced messages.
            if (
                Number(message.timestamp) &&
                Number(message.timestamp) < startedAt
            ) {
                return;
            }

            if (await isTrackedBotMessage(message)) return;

            const number = await resolvePhone(message.to);
            if (!number) return;

            const lead = await getLeadByNumber(number);
            if (!lead) return;

            // This may also be an uncertain/untracked automated send.
            // Pause conservatively rather than claiming it was manual.
            await pauseLead(
                lead,
                'In-Discussion',
                'Untracked outgoing message; automation paused'
            );
        } catch (error) {
            console.error(
                '❌ Outgoing-message listener error:',
                error.message || error
            );
        }
    });

    client.on('message', async message => {
        let id;

        try {
            if (
                stopping ||
                message.fromMe ||
                message.isStatus ||
                !isDirectChat(message.from)
            ) {
                return;
            }

            id = messageId(message);
            prune(incomingIds, 60 * 60 * 1000);

            if (id && incomingIds.has(id)) return;
            if (id) incomingIds.set(id, Date.now());

            console.log(
                `📨 Incoming direct message; ID type: ` +
                `${message.from.endsWith('@lid') ? 'LID' : 'phone'}`
            );

            const number = await resolvePhone(message.from);

            if (!number) {
                console.warn(
                    '⚠️ Sender phone unresolved. Reply skipped.'
                );
                return;
            }

            const lead = await getLeadByNumber(number);

            if (!lead) {
                console.log(
                    'ℹ️ No Sheet lead returned. Check number match ' +
                    'and any preceding Sheet errors.'
                );
                return;
            }

            console.log(`📋 Sheet lead matched: ${lead.name}`);

            if (
                pausedNumbers.has(number) ||
                isPaused(lead.status)
            ) {
                if (typeof cancelPendingReply === 'function') {
                    cancelPendingReply(number);
                }

                console.log(
                    `🛑 Automation paused for ${lead.name}; ` +
                    `Sheet status: ${lead.status}`
                );
                return;
            }

            const text = String(message.body || '')
                .trim()
                .toLowerCase();

            const isAutoCatalog =
                message.type === 'document' ||
                message.type === 'vcard' ||
                text.includes('thank you for contacting') ||
                text.includes('thanks for reaching out') ||
                text.includes('press 1') ||
                text.includes('automated message');

            if (isAutoCatalog) {
                await pauseLead(
                    lead,
                    'In-Discussion',
                    'Catalog/automated-response rule matched'
                );
                return;
            }

            if (!text) {
                console.log(
                    'ℹ️ Non-text message received; no text reply queued.'
                );
                return;
            }

            // Mark promptly so follow-up scans can stop selecting it.
            await updateCell(lead.rowIndex, 'F', 'Replied');

            if (pausedNumbers.has(number)) return;

            await handleIncomingMessage(
                client,
                message,
                { ...lead, number, status: 'Replied' }
            );
        } catch (error) {
            console.error(
                '❌ Incoming-message listener error:',
                error.message || error
            );
        }
    });

    function scheduleReconnect(attempt = 1) {
        if (stopping || reconnectTimer || attempt > 3) return;

        reconnectTimer = setTimeout(async () => {
            reconnectTimer = null;

            if (stopping) return;

            reconnecting = true;

            try {
                console.log(
                    `🔄 Reconnection attempt ${attempt}/3`
                );

                await client.destroy();

                if (stopping) return;

                await client.initialize();

                console.log('✅ Reinitialization completed.');
            } catch (error) {
                console.error(
                    '⚠️ Reconnection failed:',
                    error.message || error
                );

                if (attempt < 3) {
                    scheduleReconnect(attempt + 1);
                } else {
                    console.error(
                        '❌ Reconnection attempts exhausted. ' +
                        'Check deployment logs.'
                    );
                }
            } finally {
                reconnecting = false;
            }
        }, 10000);
    }

    client.on('disconnected', reason => {
        console.warn('⚠️ WhatsApp disconnected:', reason);

        if (stopping || reconnecting) return;

        if (String(reason).toUpperCase().includes('LOGOUT')) {
            console.error(
                '🔐 WhatsApp logged out. Re-linking may be required.'
            );
            return;
        }

        scheduleReconnect();
    });

    // index.js handles actual browser/database shutdown.
    function stopListenerWork() {
        stopping = true;

        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    }

    process.once('SIGTERM', stopListenerWork);
    process.once('SIGINT', stopListenerWork);

    console.log(
        '🎧 Listeners active: sender resolution, send tracking, ' +
        'pause handling and diagnostic logs enabled.'
    );
}

module.exports = { setupListeners };