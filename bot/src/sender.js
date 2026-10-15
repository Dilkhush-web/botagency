// src/sender.js
const { generateMessage } = require('./gemini');
const { updateCell, getTodayISTDate } = require('./sheet');

// Anti-Ban Delay: Har message ke beech 60-90s ka natural human gap
function getRandomDelay() {
    const min = 60000;  // 1 minute
    const max = 90000;  // 1.5 minute
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Clean and sanitize Indian phone number (+91, spaces, dashes handle karega)
function sanitizeNumber(rawNumber) {
    if (!rawNumber) return '';
    let cleaned = String(rawNumber).split('.')[0].replace(/\D/g, '');
    if (cleaned.length === 10) {
        cleaned = '91' + cleaned;
    } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
        cleaned = '91' + cleaned.substring(1);
    }
    return cleaned;
}

/**
 * Executes Cold Outreach Messaging Batch
 * Supports flexible parameters from scheduler:
 * sendOutreachMessages(client, leads, batchSize)
 */
async function sendOutreachMessages(client, leads, arg3 = 5, arg4 = 5) {
    try {
        if (!Array.isArray(leads) || leads.length === 0) {
            console.log('ℹ️ Outreach: Processing ke liye koi pending leads nahi hain.');
            return;
        }

        // Dynamic slot limit resolve karna (No hardcoded limitation)
        let maxLeads = 5;
        if (typeof arg4 === 'number' && !isNaN(arg4) && arg4 > 0) {
            maxLeads = arg4;
        } else if (typeof arg3 === 'number' && !isNaN(arg3) && arg3 > 0) {
            maxLeads = arg3;
        }

        const leadsToProcess = leads.slice(0, maxLeads);
        const todayDateIST = getTodayISTDate();

        console.log(`\n==================================================`);
        console.log(`📊 Batch Execution Started: Is slot mein ${leadsToProcess.length} leads process hongi.`);
        console.log(`==================================================`);

        for (let i = 0; i < leadsToProcess.length; i++) {
            const lead = leadsToProcess[i];
            
            console.log(`\n--------------------------------------------------`);
            console.log(`⏳ [${i + 1}/${leadsToProcess.length}] Processing Lead: ${lead.name} (${lead.niche})`);

            // 1. Clean number validation
            const cleanedDigits = sanitizeNumber(lead.number);
            if (cleanedDigits.length < 10) {
                console.log(`❌ Number '${lead.number}' invalid hai. Format check karein.`);
                try { await updateCell(lead.rowIndex, 'F', 'Invalid Number'); } catch (e) {}
                continue;
            }

            // 2. WhatsApp registration verify karna
            let targetJid = `${cleanedDigits}@c.us`;
            try {
                if (typeof client.getNumberId === 'function') {
                    const numberId = await client.getNumberId(cleanedDigits);
                    if (!numberId) {
                        console.log(`❌ Number '${lead.number}' WhatsApp par register nahi hai!`);
                        try { await updateCell(lead.rowIndex, 'F', 'Invalid Number'); } catch (e) {}
                        continue;
                    }
                    targetJid = numberId._serialized;
                }
            } catch (verErr) {
                console.log(`⚠️ Number verification fallback, default JID use ho rahi hai: ${verErr.message}`);
            }

            // 3. AI Message generation (Groq primary -> Gemini fallback)
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

            console.log(`💬 Professional Message Generated for ${lead.name}:\n---\n${messageText}\n---`);

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
                // Ignore typing errors to ensure delivery continues smoothly
            }

            // 5. Message Delivery with Single Safe Retry
            let delivered = false;
            let attempts = 0;
            while (!delivered && attempts < 2) {
                attempts++;
                try {
                    await client.sendMessage(targetJid, messageText.trim());
                    delivered = true;
                    console.log(`✅ Message successfully delivered to ${lead.name} (${lead.number})`);

                    // Google Sheet Update
                    try {
                        await updateCell(lead.rowIndex, 'F', 'Sent');
                        await updateCell(lead.rowIndex, 'G', todayDateIST);
                        await updateCell(lead.rowIndex, 'I', 'Initial Outreach');
                    } catch (sheetErr) {
                        console.error('⚠️ Sheet update warning:', sheetErr.message);
                    }

                    // Anti-Ban Delay between messages (Aakhiri message ke baad wait nahi karega)
                    if (i < leadsToProcess.length - 1) {
                        const delayMs = getRandomDelay();
                        console.log(`🕒 Anti-Ban: Agle message ke liye ${(delayMs / 1000).toFixed(0)} seconds wait kar rahe hain...`);
                        await new Promise(resolve => setTimeout(resolve, delayMs));
                    }

                } catch (sendError) {
                    console.error(`⚠️ [Attempt ${attempts}/2] Delivery issue for ${lead.name}:`, sendError.message || sendError);
                    if (attempts >= 2) {
                        try { await updateCell(lead.rowIndex, 'F', 'Failed'); } catch (e) {}
                    } else {
                        await new Promise(res => setTimeout(res, 5000)); // 5s wait before single retry
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