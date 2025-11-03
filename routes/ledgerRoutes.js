// routes/ledgerRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/ledgers/groups - Get all ledger groups as a tree
router.get('/groups', (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });

    const sql = 'SELECT id, name, parent_id, nature FROM ledger_groups WHERE company_id = ? ORDER BY name';
    db.all(sql, [companyId], (err, rows) => {
        if (err) return res.status(500).json({ error: "Failed to fetch ledger groups.", details: err.message });

        // Build a tree structure from the flat list
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
    });
});

// POST /api/ledgers/groups - Create a new ledger group
router.post('/groups', (req, res) => {
    const companyId = req.user.active_company_id;
    const { name, parent_id, nature } = req.body;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!name || !nature) return res.status(400).json({ error: "Group name and nature are required." });
    if (!['Asset', 'Liability', 'Income', 'Expense'].includes(nature)) {
        return res.status(400).json({ error: "Invalid nature specified." });
    }

    const sql = 'INSERT INTO ledger_groups (company_id, name, parent_id, nature) VALUES (?, ?, ?, ?)';
    db.run(sql, [companyId, name, parent_id || null, nature], function(err) {
        if (err) return res.status(500).json({ error: "Failed to create ledger group.", details: err.message });
        res.status(201).json({ id: this.lastID, message: "Ledger group created." });
    });
});

// GET /api/ledgers - Get all ledgers
router.get('/', (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });

    const sql = `
        SELECT l.*, lg.name as group_name 
        FROM ledgers l 
        LEFT JOIN ledger_groups lg ON l.group_id = lg.id
        WHERE l.company_id = ? ORDER BY l.name`;
    db.all(sql, [companyId], (err, rows) => {
        if (err) return res.status(500).json({ error: "Failed to fetch ledgers.", details: err.message });
        res.json(rows || []);
    });
});

// POST /api/ledgers - Create a new ledger
router.post('/', (req, res) => {
    const companyId = req.user.active_company_id;
    const { name, group_id, opening_balance, is_dr, gstin, state } = req.body;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!name || !group_id) return res.status(400).json({ error: "Ledger name and group are required." });

    const sql = `INSERT INTO ledgers (company_id, name, group_id, opening_balance, is_dr, gstin, state) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, [companyId, name, group_id, opening_balance || 0, is_dr === false ? 0 : 1, gstin, state], function(err) {
        if (err) return res.status(500).json({ error: "Failed to create ledger.", details: err.message });
        res.status(201).json({ id: this.lastID, message: "Ledger created." });
    });
});

module.exports = router;