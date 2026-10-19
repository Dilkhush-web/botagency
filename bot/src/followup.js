// src/followup.js
const { generateFollowupMessage } = require('./gemini');

const {
    updateCell,
    getLeadsForFollowup,
    getLeadByNumber,
    getTodayISTDate,
    cleanPhoneNumber
} = require('./sheet');

let isFollowupRunning = false;

function getRandomFollowupDelay() {
    const min = 60000;
    const max = 150000;

    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Accept only an actual YYYY-MM-DD calendar date.
function parseDate(dateString) {
    const value = String(dateString || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

    if (!match) return null;

    const timestamp = Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
    );

    if (
        new Date(timestamp).toISOString().slice(0, 10) !== value
    ) {
        return null;
    }

    return timestamp;
}

function getDaysDifference(pastDateString) {
    const past = parseDate(pastDateString);
    const today = parseDate(getTodayISTDate());

    if (past === null || today === null) return null;

    return Math.floor((today - past) / 86400000);
}

function isEligibleStatus(status) {
    const value = String(status || '').trim().toLowerCase();

    return value === 'sent' || value === 'follow-up sent';
}

// G contains the last successful contact date.
// Stage gaps produce Day 3, 7, 14, 21 when runs are on time.
function getNextStage(lead) {
    const current = String(lead.followupStage || '')
        .trim()
        .toLowerCase();

    const stages = {
        '': {
            gap: 3,
            aiStage: 'day3',
            nextName: '1st Follow-up'
        },
        'initial outreach': {
            gap: 3,
            aiStage: 'day3',
            nextName: '1st Follow-up'
        },
        '1st follow-up': {
            gap: 4,
            aiStage: 'day7',
            nextName: '2nd Follow-up'
        },
        '2nd follow-up': {
            gap: 7,
            aiStage: 'day14',
            nextName: '3rd Follow-up'
        },
        '3rd follow-up': {
            gap: 7,
            aiStage: 'day21',
            nextName: 'Breakup Sent'
        }
    };

    return stages[current] || null;
}

async function processFollowups(client) {
    if (isFollowupRunning) {
        console.log('ℹ️ Follow-up scan already running.');
        return;
    }

    isFollowupRunning = true;

    let sentCount = 0;
    let previousSendAttempt = false;

    try {
        console.log('\n🔎 Scanning Google Sheet for follow-ups...');

        const leads = await getLeadsForFollowup();

        if (!leads || leads.length === 0) {
            console.log(
                'ℹ️ No follow-up candidates returned. ' +
                'Check preceding logs for any Sheet errors.'
            );
            return;
        }

        const processedNumbers = new Set();

        for (const lead of leads) {
            const stage = getNextStage(lead);
            const daysPassed = getDaysDifference(
                lead.lastContactDate
            );

            if (!stage) continue;

            if (daysPassed === null) {
                console.warn(
                    `⚠️ Invalid date for ${lead.name}. ` +
                    'Column G must contain YYYY-MM-DD.'
                );
                continue;
            }

            if (daysPassed < stage.gap) continue;

            const number = cleanPhoneNumber(lead.number);

            if (!/^91[6-9]\d{9}$/.test(number)) {
                console.warn(
                    `⚠️ Invalid Indian mobile number: ${lead.name}`
                );
                continue;
            }

            if (processedNumbers.has(number)) continue;
            processedNumbers.add(number);

            // Do not proceed when the lead is unavailable or paused.
            let freshLead = await getLeadByNumber(number);

            if (
                !freshLead ||
                freshLead.rowIndex !== lead.rowIndex ||
                !isEligibleStatus(freshLead.status)
            ) {
                console.log(
                    `⏭️ Follow-up skipped: ${lead.name} ` +
                    '(lead unavailable, changed, or paused).'
                );
                continue;
            }

            let messageText;
            let numberId;

            try {
                numberId = await client.getNumberId(number);

                if (!numberId || !numberId._serialized) {
                    await updateCell(
                        lead.rowIndex,
                        'F',
                        'Invalid Number'
                    );
                    continue;
                }

                messageText = await generateFollowupMessage(
                    lead.name,
                    lead.niche,
                    stage.aiStage
                );
            } catch (error) {
                console.error(
                    `⚠️ Follow-up preparation failed: ${lead.name}`,
                    error.message || error
                );
                continue;
            }

            if (
                typeof messageText !== 'string' ||
                !messageText.trim()
            ) {
                console.warn(
                    `⚠️ Empty follow-up message: ${lead.name}`
                );
                continue;
            }

            if (previousSendAttempt) {
                const delayMs = getRandomFollowupDelay();

                console.log(
                    `🕒 Next follow-up attempt in ` +
                    `${Math.round(delayMs / 1000)} seconds.`
                );

                await sleep(delayMs);
            }

            const targetJid = numberId._serialized;
            let chat;

            try {
                chat = await client.getChatById(targetJid);

                if (
                    chat &&
                    typeof chat.sendStateTyping === 'function'
                ) {
                    await chat.sendStateTyping();
                    await sleep(
                        3000 + Math.floor(Math.random() * 3001)
                    );
                }
            } catch {
                // Optional typing indicator.
            } finally {
                if (
                    chat &&
                    typeof chat.clearState === 'function'
                ) {
                    try {
                        await chat.clearState();
                    } catch {
                        // Optional typing indicator.
                    }
                }
            }

            // Recheck after generation and pacing delays.
            freshLead = await getLeadByNumber(number);

            if (
                !freshLead ||
                freshLead.rowIndex !== lead.rowIndex ||
                !isEligibleStatus(freshLead.status)
            ) {
                console.log(
                    `🛑 Follow-up cancelled: ${lead.name} ` +
                    '(latest status is no longer eligible).'
                );
                continue;
            }

            console.log(
                `📌 ${stage.aiStage}: ${lead.name} | ` +
                `${daysPassed} days since last contact`
            );

            previousSendAttempt = true;

            try {
                await client.sendMessage(
                    targetJid,
                    messageText.trim()
                );
            } catch (error) {
                console.error(
                    `⚠️ Follow-up send result uncertain: ${lead.name}`,
                    error.message || error
                );

                await updateCell(
                    lead.rowIndex,
                    'F',
                    'Needs Review'
                );

                // No automatic retry: the message may have been sent.
                continue;
            }

            sentCount++;

            console.log(
                `✅ Follow-up send request successful: ${lead.name}`
            );

            // Save date and stage first.
            await updateCell(
                lead.rowIndex,
                'G',
                getTodayISTDate()
            );

            await updateCell(
                lead.rowIndex,
                'I',
                stage.nextName
            );

            // Avoid knowingly overwriting a reply/manual takeover
            // that occurred while sending.
            const afterSend = await getLeadByNumber(number);

            if (
                afterSend &&
                afterSend.rowIndex === lead.rowIndex &&
                isEligibleStatus(afterSend.status)
            ) {
                await updateCell(
                    lead.rowIndex,
                    'F',
                    stage.aiStage === 'day21'
                        ? 'Dead'
                        : 'Follow-up Sent'
                );
            }
        }

        console.log(
            `\n📋 Follow-up scan finished. ` +
            `Successful send requests: ${sentCount}`
        );
    } catch (error) {
        console.error(
            '❌ Follow-up processing stopped:',
            error.message || error
        );

        throw error;
    } finally {
        isFollowupRunning = false;
    }
}

module.exports = { processFollowups };