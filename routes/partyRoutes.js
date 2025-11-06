// routes/partyRoutes.js
const express = require('express');
const router = express.Router();
// --- PG FIX: Import pool ---
const { pool } = require('../db'); 
const bcrypt = require('bcryptjs');
const saltRounds = 10;

async function dbQuery(sql, params = []) {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(sql, params);
        // PG returns rows; rowsCount is only used in mutation functions
        return result.rows;
    } catch (e) {
        console.error("PG Query Error:", e.message, "SQL:", sql, "Params:", params);
        throw e;
    } finally {
        if (client) client.release();
    }
}

// Helper function to convert JSON data to a CSV string (JS only, no DB change needed)
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
router.get('/', async (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) {
        return res.status(400).json({ error: "No active company selected." });
    }
    // Changed IFNULL to COALESCE, $1 placeholder
    const sql = `
        SELECT
          u.id, u.username, u.email, u.phone, u.company, u.initial_balance,
          u.created_at, u.address_line1, u.address_line2, u.city_pincode,
          u.state, u.gstin, u.state_code, u.role,
          (u.initial_balance + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id = u.id), 0)) AS remaining_balance 
        FROM users u
        JOIN user_companies uc ON u.id = uc.user_id
        WHERE uc.company_id = $1
        ORDER BY u.id DESC
    `;
    try {
        const rows = await dbQuery(sql, [companyId]);
        res.json(rows.map(({ password, ...rest }) => rest) || []);
    } catch (err) {
        console.error("Error fetching users for company:", err.message);
        return res.status(500).json({ error: "Failed to fetch user/party data." });
    }
});

