// src/listener.js
const { handleIncomingMessage } = require('./reply');
const { getLeadByNumber } = require('./sheet');

function setupListeners(client) {
    console.log('🎧 Event Listeners active ho gaye hain...');

    // 1. Client se aane wale incoming messages
    client.on('message', async (message) => {
        try {
            // A. Agar message humne khud bheja hai toh skip karein
            if (message.fromMe) return;

            // B. Groups (@g.us), Status (@broadcast) aur Newsletters ko skip karein
            if (
                message.from.includes('@g.us') || 
                message.from.includes('@broadcast') || 
                message.from.includes('@newsletter')
            ) {
                return;
            }

            // C. Sender ka clean phone number nikalna
            const rawSender = message.from.split('@')[0];
            const cleanNumber = String(rawSender).replace(/\D/g, '');

            if (cleanNumber.length < 10) return;

            // D. STRICT GOOGLE SHEET CHECK:
            // Sirf wahi reply hoga jo Google Sheet ke andar registered lead hai
            const lead = await getLeadByNumber(cleanNumber);

            if (!lead) {
                // Yeh personal contact / unlisted number hai -> Skip
                return;
            }

            console.log(`\n📩 Recognized Sheet Lead Message: ${lead.name} (${cleanNumber}) - "${message.body}"`);

            // E. Valid sheet lead ke liye reply handler execute karein
            await handleIncomingMessage(client, message, lead);

        } catch (err) {
            console.error('❌ Error handling incoming message:', err.message || err);
        }
    });

    // 2. Reconnection guard agar WhatsApp disconnect ho
    client.on('disconnected', (reason) => {
        console.warn(`⚠️ WhatsApp Client disconnected: ${reason}`);
        console.log('🔄 Reconnecting client in 10 seconds...');
        setTimeout(() => {
            try {
                client.initialize();
            } catch (reconnectErr) {
                console.error('⚠️ Reconnection trigger error:', reconnectErr.message || reconnectErr);
            }
        }, 10000);
    });
}

module.exports = { setupListeners };