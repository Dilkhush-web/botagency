// src/sender.js
const { generateMessage } = require('./gemini');
const { updateCell, getTodayISTDate } = require('./sheet');

// Anti-Ban Delay: Har outreach message ke beech 1 se 2 minute ka random human gap
function getRandomDelay() {
    const min = 60000;  // 1 minute
    const max = 120000; // 2 minute
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Clean and sanitize phone number
function sanitizeNumber(rawNumber) {
    if (!rawNumber) return '';
    // Decimal points aur non-digits hatana
    let cleaned = String(rawNumber).split('.')[0].replace(/\D/g, '');
    if (cleaned.length === 10) {
        cleaned = '91' + cleaned;
    }
    return cleaned;
}

/**
 * Executes Cold Outreach Messaging Batch
 * @param {import('whatsapp-web.js').Client} client 
 * @param {Array} leads 
 * @param {number} maxLeadsToProcess 
 */
async function sendOutreachMessages(client, leads, maxLeadsToProcess = 3) {
    try {
        const leadsToProcess = leads.slice(0, maxLeadsToProcess);
        const todayDateIST = getTodayISTDate();

        console.log(`\n📊 Batch Started: Is slot mein ${leadsToProcess.length} leads process hongi.`);

        for (let i = 0; i < leadsToProcess.length; i++) {
            const lead = leadsToProcess[i];
            
            console.log(`\n--------------------------------------------------`);
            console.log(`⏳ [${i + 1}/${leadsToProcess.length}] Processing: ${lead.name} (${lead.niche})`);

            // 1. Clean number
            const cleanedDigits = sanitizeNumber(lead.number);
            if (cleanedDigits.length < 10) {
                console.log(`❌ Number ${lead.number} invalid hai.`);
                await updateCell(lead.rowIndex, 'F', 'Invalid Number');
                continue;
            }

            // 2. Verify WhatsApp registration via getNumberId
            let targetJid = `${cleanedDigits}@c.us`;
            try {
                const numberId = await client.getNumberId(cleanedDigits);
                if (!numberId) {
                    console.log(`❌ Number ${lead.number} WhatsApp par registered nahi hai!`);
                    await updateCell(lead.rowIndex, 'F', 'Invalid Number');
                    continue;
                }
                targetJid = numberId._serialized;
            } catch (verErr) {
                console.log(`⚠️ Number verification warning, trying default JID: ${verErr.message}`);
            }

            // 3. AI / Professional Message generate karna
            const messageText = await generateMessage(lead.name, lead.niche, false, "", "new");
            
            if (!messageText || messageText.trim().length === 0) {
                console.log(`⚠️ Message create nahi ho paya for ${lead.name}`);
                await updateCell(lead.rowIndex, 'F', 'Failed');
                continue;
            }

            console.log(`💬 Professional Message Ready for ${lead.name}:\n---\n${messageText}\n---`);

            // 4. Safe Typing Indicator (Crash-proof)
            try {
                const chat = await client.getChatById(targetJid);
                if (chat && chat.sendStateTyping) {
                    await chat.sendStateTyping();
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    await chat.clearState();
                }
            } catch (typingErr) {
                // Agar chat nayi hai toh typing skip karo, message fail nahi hona chahiye
            }

            // 5. Deliver Message
            try {
                await client.sendMessage(targetJid, messageText.trim());
                console.log(`✅ Message successfully delivered to ${lead.name} (${lead.number})`);

                // Sheet Updates
                await updateCell(lead.rowIndex, 'F', 'Sent');
                await updateCell(lead.rowIndex, 'G', todayDateIST);
                await updateCell(lead.rowIndex, 'I', 'Initial Outreach');

                // Anti-Ban Delay between messages
                if (i < leadsToProcess.length - 1) {
                    const delayMs = getRandomDelay();
                    console.log(`🕒 Anti-Ban: Agle message ke liye ${(delayMs / 1000).toFixed(0)} seconds wait kar rahe hain...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }

            } catch (sendError) {
                console.error(`❌ ${lead.name} ko message deliver karne mein error:`, sendError.message || sendError);
                await updateCell(lead.rowIndex, 'F', 'Failed');
            }
        }
        
        console.log('\n🎉 Outreach batch safaltapoorvak complete hua!');

    } catch (err) {
        console.error('❌ Critical error in sendOutreachMessages:', err.message || err);
    }
}

module.exports = { sendOutreachMessages };