// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const saltRounds = 10;
// Paste this near the top of every route file:
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
// Helper function to convert JSON data to a CSV string
function convertToCsv(data, headers) {
    if (!Array.isArray(data) || data.length === 0) {
        return '';
    }
    const sanitizeValue = (value) => {
        if (value === null || value === undefined) return '';
        const strValue = String(value);
        if (strValue.includes(',') || strValue.includes('\n') || strValue.includes('"')) {
            return `"${strValue.replace(/"/g, '""')}"`;
        }
        return strValue;
    };
    const headerRow = headers.map(h => sanitizeValue(h.label)).join(',');
    const dataRows = data.map(row => headers.map(header => sanitizeValue(row[header.key])).join(','));
    return [headerRow, ...dataRows].join('\n');
}

// GET /api/users - Get all users (parties) for the active company
router.get('/', (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) {
        return res.status(400).json({ error: "No active company selected." });
    }
    const sql = `
        SELECT
          u.id, u.username, u.email, u.phone, u.company, u.initial_balance,
          u.created_at, u.address_line1, u.address_line2, u.city_pincode,
          u.state, u.gstin, u.state_code, u.role,
          (u.initial_balance + IFNULL((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id = u.id), 0)) AS remaining_balance 
        FROM users u
        JOIN user_companies uc ON u.id = uc.user_id
        WHERE uc.company_id = ?
        ORDER BY u.id DESC
    `;
    db.all(sql, [companyId], (err, rows) => {
        if (err) {
            console.error("Error fetching users for company:", err.message);
            return res.status(500).json({ error: "Failed to fetch user/party data." });
        }
        res.json(rows.map(({ password, ...rest }) => rest) || []);
    });
});

