// routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db'); // <-- PG FIX: Import pool

// Paste this near the top of every route file:
async function dbQuery(sql, params = []) {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(sql, params);
        // PG returns rows; we need to check rowCount for mutation success
        const rows = result.rows;
        rows.rowCount = result.rowCount; 
        return rows;
    } catch (e) {
        console.error("PG Query Error:", e.message, "SQL:", sql, "Params:", params);
        throw e;
    } finally {
        if (client) client.release();
    }
}
// GET /api/notifications - Fetch unread notifications for the logged-in user
// For now, we will fetch all global (user_id IS NULL) unread notifications.
router.get('/', async (req, res) => {
    const userId = req.user.id;
    const sql = `
        SELECT * FROM notifications 
        WHERE (user_id IS NULL OR user_id = $1) AND is_read = FALSE 
        ORDER BY created_at DESC
    `;
    // req.user.id is available from our auth middleware
    try {
        const rows = await dbQuery(sql, [userId]);
        res.json(rows || []);
    } catch (err) {
        console.error("Error fetching notifications:", err.message);
        return res.status(500).json({ error: 'Failed to fetch notifications.' });
    }
});

// PUT /api/notifications/mark-as-read - Mark specific notifications as read
router.put('/mark-as-read', async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'An array of notification IDs is required.' });
    }
    
    // PG requires parameterized lists using UNNEST or explicit array handling.
    // For simplicity with an existing framework, we use standard $1, $2, ... placeholders for IN clause.
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const sql = `UPDATE notifications SET is_read = TRUE WHERE id IN (${placeholders})`;

    try {
        const result = await dbQuery(sql, ids);
        // PG mutation returns rows with rowCount property
        res.json({ message: `${result.rowCount} notifications marked as read.` });
    } catch (err) {
        console.error("Error marking notifications as read:", err.message);
        return res.status(500).json({ error: 'Failed to update notifications.' });
    }
});

module.exports = router;