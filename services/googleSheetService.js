// services/googleSheetService.js
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library'); // Import JWT for authentication
const path = require('path');
const db = require('../db');

// --- Configuration ---
const SPREADSHEET_ID = '1mYY3uByHqRbYpekrwZJzk3bqVpZtsAEfk99u1fKnt10';
const CREDENTIALS_PATH = path.join(__dirname, '..', 'google-credentials.json');
const LOAN_SHEET_NAMES = ['Bajaj', 'Hero', 'Protium'];
const PARTY_SHEET_NAMES = ['Chandhan', 'Shiva Adass(Sunshine)', 'JAMES', 'MS', 'DEEPAK DELHI', 'waves'];
const IGNORED_SHEET_NAMES = ['Sheet1'];

let doc; // Will be initialized after auth
let isAuthLoaded = false;

// --- Helper Functions ---
async function loadCredentialsAndAuth() {
    if (isAuthLoaded) return;
    try {
        const creds = require(CREDENTIALS_PATH);

        // --- FIX: Correctly format the private key to handle potential line break issues ---
        const formattedKey = creds.private_key.replace(/\\n/g, '\n');

        const serviceAccountAuth = new JWT({
            email: creds.client_email,
            key: formattedKey, // Use the formatted key
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets',
            ],
        });

        doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
        
        isAuthLoaded = true;
        console.log("✅ Google Sheet auth configured successfully.");
    } catch (error) {
        console.error("❌ ERROR: Failed to configure Google Sheet authentication.", error);
        throw error;
    }
}


const findOrCreateEntity = (name, type, companyId) => new Promise((resolve, reject) => {
    db.get('SELECT id FROM lenders WHERE name = ? AND company_id = ?', [name, companyId], (err, row) => {
        if (err) return reject(err);
        if (row) return resolve(row.id);
        db.run('INSERT INTO lenders (name, entity_type, company_id) VALUES (?, ?, ?)', [name, type, companyId], function (err) {
            if (err) return reject(err);
            resolve(this.lastID);
        });
    });
});

const findOrCreateParty = (name, companyId) => new Promise((resolve, reject) => {
    db.get("SELECT id FROM users WHERE username = ? AND active_company_id = ?", [name, companyId], (err, row) => {
        if (err) return reject(err);
        if (row) return resolve(row.id);
        
        const userSql = `INSERT INTO users (username, role, active_company_id) VALUES (?, ?, ?)`;
        db.run(userSql, [name, 'user', companyId], function (userErr) {
            if (userErr) return reject(userErr);
            const newUserId = this.lastID;
            db.run(`INSERT INTO user_companies (user_id, company_id) VALUES (?, ?)`, [newUserId, companyId], (linkErr) => {
                if(linkErr) return reject(linkErr);

                db.get("SELECT id FROM ledger_groups WHERE company_id = ? AND name = 'Sundry Debtors'", [companyId], (groupErr, groupRow) => {
                    if(groupErr || !groupRow) return reject(new Error('Sundry Debtors group not found for company ' + companyId));
                    db.run('INSERT INTO ledgers (company_id, name, group_id) VALUES (?, ?, ?)', [companyId, name, groupRow.id], (ledgerErr) => {
                        if (ledgerErr) return reject(ledgerErr);
                        resolve(newUserId);
                    });
                });
            });
        });
    });
});

const processLoanSheet = async (sheet, companyId) => {
    const lenderName = sheet.title;
    await sheet.loadCells('A1:D2');
    const remainingBalance = sheet.getCellByA1('C2').value;
    const months = sheet.getCellByA1('D2').value;

    if (typeof remainingBalance !== 'number' || remainingBalance <= 0) {
        return { status: 'skipped', reason: 'Invalid or zero remaining balance.' };
    }

    const lenderId = await findOrCreateEntity(lenderName, 'Financial', companyId);

    const agreementExists = await new Promise((resolve, reject) => {
        db.get("SELECT id FROM business_agreements WHERE lender_id = ? AND details LIKE ? AND company_id = ?", [lenderId, `%Imported from sheet: ${lenderName}%`, companyId], (err, row) => {
            if (err) reject(err); else resolve(row);
        });
    });

    if (agreementExists) {
        return { status: 'skipped', reason: 'Loan agreement already exists in DB.' };
    }

    const agreementData = {
        company_id: companyId,
        lender_id: lenderId,
        agreement_type: 'loan_taken_by_biz',
        total_amount: remainingBalance,
        start_date: new Date().toISOString().split('T')[0],
        details: `Imported from sheet: ${lenderName}. Original remaining months: ${months || 'N/A'}`
    };

    const agreementId = await new Promise((resolve, reject) => {
        const sql = 'INSERT INTO business_agreements (company_id, lender_id, agreement_type, total_amount, start_date, details) VALUES (?, ?, ?, ?, ?, ?)';
        db.run(sql, Object.values(agreementData), function(err) {
            if(err) reject(err); else resolve(this.lastID);
        });
    });

    const txData = {
        company_id: companyId,
        user_id: null,
        lender_id: lenderId,
        agreement_id: agreementId,
        amount: remainingBalance,
        description: `Onboarding existing loan from ${lenderName}`,
        category: 'Loan Received by Business (to Bank)',
        date: new Date().toISOString().split('T')[0],
        related_invoice_id: null
    };
    await new Promise((resolve, reject) => {
        const sql = 'INSERT INTO transactions (company_id, user_id, lender_id, agreement_id, amount, description, category, date, related_invoice_id) VALUES (?,?,?,?,?,?,?,?,?)';
        db.run(sql, Object.values(txData), err => { if(err) reject(err); else resolve(); });
    });

    return { status: 'imported', type: 'Loan', amount: remainingBalance };
};

