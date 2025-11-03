console.log("<<<<< DEBUG: routes/auditLogRoutes.js is being loaded (placeholder) >>>>>");

const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
    console.log("<<<<< DEBUG: GET /api/auditlog - Placeholder route hit >>>>>");
    db.all('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 100', [], (err, rows) => {
        if (err) {
            console.error("Error fetching audit logs:", err.message);
            return res.status(500).json({ error: "Failed to fetch audit logs." });
        }
        res.json(rows || []);
    });
});

console.log("<<<<< DEBUG: routes/auditLogRoutes.js - router object:", typeof router, router ? Object.keys(router) : 'router is null/undefined' ,">>>>>");
module.exports = router;