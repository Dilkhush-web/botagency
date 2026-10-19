// src/sheet.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');

require('dotenv').config();

// Local credentials file fallback
const credentialsPath = path.resolve(
    __dirname,
    '../credentials.json'
);

// Google service-account credentials loader
function loadGoogleCredentials() {
    let credentials;

    const credentialsJSON =
        process.env.GOOGLE_CREDENTIALS_JSON;

    if (credentialsJSON && credentialsJSON.trim()) {
        try {
            credentials = JSON.parse(credentialsJSON);
        } catch {
            throw new Error(
                'GOOGLE_CREDENTIALS_JSON valid JSON nahi hai. ' +
                'Downloaded JSON file ka complete content paste karein.'
            );
        }

        console.log(
            '🔑 Google credentials source: Railway variable'
        );
    } else {
        if (!fs.existsSync(credentialsPath)) {
            throw new Error(
                'Google credentials missing. ' +
                'GOOGLE_CREDENTIALS_JSON set karein ' +
                'ya credentials.json provide karein.'
            );
        }

        try {
            credentials = JSON.parse(
                fs.readFileSync(credentialsPath, 'utf8')
            );
        } catch {
            throw new Error(
                'credentials.json read/parse nahi ho pa raha.'
            );
        }

        console.log(
            '🔑 Google credentials source: credentials.json'
        );
    }

    if (
        !credentials ||
        credentials.type !== 'service_account' ||
        typeof credentials.client_email !== 'string' ||
        !credentials.client_email.trim() ||
        typeof credentials.private_key !== 'string'
    ) {
        throw new Error(
            'Valid service-account JSON required. ' +
            'type, client_email aur private_key check karein.'
        );
    }

    credentials.client_email =
        credentials.client_email.trim();

    // Handle actual newlines and escaped newlines.
    credentials.private_key = credentials.private_key
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\r\n/g, '\n')
        .trim() + '\n';

    // Validate private-key format without logging the secret.
    try {
        const key = crypto.createPrivateKey(
            credentials.private_key
        );

        if (key.asymmetricKeyType !== 'rsa') {
            throw new Error('RSA private key required.');
        }
    } catch {
        throw new Error(
            'Google private_key invalid ya incomplete hai. ' +
            'Original downloaded JSON ka complete content use karein.'
        );
    }

    // This checks format, not whether the key is active at Google.
    return credentials;
}

const SPREADSHEET_ID = String(
    process.env.SPREADSHEET_ID || ''
).trim();

if (!SPREADSHEET_ID) {
    throw new Error(
        'SPREADSHEET_ID missing hai. Railway Variables mein set karein.'
    );
}

const auth = new google.auth.GoogleAuth({
    credentials: loadGoogleCredentials(),
    scopes: [
        'https://www.googleapis.com/auth/spreadsheets'
    ]
});

const sheets = google.sheets({
    version: 'v4',
    auth
});

const SHEET_NAME = 'Sheet1';
const LEADS_RANGE = `${SHEET_NAME}!A2:J`;

// IST date: YYYY-MM-DD
function getTodayISTDate() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());

    const values = {};

    for (const part of parts) {
        values[part.type] = part.value;
    }

    return `${values.year}-${values.month}-${values.day}`;
}

// Number_1, Number 1, number-1 -> number1
function normalizeBotId(val) {
    return String(val || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '');
}

// Indian phone-number normalization
function cleanPhoneNumber(rawVal) {
    if (!rawVal) return '';

    let cleaned = String(rawVal)
        .split('.')[0]
        .replace(/\D/g, '');

    if (cleaned.length === 10) {
        cleaned = '91' + cleaned;
    } else if (
        cleaned.length === 12 &&
        cleaned.startsWith('91')
    ) {
        // Already normalized.
    } else if (
        cleaned.length === 11 &&
        cleaned.startsWith('0')
    ) {
        cleaned = '91' + cleaned.substring(1);
    }

    return cleaned;
}

// Consistent error reporting without printing credentials.
function logSheetError(operation, error) {
    const message = error && error.message
        ? error.message
        : 'Unknown Google Sheets error';

    console.error(
        `❌ Sheet Error (${operation}):`,
        message
    );

    if (
        /invalid_grant|invalid jwt signature/i.test(message)
    ) {
        console.error(
            '👉 GOOGLE_CREDENTIALS_JSON mein same service account ' +
            'ki matching, active key use karein. ' +
            'Deleted/disabled key ko code se repair nahi kiya ja sakta.'
        );
    }
}

/**
 * Pending outreach leads.
 * Existing assignment and status rules preserved.
 */
