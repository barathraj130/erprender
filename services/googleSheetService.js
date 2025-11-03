// services/googleSheetService.js
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library'); 
const path = require('path');
const { pool } = require('../db'); // <-- PG FIX: Import pool

// --- Configuration ---
const SPREADSHEET_ID = '1mYY3uByHqRbYpekrwZJzk3bqVpZtsAEfk99u1fKnt10';
const CREDENTIALS_PATH = path.join(__dirname, '..', 'google-credentials.json');
const LOAN_SHEET_NAMES = ['Bajaj', 'Hero', 'Protium'];
const PARTY_SHEET_NAMES = ['Chandhan', 'Shiva Adass(Sunshine)', 'JAMES', 'MS', 'DEEPAK DELHI', 'waves'];
const IGNORED_SHEET_NAMES = ['Sheet1'];

let doc; 
let isAuthLoaded = false;

// --- Helper Functions ---
async function dbQuery(sql, params = []) {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(sql, params);
        return result.rows;
    } catch (e) {
        console.error("PG Query Error:", e.message, "SQL:", sql, "Params:", params);
        throw e;
    } finally {
        if (client) client.release();
    }
}

async function loadCredentialsAndAuth() {
    if (isAuthLoaded) return;
    try {
        const creds = require(CREDENTIALS_PATH);

        const formattedKey = creds.private_key.replace(/\\n/g, '\n');

        const serviceAccountAuth = new JWT({
            email: creds.client_email,
            key: formattedKey, 
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


const findOrCreateEntity = async (name, type, companyId) => {
    // PG FIX: Use dbQuery
    const checkSql = 'SELECT id FROM lenders WHERE lender_name = $1 AND company_id = $2';
    const existing = await dbQuery(checkSql, [name, companyId]);

    if (existing.length > 0) return existing[0].id;
    
    const insertSql = 'INSERT INTO lenders (lender_name, entity_type, company_id) VALUES ($1, $2, $3) RETURNING id';
    const result = await dbQuery(insertSql, [name, type, companyId]);
    return result[0].id;
};

const findOrCreateParty = async (name, companyId) => {
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Find or Create User
        const userCheck = await client.query("SELECT id FROM users WHERE username = $1 AND active_company_id = $2", [name, companyId]);
        
        let newUserId;
        if (userCheck.rows.length > 0) {
            newUserId = userCheck.rows[0].id;
        } else {
            const userSql = `INSERT INTO users (username, role, active_company_id) VALUES ($1, $2, $3) RETURNING id`;
            const userResult = await client.query(userSql, [name, 'user', companyId]);
            newUserId = userResult.rows[0].id;

            // Link to company
            await client.query(`INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2)`, [newUserId, companyId]);
        }

        // 2. Find Sundry Debtors Group ID
        const groupResult = await client.query("SELECT id FROM ledger_groups WHERE company_id = $1 AND name = 'Sundry Debtors'", [companyId]);
        const groupRow = groupResult.rows[0];
        
        if (!groupRow) {
            await client.query('ROLLBACK');
            throw new Error('Sundry Debtors group not found for company ' + companyId);
        }

        // 3. Create Ledger (using ON CONFLICT DO NOTHING to ensure idempotency)
        const ledgerSql = 'INSERT INTO ledgers (company_id, name, group_id) VALUES ($1, $2, $3) ON CONFLICT (company_id, name) DO NOTHING';
        await client.query(ledgerSql, [companyId, name, groupRow.id]);
        
        await client.query('COMMIT');
        return newUserId;
        
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        throw err;
    } finally {
        if (client) client.release();
    }
};

const processLoanSheet = async (sheet, companyId) => {
    const lenderName = sheet.title;
    await sheet.loadCells('A1:D2');
    const remainingBalance = sheet.getCellByA1('C2').value;
    const months = sheet.getCellByA1('D2').value;

    if (typeof remainingBalance !== 'number' || remainingBalance <= 0) {
        return { status: 'skipped', reason: 'Invalid or zero remaining balance.' };
    }

    const lenderId = await findOrCreateEntity(lenderName, 'Financial', companyId);

    const agreementExists = await dbQuery("SELECT id FROM business_agreements WHERE lender_id = $1 AND details LIKE $2 AND company_id = $3", 
        [lenderId, `%Imported from sheet: ${lenderName}%`, companyId]);

    if (agreementExists.length > 0) {
        return { status: 'skipped', reason: 'Loan agreement already exists in DB.' };
    }
    
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Insert Agreement
        const agreementData = {
            company_id: companyId,
            lender_id: lenderId,
            agreement_type: 'loan_taken_by_biz',
            total_amount: remainingBalance,
            start_date: new Date().toISOString().split('T')[0],
            details: `Imported from sheet: ${lenderName}. Original remaining months: ${months || 'N/A'}`
        };
        const agreementSql = 'INSERT INTO business_agreements (company_id, lender_id, agreement_type, total_amount, start_date, details) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id';
        const agreementResult = await client.query(agreementSql, Object.values(agreementData));
        const agreementId = agreementResult.rows[0].id;

        // 2. Insert Transaction
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
        const txSql = 'INSERT INTO transactions (company_id, user_id, lender_id, agreement_id, amount, description, category, date, related_invoice_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)';
        await client.query(txSql, Object.values(txData));
        
        await client.query('COMMIT');

        return { status: 'imported', type: 'Loan', amount: remainingBalance };
        
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        throw error;
    } finally {
        if (client) client.release();
    }
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
    
    // This function handles its own transaction
    const partyId = await findOrCreateParty(partyName, companyId); 
    
    // Check if opening balance adjustment already exists
    const balanceTxExists = await dbQuery("SELECT id FROM transactions WHERE user_id = $1 AND category = 'Opening Balance Adjustment' AND company_id = $2", [partyId, companyId]);

    if (balanceTxExists.length > 0) {
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
    
    const txSql = 'INSERT INTO transactions (company_id, user_id, lender_id, agreement_id, amount, description, category, date, related_invoice_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)';
    await dbQuery(txSql, Object.values(txData));

    return { status: 'imported', type: 'Party Balance', amount: finalPending };
};

// --- Main Exported Function ---
const importAllSheetsData = async (companyId) => {
    // ... (rest of main function logic remains the same, relying on helper functions)
    await loadCredentialsAndAuth(); 
    await doc.loadInfo(); 
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
                } else if (PARTY_SHEET_NAMES.includes(title)) { 
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