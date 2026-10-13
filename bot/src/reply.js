// src/reply.js
const { generateMessage } = require('./gemini');
const { updateCellByNumber, getLeadByNumber } = require('./sheet');

// In-memory queue to debounce multiple messages from the same client
const pendingReplies = new Map();

// 10 se 20 minutes ka random delay (in milliseconds)
function getRandomReplyDelay() {
    const minMins = 10;
    const maxMins = 20;
    const randomMinutes = Math.floor(Math.random() * (maxMins - minMins + 1)) + minMins;
    return randomMinutes * 60 * 1000;
}

/**
 * Handle incoming WhatsApp message with human simulation
 * @param {import('whatsapp-web.js').Client} client 
 * @param {import('whatsapp-web.js').Message} message 
 */
async function handleIncomingMessage(client, message) {
    try {
        // 1. Basic Guards: Ignore status broadcasts, groups, or bot's own messages
        if (message.isStatus || message.from.includes('@g.us') || message.fromMe) {
            return;
        }

        // WhatsApp number extract karna
        const fromNumber = message.from.replace('@c.us', '');
        const clientText = message.body ? message.body.trim() : '';

        if (!clientText) return;

        // 2. Check karo kya yeh lead hamari Google Sheet mein exist karti hai
        const lead = await getLeadByNumber(fromNumber);
        if (!lead) {
            // Agar unknown number hai jo sheet mein nahi hai, toh safe side ignore ya log karo
            return;
        }

        console.log(`\n📩 Incoming message from ${lead.name} (${fromNumber}): "${clientText}"`);

        // Sheet mein turant status 'Replied' mark karo taaki standard follow-up pause ho jaye
        await updateCellByNumber(fromNumber, 'F', 'Replied');

        // 3. Debounce Logic: Agar client ne lagatar messages bheje hain, toh unhe combine karo
        if (pendingReplies.has(fromNumber)) {
            const existing = pendingReplies.get(fromNumber);
            clearTimeout(existing.timer);
            existing.fullConversation += `\nClient: ${clientText}`;
            console.log(`⏳ Additional message buffered from ${lead.name}. Resetting timer...`);

            // Naya random timer schedule karo
            const delay = getRandomReplyDelay();
            existing.timer = setTimeout(() => executeReply(client, fromNumber, lead, existing.fullConversation), delay);
            return;
        }

        // Pehla message: 10-20 min ka delay schedule karo
        const delayMs = getRandomReplyDelay();
        const delayMins = (delayMs / 60000).toFixed(1);
        console.log(`🕒 Human Simulation: ${lead.name} ko ${delayMins} minute baad reply jayega.`);

        const timer = setTimeout(() => {
            const data = pendingReplies.get(fromNumber);
            const convText = data ? data.fullConversation : clientText;
            executeReply(client, fromNumber, lead, convText);
        }, delayMs);

        pendingReplies.set(fromNumber, {
            timer,
            fullConversation: clientText
        });

    } catch (error) {
        console.error('❌ Error handling incoming message:', error.message || error);
    }
}

/**
 * Executes the reply after the randomized delay
 */
async function executeReply(client, fromNumber, lead, fullMessageText) {
    try {
        pendingReplies.delete(fromNumber);

        console.log(`\n🤖 Generating human-like reply for ${lead.name}...`);
        const replyText = await generateMessage(lead.name, lead.niche, true, fullMessageText);

        if (!replyText) {
            console.log(`⚠️ AI failed to generate reply for ${lead.name}`);
            return;
        }

        const chatId = `${fromNumber}@c.us`;
        const chat = await client.getChatById(chatId);

        // 4. Ultra-Human Simulation: Blue tick aur typing indicator
        await chat.sendSeen(); // Seen mark karo
        await chat.sendStateTyping(); // "typing..." show karega

        // 4 se 8 seconds ka typing delay taaki bot-like paste na lage
        const typingDelay = Math.floor(Math.random() * 4000) + 4000;
        await new Promise(res => setTimeout(res, typingDelay));

        await chat.clearState();
        await client.sendMessage(chatId, replyText);

        console.log(`✅ Human Reply sent to ${lead.name} (${fromNumber}):\n${replyText}\n`);

        // Sheet mein update karo ki reply de diya gaya hai
        await updateCellByNumber(fromNumber, 'F', 'In-Discussion');
    } catch (err) {
        console.error(`❌ Failed to send reply to ${fromNumber}:`, err.message || err);
    }
}

module.exports = { handleIncomingMessage };