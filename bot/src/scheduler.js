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

const CAMPAIGN_START_DATE = '2026-10-13';

// 0 se 45 minute ka natural human jitter delay (Meta Anti-Ban)
function getRandomStartDelay() {
    return Math.floor(Math.random() * 45) * 60 * 1000;
}

function startDailyCron(whatsappClient) {
    console.log(`\n==================================================`);
    console.log(`⏰ Production Scheduler Activated (AUG Consultancy)`);
    console.log(`Daily Slots: 10:00 AM | 02:00 PM | 06:00 PM (IST)`);
    console.log(`Rules: Sunday Off | 0-45m Anti-Ban Jitter | Auto Follow-up`);
    console.log(`==================================================\n`);

    // Slot 1: Morning (10:00 AM)
    cron.schedule('0 10 * * *', () => {
        executeSlot(whatsappClient, 'Morning Slot (10:00 AM)');
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
    });

    // Slot 2: Afternoon (02:00 PM)
    cron.schedule('0 14 * * *', () => {
        executeSlot(whatsappClient, 'Afternoon Slot (02:00 PM)');
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
    });

    // Slot 3: Evening (06:00 PM)
    cron.schedule('0 18 * * *', () => {
        executeSlot(whatsappClient, 'Evening Slot (06:00 PM)');
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
    });
}

async function executeSlot(whatsappClient, slotName) {
    const today = new Date();
    if (today.getDay() === 0) {
        console.log(`\n🛑 [${slotName}]: Aaj Sunday hai! Outreach off hai.\n`);
        return;
    }

    const delayMs = getRandomStartDelay();
    const delayMins = (delayMs / 60000).toFixed(1);

    console.log(`\n🕒 [${slotName}] Triggered on ${getTodayISTDate()}`);
    console.log(`⏳ Anti-Ban: Natural human delay (${delayMins} mins) ke baad execution start hoga...`);

    setTimeout(async () => {
        console.log(`\n🚀 [${slotName}] Execution Started!`);
        try {
            const leads = await getPendingLeads();
            if (leads.length > 0) {
                // Har slot mein daily limit ke hisaab se leads process hongi
                await sendOutreachMessages(whatsappClient, leads, CAMPAIGN_START_DATE, 3);
            } else {
                console.log(`ℹ️ [${slotName}]: Google Sheet mein koi 'Pending' leads nahi hain.`);
            }

            // Multi-Day Follow-ups automatically trigger honge
            await processFollowups(whatsappClient);
        } catch (error) {
            console.error(`❌ Critical error in ${slotName}:`, error.message || error);
        }
        console.log(`\n✨ [${slotName}] Slot tasks complete ho gaye.\n`);
    }, delayMs);
}

module.exports = { startDailyCron, getTodayISTDate };