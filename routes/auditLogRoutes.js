// routes/auditLogRoutes.js
console.log("<<<<< DEBUG: routes/auditLogRoutes.js is being loaded (placeholder) >>>>>");

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
        // PostgreSQL returns rows in result.rows
        return result.rows;
    } catch (e) {
        console.error("PG Query Error:", e.message, "SQL:", sql, "Params:", params);
        throw e;
    } finally {
        if (client) client.release();
    }
}
router.get('/', async (req, res) => {
    console.log("<<<<< DEBUG: GET /api/auditlog - Placeholder route hit >>>>>");
    const sql = 'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 100';
    
    try {
        const rows = await dbQuery(sql);
        res.json(rows || []);
    } catch (err) {
        console.error("Error fetching audit logs:", err.message);
        return res.status(500).json({ error: "Failed to fetch audit logs." });
    }
});

console.log("<<<<< DEBUG: routes/auditLogRoutes.js - router object:", typeof router, router ? Object.keys(router) : 'router is null/undefined' ,">>>>>");
module.exports = router;