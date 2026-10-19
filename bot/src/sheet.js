// src/sheet.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');

require('dotenv').config();

function loadGoogleCredentials() {
    const raw = process.env.GOOGLE_CREDENTIALS_JSON;

    const credentials = JSON.parse(
        raw && raw.trim()
            ? raw
            : fs.readFileSync(
                path.resolve(__dirname, '../credentials.json'),
                'utf8'
            )
    );

    if (
        credentials.type !== 'service_account' ||
        typeof credentials.client_email !== 'string' ||
        typeof credentials.private_key !== 'string'
    ) {
        throw new Error('Valid Google service-account JSON required.');
    }

    credentials.client_email = credentials.client_email.trim();

    credentials.private_key = credentials.private_key
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\r\n/g, '\n')
        .trim() + '\n';

    const key = crypto.createPrivateKey(credentials.private_key);

    if (key.asymmetricKeyType !== 'rsa') {
        throw new Error('Google credentials require an RSA private key.');
    }

    console.log(
        `🔑 Google credentials source: ${
            raw && raw.trim() ? 'Railway variable' : 'credentials.json'
        }`
    );

    return credentials;
}

const SPREADSHEET_ID = String(
    process.env.SPREADSHEET_ID || ''
).trim();

if (!SPREADSHEET_ID) {
    throw new Error('SPREADSHEET_ID missing.');
}

const auth = new google.auth.GoogleAuth({
    credentials: loadGoogleCredentials(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

// All existing column mappings are preserved.
const SHEET = "'Sheet1'";

// Serialize operations within this Node process.
// This is not a cross-process/database transaction.
let operationQueue = Promise.resolve();

function runSheetOperation(operation, task) {
    const result = operationQueue.then(task);

    operationQueue = result.catch(() => {});

    return result.catch(error => {
        console.error(
            `❌ Sheet Error (${operation}):`,
            error.message || 'Unknown error'
        );

        // Propagate the error to the caller.
        throw error;
    });
}

function getTodayISTDate() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());

    const values = Object.fromEntries(
        parts.map(part => [part.type, part.value])
    );

    return `${values.year}-${values.month}-${values.day}`;
}

function normalizeBotId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '');
}

function cleanPhoneNumber(value) {
    if (value === undefined || value === null) return '';

    let number = String(value)
        .split('.')[0]
        .replace(/\D/g, '');

    if (number.length === 10) {
        number = '91' + number;
    } else if (
        number.length === 11 &&
        number.startsWith('0')
    ) {
        number = '91' + number.slice(1);
    }

    return number;
}

function normalizeStatus(value) {
    return String(value || '').trim().toLowerCase();
}

function isPausedStatus(value) {
    return [
        'manual',
        'in-discussion',
        'dead',
        'needs review'
    ].includes(normalizeStatus(value));
}

function isAssignedToThisBot(value) {
    const assigned = normalizeBotId(value);
    const target = normalizeBotId(
        process.env.ASSIGNED_BOT || 'Number_1'
    );

    return assigned === '' || assigned === target;
}

function rowToLead(row, index) {
    return {
        rowIndex: index + 2,
        assignedBot: row[0] || '',
        dateAdded: row[1] || '',
        name: row[2] || "Sir/Ma'am",
        number: cleanPhoneNumber(row[3]),
        niche: row[4] || 'Business',
        status: row[5] || '',
        lastContactDate: row[6] || '',
        followupStage: row[8] || ''
    };
}

async function readRows() {
    const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET}!A2:J`
    });

    return result.data.values || [];
}

// Call this during startup: reads only, sends no WhatsApp messages.
async function verifySheetConnection() {
    return runSheetOperation('verifySheetConnection', async () => {
        const rows = await readRows();

        console.log(
            `✅ Google Sheets READ verified: ${rows.length} rows.`
        );

        return true;
    });
}

async function getPendingLeads() {
    return runSheetOperation('getPendingLeads', async () => {
        const rows = await readRows();

        const leads = rows
            .map(rowToLead)
            .filter(lead => (
                isAssignedToThisBot(lead.assignedBot) &&
                ['', 'pending'].includes(
                    normalizeStatus(lead.status)
                ) &&
                /^91[6-9]\d{9}$/.test(lead.number)
            ));

        console.log(
            `📋 Sheet rows: ${rows.length} | ` +
            `Eligible pending leads: ${leads.length}`
        );

        return leads;
    });
}

async function getLeadsForFollowup() {
    return runSheetOperation('getLeadsForFollowup', async () => {
        const rows = await readRows();

        return rows
            .map(rowToLead)
            .filter(lead => (
                isAssignedToThisBot(lead.assignedBot) &&
                ['sent', 'follow-up sent'].includes(
                    normalizeStatus(lead.status)
                ) &&
                Boolean(lead.lastContactDate) &&
                /^91[6-9]\d{9}$/.test(lead.number)
            ));
    });
}

async function getLeadByNumber(value) {
    const target = cleanPhoneNumber(value);

    if (!/^\d{10,15}$/.test(target)) return null;

    return runSheetOperation('getLeadByNumber', async () => {
        const rows = await readRows();

        const matches = rows
            .map(rowToLead)
            .filter(lead => (
                lead.number === target &&
                isAssignedToThisBot(lead.assignedBot)
            ));

        if (matches.length > 1) {
            throw new Error(
                'Duplicate eligible Sheet rows for this phone number. ' +
                'Resolve duplicates before sending.'
            );
        }

        // null means no matching lead. API failures throw.
        return matches[0] || null;
    });
}

async function updateCell(rowIndex, columnLetter, value) {
    const row = Number(rowIndex);
    const column = String(columnLetter || '').trim().toUpperCase();

    if (
        !Number.isInteger(row) ||
        row < 2 ||
        !/^[A-Z]+$/.test(column)
    ) {
        throw new Error('Invalid Sheet row or column.');
    }

    return runSheetOperation('updateCell', async () => {
        if (column === 'F') {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET}!F${row}`
            });

            const current = normalizeStatus(
                response.data.values?.[0]?.[0]
            );

            const next = normalizeStatus(value);

            const automatedStatuses = [
                'pending',
                'sent',
                'follow-up sent',
                'replied',
                'failed',
                'invalid number'
            ];

            // Automated updates must not clear an existing pause.
            if (
                isPausedStatus(current) &&
                automatedStatuses.includes(next)
            ) {
                console.log(
                    `🔒 Row ${row}: preserved '${current}' status.`
                );
                return false;
            }

            // A send completion must not overwrite an incoming reply.
            if (
                current === 'replied' &&
                [
                    'sent',
                    'follow-up sent',
                    'dead',
                    'failed',
                    'invalid number'
                ].includes(next)
            ) {
                console.log(
                    `🔒 Row ${row}: preserved 'Replied' status.`
                );
                return false;
            }
        }

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET}!${column}${row}`,
            valueInputOption: 'RAW',
            requestBody: {
                values: [[value ?? '']]
            }
        });

        console.log(
            `✅ Sheet write verified: row ${row}, column ${column}`
        );

        return true;
    });
}

async function updateCellByNumber(
    mobileNumber,
    columnLetter,
    value
) {
    const lead = await getLeadByNumber(mobileNumber);

    if (!lead) return false;

    return updateCell(lead.rowIndex, columnLetter, value);
}

module.exports = {
    getPendingLeads,
    getLeadsForFollowup,
    getLeadByNumber,
    updateCell,
    updateCellByNumber,
    getTodayISTDate,
    cleanPhoneNumber,
    verifySheetConnection,
    isPausedStatus
};