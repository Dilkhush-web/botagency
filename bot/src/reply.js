// src/reply.js
const { generateMessage } = require('./gemini');
const {
    updateCell,
    getLeadByNumber,
    cleanPhoneNumber
} = require('./sheet');

// One queue per lead.
const pendingReplies = new Map();

function getRealisticHumanDelay() {
    const minSecs = 90;
    const maxSecs = 240;

    return (
        Math.floor(Math.random() * (maxSecs - minSecs + 1)) +
        minSecs
    ) * 1000;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isPaused(lead) {
    const status = String(lead.status || '')
        .trim()
        .toLowerCase();

    return [
        'in-discussion',
        'manual',
        'dead',
        'needs review'
    ].includes(status);
}

// Used by the listener when manual takeover is detected.
function cancelPendingReply(number) {
    const key = cleanPhoneNumber(number);
    const item = pendingReplies.get(key);

    if (!item) return;

    clearTimeout(item.timer);
    item.cancelled = true;
    pendingReplies.delete(key);

    console.log('🛑 Pending automated reply cancelled.');
}

function scheduleReply(client, number, item) {
    clearTimeout(item.timer);

    const delayMs = getRealisticHumanDelay();

    console.log(
        `🕒 Reply queued for ${item.lead.name}: ` +
        `${Math.round(delayMs / 1000)} seconds.`
    );

    item.timer = setTimeout(() => {
        void executeReply(client, number, item);
    }, delayMs);
}

async function handleIncomingMessage(client, message, lead) {
    try {
        if (
            !message ||
            message.fromMe ||
            message.isStatus ||
            !lead
        ) {
            return;
        }

        if (isPaused(lead)) return;

        // The listener must resolve the sender and find the correct lead.
        // Do not treat an @lid identifier as a phone number.
        const number = cleanPhoneNumber(lead.number);
        const chatId = message.from;
        const text = String(message.body || '').trim();

        if (!number || !chatId || !text) return;

        let item = pendingReplies.get(number);

        if (!item) {
            item = {
                lead,
                chatId,
                messages: [],
                timer: null,
                running: false,
                cancelled: false,
                revision: 0
            };

            pendingReplies.set(number, item);
        }

        item.lead = lead;
        item.chatId = chatId;
        item.messages.push(text);
        item.revision++;

        console.log(`📩 Inquiry buffered: ${lead.name}`);

        // If generation is running, it will detect the new revision
        // and queue a fresh response with the combined messages.
        if (!item.running) {
            scheduleReply(client, number, item);
        }
    } catch (error) {
        console.error(
            '❌ Incoming reply handler error:',
            error.message || error
        );
    }
}

async function executeReply(client, number, item) {
    if (
        pendingReplies.get(number) !== item ||
        item.cancelled ||
        item.running
    ) {
        return;
    }

    item.running = true;

    const revision = item.revision;
    const messageCount = item.messages.length;
    const conversation = item.messages.join('\n');

    let chat = null;
    let sendAttempted = false;

    const isCurrent = () => (
        pendingReplies.get(number) === item &&
        !item.cancelled
    );

    try {
        if (!conversation.trim()) return;

        // Fail closed if the lead cannot be read.
        // Current sheet.js returns null for both missing leads and errors.
        let latestLead = await getLeadByNumber(number);

        if (!isCurrent()) return;

        if (!latestLead || isPaused(latestLead)) {
            console.log(
                '🛑 Reply skipped: lead unavailable or automation paused.'
            );

            cancelPendingReply(number);
            return;
        }

        // A reply should stop outreach follow-ups.
        await updateCell(latestLead.rowIndex, 'F', 'Replied');

        if (!isCurrent() || item.revision !== revision) return;

        console.log(
            `🤖 Generating response for ${latestLead.name}...`
        );

        const replyText = await generateMessage(
            latestLead.name,
            latestLead.niche,
            true,
            conversation
        );

        if (
            typeof replyText !== 'string' ||
            !replyText.trim()
        ) {
            console.warn('⚠️ AI returned an empty response.');
            return;
        }

        if (!isCurrent() || item.revision !== revision) return;

        // Preserve the actual incoming chat ID, including @lid.
        chat = await client.getChatById(item.chatId);

        try {
            if (typeof chat.sendSeen === 'function') {
                await chat.sendSeen();
            }

            await sleep(1200);

            if (typeof chat.sendStateTyping === 'function') {
                await chat.sendStateTyping();
            }

            await sleep(4000 + Math.floor(Math.random() * 3001));
        } catch {
            console.log('ℹ️ Optional typing indicator unavailable.');
        } finally {
            if (chat && typeof chat.clearState === 'function') {
                try {
                    await chat.clearState();
                } catch {
                    // Optional UI indicator.
                }
            }
        }

        if (!isCurrent() || item.revision !== revision) return;

        // Recheck manual takeover after AI generation and typing delay.
        latestLead = await getLeadByNumber(number);

        if (!isCurrent()) return;

        if (!latestLead || isPaused(latestLead)) {
            cancelPendingReply(number);
            return;
        }

        if (item.revision !== revision) return;

        sendAttempted = true;

        await client.sendMessage(
            item.chatId,
            replyText.trim()
        );

        // Remove only the messages included in this response.
        item.messages.splice(0, messageCount);

        console.log(
            `✅ Reply send request successful: ${latestLead.name}`
        );

        // Keep status Replied so future incoming messages can be answered.
        // In-Discussion / Manual must represent an actual human takeover.
        // Do not overwrite a takeover status after sending.

    } catch (error) {
        console.error(
            '❌ Automated reply error:',
            error.message || error
        );

        if (sendAttempted) {
            // The message might have been sent despite the error.
            // Avoid automatically sending it again.
            item.cancelled = true;

            await updateCell(
                item.lead.rowIndex,
                'F',
                'Needs Review'
            );

            console.warn(
                '👉 Send result uncertain. Check the chat before retrying.'
            );
        }
    } finally {
        item.running = false;

        if (pendingReplies.get(number) === item) {
            if (
                !item.cancelled &&
                item.revision !== revision &&
                item.messages.length > 0
            ) {
                scheduleReply(client, number, item);
            } else {
                clearTimeout(item.timer);
                pendingReplies.delete(number);
            }
        }
    }
}

module.exports = {
    handleIncomingMessage,
    cancelPendingReply
};