// POST /api/users - Create a user (Party) AND its corresponding Accounting Ledger
router.post('/', async (req, res) => {
    const companyId = req.user.active_company_id;
    const { 
        username, email, phone, company, initial_balance, role,
        address_line1, address_line2, city_pincode, state, gstin, state_code,
        password 
    } = req.body;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!username) return res.status(400).json({ error: "Username (Party Name) is required." });

    const finalEmail = (email && email.trim() !== '') ? email.trim() : null;
    const initialBalanceFloat = parseFloat(initial_balance || 0);

    const createUserAndLedger = async (hashedPassword = null) => {
        let client;
        try {
            client = await pool.connect();
            await client.query("BEGIN");
            
            // 1. Create User
            const userSql = `INSERT INTO users (username, password, email, phone, company, initial_balance, role, address_line1, address_line2, city_pincode, state, gstin, state_code, active_company_id) 
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`;
            const userParams = [
                username, hashedPassword, finalEmail, phone, company, initialBalanceFloat, role || 'user',
                address_line1, address_line2, city_pincode, state, gstin, state_code, companyId
            ];
            const userResult = await client.query(userSql, userParams);
            const newUserId = userResult.rows[0].id;

            // 2. Link User to Company
            await client.query(`INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2)`, [newUserId, companyId]);
            
            // 3. Get Sundry Debtors Group ID
            const groupResult = await client.query("SELECT id FROM ledger_groups WHERE company_id = $1 AND name = 'Sundry Debtors'", [companyId]);
            const groupRow = groupResult.rows[0];

            if (!groupRow) {
                throw new Error("Critical Error: Accounting group 'Sundry Debtors' not found. Setup may be incomplete.");
            }
            
            // 4. Create Ledger
            const ledgerSql = `INSERT INTO ledgers (company_id, name, group_id, opening_balance, is_dr, gstin, state) 
                               VALUES ($1, $2, $3, $4, $5, $6, $7)`;
            const isDr = initialBalanceFloat >= 0 ? true : false;
            await client.query(ledgerSql, [companyId, username, groupRow.id, initialBalanceFloat, isDr, gstin, state]);

            await client.query("COMMIT");
            res.status(201).json({ id: newUserId, message: 'Party and Accounting Ledger created successfully.' });

        } catch (err) {
            if (client) await client.query("ROLLBACK");
            let errorMsg = err.message;
            if (err.code === '23505') errorMsg = "A user or ledger with that name already exists in your company.";
            
            console.error("PG POST User/Party Error:", errorMsg, err.stack);
            return res.status(500).json({ error: "Failed to create party record: " + errorMsg, details: err.message });
        } finally {
            if (client) client.release();
        }
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
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const userId = parseInt(id); 
    const companyId = req.user.active_company_id;
    const { username, email, phone, company, initial_balance, 
            address_line1, address_line2, city_pincode, state, gstin, state_code } = req.body;
    
    // Explicitly handle role if sent, but default to preservation.
    let { role } = req.body; 

    if (!username) return res.status(400).json({ error: "Username is required." });
    
    if (isNaN(userId)) return res.status(400).json({ error: "Invalid User ID provided in URL." });

    let client;
    try {
        const oldUserRows = await dbQuery("SELECT username, role FROM users WHERE id = $1", [userId]);
        const oldUser = oldUserRows[0];

        if (!oldUser) return res.status(404).json({error: "User not found."});
        const oldUsername = oldUser.username;
        
        // FIX: Ensure the role is never set to NULL, using the existing role as fallback
        const finalRole = role || oldUser.role || 'user';
        const initialBalanceFloat = parseFloat(initial_balance || 0);

        const nameIsChanging = (oldUsername !== username);
        
        // --- Pre-validation for Conflicts (Only runs if name is changing) ---
        if (nameIsChanging) {
            // Check 1A: Global user conflict (users.username UNIQUE)
            const duplicateUserCheckSql = "SELECT id FROM users WHERE username = $1 AND id != $2";
            const duplicateUserCheck = await dbQuery(duplicateUserCheckSql, [username, userId]);
            if (duplicateUserCheck.length > 0) {
                return res.status(400).json({ error: "A user with that username already exists globally. Please choose another." });
            }
            
            // Check 1B: Local ledger conflict (ledgers.name UNIQUE within company_id)
            const conflictingLedgerSql = `
                SELECT id 
                FROM ledgers 
                WHERE name = $1 AND company_id = $2
            `;
            const conflictingLedger = await dbQuery(conflictingLedgerSql, [username, companyId]);

            if (conflictingLedger.length > 0) {
                return res.status(400).json({ error: "An accounting ledger with this name already exists in your company. Please choose a different party name." });
            }
        }
        
        client = await pool.connect();
        await client.query("BEGIN");
        
        // 1. Update User (Regardless of name change)
        const userUpdateSql = `UPDATE users SET 
            username = $1, email = $2, phone = $3, company = $4, initial_balance = $5, role = $6, 
            address_line1 = $7, address_line2 = $8, city_pincode = $9, state = $10, gstin = $11, state_code = $12
            WHERE id = $13`;
        const userParams = [
            username, email, phone, company, initialBalanceFloat, finalRole, 
            address_line1, address_line2, city_pincode, state, gstin, state_code, userId
        ];
        const userResult = await client.query(userUpdateSql, userParams);
        
        if (userResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "User not found or no changes made." });
        }

        // 2. Fetch the target ledger ID using the OLD username (safer lookup method)
        const ledgerIdRows = await client.query("SELECT id FROM ledgers WHERE name = $1 AND company_id = $2", [oldUsername, companyId]);
        const ledgerId = ledgerIdRows.rows[0]?.id;
        
        if (!ledgerId) {
            await client.query("ROLLBACK");
            return res.status(500).json({ error: "Critical Error: Could not find associated accounting ledger." });
        }
        
        // 3. Construct and run Ledger update statement
        const isDr = initialBalanceFloat >= 0;
        
        let ledgerUpdateFields = `opening_balance = $1, is_dr = $2, gstin = $3, state = $4`;
        let ledgerUpdateParams = [initial_balance, isDr, gstin, state];
        
        if (nameIsChanging) {
            // If the name is changing, prepend the name update parameter
            ledgerUpdateFields = `name = $${ledgerUpdateParams.length + 1}, ` + ledgerUpdateFields;
            ledgerUpdateParams.push(username); 
            // Since we use array parameters, we must reverse the order of push to match the order in the SQL statement.
            // Let's reset the logic for clarity and ensure name is first if needed.
            
            ledgerUpdateFields = `name = $1, opening_balance = $2, is_dr = $3, gstin = $4, state = $5`;
            ledgerUpdateParams = [username, initial_balance, isDr, gstin, state];
        } else {
             ledgerUpdateFields = `opening_balance = $1, is_dr = $2, gstin = $3, state = $4`;
             ledgerUpdateParams = [initial_balance, isDr, gstin, state];
        }
        
        // Add WHERE clause parameters (Ledger ID and Company ID)
        ledgerUpdateParams.push(ledgerId, companyId);
        
        const finalLedgerUpdateSql = `UPDATE ledgers SET ${ledgerUpdateFields} WHERE id = $${ledgerUpdateParams.length - 1} AND company_id = $${ledgerUpdateParams.length}`;

        await client.query(finalLedgerUpdateSql, ledgerUpdateParams);

        await client.query("COMMIT");
        res.json({ message: 'Party and Ledger updated successfully' });

    } catch (err) {
        if (client) await client.query("ROLLBACK");
        let errorMsg = err.message;
        
        // Catch PostgreSQL unique constraint violation
        if (err.code === '23505') { 
            let constraintErrorMsg = "A user or ledger with that name already exists in your company. Please ensure there are no duplicate accounts/parties with this name.";
            
            if (err.constraint && err.constraint.includes('users_username_key')) {
                 constraintErrorMsg = "This username is already taken by another user (globally). Please choose a unique name.";
            } else if (err.constraint && err.constraint.includes('ledgers_company_id_name_key')) {
                 constraintErrorMsg = "An accounting ledger with this name already exists in your company.";
            } 
            
            return res.status(400).json({ error: "Failed to update user: " + constraintErrorMsg, details: err.message });
        }
        
        console.error("PG PUT User/Party Error:", errorMsg, err.stack);
        return res.status(500).json({ error: 'Failed to update user records.', details: err.message });
    } finally {
        if (client) client.release();
    }
});

