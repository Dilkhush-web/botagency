// src/followup.js
const { generateFollowupMessage } = require('./gemini');
const { updateCell, getLeadsForFollowup, getLeadByNumber } = require('./sheet');

// Anti-Ban Delay: 60s se 150s ke beech ka random human gap
function getRandomFollowupDelay() {
    const min = 60000;  // 1 min
    const max = 150000; // 2.5 min
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Real Indian Timezone (IST) Date Generator (YYYY-MM-DD)
function getTodayISTDate() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

// Do dates ke beech ke din nikalna (Accurate IST Midnight diff)
function getDaysDifference(pastDateStr) {
    if (!pastDateStr) return 0;
    try {
        const past = new Date(pastDateStr);
        const today = new Date(getTodayISTDate());

        past.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);

        const diffTime = today.getTime() - past.getTime();
        return Math.floor(diffTime / (1000 * 60 * 60 * 24));
    } catch (e) {
        return 0;
    }
}

// Clean and format phone number for WhatsApp Web JID
function cleanPhoneNumber(rawNumber) {
    let cleaned = String(rawNumber).split('.')[0].replace(/\D/g, '');
    if (cleaned.length === 10) {
        cleaned = '91' + cleaned;
    } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
        cleaned = '91' + cleaned.substring(1);
    }
    return cleaned;
}

/**
 * Runs the Multi-day Follow-up Pipeline with Human Takeover Protection
 * @param {import('whatsapp-web.js').Client} client 
 */
async function processFollowups(client) {
    console.log('\n🔎 Follow-up engine: Google Sheet se eligible leads scan kar rahe hain...');

    try {
        const leads = await getLeadsForFollowup();

        if (!leads || leads.length === 0) {
            console.log('✅ Follow-up ke liye koi eligible lead nahi mili.');
            return;
        }

        console.log(`📋 Total ${leads.length} potential leads scan hui. Calculating days difference...`);

        const todayDateStr = getTodayISTDate();

        for (let i = 0; i < leads.length; i++) {
            const lead = leads[i];
            const daysPassed = getDaysDifference(lead.lastContactDate);

            let stage = null;
            let nextStageName = null;

            // Follow-up Stage Decision Matrix: Day 3, 7, 14, 21
            if (daysPassed >= 21 && lead.followupStage !== 'Dead' && lead.followupStage !== 'Breakup Sent') {
                stage = 'day21';
                nextStageName = 'Breakup Sent';
            } else if (daysPassed >= 14 && (lead.followupStage === '2nd Follow-up' || lead.followupStage === '1st Follow-up' || !lead.followupStage)) {
                stage = 'day14';
                nextStageName = '3rd Follow-up';
            } else if (daysPassed >= 7 && (lead.followupStage === '1st Follow-up' || !lead.followupStage)) {
                stage = 'day7';
                nextStageName = '2nd Follow-up';
            } else if (daysPassed >= 3 && (!lead.followupStage || lead.followupStage === 'Initial Outreach')) {
                stage = 'day3';
                nextStageName = '1st Follow-up';
            }

            // Agar koi stage trigger nahi hoti toh skip karein
            if (!stage) {
                continue;
            }

            const cleanDigits = cleanPhoneNumber(lead.number);
            const targetJid = `${cleanDigits}@c.us`;

            // 1. RE-VERIFY STATUS IN SHEET (Double-check)
            const freshLead = await getLeadByNumber(cleanDigits);
            if (freshLead && (freshLead.status === 'In-Discussion' || freshLead.status === 'Replied' || freshLead.status === 'Dead' || freshLead.status === 'Manual')) {
                console.log(`🛑 Follow-up Skipped: Lead ${lead.name} is in '${freshLead.status}' status.`);
                continue;
            }

            // 2. CRITICAL HUMAN TAKEOVER INTERCEPT (Live Chat History Check)
            try {
                const chat = await client.getChatById(targetJid);
                if (chat) {
                    const messages = await chat.fetchMessages({ limit: 5 });
                    const lastMsg = messages[messages.length - 1];

                    // Agar aapne phone se manually kabhi bhi reply kiya tha
                    if (lastMsg && lastMsg.fromMe && lead.followupStage !== 'Initial Outreach') {
                        console.log(`🛑 Human Intervention Verified: Phone se lead ${lead.name} se baat ho chuki hai. Follow-up cancelled.`);
                        await updateCell(lead.rowIndex, 'F', 'In-Discussion');
                        continue;
                    }
                }
            } catch (chatErr) {
                // Ignore chat check error, proceed safely
            }

            console.log(`\n📌 Triggering [${stage}]: ${lead.name} (${cleanDigits}) | Days passed: ${daysPassed}`);

            // 3. Generate Consultative Follow-up Message
            const messageText = await generateFollowupMessage(lead.name, lead.niche, stage);

            if (!messageText || messageText.trim().length === 0) {
                console.log(`⚠️ AI ne follow-up message generate nahi kiya for ${lead.name}`);
                continue;
            }

            try {
                // 4. WhatsApp registration check
                if (typeof client.getNumberId === 'function') {
                    const numberId = await client.getNumberId(cleanDigits);
                    if (!numberId) {
                        console.log(`❌ Number ${lead.number} WhatsApp par active nahi mila.`);
                        await updateCell(lead.rowIndex, 'F', 'Invalid Number');
                        continue;
                    }
                }

                // 5. Human-like Typing Simulation
                try {
                    const chat = await client.getChatById(targetJid);
                    if (chat && typeof chat.sendStateTyping === 'function') {
                        await chat.sendStateTyping();
                        const typingDuration = Math.floor(Math.random() * 3000) + 3000; // 3-6 sec typing
                        await new Promise(resolve => setTimeout(resolve, typingDuration));
                        if (typeof chat.clearState === 'function') {
                            await chat.clearState();
                        }
                    }
                } catch (typingErr) {}

                // 6. Deliver Message
                await client.sendMessage(targetJid, messageText.trim());
                console.log(`✅ [${stage}] Follow-up Delivered to ${lead.name} (${cleanDigits})`);

                // 7. Sheet Updates
                if (stage === 'day21') {
                    await updateCell(lead.rowIndex, 'F', 'Dead'); // Day 21 ke baad cycle close
                } else {
                    await updateCell(lead.rowIndex, 'F', 'Follow-up Sent');
                }
                await updateCell(lead.rowIndex, 'G', todayDateStr);
                await updateCell(lead.rowIndex, 'I', nextStageName);

                // 8. Anti-Ban Delay before next lead
                if (i < leads.length - 1) {
                    const delayMs = getRandomFollowupDelay();
                    console.log(`🕒 Anti-Ban: Agle follow-up ke liye ${(delayMs / 1000).toFixed(0)} seconds wait kar rahe hain...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }

            } catch (err) {
                console.error(`❌ Follow-up delivery failed for ${lead.name}:`, err.message || err);
            }
        }

        console.log('\n🎉 Follow-up batch check complete hua!');

    } catch (error) {
        console.error('❌ Critical error in processFollowups:', error.message || error);
    }
}

module.exports = { processFollowups };