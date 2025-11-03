// routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/notifications - Fetch unread notifications for the logged-in user
// For now, we will fetch all global (user_id IS NULL) unread notifications.
router.get('/', (req, res) => {
    const sql = `
        SELECT * FROM notifications 
        WHERE (user_id IS NULL OR user_id = ?) AND is_read = 0 
        ORDER BY created_at DESC
    `;
    // req.user.id is available from our auth middleware
    db.all(sql, [req.user.id], (err, rows) => {
        if (err) {
            console.error("Error fetching notifications:", err.message);
            return res.status(500).json({ error: 'Failed to fetch notifications.' });
        }
        res.json(rows || []);
    });
});

// PUT /api/notifications/mark-as-read - Mark specific notifications as read
router.put('/mark-as-read', (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'An array of notification IDs is required.' });
    }

    // Create placeholders for the query: (?, ?, ?)
    const placeholders = ids.map(() => '?').join(',');
    const sql = `UPDATE notifications SET is_read = 1 WHERE id IN (${placeholders})`;

    db.run(sql, ids, function(err) {
        if (err) {
            console.error("Error marking notifications as read:", err.message);
            return res.status(500).json({ error: 'Failed to update notifications.' });
        }
        res.json({ message: `${this.changes} notifications marked as read.` });
    });
});

module.exports = router;