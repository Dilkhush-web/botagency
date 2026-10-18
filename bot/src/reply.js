// src/reply.js
const { generateMessage } = require('./gemini');
const { updateCellByNumber, getLeadByNumber } = require('./sheet');

// In-memory queue to buffer/debounce multiple messages from the same client
const pendingReplies = new Map();

// 1.5 se 4 minute ka realistic human response delay (Agency standard)
function getRealisticHumanDelay() {
    const minSecs = 90;   // 1.5 min
    const maxSecs = 240;  // 4 min
    const randomSecs = Math.floor(Math.random() * (maxSecs - minSecs + 1)) + minSecs;
    return randomSecs * 1000;
}

/**
 * Handle incoming WhatsApp message with enterprise human simulation
 * @param {import('whatsapp-web.js').Client} client 
 * @param {import('whatsapp-web.js').Message} message 
 * @param {Object} lead
 */
async function handleIncomingMessage(client, message, lead) {
    try {
        if (!message || message.fromMe || message.isStatus) return;

        const fromNumber = message.from.split('@')[0].replace(/\D/g, '');
        const clientText = message.body ? message.body.trim() : '';

        if (!clientText) return;

        console.log(`\n📩 Incoming Lead Inquiry: ${lead.name} (${fromNumber})`);
        console.log(`💬 Client Text: "${clientText}"`);

        // Sheet me turant status 'Replied' mark karo taaki multi-day follow-up band ho jaye
        try {
            await updateCellByNumber(fromNumber, 'F', 'Replied');
        } catch (e) {}

        // 1. Debounce Logic: Agar client ne lagatar 2-3 messages bheje hain toh unhe combine karein
        if (pendingReplies.has(fromNumber)) {
            const existing = pendingReplies.get(fromNumber);
            clearTimeout(existing.timer);
            existing.fullConversation += `\n${clientText}`;
            console.log(`⏳ Additional message buffered from ${lead.name}. Timer refreshed.`);

            const delay = getRealisticHumanDelay();
            existing.timer = setTimeout(() => executeReply(client, fromNumber, lead), delay);
            return;
        }

        // 2. Schedule realistic busy consultant response delay
        const delayMs = getRealisticHumanDelay();
        const delayMins = (delayMs / 60000).toFixed(1);
        console.log(`🕒 Natural Consultant Delay: ${lead.name} ko ${delayMins} minute baad human response jayega.`);

        const timer = setTimeout(() => {
            executeReply(client, fromNumber, lead);
        }, delayMs);

        pendingReplies.set(fromNumber, {
            timer,
            fullConversation: clientText
        });

    } catch (error) {
        console.error('❌ Error in handleIncomingMessage:', error.message || error);
    }
}

/**
 * Executes the reply after the randomized delay with Human Takeover validation
 */
async function executeReply(client, fromNumber, lead) {
    try {
        const item = pendingReplies.get(fromNumber);
        pendingReplies.delete(fromNumber);

        const convText = item ? item.fullConversation : '';
        const chatId = `${fromNumber}@c.us`;

        // 1. CRITICAL HUMAN TAKEOVER INTERCEPT:
        // Delay ke dauran check karein ki kya aapne apne phone se khud baat shuru kar di hai
        try {
            const chat = await client.getChatById(chatId);
            const messages = await chat.fetchMessages({ limit: 5 });
            const lastMsg = messages[messages.length - 1];

            // Agar aakhiri message aapne khud phone se bheja hai, toh AI cancel ho jayega
            if (lastMsg && lastMsg.fromMe) {
                console.log(`🛑 Human Intervention Verified: Phone se already reply diya ja chuka hai ${lead.name} ko. AI response cancelled.`);
                await updateCellByNumber(fromNumber, 'F', 'In-Discussion');
                return;
            }
        } catch (chatCheckErr) {
            // Safe fallback continue
        }

        // Check if lead status in sheet was already set to In-Discussion / Manual
        const latestLead = await getLeadByNumber(fromNumber);
        if (latestLead && (latestLead.status === 'In-Discussion' || latestLead.status === 'Manual' || latestLead.status === 'Dead')) {
            console.log(`🛑 Lead ${lead.name} status is '${latestLead.status}'. Skipping automated bot reply.`);
            return;
        }

        console.log(`\n🤖 Generating consultative human response for ${lead.name}...`);
        
        // 2. Generate Contextual Response (Groq -> Gemini dual engine)
        const replyText = await generateMessage(lead.name, lead.niche, true, convText);

        if (!replyText || replyText.trim().length === 0) {
            console.log(`⚠️ AI failed to generate response for ${lead.name}`);
            return;
        }

        const chat = await client.getChatById(chatId);

        // 3. Ultra-Human Simulation: Blue tick aur typing indicator
        try {
            await chat.sendSeen(); // Mark as read
            await new Promise(res => setTimeout(res, 1200));

            if (chat.sendStateTyping) {
                await chat.sendStateTyping();
            }

            // 4 se 7 seconds natural typing speed
            const typingDuration = Math.floor(Math.random() * 3000) + 4000;
            await new Promise(res => setTimeout(res, typingDuration));

            if (chat.clearState) {
                await chat.clearState();
            }
        } catch (typingErr) {
            // Typing indicator fail hone par message block nahi hoga
        }

        // 4. Send Message
        await client.sendMessage(chatId, replyText.trim());
        console.log(`✅ Consultant Reply sent to ${lead.name} (${fromNumber}):\n---\n${replyText.trim()}\n---`);

        // 5. Update Sheet Status to 'In-Discussion'
        try {
            await updateCellByNumber(fromNumber, 'F', 'In-Discussion');
        } catch (sheetErr) {}

    } catch (err) {
        console.error(`❌ Failed to deliver reply to ${fromNumber}:`, err.message || err);
    }
}

module.exports = { handleIncomingMessage };