// src/sheet.js
const path = require('path');
const { google } = require('googleapis');
require('dotenv').config();

// Service Account Path (Local & Render Linux resilient)
const credentialsPath = path.resolve(__dirname, '../credentials.json');

const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Real Indian Timezone (IST) Date Generator (YYYY-MM-DD)
function getTodayISTDate() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

// Bot ID normalize helper (Number_1, Number 1, number-1 sab seamlessly match honge)
function normalizeBotId(val) {
    return String(val || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

// Phone Number Cleaner (+91, 91, 10-digit, spaces, dashes sab handle karega)
function cleanPhoneNumber(rawVal) {
    if (!rawVal) return '';
    // Decimal points aur non-digits hatana
    let cleaned = String(rawVal).split('.')[0].replace(/\D/g, '');

    // Agar 10 digit ka Indian number hai toh '91' prepend karein
    if (cleaned.length === 10) {
        cleaned = '91' + cleaned;
    } 
    // Agar 12 digit hai aur 91 se start hota hai
    else if (cleaned.length === 12 && cleaned.startsWith('91')) {
        // already fine
    } 
    // Agar number ke aage 0 laga ho (e.g. 09876543210)
    else if (cleaned.length === 11 && cleaned.startsWith('0')) {
        cleaned = '91' + cleaned.substring(1);
    }

    return cleaned;
}

/**
 * Nayi Outreach Leads nikalna (Jinka status khali ya 'pending' ho)
 */
async function getPendingLeads() {
    try {
        const sheets = google.sheets({ version: 'v4', auth });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A2:J',
        });

        const rows = res.data.values || [];
        const leads = [];
        const targetBot = normalizeBotId(process.env.ASSIGNED_BOT || 'Number_1');

        console.log(`📋 Google Sheet Total Rows fetched: ${rows.length}. Target Bot ID: '${targetBot}'`);

        rows.forEach((row, index) => {
            const assignedBot = normalizeBotId(row[0]);
            const rawStatus = (row[5] || '').trim().toLowerCase();
            const rawNumber = row[3];
            const formattedNumber = cleanPhoneNumber(rawNumber);

            // Match assigned bot & Pending status (khali ya 'pending')
            const isBotMatch = (assignedBot === targetBot || assignedBot === '');
            const isStatusMatch = (rawStatus === '' || rawStatus === 'pending');

            // Kam se kam 10 digit ka valid number hona chahiye
            if (isBotMatch && isStatusMatch && formattedNumber.length >= 12) {
                leads.push({
                    rowIndex: index + 2,
                    dateAdded: row[1] || '',
                    name: row[2] || 'Sir/Ma\'am',
                    number: formattedNumber,
                    niche: row[4] || 'Business',
                    status: row[5] || 'Pending'
                });
            }
        });

        console.log(`🎯 Matched Valid Pending Leads: ${leads.length}`);
        return leads;
    } catch (error) {
        console.error('❌ Sheet Error (getPendingLeads):', error.message || error);
        return [];
    }
}

/**
 * Multi-day Follow-up leads filter karna (Day 3, 7, 14, 21)
 */
async function getLeadsForFollowup() {
    try {
        const sheets = google.sheets({ version: 'v4', auth });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A2:J',
        });

        const rows = res.data.values || [];
        const followups = [];
        const targetBot = normalizeBotId(process.env.ASSIGNED_BOT || 'Number_1');

        rows.forEach((row, index) => {
            const assignedBot = normalizeBotId(row[0]);
            const messageStatus = (row[5] || '').trim();
            const lastContactDate = (row[6] || '').trim();
            const followupStage = (row[8] || '').trim();
            const formattedNumber = cleanPhoneNumber(row[3]);

            const isAssigned = (assignedBot === targetBot || assignedBot === '');
            const isEligibleStatus = messageStatus === 'Sent' || messageStatus === 'Follow-up Sent';
            const isNotInterrupted = messageStatus !== 'Replied' && messageStatus !== 'In-Discussion' && messageStatus !== 'Dead';

            if (isAssigned && isEligibleStatus && isNotInterrupted && lastContactDate && formattedNumber.length >= 12) {
                followups.push({
                    rowIndex: index + 2,
                    name: row[2] || 'Sir/Ma\'am',
                    number: formattedNumber,
                    niche: row[4] || 'Business',
                    status: messageStatus,
                    lastContactDate: lastContactDate,
                    followupStage: followupStage
                });
            }
        });

        return followups;
    } catch (error) {
        console.error('❌ Sheet Error (getLeadsForFollowup):', error.message || error);
        return [];
    }
}

/**
 * Incoming message ke waqt phone number se lead dhundhna
 */
async function getLeadByNumber(mobileNumber) {
    try {
        const sheets = google.sheets({ version: 'v4', auth });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A2:J',
        });

        const rows = res.data.values || [];
        const cleanTarget = cleanPhoneNumber(mobileNumber);

        for (let i = 0; i < rows.length; i++) {
            const rowNumber = cleanPhoneNumber(rows[i][3]);
            if (rowNumber.length >= 10 && (rowNumber.endsWith(cleanTarget) || cleanTarget.endsWith(rowNumber))) {
                return {
                    rowIndex: i + 2,
                    name: rows[i][2] || 'Sir/Ma\'am',
                    number: rowNumber,
                    niche: rows[i][4] || 'Business',
                    status: rows[i][5] || ''
                };
            }
        }
        return null;
    } catch (error) {
        console.error('❌ Sheet Error (getLeadByNumber):', error.message || error);
        return null;
    }
}

/**
 * Kisi specific cell ko update karna
 */
async function updateCell(rowIndex, columnLetter, value) {
    try {
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `Sheet1!${columnLetter}${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[value]]
            }
        });
        console.log(`✅ Sheet Row ${rowIndex} [Col ${columnLetter}] updated to: '${value}'`);
    } catch (error) {
        console.error(`❌ Sheet update error at Row ${rowIndex} [Col ${columnLetter}]:`, error.message || error);
    }
}

/**
 * Phone number ke hisaab se cell update karna
 */
async function updateCellByNumber(mobileNumber, columnLetter, value) {
    try {
        const lead = await getLeadByNumber(mobileNumber);
        if (lead) {
            await updateCell(lead.rowIndex, columnLetter, value);
        }
    } catch (error) {
        console.error('❌ Sheet update error by number:', error.message || error);
    }
}

module.exports = {
    getPendingLeads,
    getLeadsForFollowup,
    getLeadByNumber,
    updateCell,
    updateCellByNumber,
    getTodayISTDate,
    cleanPhoneNumber
};