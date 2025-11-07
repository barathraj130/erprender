// routes/partyRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const bcrypt = require('bcryptjs');
const saltRounds = 10;

// DB Helper
async function dbQuery(sql, params = []) {
    const client = await pool.connect();
    try {
        const result = await client.query(sql, params);
        return result.rows;
    } finally {
        client.release();
    }
}

// CSV Convert Helper (Updated to include footer)
function convertToCsv(data, headers, footerData = null) {
    if (!Array.isArray(data) || data.length === 0) return '';

    const sanitize = (v) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        // Ensure numbers are formatted without commas for clean CSV parsing
        if (typeof v === 'number') {
            return s; 
        }
        // Handle strings that contain commas, newlines, or quotes by wrapping them in double quotes
        return s.includes(',') || s.includes('\n') || s.includes('"') 
            ? `"${s.replace(/"/g, '""')}"` 
            : s;
    };

    // 1. Generate Header Row
    const headerRow = headers.map(h => sanitize(h.label)).join(',');
    
    // 2. Generate Data Rows
    const rows = data.map(row => headers.map(h => sanitize(row[h.key])).join(','));
    
    let csvContent = [headerRow, ...rows].join('\n');

    // 3. Append Footer Row (Grand Total)
    if (footerData && headers.length >= 1) {
        
        // Start the footer row with a label 'TOTAL' in the first column
        const totalRow = ['TOTAL'];
        
        // Pad empty columns if there are intermediate columns. 
        // We subtract 2 because we account for the first (label) and the last (amount).
        for (let i = 1; i < headers.length - 1; i++) {
            totalRow.push('');
        }
        
        // Add the total amount (which is expected to be available in footerData.total_amount) 
        // to the last column.
        totalRow.push(sanitize(footerData.total_amount));
        
        csvContent += '\n' + totalRow.join(',');
    }

    return csvContent;
}

// Helper to calculate Receivable balance for a user (based on Ledger logic)
async function calculateReceivable(userId, companyId) {
    // 1. Get Opening Balance (which acts as the historical balance)
    const userRows = await dbQuery("SELECT initial_balance FROM users WHERE id = $1", [userId]);
    const user = userRows[0];
    if (!user) return 0;

    let receivable = parseFloat(user.initial_balance || 0);

    // 2. Sum of all transactions associated with this user
    // NOTE: Transaction amounts are already stored signed (+ve = increase AR, -ve = decrease AR)
    const txRows = await dbQuery(`
        SELECT COALESCE(SUM(amount), 0) AS total_amount_change
        FROM transactions 
        WHERE user_id = $1 AND company_id = $2
    `, [userId, companyId]);

    receivable += parseFloat(txRows[0].total_amount_change || 0);

    return receivable;
}

// -------------------- GET ALL PARTIES --------------------
router.get('/', async (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });

    const sql = `
        SELECT u.id, u.username, u.email, u.phone, u.company, u.initial_balance,
               u.address_line1, u.address_line2, u.city_pincode,
               u.state, u.gstin, u.state_code, u.role,
               (u.initial_balance + COALESCE((SELECT SUM(t.amount) 
                   FROM transactions t WHERE t.user_id = u.id), 0)) 
               AS remaining_balance
        FROM users u
        JOIN user_companies uc ON u.id = uc.user_id
        WHERE uc.company_id = $1
        ORDER BY u.id DESC
    `;
    const rows = await dbQuery(sql, [companyId]);
    res.json(rows.map(({ password, ...safe }) => safe));
});

// -------------------- EXPORT CUSTOMER LIST (BASIC) --------------------
router.get('/export', async (req, res) => {
    const companyId = req.user.active_company_id;

    const data = await dbQuery(`
        SELECT username, phone, email, city_pincode, state, gstin, initial_balance
        FROM users
        JOIN user_companies ON users.id = user_companies.user_id
        WHERE user_companies.company_id = $1
        ORDER BY username ASC
    `, [companyId]);

    const headers = [
        { key: "username", label: "Customer Name" },
        { key: "phone", label: "Phone" },
        { key: "email", label: "Email" },
        { key: "city_pincode", label: "City / Pincode" },
        { key: "state", label: "State" },
        { key: "gstin", label: "GSTIN" },
        { key: "initial_balance", label: "Opening Balance" }
    ];

    const csv = convertToCsv(data, headers);

    res.setHeader("Content-Disposition", "attachment; filename=Customer_List.csv");
    res.set("Content-Type", "text/csv");
    res.send(csv);
});

