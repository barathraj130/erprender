// routes/voucherRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

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

// GET /api/vouchers/daybook?date=YYYY-MM-DD - Get all vouchers for a day
router.get('/daybook', async (req, res) => {
    const companyId = req.user.active_company_id;
    const { date } = req.query;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!date) return res.status(400).json({ error: "Date parameter is required." });

    // Use string_agg for PostgreSQL equivalent of GROUP_CONCAT
    const sql = `
        SELECT 
            v.id, v.date, v.voucher_number, v.voucher_type, v.narration, v.total_amount,
            STRING_AGG(ve.ledger_id || ':' || l.name || ':' || ve.debit || ':' || ve.credit, ';') AS entries
        FROM vouchers v
        JOIN voucher_entries ve ON v.id = ve.voucher_id
        JOIN ledgers l ON ve.ledger_id = l.id
        WHERE v.company_id = $1 AND v.date = $2
        GROUP BY v.id
        ORDER BY v.created_at ASC
    `;
    
    try {
        const rows = await dbQuery(sql, [companyId, date]);
        
        // Process rows to be more frontend-friendly (JS logic remains the same)
        const processedRows = (rows || []).map(row => {
            const entries = row.entries.split(';').map(e => {
                const [ledger_id, ledger_name, debit, credit] = e.split(':');
                return {
                    ledger_id: parseInt(ledger_id),
                    ledger_name,
                    debit: parseFloat(debit),
                    credit: parseFloat(credit)
                };
            });
            return { ...row, entries };
        });
        res.json(processedRows);

    } catch (err) {
        return res.status(500).json({ error: "Failed to fetch daybook.", details: err.message });
    }
});


// POST /api/vouchers - Create any type of voucher (The core endpoint)
router.post('/', async (req, res) => {
    const companyId = req.user.active_company_id;
    const userId = req.user.id;
    const {
        date,
        voucher_number,
        voucher_type,
        narration,
        ledgerEntries, // Array of { ledger_id, debit, credit }
        inventoryEntries, // Optional array for Sales/Purchase
    } = req.body;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!date || !voucher_number || !voucher_type || !ledgerEntries || ledgerEntries.length < 2) {
        return res.status(400).json({ error: "Missing required voucher data. At least two ledger entries are required." });
    }

    // --- 1. Double-Entry Validation ---
    const totalDebit = ledgerEntries.reduce((sum, entry) => sum + (parseFloat(entry.debit) || 0), 0);
    const totalCredit = ledgerEntries.reduce((sum, entry) => sum + (parseFloat(entry.credit) || 0), 0);
    
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return res.status(400).json({ 
            error: `Debit and Credit totals do not match! Debit: ${totalDebit}, Credit: ${totalCredit}` 
        });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query("BEGIN");

        // 2. Insert into main vouchers table
        const voucherSql = `INSERT INTO vouchers (company_id, date, voucher_number, voucher_type, narration, total_amount, created_by_user_id) 
                            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`;
        const voucherResult = await client.query(voucherSql, [companyId, date, voucher_number, voucher_type, narration, totalDebit, userId]);
        const voucherId = voucherResult.rows[0].id;
        
        // 3. Insert Ledger Entries
        const entrySql = `INSERT INTO voucher_entries (voucher_id, ledger_id, debit, credit) VALUES ($1, $2, $3, $4)`;
        for (const entry of ledgerEntries) {
             await client.query(entrySql, [voucherId, entry.ledger_id, entry.debit || 0, entry.credit || 0]);
        }

        // 4. Insert Inventory Entries (if applicable)
        if (inventoryEntries && Array.isArray(inventoryEntries) && inventoryEntries.length > 0) {
            const invSql = `INSERT INTO voucher_inventory_entries (voucher_id, item_id, warehouse_id, quantity, rate, amount) VALUES ($1, $2, $3, $4, $5, $6)`;
            for (const item of inventoryEntries) {
                 // For Sales, quantity should be negative. For Purchase, positive.
                const quantity = voucher_type === 'Sales' ? -Math.abs(item.quantity) : Math.abs(item.quantity);
                await client.query(invSql, [voucherId, item.item_id, item.warehouse_id, quantity, item.rate, item.amount]);
            }
        }

        // 5. Commit
        await client.query("COMMIT");
        res.status(201).json({ id: voucherId, message: `Voucher ${voucher_number} created successfully.` });

    } catch (err) {
        if (client) await client.query("ROLLBACK");
        console.error("❌ [API PG Error] Error creating voucher:", err.message);
        res.status(500).json({ error: "Failed to create voucher.", details: err.message });
    } finally {
        if (client) client.release();
    }
});

// GET /api/vouchers/gst-calculation-details - Helper to determine GST type
router.get('/gst-calculation-details', async (req, res) => {
    const companyId = req.user.active_company_id;
    const { partyLedgerId } = req.query;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!partyLedgerId) return res.status(400).json({ error: "Party Ledger ID is required." });

    const companySql = 'SELECT state FROM companies WHERE id = $1';
    const partySql = 'SELECT state FROM ledgers WHERE id = $1 AND company_id = $2';

    try {
        const companyRows = await dbQuery(companySql, [companyId]);
        const company = companyRows[0];
        if (!company) return res.status(500).json({ error: "Could not find company details." });
        
        const partyRows = await dbQuery(partySql, [partyLedgerId, companyId]);
        const party = partyRows[0];
        if (!party) return res.status(500).json({ error: "Could not find party ledger details." });
        
        // Logic for GST Type (JS logic remains the same)
        const isIntraState = company.state && party.state && company.state.toLowerCase() === party.state.toLowerCase();
        const gstType = isIntraState ? 'CGST_SGST' : 'IGST';

        res.json({
            companyState: company.state,
            partyState: party.state,
            gstType: gstType
        });
    } catch (err) {
        return res.status(500).json({ error: "Database error during GST check.", details: err.message });
    }
});

module.exports = router;