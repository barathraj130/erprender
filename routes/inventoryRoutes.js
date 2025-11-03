// routes/inventoryRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// --- Stock Unit Routes ---
router.get('/units', (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    db.all('SELECT * FROM stock_units WHERE company_id = ? ORDER BY name', [companyId], (err, rows) => {
        if (err) return res.status(500).json({ error: "Failed to fetch stock units." });
        res.json(rows || []);
    });
});

router.post('/units', (req, res) => {
    const companyId = req.user.active_company_id;
    const { name } = req.body;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!name) return res.status(400).json({ error: "Unit name is required." });
    db.run('INSERT INTO stock_units (company_id, name) VALUES (?, ?)', [companyId, name], function (err) {
        if (err) return res.status(500).json({ error: "Failed to create stock unit." });
        res.status(201).json({ id: this.lastID, name: name });
    });
});

// --- Stock Warehouse Routes ---
router.get('/warehouses', (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    db.all('SELECT * FROM stock_warehouses WHERE company_id = ? ORDER BY name', [companyId], (err, rows) => {
        if (err) return res.status(500).json({ error: "Failed to fetch warehouses." });
        res.json(rows || []);
    });
});

router.post('/warehouses', (req, res) => {
    const companyId = req.user.active_company_id;
    const { name } = req.body;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!name) return res.status(400).json({ error: "Warehouse name is required." });
    db.run('INSERT INTO stock_warehouses (company_id, name) VALUES (?, ?)', [companyId, name], function (err) {
        if (err) return res.status(500).json({ error: "Failed to create warehouse." });
        res.status(201).json({ id: this.lastID, name: name });
    });
});

// --- Stock Item Routes ---
router.get('/items', (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });

    const sql = `
        SELECT i.*, u.name as unit_name,
        (i.opening_qty + IFNULL((SELECT SUM(vi.quantity) FROM voucher_inventory_entries vi WHERE vi.item_id = i.id), 0)) as current_stock
        FROM stock_items i
        JOIN stock_units u ON i.unit_id = u.id
        WHERE i.company_id = ?
        ORDER BY i.name
    `;
    db.all(sql, [companyId], (err, rows) => {
        if (err) return res.status(500).json({ error: "Failed to fetch stock items.", details: err.message });
        res.json(rows || []);
    });
});

router.post('/items', (req, res) => {
    const companyId = req.user.active_company_id;
    const { name, unit_id, gst_rate, opening_qty, opening_rate } = req.body;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!name || !unit_id) return res.status(400).json({ error: "Item name and unit are required." });

    const sql = `INSERT INTO stock_items (company_id, name, unit_id, gst_rate, opening_qty, opening_rate) VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(sql, [companyId, name, unit_id, gst_rate || 0, opening_qty || 0, opening_rate || 0], function(err) {
        if (err) return res.status(500).json({ error: "Failed to create stock item.", details: err.message });
        res.status(201).json({ id: this.lastID, message: "Stock item created." });
    });
});

router.put('/items/:id', (req, res) => {
    const companyId = req.user.active_company_id;
    const itemId = req.params.id;
    const { name, unit_id, gst_rate } = req.body;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!name || !unit_id) return res.status(400).json({ error: "Item name and unit are required." });
    
    // Note: Opening stock is generally not editable after creation.
    const sql = `UPDATE stock_items SET name = ?, unit_id = ?, gst_rate = ? WHERE id = ? AND company_id = ?`;
    db.run(sql, [name, unit_id, gst_rate || 0, itemId, companyId], function(err) {
        if (err) return res.status(500).json({ error: "Failed to update stock item.", details: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Stock item not found or no changes made." });
        res.json({ message: "Stock item updated." });
    });
});

module.exports = router;