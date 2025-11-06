// routes/partyRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const bcrypt = require('bcryptjs');
const saltRounds = 10;

// Helper DB Query
async function dbQuery(sql, params = []) {
    const client = await pool.connect();
    try {
        const result = await client.query(sql, params);
        return result.rows;
    } finally {
        client.release();
    }
}

// -------------------- GET ALL PARTIES --------------------
router.get('/', async (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });

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
        console.error("Error fetching users:", err.message);
        res.status(500).json({ error: "Failed to fetch user data." });
    }
});

// -------------------- CREATE PARTY + LEDGER --------------------
router.post('/', async (req, res) => {
    const companyId = req.user.active_company_id;

    const { 
        username, email, phone, company, initial_balance, role,
        address_line1, address_line2, city_pincode, state, gstin, state_code,
        password 
    } = req.body;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!username) return res.status(400).json({ error: "Party name (username) is required." });

    const finalEmail = email?.trim() || null;
    const initialBalanceFloat = parseFloat(initial_balance || 0);
    const hashedPassword = password ? await bcrypt.hash(password, saltRounds) : null;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const userSql = `
            INSERT INTO users (username, password, email, phone, company, initial_balance, role, address_line1, address_line2, city_pincode, state, gstin, state_code, active_company_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id
        `;

        const userResult = await client.query(userSql, [
            username, hashedPassword, finalEmail, phone, company,
            initialBalanceFloat, role || 'user',
            address_line1, address_line2, city_pincode, state, gstin, state_code, companyId
        ]);

        const newUserId = userResult.rows[0].id;

        await client.query(`INSERT INTO user_companies (user_id, company_id) VALUES ($1,$2)`, [newUserId, companyId]);

        const group = await client.query(`SELECT id FROM ledger_groups WHERE company_id=$1 AND name='Sundry Debtors'`, [companyId]);
        if (!group.rows[0]) throw new Error("Ledger group 'Sundry Debtors' missing.");

        const isDr = initialBalanceFloat >= 0;

        await client.query(`
            INSERT INTO ledgers (company_id, name, group_id, opening_balance, is_dr, gstin, state)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
        `, [companyId, username, group.rows[0].id, initialBalanceFloat, isDr, gstin, state]);

        await client.query("COMMIT");
        res.status(201).json({ id: newUserId, message: "Party + Ledger created successfully" });

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("POST Party Error:", err.message);

        if (err.code === '23505')
            return res.status(400).json({ error: "Party or Ledger name already exists." });

        res.status(500).json({ error: "Failed to create party." });
    } finally {
        client.release();
    }
});

// -------------------- UPDATE PARTY + LEDGER --------------------
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;

    const { username, email, phone, company,
        initial_balance, address_line1, address_line2,
        city_pincode, state, gstin, state_code, role
    } = req.body;

    if (!username) return res.status(400).json({ error: "Username is required." });

    const initialBalanceFloat = parseFloat(initial_balance || 0);
    const isDr = initialBalanceFloat >= 0;

    const oldUserRows = await dbQuery(`SELECT username, role FROM users WHERE id=$1`, [id]);
    if (!oldUserRows[0]) return res.status(404).json({ error: "User not found." });

    const oldUsername = oldUserRows[0].username;
    const finalRole = role || oldUserRows[0].role;
    const nameIsChanging = (oldUsername !== username);

    // Duplicate check only if renaming
    if (nameIsChanging) {
        const userDup = await dbQuery(`SELECT id FROM users WHERE username=$1 AND id != $2`, [username, id]);
        if (userDup.length > 0)
            return res.status(400).json({ error: "Another user already has this name." });

        const ledgerDup = await dbQuery(`SELECT id FROM ledgers WHERE name=$1 AND company_id=$2`, [username, companyId]);
        if (ledgerDup.length > 0)
            return res.status(400).json({ error: "Another ledger already has this name in this company." });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Update user record
        await client.query(`
            UPDATE users SET username=$1, email=$2, phone=$3, company=$4, initial_balance=$5,
            role=$6, address_line1=$7, address_line2=$8, city_pincode=$9, state=$10, gstin=$11, state_code=$12
            WHERE id=$13
        `, [
            username, email, phone, company, initialBalanceFloat, finalRole,
            address_line1, address_line2, city_pincode, state, gstin, state_code, id
        ]);

        // Update corresponding ledger safely
        const ledger = await client.query(`SELECT id FROM ledgers WHERE name=$1 AND company_id=$2`, [oldUsername, companyId]);
        if (!ledger.rows[0]) throw new Error("Associated ledger not found.");

        const ledgerId = ledger.rows[0].id;

        if (nameIsChanging) {
            await client.query(`
                UPDATE ledgers SET name=$1, opening_balance=$2, is_dr=$3, gstin=$4, state=$5
                WHERE id=$6
            `, [username, initialBalanceFloat, isDr, gstin, state, ledgerId]);
        } else {
            await client.query(`
                UPDATE ledgers SET opening_balance=$1, is_dr=$2, gstin=$3, state=$4
                WHERE id=$5
            `, [initialBalanceFloat, isDr, gstin, state, ledgerId]);
        }

        await client.query("COMMIT");
        res.json({ message: "Party + Ledger updated successfully" });

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("PUT Party Error:", err.message);
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;
