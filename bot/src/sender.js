// src/sender.js
const { generateMessage } = require('./gemini');
const { updateCell, getTodayISTDate } = require('./sheet');

// Anti-Ban Delay: Har message ke beech 60-90s ka random human gap
function getRandomDelay() {
    const min = 60000;  // 1 minute
    const max = 90000;  // 1.5 minute
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Clean and sanitize Indian phone number
function sanitizeNumber(rawNumber) {
    if (!rawNumber) return '';
    let cleaned = String(rawNumber).split('.')[0].replace(/\D/g, '');
    if (cleaned.length === 10) {
        cleaned = '91' + cleaned;
    }
    return cleaned;
}

/**
 * Executes Cold Outreach Messaging Batch
 * Supports flexible arguments so parameter mismatch never fails:
 * (client, leads, maxLeads) OR (client, leads, campaignDate, maxLeads)
 */
async function sendOutreachMessages(client, leads, arg3 = 3, arg4 = 3) {
    try {
        if (!Array.isArray(leads) || leads.length === 0) {
            console.log('ℹ️ Outreach: Processing ke liye koi leads nahi hain.');
            return;
        }

        // Automatic parameter resolution (agar 3rd arg date string ho toh 4th ko limit lo)
        let maxLeads = 3;
        if (typeof arg4 === 'number' && !isNaN(arg4) && arg4 > 0) {
            maxLeads = arg4;
        } else if (typeof arg3 === 'number' && !isNaN(arg3) && arg3 > 0) {
            maxLeads = arg3;
        }

        const leadsToProcess = leads.slice(0, maxLeads);
        const todayDateIST = getTodayISTDate();

        console.log(`\n📊 Batch Started: Is slot mein ${leadsToProcess.length} leads process hongi.`);

        for (let i = 0; i < leadsToProcess.length; i++) {
            const lead = leadsToProcess[i];
            
            console.log(`\n--------------------------------------------------`);
            console.log(`⏳ [${i + 1}/${leadsToProcess.length}] Processing: ${lead.name} (${lead.niche})`);

            // 1. Clean number
            const cleanedDigits = sanitizeNumber(lead.number);
            if (cleanedDigits.length < 10) {
                console.log(`❌ Number '${lead.number}' invalid hai.`);
                try { await updateCell(lead.rowIndex, 'F', 'Invalid Number'); } catch (e) {}
                continue;
            }

            // 2. Verify WhatsApp registration via getNumberId
            let targetJid = `${cleanedDigits}@c.us`;
            try {
                if (typeof client.getNumberId === 'function') {
                    const numberId = await client.getNumberId(cleanedDigits);
                    if (!numberId) {
                        console.log(`❌ Number '${lead.number}' WhatsApp par registered nahi mila!`);
                        try { await updateCell(lead.rowIndex, 'F', 'Invalid Number'); } catch (e) {}
                        continue;
                    }
                    targetJid = numberId._serialized;
                }
            } catch (verErr) {
                console.log(`⚠️ Number verification warning, using default JID: ${verErr.message}`);
            }

            // 3. AI Message generate karna (Groq -> Gemini Dual-Engine)
            let messageText = '';
            try {
                messageText = await generateMessage(lead.name, lead.niche, false, "", "new");
            } catch (aiErr) {
                console.error(`⚠️ AI Generation Error for ${lead.name}:`, aiErr.message);
            }
            
            if (!messageText || messageText.trim().length === 0) {
                console.log(`⚠️ Message create nahi ho paya for ${lead.name}`);
                try { await updateCell(lead.rowIndex, 'F', 'Failed'); } catch (e) {}
                continue;
            }

            console.log(`💬 Professional Message Ready for ${lead.name}:\n---\n${messageText}\n---`);

            // 4. Safe Human-like Typing Indicator
            try {
                const chat = await client.getChatById(targetJid);
                if (chat && typeof chat.sendStateTyping === 'function') {
                    await chat.sendStateTyping();
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    if (typeof chat.clearState === 'function') {
                        await chat.clearState();
                    }
                }
            } catch (typingErr) {
                // Typing error hone par delivery block nahi hogi
            }

            // 5. Deliver Message with Retries
            let delivered = false;
            let attempts = 0;
            while (!delivered && attempts < 2) {
                attempts++;
                try {
                    await client.sendMessage(targetJid, messageText.trim());
                    delivered = true;
                    console.log(`✅ Message successfully delivered to ${lead.name} (${lead.number})`);

                    // Sheet Updates (safe execution)
                    try {
                        await updateCell(lead.rowIndex, 'F', 'Sent');
                        await updateCell(lead.rowIndex, 'G', todayDateIST);
                        await updateCell(lead.rowIndex, 'I', 'Initial Outreach');
                    } catch (sheetErr) {
                        console.error('⚠️ Sheet cell update error:', sheetErr.message);
                    }

                    // Anti-Ban Delay between messages
                    if (i < leadsToProcess.length - 1) {
                        const delayMs = getRandomDelay();
                        console.log(`🕒 Anti-Ban: Agle message ke liye ${(delayMs / 1000).toFixed(0)} seconds wait kar rahe hain...`);
                        await new Promise(resolve => setTimeout(resolve, delayMs));
                    }

                } catch (sendError) {
                    console.error(`⚠️ [Attempt ${attempts}/2] Delivery error for ${lead.name}:`, sendError.message || sendError);
                    if (attempts >= 2) {
                        try { await updateCell(lead.rowIndex, 'F', 'Failed'); } catch (e) {}
                    } else {
                        await new Promise(res => setTimeout(res, 5000)); // 5 sec wait before single retry
                    }
                }
            }
        }
        
        console.log('\n🎉 Outreach batch safaltapoorvak complete hua!');

    } catch (err) {
        console.error('❌ Critical error in sendOutreachMessages:', err.message || err);
    }
}

module.exports = { sendOutreachMessages };