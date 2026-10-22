// src/sender.js
const { generateMessage } = require('./gemini');
const { updateCell, getTodayISTDate } = require('./sheet');

// Message pacing: 60–90 seconds.
// This delay does not guarantee protection from account restrictions.
function getRandomDelay() {
    const min = 60000;
    const max = 90000;

    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Indian phone-number normalization
function sanitizeNumber(rawNumber) {
    if (!rawNumber) return '';

    let cleaned = String(rawNumber)
        .split('.')[0]
        .replace(/\D/g, '');

    if (cleaned.length === 10) {
        cleaned = '91' + cleaned;
    } else if (
        cleaned.length === 11 &&
        cleaned.startsWith('0')
    ) {
        cleaned = '91' + cleaned.substring(1);
    }

    return cleaned;
}

/**
 * Supports:
 * sendOutreachMessages(client, leads, batchSize)
 * sendOutreachMessages(client, leads, legacyArg, batchSize)
 */
async function sendOutreachMessages(
    client,
    leads,
    arg3 = 5,
    arg4
) {
    let sentCount = 0;
    let skippedCount = 0;
    let reviewCount = 0;
    let previousSendAttempt = false;

    try {
        if (!Array.isArray(leads) || leads.length === 0) {
            console.log('ℹ️ Outreach: Koi pending leads nahi hain.');
            return;
        }

        const requestedLimit =
            arg4 !== undefined ? arg4 : arg3;

        if (
            !Number.isInteger(requestedLimit) ||
            requestedLimit < 1
        ) {
            throw new Error(
                'Batch size must be a positive integer.'
            );
        }

        const leadsToProcess = leads.slice(0, requestedLimit);
        const processedNumbers = new Set();

        console.log('\n==================================================');
        console.log(
            `📊 Batch Started: Maximum ${leadsToProcess.length} leads.`
        );
        console.log('==================================================');

        for (let i = 0; i < leadsToProcess.length; i++) {
            const lead = leadsToProcess[i];

            console.log(
                `\n⏳ [${i + 1}/${leadsToProcess.length}] ` +
                `Processing: ${lead.name} (${lead.niche})`
            );

            try {
                // 1. Validate normalized Indian phone number.
                const cleanedDigits = sanitizeNumber(lead.number);

                if (!/^91[6-9]\d{9}$/.test(cleanedDigits)) {
                    console.warn(
                        `❌ Invalid Indian mobile number for ${lead.name}`
                    );

                    await updateCell(
                        lead.rowIndex,
                        'F',
                        'Invalid Number'
                    );

                    skippedCount++;
                    continue;
                }

                // Avoid duplicates within this batch.
                if (processedNumbers.has(cleanedDigits)) {
                    console.warn(
                        `⏭️ Duplicate number skipped: ${lead.name}`
                    );

                    skippedCount++;
                    continue;
                }

                processedNumbers.add(cleanedDigits);

                // 2. Verify WhatsApp registration with Timeout Guard (Fixes Runtime.callFunctionOn timed out)
                let targetJid = `${cleanedDigits}@c.us`;

                try {
                    if (typeof client.getNumberId === 'function') {
                        const numberIdPromise = client.getNumberId(cleanedDigits);
                        const timeoutPromise = new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('getNumberId timeout (Runtime.callFunctionOn safety fallback)')), 15000)
                        );

                        const numberId = await Promise.race([numberIdPromise, timeoutPromise]);

                        if (numberId && numberId._serialized) {
                            targetJid = numberId._serialized;
                        }
                    }
                } catch (error) {
                    console.warn(
                        `⚠️ Number verification timed out/failed for ${lead.name}. Proceeding safely with direct JID: ${targetJid}`,
                        error.message || error
                    );
                    // Safe fallback: direct JID use karega bina crash hue
                }

                // 3. Generate message.
                let messageText;

                try {
                    messageText = await generateMessage(
                        lead.name,
                        lead.niche,
                        false,
                        '',
                        'new'
                    );
                } catch (error) {
                    console.error(
                        `⚠️ AI generation failed for ${lead.name}:`,
                        error.message || error
                    );
                }

                if (
                    typeof messageText !== 'string' ||
                    !messageText.trim()
                ) {
                    console.warn(
                        `⚠️ Empty/invalid message: ${lead.name}`
                    );

                    await updateCell(
                        lead.rowIndex,
                        'F',
                        'Failed'
                    );

                    skippedCount++;
                    continue;
                }

                messageText = messageText.trim();

                // Pace send attempts, including uncertain failures.
                if (previousSendAttempt) {
                    const delayMs = getRandomDelay();

                    console.log(
                        `🕒 Next send attempt in ` +
                        `${Math.round(delayMs / 1000)} seconds.`
                    );

                    await sleep(delayMs);
                }

                // 4. Optional typing indicator.
                let chat;

                try {
                    chat = await client.getChatById(targetJid);

                    if (
                        chat &&
                        typeof chat.sendStateTyping === 'function'
                    ) {
                        await chat.sendStateTyping();
                        await sleep(3000);
                    }
                } catch (error) {
                    console.warn(
                        'ℹ️ Typing indicator unavailable; continuing.'
                    );
                } finally {
                    if (
                        chat &&
                        typeof chat.clearState === 'function'
                    ) {
                        try {
                            await chat.clearState();
                        } catch {
                            // Typing indicator is optional.
                        }
                    }
                }

                // 5. Submit message once.
                previousSendAttempt = true;

                try {
                    await client.sendMessage(
                        targetJid,
                        messageText
                    );
                } catch (error) {
                    reviewCount++;

                    console.error(
                        `⚠️ Send result uncertain for ${lead.name}:`,
                        error.message || error
                    );

                    await updateCell(
                        lead.rowIndex,
                        'F',
                        'Needs Review'
                    );

                    console.warn(
                        '👉 Chat check kiye bina is lead ko ' +
                        'dobara Pending mat karein.'
                    );

                    continue;
                }

                sentCount++;

                console.log(
                    `✅ Message send request successful: ${lead.name}. ` +
                    'Recipient delivery is not yet confirmed.'
                );

                // 6. Save tracking data.
                await updateCell(
                    lead.rowIndex,
                    'F',
                    'Sent'
                );

                await updateCell(
                    lead.rowIndex,
                    'G',
                    getTodayISTDate()
                );

                await updateCell(
                    lead.rowIndex,
                    'I',
                    'Initial Outreach'
                );

            } catch (error) {
                console.error(
                    `❌ Lead processing error for ${lead.name}:`,
                    error.message || error
                );

                // Stop this batch on an unexpected error.
                throw error;
            }
        }

        console.log('\n==================================================');
        console.log('📋 Outreach batch processing finished.');
        console.log(`✅ Successful send requests: ${sentCount}`);
        console.log(`⏭️ Skipped/unsent leads: ${skippedCount}`);
        console.log(`🔎 Needs manual review: ${reviewCount}`);
        console.log('==================================================\n');

    } catch (error) {
        console.error(
            '❌ Outreach batch stopped:',
            error.message || error
        );

        throw error;
    }
}

module.exports = { sendOutreachMessages };