const processPartySheet = async (sheet, companyId) => {
    const partyName = sheet.title;
    const rows = await sheet.getRows();
    let finalPending = 0;
    
    for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        const pendingValue = row.get('PENDING') || row.get('pending') || row.get('Pending');
        if (pendingValue !== null && pendingValue !== undefined && String(pendingValue).trim() !== '') {
            const cleanedValue = String(pendingValue).replace(/,/g, '');
            if (!isNaN(parseFloat(cleanedValue))) {
                finalPending = parseFloat(cleanedValue);
                break;
            }
        }
    }
    
    if (finalPending === 0) {
        return { status: 'skipped', reason: 'No valid pending balance found.' };
    }
    
    const partyId = await findOrCreateParty(partyName, companyId);
    
    const balanceTxExists = await new Promise((resolve, reject) => {
        db.get("SELECT id FROM transactions WHERE user_id = ? AND category = 'Opening Balance Adjustment' AND company_id = ?", [partyId, companyId], (err, row) => {
            if(err) reject(err); else resolve(row);
        });
    });

    if (balanceTxExists) {
        return { status: 'skipped', reason: 'Opening balance already exists for this party.' };
    }

    const txData = {
        company_id: companyId,
        user_id: partyId,
        lender_id: null,
        agreement_id: null,
        amount: finalPending,
        description: `Historical balance imported from sheet: ${partyName}`,
        category: 'Opening Balance Adjustment',
        date: new Date().toISOString().split('T')[0],
        related_invoice_id: null,
    };
     await new Promise((resolve, reject) => {
        const sql = 'INSERT INTO transactions (company_id, user_id, lender_id, agreement_id, amount, description, category, date, related_invoice_id) VALUES (?,?,?,?,?,?,?,?,?)';
        db.run(sql, Object.values(txData), err => { if(err) reject(err); else resolve(); });
    });

    return { status: 'imported', type: 'Party Balance', amount: finalPending };
};

// --- Main Exported Function ---
const importAllSheetsData = async (companyId) => {
    await loadCredentialsAndAuth(); // Use the new auth function
    await doc.loadInfo(); // This is the first interaction with the sheet, authenticates here.
    const sheets = doc.sheetsByIndex;
    const summary = {
        processed: 0,
        imported: 0,
        skipped: 0,
        errors: 0,
        details: []
    };

    for (const sheet of sheets) {
        summary.processed++;
        const title = sheet.title;
        let result;

        if (IGNORED_SHEET_NAMES.includes(title)) {
            result = { status: 'skipped', reason: 'Sheet is in ignore list.' };
        } else {
            console.log(`[Importer] Processing sheet: "${title}" for company ${companyId}`);
            try {
                if (LOAN_SHEET_NAMES.includes(title)) {
                    result = await processLoanSheet(sheet, companyId);
                } else if (PARTY_SHEET_NAMES.includes(title)) { // Use the party sheet list
                    result = await processPartySheet(sheet, companyId);
                } else {
                    result = { status: 'skipped', reason: 'Sheet name not categorized for import.' };
                }
            } catch (error) {
                console.error(`Error processing sheet "${title}":`, error.message);
                result = { status: 'error', reason: error.message };
            }
        }
        
        if (result.status === 'imported') summary.imported++;
        if (result.status === 'skipped') summary.skipped++;
        if (result.status === 'error') summary.errors++;
        
        summary.details.push({ sheet: title, ...result });
    }

    console.log('[Importer] Import process finished. Summary:', summary);
    return summary;
};

module.exports = { importAllSheetsData };