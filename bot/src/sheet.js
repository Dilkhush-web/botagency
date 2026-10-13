// src/sheet.js
const { google } = require('googleapis');
require('dotenv').config();

const auth = new google.auth.GoogleAuth({
    keyFile: './credentials.json',
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

        rows.forEach((row, index) => {
            const assignedBot = (row[0] || '').trim();
            const rawStatus = (row[5] || '').trim().toLowerCase();

            // Match assigned bot & Pending status
            if (assignedBot === process.env.ASSIGNED_BOT && (rawStatus === '' || rawStatus === 'pending')) {
                leads.push({
                    rowIndex: index + 2,
                    dateAdded: row[1] || '',
                    name: row[2] || 'Sir/Ma\'am',
                    number: row[3] || '',
                    niche: row[4] || 'Business',
                    status: row[5] || 'Pending'
                });
            }
        });

        return leads;
    } catch (error) {
        console.error('❌ Sheet Error (getPendingLeads):', error.message);
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

        rows.forEach((row, index) => {
            const assignedBot = (row[0] || '').trim();
            const messageStatus = (row[5] || '').trim();
            const lastContactDate = (row[6] || '').trim();
            const followupStage = (row[8] || '').trim();

            const isAssigned = assignedBot === process.env.ASSIGNED_BOT;
            const isEligibleStatus = messageStatus === 'Sent' || messageStatus === 'Follow-up Sent';
            // Replied, In-Discussion ya Dead leads ko follow-up nahi bhejenge
            const isNotInterrupted = messageStatus !== 'Replied' && messageStatus !== 'In-Discussion' && messageStatus !== 'Dead';

            if (isAssigned && isEligibleStatus && isNotInterrupted && lastContactDate) {
                followups.push({
                    rowIndex: index + 2,
                    name: row[2] || 'Sir/Ma\'am',
                    number: row[3] || '',
                    niche: row[4] || 'Business',
                    status: messageStatus,
                    lastContactDate: lastContactDate,
                    followupStage: followupStage
                });
            }
        });

        return followups;
    } catch (error) {
        console.error('❌ Sheet Error (getLeadsForFollowup):', error.message);
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
        const cleanTarget = String(mobileNumber).replace(/\D/g, '');

        for (let i = 0; i < rows.length; i++) {
            const rowNumber = String(rows[i][3] || '').replace(/\D/g, '');
            if (rowNumber.length >= 10 && (rowNumber.endsWith(cleanTarget) || cleanTarget.endsWith(rowNumber))) {
                return {
                    rowIndex: i + 2,
                    name: rows[i][2] || 'Sir/Ma\'am',
                    number: rows[i][3] || '',
                    niche: rows[i][4] || 'Business',
                    status: rows[i][5] || ''
                };
            }
        }
        return null;
    } catch (error) {
        console.error('❌ Sheet Error (getLeadByNumber):', error.message);
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
        console.error(`❌ Sheet update error at Row ${rowIndex} [Col ${columnLetter}]:`, error.message);
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
        console.error('❌ Sheet update error by number:', error.message);
    }
}

module.exports = {
    getPendingLeads,
    getLeadsForFollowup,
    getLeadByNumber,
    updateCell,
    updateCellByNumber,
    getTodayISTDate
};