async function getPendingLeads() {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: LEADS_RANGE
        });

        const rows = res.data.values || [];
        const leads = [];

        const targetBot = normalizeBotId(
            process.env.ASSIGNED_BOT || 'Number_1'
        );

        console.log(
            `📋 Google Sheet Total Rows fetched: ${rows.length}. ` +
            `Target Bot ID: '${targetBot}'`
        );

        rows.forEach((row, index) => {
            const assignedBot = normalizeBotId(row[0]);

            const rawStatus = String(row[5] || '')
                .trim()
                .toLowerCase();

            const formattedNumber = cleanPhoneNumber(row[3]);

            const isBotMatch =
                assignedBot === targetBot ||
                assignedBot === '';

            const isStatusMatch =
                rawStatus === '' ||
                rawStatus === 'pending';

            if (
                isBotMatch &&
                isStatusMatch &&
                formattedNumber.length >= 12
            ) {
                leads.push({
                    rowIndex: index + 2,
                    dateAdded: row[1] || '',
                    name: row[2] || "Sir/Ma'am",
                    number: formattedNumber,
                    niche: row[4] || 'Business',
                    status: row[5] || 'Pending'
                });
            }
        });

        console.log(
            `🎯 Matched Valid Pending Leads: ${leads.length}`
        );

        return leads;
    } catch (error) {
        logSheetError('getPendingLeads', error);
        return [];
    }
}

/**
 * Follow-up candidates.
 * Day 3, 7, 14, 21 timing remains the scheduler's responsibility.
 */
async function getLeadsForFollowup() {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: LEADS_RANGE
        });

        const rows = res.data.values || [];
        const followups = [];

        const targetBot = normalizeBotId(
            process.env.ASSIGNED_BOT || 'Number_1'
        );

        rows.forEach((row, index) => {
            const assignedBot = normalizeBotId(row[0]);

            const messageStatus = String(row[5] || '').trim();
            const lastContactDate = String(row[6] || '').trim();
            const followupStage = String(row[8] || '').trim();

            const formattedNumber = cleanPhoneNumber(row[3]);

            const isAssigned =
                assignedBot === targetBot ||
                assignedBot === '';

            const isEligibleStatus =
                messageStatus === 'Sent' ||
                messageStatus === 'Follow-up Sent';

            const isNotInterrupted =
                messageStatus !== 'Replied' &&
                messageStatus !== 'In-Discussion' &&
                messageStatus !== 'Dead';

            if (
                isAssigned &&
                isEligibleStatus &&
                isNotInterrupted &&
                lastContactDate &&
                formattedNumber.length >= 12
            ) {
                followups.push({
                    rowIndex: index + 2,
                    name: row[2] || "Sir/Ma'am",
                    number: formattedNumber,
                    niche: row[4] || 'Business',
                    status: messageStatus,
                    lastContactDate,
                    followupStage
                });
            }
        });

        return followups;
    } catch (error) {
        logSheetError('getLeadsForFollowup', error);
        return [];
    }
}

/**
 * Find a lead by incoming phone number.
 */
async function getLeadByNumber(mobileNumber) {
    try {
        const cleanTarget = cleanPhoneNumber(mobileNumber);

        // Prevent empty/short input from matching unrelated rows.
        if (cleanTarget.length < 10) {
            return null;
        }

        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: LEADS_RANGE
        });

        const rows = res.data.values || [];

        for (let i = 0; i < rows.length; i++) {
            const rowNumber = cleanPhoneNumber(rows[i][3]);

            // Both numbers have already been normalized.
            if (rowNumber === cleanTarget) {
                return {
                    rowIndex: i + 2,
                    name: rows[i][2] || "Sir/Ma'am",
                    number: rowNumber,
                    niche: rows[i][4] || 'Business',
                    status: rows[i][5] || ''
                };
            }
        }

        return null;
    } catch (error) {
        logSheetError('getLeadByNumber', error);
        return null;
    }
}

/**
 * Update a specific cell.
 */
async function updateCell(rowIndex, columnLetter, value) {
    try {
        const row = Number(rowIndex);

        const column = String(columnLetter || '')
            .trim()
            .toUpperCase();

        if (
            !Number.isInteger(row) ||
            row < 2 ||
            !/^[A-Z]+$/.test(column)
        ) {
            throw new Error('Invalid row index or column letter.');
        }

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!${column}${row}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[value]]
            }
        });

        console.log(
            `✅ Sheet Row ${row} [Col ${column}] ` +
            `updated to: '${value}'`
        );
    } catch (error) {
        logSheetError('updateCell', error);
    }
}

/**
 * Update a cell by the lead's phone number.
 */
async function updateCellByNumber(
    mobileNumber,
    columnLetter,
    value
) {
    try {
        const lead = await getLeadByNumber(mobileNumber);

        if (lead) {
            await updateCell(
                lead.rowIndex,
                columnLetter,
                value
            );
        }
    } catch (error) {
        logSheetError('updateCellByNumber', error);
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