// -------------------- EXPORT CUSTOMER SUMMARY (NEW) --------------------
// @route   GET /api/users/export/customer-summary
// @desc    Export Customer Name and calculated Receivable Balance
// @access  Protected
router.get('/export/customer-summary', async (req, res) => {
    const companyId = req.user.active_company_id;

    try {
        const userRows = await dbQuery(`
            SELECT id, username
            FROM users
            JOIN user_companies ON users.id = user_companies.user_id
            WHERE user_companies.company_id = $1 AND users.role != 'admin'
            ORDER BY username ASC
        `, [companyId]);

        let grandTotal = 0;
        
        const exportDataPromises = userRows.map(async (user) => {
            // Calculate the final receivable balance for each user
            const finalReceivable = await calculateReceivable(user.id, companyId);
            
            // Accumulate the grand total
            grandTotal += finalReceivable; 
            
            return {
                "PARTY NAME": user.username,
                "AMOUNT": finalReceivable.toFixed(2)
            };
        });

        const data = await Promise.all(exportDataPromises);
        
        // Define headers (must match keys used in exportDataPromises)
        const headers = [
            { key: "PARTY NAME", label: "PARTY NAME" },
            { key: "AMOUNT", label: "AMOUNT" }
        ];
        
        // Define footer data
        const footer = {
            total_amount: grandTotal.toFixed(2)
        };

        // Convert to CSV, passing the footer data
        const csv = convertToCsv(data, headers, footer);

        res.setHeader("Content-Disposition", "attachment; filename=Customer_Receivable_Summary.csv");
        res.set("Content-Type", "text/csv");
        res.send(csv);

    } catch (err) {
        console.error("Error exporting customer summary:", err.message);
        res.status(500).json({ error: "Failed to generate customer summary export." });
    }
});


// -------------------- EXPORT OUTSTANDING (DUE FIRST) --------------------
router.get('/export/outstanding', async (req, res) => {
    const companyId = req.user.active_company_id;

    const sql = `
        SELECT u.username AS customer_name,
               u.initial_balance,
               COALESCE((SELECT SUM(t.amount) 
                   FROM transactions t WHERE t.user_id = u.id), 0) AS transaction_total,
               (u.initial_balance + COALESCE((SELECT SUM(t.amount) 
                   FROM transactions t WHERE t.user_id = u.id), 0)) AS outstanding_balance
        FROM users u
        JOIN user_companies uc ON u.id = uc.user_id
        WHERE uc.company_id = $1
        ORDER BY outstanding_balance DESC;
    `;
    const rows = await dbQuery(sql, [companyId]);

    const headers = [
        { key: "customer_name", label: "Customer Name" },
        { key: "initial_balance", label: "Opening Balance" },
        { key: "transaction_total", label: "Transaction Total" },
        { key: "outstanding_balance", label: "Outstanding Balance" }
    ];

    const csv = convertToCsv(rows, headers);

    res.setHeader("Content-Disposition", "attachment; filename=Outstanding_Due_First.csv");
    res.set("Content-Type", "text/csv");
    res.send(csv);
});

// -------------------- EXPORT OUTSTANDING (A → Z) --------------------
router.get('/export/outstanding/alpha', async (req, res) => {
    const companyId = req.user.active_company_id;

    const sql = `
        SELECT u.username AS customer_name,
               u.initial_balance,
               COALESCE((SELECT SUM(t.amount) 
                   FROM transactions t WHERE t.user_id = u.id), 0) AS transaction_total,
               (u.initial_balance + COALESCE((SELECT SUM(t.amount) 
                   FROM transactions t WHERE t.user_id = u.id), 0)) AS outstanding_balance
        FROM users u
        JOIN user_companies uc ON u.id = uc.user_id
        WHERE uc.company_id = $1
        ORDER BY u.username ASC;
    `;
    const rows = await dbQuery(sql, [companyId]);

    const headers = [
        { key: "customer_name", label: "Customer Name" },
        { key: "initial_balance", label: "Opening Balance" },
        { key: "transaction_total", label: "Transaction Total" },
        { key: "outstanding_balance", label: "Outstanding Balance" }
    ];

    const csv = convertToCsv(rows, headers);

    res.setHeader("Content-Disposition", "attachment; filename=Outstanding_AtoZ.csv");
    res.set("Content-Type", "text/csv");
    res.send(csv);
});

