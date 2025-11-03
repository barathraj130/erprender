// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const saltRounds = 10;

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

// ----- NEW SELF-HEALING HELPER FUNCTION -----
// This function seeds the chart of accounts for a company if it's missing.
function seedChartOfAccountsIfNeeded(companyId, callback) {
    const groups = [
        { name: 'Primary', children: [
            { name: 'Current Assets', nature: 'Asset', children: [
                { name: 'Cash-in-Hand', nature: 'Asset' }, { name: 'Bank Accounts', nature: 'Asset' },
                { name: 'Sundry Debtors', nature: 'Asset' }, { name: 'Stock-in-Hand', nature: 'Asset' },
            ]},
            { name: 'Fixed Assets', nature: 'Asset' },
            { name: 'Current Liabilities', nature: 'Liability', children: [
                { name: 'Sundry Creditors', nature: 'Liability' }, { name: 'Duties & Taxes', nature: 'Liability' }
            ]},
            { name: 'Loans (Liability)', nature: 'Liability' }, { name: 'Direct Incomes', nature: 'Income' },
            { name: 'Indirect Incomes', nature: 'Income' }, { name: 'Sales Accounts', nature: 'Income' },
            { name: 'Direct Expenses', nature: 'Expense' }, { name: 'Indirect Expenses', nature: 'Expense' },
            { name: 'Purchase Accounts', nature: 'Expense' }
        ]}
    ];
    const ledgers = [
        { name: 'Profit & Loss A/c', is_default: 1, groupName: null }, { name: 'Cash', groupName: 'Cash-in-Hand', is_default: 1 },
        { name: 'Sales', groupName: 'Sales Accounts', is_default: 1 }, { name: 'Purchase', groupName: 'Purchase Accounts', is_default: 1 },
        { name: 'CGST', groupName: 'Duties & Taxes', is_default: 1 }, { name: 'SGST', groupName: 'Duties & Taxes', is_default: 1 },
        { name: 'IGST', groupName: 'Duties & Taxes', is_default: 1 },
    ];
    
    db.get("SELECT id FROM ledger_groups WHERE company_id = ? AND name = 'Sundry Debtors'", [companyId], (err, groupRow) => {
        if (err) return callback(err);
        if (groupRow) return callback(null); // Already seeded, continue

        console.warn(`[Self-Healing] Chart of accounts for company ${companyId} is missing. Seeding now...`);
        db.serialize(() => {
            const groupMap = new Map();
            function insertGroups(groupList, parentId = null, onComplete) {
                let pending = groupList.length;
                if (pending === 0) return onComplete();
                groupList.forEach(group => {
                    db.run('INSERT OR IGNORE INTO ledger_groups (company_id, name, parent_id, nature, is_default) VALUES (?, ?, ?, ?, ?)', 
                    [companyId, group.name, parentId, group.nature, group.is_default || 0], function(err) {
                        if (err) console.error(`[Seed] Error inserting group ${group.name}:`, err.message);
                        db.get('SELECT id FROM ledger_groups WHERE company_id = ? AND name = ?', [companyId, group.name], (e, r) => {
                            if(r) groupMap.set(group.name, r.id);
                            if (group.children) {
                                insertGroups(group.children, r ? r.id : null, () => { if (--pending === 0) onComplete(); });
                            } else {
                                if (--pending === 0) onComplete();
                            }
                        });
                    });
                });
            }
            insertGroups(groups[0].children, null, () => {
                let ledgersPending = ledgers.length;
                if (ledgersPending === 0) return callback(null);
                ledgers.forEach(ledger => {
                    const groupId = ledger.groupName ? groupMap.get(ledger.groupName) : null;
                    db.run('INSERT OR IGNORE INTO ledgers (company_id, name, group_id, is_default) VALUES (?, ?, ?, ?)', 
                    [companyId, ledger.name, groupId, ledger.is_default || 0], (err) => {
                        if (err) console.error(`[Seed] Error inserting ledger ${ledger.name}:`, err.message);
                        if (--ledgersPending === 0) callback(null);
                    });
                });
            });
        });
    });
}
// ----- END OF HELPER FUNCTION -----

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
        // --- FIX: Run the self-healing check before the transaction ---
        seedChartOfAccountsIfNeeded(companyId, (seedErr) => {
            if (seedErr) {
                return res.status(500).json({ error: "Failed to verify or prepare accounting setup.", details: seedErr.message });
            }

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