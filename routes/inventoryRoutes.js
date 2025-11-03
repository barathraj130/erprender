// routes/inventoryRoutes.js
const express = require('express');
const router = express.Router();
// --- PG FIX: Import pool for helper function ---
const { pool } = require('../db'); 

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
// --- Stock Unit Routes ---
router.get('/units', async (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    try {
        const rows = await dbQuery('SELECT * FROM stock_units WHERE company_id = $1 ORDER BY name', [companyId]);
        res.json(rows || []);
    } catch (err) {
        return res.status(500).json({ error: "Failed to fetch stock units." });
    }
});

router.post('/units', async (req, res) => {
    const companyId = req.user.active_company_id;
    const { name } = req.body;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!name) return res.status(400).json({ error: "Unit name is required." });
    try {
        const result = await dbQuery('INSERT INTO stock_units (company_id, name) VALUES ($1, $2) RETURNING id', [companyId, name]);
        res.status(201).json({ id: result[0].id, name: name });
    } catch (err) {
        return res.status(500).json({ error: "Failed to create stock unit.", details: err.message });
    }
});

// --- Stock Warehouse Routes ---
router.get('/warehouses', async (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    try {
        const rows = await dbQuery('SELECT * FROM stock_warehouses WHERE company_id = $1 ORDER BY name', [companyId]);
        res.json(rows || []);
    } catch (err) {
        return res.status(500).json({ error: "Failed to fetch warehouses." });
    }
});

router.post('/warehouses', async (req, res) => {
    const companyId = req.user.active_company_id;
    const { name } = req.body;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!name) return res.status(400).json({ error: "Warehouse name is required." });
    try {
        const result = await dbQuery('INSERT INTO stock_warehouses (company_id, name) VALUES ($1, $2) RETURNING id', [companyId, name]);
        res.status(201).json({ id: result[0].id, name: name });
    } catch (err) {
        return res.status(500).json({ error: "Failed to create warehouse.", details: err.message });
    }
});

// --- Stock Item Routes ---
router.get('/items', async (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });

    const sql = `
        SELECT i.*, u.name as unit_name,
        (i.opening_qty + COALESCE((SELECT SUM(vi.quantity) FROM voucher_inventory_entries vi WHERE vi.item_id = i.id), 0)) as current_stock
        FROM stock_items i
        JOIN stock_units u ON i.unit_id = u.id
        WHERE i.company_id = $1
        ORDER BY i.name
    `;
    // NOTE: SQLite IFNULL changed to PG COALESCE
    try {
        const rows = await dbQuery(sql, [companyId]);
        res.json(rows || []);
    } catch (err) {
        return res.status(500).json({ error: "Failed to fetch stock items.", details: err.message });
    }
});

router.post('/items', async (req, res) => {
    const companyId = req.user.active_company_id;
    const { name, unit_id, gst_rate, opening_qty, opening_rate } = req.body;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!name || !unit_id) return res.status(400).json({ error: "Item name and unit are required." });

    const sql = `INSERT INTO stock_items (company_id, name, unit_id, gst_rate, opening_qty, opening_rate) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`;
    try {
        const result = await dbQuery(sql, [companyId, name, unit_id, gst_rate || 0, opening_qty || 0, opening_rate || 0]);
        res.status(201).json({ id: result[0].id, message: "Stock item created." });
    } catch (err) {
        return res.status(500).json({ error: "Failed to create stock item.", details: err.message });
    }
});

router.put('/items/:id', async (req, res) => {
    const companyId = req.user.active_company_id;
    const itemId = req.params.id;
    const { name, unit_id, gst_rate } = req.body;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!name || !unit_id) return res.status(400).json({ error: "Item name and unit are required." });
    
    const sql = `UPDATE stock_items SET name = $1, unit_id = $2, gst_rate = $3 WHERE id = $4 AND company_id = $5`;
    try {
        const result = await dbQuery(sql, [name, unit_id, gst_rate || 0, itemId, companyId]);
        if (result.rowCount === 0) return res.status(404).json({ error: "Stock item not found or no changes made." });
        res.json({ message: "Stock item updated." });
    } catch (err) {
        return res.status(500).json({ error: "Failed to update stock item.", details: err.message });
    }
});

module.exports = router;