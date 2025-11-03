// routes/voucherRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/vouchers/daybook?date=YYYY-MM-DD - Get all vouchers for a day
router.get('/daybook', (req, res) => {
    const companyId = req.user.active_company_id;
    const { date } = req.query;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!date) return res.status(400).json({ error: "Date parameter is required." });

    const sql = `
        SELECT v.id, v.date, v.voucher_number, v.voucher_type, v.narration, v.total_amount,
               GROUP_CONCAT(ve.ledger_id || ':' || l.name || ':' || ve.debit || ':' || ve.credit, ';') as entries
        FROM vouchers v
        JOIN voucher_entries ve ON v.id = ve.voucher_id
        JOIN ledgers l ON ve.ledger_id = l.id
        WHERE v.company_id = ? AND v.date = ?
        GROUP BY v.id
        ORDER BY v.created_at ASC
    `;
    db.all(sql, [companyId, date], (err, rows) => {
        if (err) return res.status(500).json({ error: "Failed to fetch daybook.", details: err.message });
        
        // Process rows to be more frontend-friendly
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
    });
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
        partyLedgerId, // Optional for Sales/Purchase
        gstDetails // Optional { cgst, sgst, igst } for Sales/Purchase
    } = req.body;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!date || !voucher_number || !voucher_type || !ledgerEntries || ledgerEntries.length < 2) {
        return res.status(400).json({ error: "Missing required voucher data. At least two ledger entries are required." });
    }

    // --- 1. Double-Entry Validation ---
    const totalDebit = ledgerEntries.reduce((sum, entry) => sum + (parseFloat(entry.debit) || 0), 0);
    const totalCredit = ledgerEntries.reduce((sum, entry) => sum + (parseFloat(entry.credit) || 0), 0);
    
    // Use a small tolerance for floating point comparisons
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return res.status(400).json({ 
            error: `Debit and Credit totals do not match! Debit: ${totalDebit}, Credit: ${totalCredit}` 
        });
    }

    // --- 2. Database Transaction ---
    db.serialize(() => {
        db.run("BEGIN TRANSACTION;");

        // Insert into main vouchers table
        const voucherSql = `INSERT INTO vouchers (company_id, date, voucher_number, voucher_type, narration, total_amount, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        db.run(voucherSql, [companyId, date, voucher_number, voucher_type, narration, totalDebit, userId], function(err) {
            if (err) {
                db.run("ROLLBACK;");
                return res.status(500).json({ error: "Failed to create voucher.", details: err.message });
            }
            const voucherId = this.lastID;
            
            // --- 3. Insert Ledger Entries ---
            const entryPromises = ledgerEntries.map(entry => {
                return new Promise((resolve, reject) => {
                    const entrySql = `INSERT INTO voucher_entries (voucher_id, ledger_id, debit, credit) VALUES (?, ?, ?, ?)`;
                    db.run(entrySql, [voucherId, entry.ledger_id, entry.debit || 0, entry.credit || 0], (entryErr) => {
                        if (entryErr) reject(entryErr);
                        else resolve();
                    });
                });
            });

            // --- 4. Insert Inventory Entries (if applicable) ---
            if (inventoryEntries && Array.isArray(inventoryEntries) && inventoryEntries.length > 0) {
                inventoryEntries.forEach(item => {
                    entryPromises.push(new Promise((resolve, reject) => {
                        // For Sales, quantity should be negative. For Purchase, positive.
                        const quantity = voucher_type === 'Sales' ? -Math.abs(item.quantity) : Math.abs(item.quantity);
                        const invSql = `INSERT INTO voucher_inventory_entries (voucher_id, item_id, warehouse_id, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?)`;
                        db.run(invSql, [voucherId, item.item_id, item.warehouse_id, quantity, item.rate, item.amount], (invErr) => {
                            if (invErr) reject(invErr);
                            else resolve();
                        });
                    }));
                });
            }

            // --- 5. Commit or Rollback ---
            Promise.all(entryPromises)
                .then(() => {
                    db.run("COMMIT;", (commitErr) => {
                        if (commitErr) {
                             db.run("ROLLBACK;");
                             return res.status(500).json({ error: "Failed to commit voucher transaction.", details: commitErr.message });
                        }
                        res.status(201).json({ id: voucherId, message: `Voucher ${voucher_number} created successfully.` });
                    });
                })
                .catch(promiseErr => {
                    db.run("ROLLBACK;");
                    res.status(500).json({ error: "Failed to save all voucher entries.", details: promiseErr.message });
                });
        });
    });
});

// GET /api/vouchers/gst-calculation-details - Helper to determine GST type
router.get('/gst-calculation-details', (req, res) => {
    const companyId = req.user.active_company_id;
    const { partyLedgerId } = req.query;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!partyLedgerId) return res.status(400).json({ error: "Party Ledger ID is required." });

    const companySql = 'SELECT state FROM companies WHERE id = ?';
    const partySql = 'SELECT state FROM ledgers WHERE id = ? AND company_id = ?';

    db.get(companySql, [companyId], (err, company) => {
        if (err || !company) return res.status(500).json({ error: "Could not find company details." });
        
        db.get(partySql, [partyLedgerId, companyId], (err, party) => {
            if (err || !party) return res.status(500).json({ error: "Could not find party ledger details." });
            
            // Logic for GST Type
            const isIntraState = company.state && party.state && company.state.toLowerCase() === party.state.toLowerCase();
            const gstType = isIntraState ? 'CGST_SGST' : 'IGST';

            res.json({
                companyState: company.state,
                partyState: party.state,
                gstType: gstType
            });
        });
    });
});

module.exports = router;