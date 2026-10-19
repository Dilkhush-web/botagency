// src/reply.js
const { generateMessage } = require('./gemini');
const {
    updateCell,
    getLeadByNumber,
    cleanPhoneNumber
} = require('./sheet');

const pendingReplies = new Map();

function errorDetails(error) {
    return error?.stack || error?.message || String(error);
}

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
        executeReply(client, number, item).catch(error => {
            console.error(
                '❌ Unexpected reply task error:',
                errorDetails(error)
            );
        });
    }, delayMs);
}

async function handleIncomingMessage(client, message, lead) {
    try {
        if (
            !message ||
            message.fromMe ||
            message.isStatus ||
            !lead ||
            isPaused(lead)
        ) {
            return;
        }

        // Use the matched lead's phone number for Sheet lookup.
        const number = cleanPhoneNumber(lead.number);

        // Preserve the actual WhatsApp chat ID.
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

        if (!item.running) {
            scheduleReply(client, number, item);
        }
    } catch (error) {
        console.error(
            '❌ Incoming reply handler error:',
            errorDetails(error)
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
    let phase = 'initial checks';

    const isCurrent = () => (
        pendingReplies.get(number) === item &&
        !item.cancelled
    );

    const hasNewMessages = () => item.revision !== revision;

    try {
        if (!conversation.trim()) return;

        phase = 'reading lead status';

        let latestLead = await getLeadByNumber(number);

        if (!isCurrent()) return;

        if (!latestLead || isPaused(latestLead)) {
            console.log(
                '🛑 Reply skipped: lead missing or automation paused.'
            );

            cancelPendingReply(number);
            return;
        }

        phase = 'saving Replied status';

        const updated = await updateCell(
            latestLead.rowIndex,
            'F',
            'Replied'
        );

        // Latest sheet.js returns false when it preserves a pause.
        if (updated === false) {
            cancelPendingReply(number);
            return;
        }

        if (!isCurrent() || hasNewMessages()) return;

        phase = 'generating AI response';

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

        if (!isCurrent() || hasNewMessages()) return;

        // Chat lookup, read receipt and typing are ALL optional.
        // Their failure must not prevent the actual send attempt.
        phase = 'optional chat indicators';

        try {
            chat = await client.getChatById(item.chatId);

            if (!isCurrent() || hasNewMessages()) return;

            if (
                chat &&
                typeof chat.sendSeen === 'function'
            ) {
                await chat.sendSeen();
            }

            await sleep(1200);

            if (!isCurrent() || hasNewMessages()) return;

            if (
                chat &&
                typeof chat.sendStateTyping === 'function'
            ) {
                await chat.sendStateTyping();

                await sleep(
                    4000 + Math.floor(Math.random() * 3001)
                );
            }
        } catch (error) {
            console.warn(
                'ℹ️ Optional chat/typing step failed; ' +
                'continuing to reply:',
                errorDetails(error)
            );
        } finally {
            if (
                chat &&
                typeof chat.clearState === 'function'
            ) {
                try {
                    await chat.clearState();
                } catch (error) {
                    console.warn(
                        'ℹ️ Could not clear typing indicator:',
                        error?.message || String(error)
                    );
                }
            }
        }

        if (!isCurrent() || hasNewMessages()) return;

        phase = 'final lead status check';

        latestLead = await getLeadByNumber(number);

        if (!isCurrent()) return;

        if (!latestLead || isPaused(latestLead)) {
            cancelPendingReply(number);
            return;
        }

        if (hasNewMessages()) return;

        phase = 'sending WhatsApp reply';
        sendAttempted = true;

        // Keep using client.sendMessage so listener tracking works.
        await client.sendMessage(
            item.chatId,
            replyText.trim()
        );

        item.messages.splice(0, messageCount);

        console.log(
            `✅ Reply send request successful: ${latestLead.name}`
        );

        // Keep Replied status.
        // Do not overwrite a concurrent manual takeover after sending.
    } catch (error) {
        console.error(
            `❌ Automated reply error during "${phase}":`,
            errorDetails(error)
        );

        if (sendAttempted) {
            // The wrapper or WhatsApp may have rejected the send.
            // Treat the outcome conservatively; never blindly retry.
            item.cancelled = true;

            try {
                const latestLead = await getLeadByNumber(number);

                if (latestLead && !isPaused(latestLead)) {
                    await updateCell(
                        latestLead.rowIndex,
                        'F',
                        'Needs Review'
                    );
                }
            } catch (sheetError) {
                console.error(
                    '❌ Could not save review status:',
                    errorDetails(sheetError)
                );
            }

            console.warn(
                '👉 Check the WhatsApp chat before retrying this reply.'
            );
        }
    } finally {
        item.running = false;

        if (pendingReplies.get(number) === item) {
            if (
                !item.cancelled &&
                hasNewMessages() &&
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