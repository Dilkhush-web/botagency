// src/scheduler.js
const cron = require('node-cron');
const { getPendingLeads } = require('./sheet');
const { sendOutreachMessages } = require('./sender');
const { processFollowups } = require('./followup');

function getTodayISTDate() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

// Campaign start date (YYYY-MM-DD)
const CAMPAIGN_START_DATE = '2026-10-19';

/**
 * Dynamic Warmup Limit Calculator:
 * Day 1-3:  25/day
 * Day 4-6:  35/day
 * Day 7+:   45/day (Full Scale)
 */
function getDailyOutreachLimit() {
    const start = new Date(CAMPAIGN_START_DATE);
    const today = new Date(getTodayISTDate());
    const diffTime = Math.max(0, today.getTime() - start.getTime());
    const dayNumber = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

    let dailyTotal = 45;
    if (dayNumber <= 3) {
        dailyTotal = 25;
    } else if (dayNumber <= 6) {
        dailyTotal = 35;
    } else {
        dailyTotal = 45;
    }

    return { dayNumber, dailyTotal };
}

/**
 * 3 Slots mein batch size calculate karna
 */
function getSlotBatchSize(slotIndex) {
    const { dayNumber, dailyTotal } = getDailyOutreachLimit();
    const base = Math.floor(dailyTotal / 3);
    const remainder = dailyTotal % 3;

    // Remaining leads distribute karna
    const batchSize = slotIndex < remainder ? base + 1 : base;
    return { dayNumber, dailyTotal, batchSize };
}

// 0 se 20 minute ka natural human jitter delay (Meta Anti-Ban)
function getRandomStartDelay() {
    return Math.floor(Math.random() * 20) * 60 * 1000;
}

// Concurrency guard taaki slots clash na karein
let isSlotRunning = false;

function startDailyCron(whatsappClient) {
    const { dayNumber, dailyTotal } = getDailyOutreachLimit();

    console.log(`\n==================================================`);
    console.log(`⏰ Production Scheduler Activated (AUG Consultancy)`);
    console.log(`📈 Warmup Stage: Day ${dayNumber} | Today's Target: ${dailyTotal} New Leads`);
    console.log(`Daily Slots: 10:00 AM | 02:00 PM | 06:00 PM (IST)`);
    console.log(`Rules: Sunday Off | 0-20m Anti-Ban Jitter | Auto Follow-up`);
    console.log(`==================================================\n`);

    // Slot 1: Morning (10:00 AM IST) - slotIndex 0
    cron.schedule('0 10 * * *', () => {
        executeSlot(whatsappClient, 'Morning Slot (10:00 AM)', 0, true);
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
    });

    // Slot 2: Afternoon (02:00 PM IST) - slotIndex 1
    cron.schedule('0 14 * * *', () => {
        executeSlot(whatsappClient, 'Afternoon Slot (02:00 PM)', 1, true);
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
    });

    // Slot 3: Evening (06:00 PM IST) - slotIndex 2
    cron.schedule('0 18 * * *', () => {
        executeSlot(whatsappClient, 'Evening Slot (06:00 PM)', 2, true);
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
    });
}

async function executeSlot(whatsappClient, slotName, slotIndex = 0, withDelay = true) {
    try {
        const today = new Date();
        // Sunday Off rule
        if (today.getDay() === 0) {
            console.log(`\n🛑 [${slotName}]: Aaj Sunday hai! Outreach schedule off hai.\n`);
            return;
        }

        if (isSlotRunning) {
            console.log(`⚠️ [${slotName}]: Pichla task abhi complete nahi hua hai, overlapping prevent karne ke liye skip kiya.`);
            return;
        }

        const { dayNumber, dailyTotal, batchSize } = getSlotBatchSize(slotIndex);
        const delayMs = withDelay ? getRandomStartDelay() : 0;
        const delayMins = (delayMs / 60000).toFixed(1);

        console.log(`\n🕒 [${slotName}] Triggered on ${getTodayISTDate()}`);
        console.log(`📊 Warmup Day ${dayNumber}: Aaj ka total quota ${dailyTotal} leads hai. Is slot mein ${batchSize} messages process honge.`);

        if (delayMs > 0) {
            console.log(`⏳ Anti-Ban: Natural human delay (${delayMins} mins) ke baad execution start hoga...`);
        } else {
            console.log(`⚡ Instant Run: Execution shuru ho raha hai bina kisi delay ke...`);
        }

        setTimeout(async () => {
            isSlotRunning = true;
            console.log(`\n🚀 [${slotName}] Execution Started!`);

            try {
                // 1. Pending outreach leads fetch karna
                const leads = await getPendingLeads();
                if (leads && leads.length > 0) {
                    const actualBatch = Math.min(leads.length, batchSize);
                    console.log(`📋 Available Pending Leads: ${leads.length}. Processing batch of ${actualBatch} leads...`);
                    await sendOutreachMessages(whatsappClient, leads, actualBatch);
                } else {
                    console.log(`ℹ️ [${slotName}]: Google Sheet mein koi 'Pending' leads nahi mili.`);
                }

                // 2. Multi-day auto follow-up (Day 3, 7, 14, 21)
                console.log(`🔎 Follow-up engine: Google Sheet check kar rahe hain...`);
                try {
                    await processFollowups(whatsappClient);
                } catch (followupErr) {
                    console.error(`⚠️ Followup execution warning in ${slotName}:`, followupErr.message || followupErr);
                }

            } catch (error) {
                console.error(`❌ Critical error in slot execution (${slotName}):`, error.message || error);
            } finally {
                isSlotRunning = false;
                console.log(`\n✨ [${slotName}] Slot tasks complete ho gaye. Bot agle slot ke liye standby mode par hai.\n`);
            }

        }, delayMs);

    } catch (outerErr) {
        console.error(`❌ Fatal Scheduler error in ${slotName}:`, outerErr.message || outerErr);
    }
}

module.exports = { startDailyCron, getTodayISTDate, getDailyOutreachLimit };