// -------------------- CREATE PARTY + LEDGER --------------------
router.post('/', async (req, res) => {
    const companyId = req.user.active_company_id;

    const {
        username, email, phone, company, initial_balance, role,
        address_line1, address_line2, city_pincode, state, gstin, state_code,
        password
    } = req.body;

    const finalEmail = (email && email.trim() !== "") ? email.trim() : null;
    const initialBalanceFloat = parseFloat(initial_balance || 0);
    const hashedPassword = password ? await bcrypt.hash(password, saltRounds) : null;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const result = await client.query(`
            INSERT INTO users (username, password, email, phone, company, initial_balance, role,
                address_line1, address_line2, city_pincode, state, gstin, state_code, active_company_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            RETURNING id
        `, [username, hashedPassword, finalEmail, phone, company, initialBalanceFloat, role || 'user',
            address_line1, address_line2, city_pincode, state, gstin, state_code, companyId]);

        const userId = result.rows[0].id;

        await client.query(`INSERT INTO user_companies (user_id, company_id) VALUES ($1,$2)`, [userId, companyId]);

        const groupResult = await client.query(`
            SELECT id FROM ledger_groups WHERE company_id=$1 AND name='Sundry Debtors'
        `, [companyId]);
        const groupId = groupResult.rows[0].id;

        await client.query(`
            INSERT INTO ledgers (company_id, name, group_id, opening_balance, is_dr, gstin, state)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
        `, [companyId, username, groupId, initialBalanceFloat, initialBalanceFloat >= 0, gstin, state]);

        await client.query("COMMIT");
        res.json({ message: "Customer created successfully." });
    } catch (err) {
        await client.query("ROLLBACK");
        // Improved error handling for unique constraint violations
        if (err.code === '23505') {
            return res.status(400).json({ error: `A customer or user with this name/email already exists.` });
        }
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

// -------------------- UPDATE PARTY & LEDGER --------------------
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;

    const {
        username, email, phone, company, initial_balance,
        address_line1, address_line2, city_pincode, state, gstin, state_code, role
    } = req.body;

    const existing = (await dbQuery("SELECT username, role FROM users WHERE id=$1", [id]))[0];
    if (!existing) return res.status(404).json({ error: "User not found." });

    const finalEmail = (email && email.trim() !== "") ? email.trim() : null;
    const newBalance = parseFloat(initial_balance || 0);
    const newIsDr = newBalance >= 0;
    const finalRole = role || existing.role;
    const nameChanged = existing.username !== username;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        if (nameChanged) {
            const dupUser = await client.query("SELECT 1 FROM users WHERE username=$1 AND id != $2", [username, id]);
            if (dupUser.rows.length) {
                await client.query("ROLLBACK");
                return res.status(400).json({ error: "Another customer has this name." });
            }

            const dupLedger = await client.query("SELECT 1 FROM ledgers WHERE name=$1 AND company_id=$2", [username, companyId]);
            if (dupLedger.rows.length) {
                await client.query("ROLLBACK");
                return res.status(400).json({ error: "A ledger with this name already exists." });
            }
        }

        await client.query(`
            UPDATE users SET username=$1,email=$2,phone=$3,company=$4,initial_balance=$5,
            role=$6,address_line1=$7,address_line2=$8,city_pincode=$9,state=$10,gstin=$11,state_code=$12
            WHERE id=$13
        `, [username, finalEmail, phone, company, newBalance, finalRole,
            address_line1, address_line2, city_pincode, state, gstin, state_code, id]);

        const ledger = await client.query(`SELECT id FROM ledgers WHERE name=$1 AND company_id=$2`, [existing.username, companyId]);
        const ledgerId = ledger.rows[0].id;

        if (nameChanged) {
            await client.query(`
                UPDATE ledgers SET name=$1, opening_balance=$2, is_dr=$3, gstin=$4, state=$5
                WHERE id=$6
            `, [username, newBalance, newIsDr, gstin, state, ledgerId]);
        } else {
            await client.query(`
                UPDATE ledgers SET opening_balance=$1, is_dr=$2, gstin=$3, state=$4
                WHERE id=$5
            `, [newBalance, newIsDr, gstin, state, ledgerId]);
        }

        await client.query("COMMIT");
        res.json({ message: "Customer updated successfully." });

    } catch (err) {
        await client.query("ROLLBACK");
        if (err.code === '23505') {
            return res.status(400).json({ error: `A customer or user with this email/GSTIN already exists.` });
        }
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

// -------------------- DELETE CUSTOMER --------------------
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;
    let client;

    try {
        client = await pool.connect();
        await client.query("BEGIN");
        
        // 1. Get user and check for associated ledger
        const userRows = await client.query('SELECT username FROM users WHERE id = $1', [id]);
        if (userRows.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Customer not found." });
        }
        const ledgerNameToDelete = userRows.rows[0].username;

        // 2. Check for related transactions (prevent deletion if heavily used)
        const txCountRows = await client.query(`SELECT COUNT(*) FROM transactions WHERE user_id = $1`, [id]);
        if (parseInt(txCountRows.rows[0].count) > 0) {
             await client.query("ROLLBACK");
             return res.status(400).json({ error: "Cannot delete customer. Existing transactions are linked. Please contact support or manually reverse transactions." });
        }

        // 3. Delete user association and user (user_companies is CASCADE deleted)
        await client.query(`DELETE FROM user_companies WHERE user_id=$1 AND company_id=$2`, [id, companyId]);
        const userDeleteResult = await client.query(`DELETE FROM users WHERE id=$1`, [id]);

        // 4. Delete associated Ledger
        if (userDeleteResult.rowCount > 0) {
            await client.query(`DELETE FROM ledgers WHERE name=$1 AND company_id=$2`, [ledgerNameToDelete, companyId]);
        }

        await client.query("COMMIT");
        res.json({ message: "Customer and associated ledger deleted." });
        
    } catch (err) {
        if (client) await client.query("ROLLBACK");
        console.error("Error deleting customer:", err.message);
        return res.status(500).json({ error: "Failed to delete customer.", details: err.message });
    } finally {
        if (client) client.release();
    }
});

module.exports = router;