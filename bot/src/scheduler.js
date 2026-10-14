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

// कैंपेन शुरू होने की तारीख (YYYY-MM-DD)
const CAMPAIGN_START_DATE = '2026-10-14';

/**
 * डायनामिक वार्मअप लिमिट कैलकुलेटर:
 * Day 1-3:  15/day
 * Day 4-6:  25/day
 * Day 7-9:  35/day
 * Day 10+:  40/day
 */
function getDailyOutreachLimit() {
    const start = new Date(CAMPAIGN_START_DATE);
    const today = new Date(getTodayISTDate());
    const diffTime = Math.max(0, today.getTime() - start.getTime());
    const dayNumber = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

    let dailyTotal = 40;
    if (dayNumber <= 3) {
        dailyTotal = 15;
    } else if (dayNumber <= 6) {
        dailyTotal = 25;
    } else if (dayNumber <= 9) {
        dailyTotal = 35;
    } else {
        dailyTotal = 40;
    }

    return { dayNumber, dailyTotal };
}

/**
 * 3 स्लॉट्स में प्रति स्लॉट बैच साइज निकालना
 */
function getSlotBatchSize(slotIndex) {
    const { dayNumber, dailyTotal } = getDailyOutreachLimit();
    // 3 स्लॉट्स में डिस्ट्रीब्यूशन
    const base = Math.floor(dailyTotal / 3);
    const remainder = dailyTotal % 3;

    // अगर शेष बचता है तो पहले स्लॉट्स में 1-1 जोड़ देगा
    const batchSize = slotIndex < remainder ? base + 1 : base;
    return { dayNumber, dailyTotal, batchSize };
}

// 0 से 30 मिनट का नैचुरल ह्यूमन जिटर डिले (Meta Anti-Ban)
function getRandomStartDelay() {
    return Math.floor(Math.random() * 30) * 60 * 1000;
}

// Concurrency guard ताकि स्लॉट्स आपस में क्लैश न हों
let isSlotRunning = false;

function startDailyCron(whatsappClient) {
    const { dayNumber, dailyTotal } = getDailyOutreachLimit();

    console.log(`\n==================================================`);
    console.log(`⏰ Production Scheduler Activated (AUG Consultancy)`);
    console.log(`📈 Warmup Stage: Day ${dayNumber} | Today's Target: ${dailyTotal} New Leads`);
    console.log(`Daily Slots: 10:00 AM | 02:00 PM | 06:00 PM (IST)`);
    console.log(`Rules: Sunday Off | 0-30m Anti-Ban Jitter | Auto Follow-up`);
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
        // Sunday Off नियम
        if (today.getDay() === 0) {
            console.log(`\n🛑 [${slotName}]: आज रविवार (Sunday) है! Outreach पूरी तरह बंद है।\n`);
            return;
        }

        if (isSlotRunning) {
            console.log(`⚠️ [${slotName}]: पिछला स्लॉट अभी रन हो रहा है, ओवरलैप रोकने के लिए स्किप किया गया।`);
            return;
        }

        const { dayNumber, dailyTotal, batchSize } = getSlotBatchSize(slotIndex);
        const delayMs = withDelay ? getRandomStartDelay() : 0;
        const delayMins = (delayMs / 60000).toFixed(1);

        console.log(`\n🕒 [${slotName}] Triggered on ${getTodayISTDate()}`);
        console.log(`📊 Warmup Day ${dayNumber}: आज का कुल कोटा ${dailyTotal} है। इस स्लॉट में ${batchSize} मैसेज भेजे जाएंगे।`);

        if (delayMs > 0) {
            console.log(`⏳ Anti-Ban: Natural human delay (${delayMins} mins) के बाद शुरू होगा...`);
        } else {
            console.log(`⚡ Instant Run: बिना डिले के तुरंत शुरू हो रहा है...`);
        }

        setTimeout(async () => {
            isSlotRunning = true;
            console.log(`\n🚀 [${slotName}] Execution Started!`);

            try {
                // 1. Pending outreach leads को उठाना
                const leads = await getPendingLeads();
                if (leads && leads.length > 0) {
                    console.log(`📋 Available Pending Leads: ${leads.length}. Processing ${Math.min(leads.length, batchSize)} leads...`);
                    // सुरक्षित बैच साइज के साथ मैसेज भेजना
                    await sendOutreachMessages(whatsappClient, leads, batchSize);
                } else {
                    console.log(`ℹ️ [${slotName}]: Google Sheet में कोई 'Pending' leads नहीं मिलीं।`);
                }

                // 2. Multi-day auto follow-up (Day 3, 7, 14, 21)
                try {
                    await processFollowups(whatsappClient);
                } catch (followupErr) {
                    console.error(`⚠️ Followup execution warning in ${slotName}:`, followupErr.message || followupErr);
                }

            } catch (error) {
                console.error(`❌ Critical error in slot execution (${slotName}):`, error.message || error);
            } finally {
                isSlotRunning = false;
                console.log(`\n✨ [${slotName}] स्लॉट के कार्य पूरे हुए। बॉट अगले स्लॉट के लिए स्टैंडबाय पर है।\n`);
            }

        }, delayMs);

    } catch (outerErr) {
        console.error(`❌ Fatal Scheduler error in ${slotName}:`, outerErr.message || outerErr);
    }
}

module.exports = { startDailyCron, getTodayISTDate, getDailyOutreachLimit };