// DELETE /api/users/:id - Delete User (Party) and associated Ledger
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;
    let client;

    try {
        const userCheckRows = await dbQuery('SELECT username, role FROM users WHERE id = $1', [id]);
        const user = userCheckRows[0];
        if (!user) return res.status(404).json({ message: "User to delete not found." });
        
        // Prevent deleting admin account
        if (user.role === 'admin') {
            return res.status(403).json({ error: "Cannot delete the primary admin account." });
        }

        const ledgerNameToDelete = user.username;

        client = await pool.connect();
        await client.query("BEGIN");
        
        // 1. Check for constraints that ARE NOT ON DELETE SET NULL/CASCADE
        
        // Check if user is referenced in invoices (FK is ON DELETE RESTRICT by default if not specified)
        const invoiceCountRows = await dbQuery('SELECT COUNT(*) as count FROM invoices WHERE customer_id = $1', [id]);
        if (parseInt(invoiceCountRows.rows[0].count) > 0) {
             await client.query("ROLLBACK");
             return res.status(400).json({ error: 'Cannot delete party. They are linked to existing invoices. Delete invoices first.' });
        }
        
        // 2. Transactions.user_id has ON DELETE SET NULL, so this is safe.
        // 3. user_companies.user_id has ON DELETE CASCADE, so this is safe.

        // 4. Delete Ledger
        const ledgerDeleteResult = await client.query("DELETE FROM ledgers WHERE name = $1 AND company_id = $2", [ledgerNameToDelete, companyId]);
        
        // 5. Delete User (Triggers cascade delete on user_companies, sets user_id to null on transactions)
        const userDeleteResult = await client.query("DELETE FROM users WHERE id = $1", [id]);

        if (userDeleteResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: 'User not found or already deleted.' });
        }
        
        await client.query("COMMIT");
        res.json({ message: "Party and associated accounting ledger deleted successfully." });

    } catch (err) {
        if (client) await client.query("ROLLBACK");
        
        // Handle specific constraint errors better
        if (err.code === '23503') { // foreign_key_violation
            if (err.constraint.includes('voucher_entries_ledger_id_fkey')) {
                 return res.status(400).json({ error: 'Cannot delete party. The associated ledger is used in existing vouchers (Journal, Payment, Receipt, etc.). Delete all related vouchers first.' });
            }
             return res.status(400).json({ error: `Failed to delete records due to related accounting entries. Delete all related transactions/vouchers first. Details: ${err.message}` });
        }

        console.error("PG DELETE User/Party Error:", err.message);
        return res.status(500).json({ error: 'Failed to delete records. An internal constraint error occurred.', details: err.message });
    } finally {
        if (client) client.release();
    }
});

// GET /api/users/export - Export party data to CSV (Migrate to use dbQuery)
router.get('/export', async (req, res) => {
    const companyId = req.user.active_company_id;
    const sql = `
      SELECT
        u.id, u.username, u.email, u.phone, u.company, u.initial_balance,
        u.created_at, u.address_line1, u.address_line2, u.city_pincode,
        u.state, u.gstin, u.state_code,
        (u.initial_balance + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id = u.id), 0)) AS remaining_balance 
      FROM users u
      JOIN user_companies uc ON u.id = uc.user_id
      WHERE uc.company_id = $1 AND u.role != 'admin'
      ORDER BY u.id DESC
    `;
    
    try {
        const rows = await dbQuery(sql, [companyId]);

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
    } catch (err) {
        return res.status(500).json({ error: "Failed to fetch user data for export." });
    }
});

module.exports = router;