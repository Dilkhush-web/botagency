// src/listener.js
const { handleIncomingMessage } = require('./reply');
const { getLeadByNumber, updateCell } = require('./sheet');

function setupListeners(client) {
    console.log('🎧 Enterprise Event Listeners active ho gaye hain...');

    // 1. HUMAN TAKEOVER DETECTOR:
    // Agar aapne phone se kisi ko bhi message kiya, bot use detect karke bot-replies pause kar dega
    client.on('message_create', async (message) => {
        try {
            if (message.fromMe) {
                const target = message.to.split('@')[0];
                const cleanTarget = String(target).replace(/\D/g, '');
                
                if (cleanTarget.length >= 10) {
                    const lead = await getLeadByNumber(cleanTarget);
                    // Agar sheet wali lead ko aapne khud message bhej diya
                    if (lead && lead.status !== 'In-Discussion' && lead.status !== 'Manual') {
                        console.log(`👤 Human Intervention Detected: Aapne lead ${lead.name} (${cleanTarget}) ko phone se message bheja. Automated Bot paused for this lead.`);
                        try {
                            await updateCell(lead.rowIndex, 'F', 'In-Discussion');
                        } catch (e) {}
                    }
                }
            }
        } catch (err) {
            // Safe silent error ignore for background message creation
        }
    });

    // 2. INCOMING LEAD MESSAGES LISTENER
    client.on('message', async (message) => {
        try {
            // A. Ignore self messages
            if (message.fromMe) return;

            // B. Ignore Groups, Statuses, Newsletters
            if (
                message.from.includes('@g.us') || 
                message.from.includes('@broadcast') || 
                message.from.includes('@newsletter')
            ) {
                return;
            }

            // C. Extract clean phone number
            const rawSender = message.from.split('@')[0];
            const cleanNumber = String(rawSender).replace(/\D/g, '');

            if (cleanNumber.length < 10) return;

            // D. STRICT GOOGLE SHEET CHECK
            // Sirf Google Sheet me registered leads par hi AI react karega
            const lead = await getLeadByNumber(cleanNumber);
            if (!lead) {
                // Personal contact / unlisted inquiry -> completely skip
                return;
            }

            // E. CHECK HUMAN TAKEOVER STATUS
            // Agar status already 'In-Discussion' ya 'Manual' hai, toh bot beech me nahi bolega
            const currentStatus = String(lead.status || '').trim();
            if (currentStatus === 'In-Discussion' || currentStatus === 'Manual' || currentStatus === 'Dead') {
                console.log(`🛑 Human Takeover Active: Lead ${lead.name} (${cleanNumber}) is already in '${currentStatus}'. Bot will remain silent.`);
                return;
            }

            // F. AUTOMATED / BROCHURE DETECTION
            // Agar samne wale ka automated catalog / business bot response aaye toh bot loop me na phase
            const textBody = (message.body || '').trim().toLowerCase();
            const isAutoCatalog = (
                message.type === 'document' || 
                message.type === 'vcard' ||
                textBody.includes('thank you for contacting') ||
                textBody.includes('thanks for reaching out') ||
                textBody.includes('press 1') ||
                textBody.includes('automated message')
            );

            if (isAutoCatalog) {
                console.log(`ℹ️ Automated brochure/catalog reply detected from ${lead.name}. Bot skipping counter-reply.`);
                try {
                    await updateCell(lead.rowIndex, 'F', 'In-Discussion');
                } catch (e) {}
                return;
            }

            console.log(`\n📩 Recognized Sheet Lead Message: ${lead.name} (${cleanNumber})`);
            console.log(`💬 Message: "${message.body}"`);

            // G. Execute high-level conversational handler
            await handleIncomingMessage(client, message, lead);

        } catch (err) {
            console.error('❌ Error handling incoming message:', err.message || err);
        }
    });

    // 3. RECONNECTION GUARD (Auto-Healing)
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