// POST /api/users - Create a user (Party) AND its corresponding Accounting Ledger
router.post('/', (req, res) => {
    const companyId = req.user.active_company_id;
    const { 
        username, email, phone, company, initial_balance, role,
        address_line1, address_line2, city_pincode, state, gstin, state_code,
        password 
    } = req.body;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!username) return res.status(400).json({ error: "Username (Party Name) is required." });

    const finalEmail = (email && email.trim() !== '') ? email.trim() : null;

    const createUserAndLedger = (hashedPassword = null) => {
        // NOTE: The self-healing chart of accounts check has been removed.
        // This is correctly handled by db.js on server startup.
        db.serialize(() => {
            db.run("BEGIN TRANSACTION;");
            const userSql = `INSERT INTO users (username, password, email, phone, company, initial_balance, role, address_line1, address_line2, city_pincode, state, gstin, state_code, active_company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            db.run(userSql, [
                username, hashedPassword, finalEmail, phone, company, parseFloat(initial_balance || 0), role || 'user',
                address_line1, address_line2, city_pincode, state, gstin, state_code, companyId
            ], function(userErr) {
                if (userErr) {
                    db.run("ROLLBACK;");
                    return res.status(500).json({ error: "Failed to create party record.", details: userErr.message });
                }
                const newUserId = this.lastID;

                db.run(`INSERT INTO user_companies (user_id, company_id) VALUES (?, ?)`, [newUserId, companyId], (linkErr) => {
                    if (linkErr) {
                        db.run("ROLLBACK;");
                        return res.status(500).json({ error: "Failed to link user to company.", details: linkErr.message });
                    }
                    
                    db.get("SELECT id FROM ledger_groups WHERE company_id = ? AND name = 'Sundry Debtors'", [companyId], (groupErr, groupRow) => {
                        if (groupErr || !groupRow) {
                            db.run("ROLLBACK;");
                            return res.status(500).json({ error: "Critical Error: Accounting group 'Sundry Debtors' not found. Setup may be incomplete." });
                        }
                        
                        const ledgerSql = `INSERT INTO ledgers (company_id, name, group_id, opening_balance, is_dr, gstin, state) VALUES (?, ?, ?, ?, ?, ?, ?)`;
                        db.run(ledgerSql, [companyId, username, groupRow.id, initial_balance || 0, (initial_balance || 0) >= 0, gstin, state], (ledgerErr) => {
                            if (ledgerErr) {
                                db.run("ROLLBACK;");
                                return res.status(500).json({ error: "User was created, but failed to create corresponding accounting ledger.", details: ledgerErr.message });
                            }
                            db.run("COMMIT;", (commitErr) => {
                                if (commitErr) return res.status(500).json({ error: "Failed to commit transaction", details: commitErr.message });
                                res.status(201).json({ id: newUserId, message: 'Party and Accounting Ledger created successfully.' });
                            });
                        });
                    });
                });
            });
        });
    };

    if (password) {
        bcrypt.hash(password, saltRounds, (err, hashedPassword) => {
            if (err) return res.status(500).json({ error: 'Failed to hash password' });
            createUserAndLedger(hashedPassword);
        });
    } else {
        createUserAndLedger(null);
    }
});

// PUT /api/users/:id - Update User (Party) and associated Ledger
router.put('/:id', (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;
    const { username, email, phone, company, initial_balance, role,
            address_line1, address_line2, city_pincode, state, gstin, state_code } = req.body;

    if (!username) return res.status(400).json({ error: "Username is required." });
    
    db.get("SELECT username FROM users WHERE id = ?", [id], (err, oldUser) => {
        if (err) return res.status(500).json({error: "Could not fetch old user data."});
        if (!oldUser) return res.status(404).json({error: "User not found."});
        
        const oldUsername = oldUser.username;

        db.serialize(() => {
            db.run("BEGIN TRANSACTION;");

            const userUpdateSql = `UPDATE users SET 
                username = ?, email = ?, phone = ?, company = ?, initial_balance = ?, role = ?, 
                address_line1 = ?, address_line2 = ?, city_pincode = ?, state = ?, gstin = ?, state_code = ?
                WHERE id = ?`;
            db.run(userUpdateSql, [
                username, email, phone, company, initial_balance, role,
                address_line1, address_line2, city_pincode, state, gstin, state_code, id
            ], function(userErr) {
                if (userErr) {
                    db.run("ROLLBACK;");
                    return res.status(500).json({ error: "Failed to update user.", details: userErr.message });
                }

                if (oldUsername !== username) {
                    const ledgerUpdateSql = `UPDATE ledgers SET name = ? WHERE name = ? AND company_id = ?`;
                    db.run(ledgerUpdateSql, [username, oldUsername, companyId], (ledgerErr) => {
                        if (ledgerErr) {
                            db.run("ROLLBACK;");
                            return res.status(500).json({ error: "User updated, but failed to update ledger name.", details: ledgerErr.message });
                        }
                        db.run("COMMIT;");
                        res.json({ message: 'Party and Ledger updated successfully' });
                    });
                } else {
                    db.run("COMMIT;");
                    res.json({ message: 'Party updated successfully' });
                }
            });
        });
    });
});

// DELETE /api/users/:id - Delete User (Party) and associated Ledger
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;

    db.get('SELECT username FROM users WHERE id = ?', [id], (err, user) => {
        if (err || !user) return res.status(404).json({ message: "User to delete not found." });
        
        const ledgerNameToDelete = user.username;

        db.serialize(() => {
            db.run("BEGIN TRANSACTION;");
            
            db.run("DELETE FROM ledgers WHERE name = ? AND company_id = ?", [ledgerNameToDelete, companyId], function(ledgerErr) {
                if (ledgerErr) {
                    db.run("ROLLBACK;");
                    return res.status(500).json({ error: 'Failed to delete corresponding ledger. Party was not deleted.', details: ledgerErr.message });
                }
                
                db.run("DELETE FROM users WHERE id = ?", [id], function(userErr) {
                    if (userErr) {
                        db.run("ROLLBACK;");
                        return res.status(500).json({ error: "Failed to delete user record.", details: userErr.message });
                    }
                    db.run("COMMIT;");
                    res.json({ message: "Party and associated accounting ledger deleted successfully." });
                });
            });
        });
    });
});

// GET /api/users/export - Export party data to CSV
router.get('/export', (req, res) => {
    const companyId = req.user.active_company_id;
    const sql = `
      SELECT
        u.id, u.username, u.email, u.phone, u.company, u.initial_balance,
        u.created_at, u.address_line1, u.address_line2, u.city_pincode,
        u.state, u.gstin, u.state_code,
        (u.initial_balance + IFNULL((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id = u.id), 0)) AS remaining_balance 
      FROM users u
      JOIN user_companies uc ON u.id = uc.user_id
      WHERE uc.company_id = ? AND u.role != 'admin'
      ORDER BY u.id DESC
    `;
    db.all(sql, [companyId], (err, rows) => {
        if (err) return res.status(500).json({ error: "Failed to fetch user data for export." });
        
        const headers = [
            { key: 'id', label: 'ID' }, { key: 'username', label: 'Party Name' },
            { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
            { key: 'company', label: 'Company' }, { key: 'initial_balance', label: 'Opening Balance' },
            { key: 'remaining_balance', label: 'Current Balance (Legacy)' }, { key: 'address_line1', label: 'Address Line 1' },
            { key: 'address_line2', label: 'Address Line 2' }, { key: 'city_pincode', label: 'City/Pincode' },
            { key: 'state', label: 'State' }, { key: 'gstin', label: 'GSTIN' },
            { key: 'created_at', label: 'Joined Date' }
        ];
        
        const csv = convertToCsv(rows, headers);
        res.header('Content-Type', 'text/csv');
        res.attachment('parties_export.csv');
        res.send(csv);
    });
});

module.exports = router;