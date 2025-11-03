// routes/ledgerRoutes.js
const express = require('express');
const router = express.Router();
// --- PG FIX: Import pool for helper function ---
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
// GET /api/ledgers/groups - Get all ledger groups as a tree
router.get('/groups', async (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });

    const sql = 'SELECT id, name, parent_id, nature FROM ledger_groups WHERE company_id = $1 ORDER BY name';
    
    try {
        const rows = await dbQuery(sql, [companyId]);

        // Build a tree structure from the flat list (Pure JS logic)
        const groups = rows || [];
        const groupMap = new Map();
        const tree = [];

        groups.forEach(group => {
            groupMap.set(group.id, { ...group, children: [] });
        });

        groups.forEach(group => {
            if (group.parent_id && groupMap.has(group.parent_id)) {
                groupMap.get(group.parent_id).children.push(groupMap.get(group.id));
            } else {
                tree.push(groupMap.get(group.id));
            }
        });

        res.json(tree);
    } catch (err) {
        return res.status(500).json({ error: "Failed to fetch ledger groups.", details: err.message });
    }
});

// POST /api/ledgers/groups - Create a new ledger group
router.post('/groups', async (req, res) => {
    const companyId = req.user.active_company_id;
    const { name, parent_id, nature } = req.body;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!name || !nature) return res.status(400).json({ error: "Group name and nature are required." });
    // PostgreSQL ENUM check is handled implicitly by the DB schema validation
    if (!['Asset', 'Liability', 'Income', 'Expense'].includes(nature)) {
        return res.status(400).json({ error: "Invalid nature specified." });
    }

    const sql = 'INSERT INTO ledger_groups (company_id, name, parent_id, nature) VALUES ($1, $2, $3, $4) RETURNING id';
    
    try {
        const result = await dbQuery(sql, [companyId, name, parent_id || null, nature]);
        res.status(201).json({ id: result[0].id, message: "Ledger group created." });
    } catch (err) {
        return res.status(500).json({ error: "Failed to create ledger group.", details: err.message });
    }
});

// GET /api/ledgers - Get all ledgers
router.get('/', async (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });

    const sql = `
        SELECT l.*, lg.name as group_name 
        FROM ledgers l 
        LEFT JOIN ledger_groups lg ON l.group_id = lg.id
        WHERE l.company_id = $1 ORDER BY l.name`;
    
    try {
        const rows = await dbQuery(sql, [companyId]);
        res.json(rows || []);
    } catch (err) {
        return res.status(500).json({ error: "Failed to fetch ledgers.", details: err.message });
    }
});

// POST /api/ledgers - Create a new ledger
router.post('/', async (req, res) => {
    const companyId = req.user.active_company_id;
    const { name, group_id, opening_balance, is_dr, gstin, state } = req.body;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!name || !group_id) return res.status(400).json({ error: "Ledger name and group are required." });

    const sql = `INSERT INTO ledgers (company_id, name, group_id, opening_balance, is_dr, gstin, state) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`;
    
    try {
        const result = await dbQuery(sql, [companyId, name, group_id, opening_balance || 0, is_dr === false ? false : true, gstin, state]);
        res.status(201).json({ id: result[0].id, message: "Ledger created." });
    } catch (err) {
        return res.status(500).json({ error: "Failed to create ledger.", details: err.message });
    }
});

module.exports = router;