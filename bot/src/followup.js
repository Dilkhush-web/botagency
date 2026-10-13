// src/followup.js
const { generateFollowupMessage } = require('./gemini');
const { updateCell, getLeadsForFollowup } = require('./sheet');

// Anti-Ban Delay: 1 se 3 minute ke beech ka random gap
function getRandomFollowupDelay() {
    const min = 60000;  // 1 min
    const max = 180000; // 3 min
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Do dates ke beech ke din nikalna
function getDaysDifference(pastDateStr) {
    if (!pastDateStr) return 0;
    const past = new Date(pastDateStr);
    const today = new Date();
    
    // Normalize time to midnight for accurate day calculation
    past.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    const diffTime = today.getTime() - past.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

// Format phone number
function cleanPhoneNumber(rawNumber) {
    let cleaned = String(rawNumber).replace(/\D/g, '');
    if (cleaned.length === 10) {
        cleaned = '91' + cleaned;
    }
    return cleaned + '@c.us';
}

/**
 * Runs the Multi-day Follow-up Pipeline
 * @param {import('whatsapp-web.js').Client} client 
 */
async function processFollowups(client) {
    console.log('\n🔎 Follow-up engine: Google Sheet se leads check kar rahe hain...');

    try {
        const leads = await getLeadsForFollowup();

        if (!leads || leads.length === 0) {
            console.log('✅ Follow-up ke liye koi eligible lead nahi mili.');
            return;
        }

        console.log(`📋 Total ${leads.length} potential leads scan hui. Day difference calculate kar rahe hain...`);

        const todayDateStr = new Date().toISOString().split('T')[0];

        for (let i = 0; i < leads.length; i++) {
            const lead = leads[i];
            const daysPassed = getDaysDifference(lead.lastContactDate);

            let stage = null;
            let nextStageName = null;

            // Follow-up Stage Decision Matrix: 3, 7, 14, 21 Days
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

            // Agar koi stage trigger nahi hoti toh skip karo
            if (!stage) {
                continue;
            }

            console.log(`\n📌 Lead: ${lead.name} (${lead.number}) | Days passed: ${daysPassed} | Triggering: [${stage}]`);

            // AI se personalized message generate karwana
            const messageText = await generateFollowupMessage(lead.name, lead.niche, stage);

            if (!messageText) {
                console.log(`⚠️ AI ne follow-up message generate nahi kiya for ${lead.name}`);
                continue;
            }

            try {
                const formattedNumber = cleanPhoneNumber(lead.number);

                // WhatsApp registration check
                const isRegistered = await client.isRegisteredUser(formattedNumber);
                if (!isRegistered) {
                    console.log(`❌ Number ${lead.number} WhatsApp par active nahi hai.`);
                    await updateCell(lead.rowIndex, 'F', 'Invalid Number');
                    continue;
                }

                // Human-like Typing Simulation
                const chat = await client.getChatById(formattedNumber);
                await chat.sendStateTyping();
                const typingDuration = Math.floor(Math.random() * 4000) + 3000; // 3-7 sec typing
                await new Promise(resolve => setTimeout(resolve, typingDuration));
                await chat.clearState();

                // Send Message
                await client.sendMessage(formattedNumber, messageText);
                console.log(`✅ [${stage}] Follow-up Sent to ${lead.name}!`);

                // Sheet Updates:
                // Column F: Message Status
                // Column G: Last Contact Date (Aaj ki date)
                // Column I: Follow-up Stage
                if (stage === 'day21') {
                    await updateCell(lead.rowIndex, 'F', 'Dead'); // Breakup ke baad Dead mark karo
                } else {
                    await updateCell(lead.rowIndex, 'F', 'Follow-up Sent');
                }
                await updateCell(lead.rowIndex, 'G', todayDateStr);
                await updateCell(lead.rowIndex, 'I', nextStageName);

                // Anti-Ban Delay before next lead
                if (i < leads.length - 1) {
                    const delayMs = getRandomFollowupDelay();
                    console.log(`🕒 Anti-Ban: Agle follow-up ke liye ${(delayMs / 1000).toFixed(0)} seconds wait kar rahe hain...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }

            } catch (err) {
                console.error(`❌ Follow-up failed for ${lead.name}:`, err.message || err);
            }
        }

        console.log('\n🎉 Aaj ka follow-up batch complete hua!');

    } catch (error) {
        console.error('❌ Critical error in processFollowups:', error.message || error);
    }
}

module.exports = { processFollowups };