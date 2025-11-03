// routes/companyRoutes.js
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
// This route is for the frontend to fetch the company profile for editing.
router.get('/:id', async (req, res) => {
    const companyId = req.user.active_company_id;
    // Security check: A user can only get their own active company's details.
    if (parseInt(req.params.id) !== companyId) {
        return res.status(403).json({ error: 'Forbidden: You can only access your active company profile.' });
    }
    try {
        const rows = await dbQuery('SELECT * FROM companies WHERE id = $1', [companyId]);
        const row = rows[0];
        if (!row) return res.status(404).json({ error: 'Company not found.' });
        res.json(row);
    } catch (err) {
        return res.status(500).json({ error: "Failed to fetch company profile: " + err.message });
    }
});

// This route handles the "Save Company Profile" button click.
router.put('/:id', async (req, res) => {
    const companyIdFromToken = req.user.active_company_id;
    const companyIdFromParams = parseInt(req.params.id);

    // Security check: A user can only update their own active company.
    if (companyIdFromParams !== companyIdFromToken) {
        return res.status(403).json({ error: 'Forbidden: You can only update your active company profile.' });
    }

    const {
        company_name, gstin, address_line1, city_pincode, state, phone, email,
        bank_name, bank_account_no, bank_ifsc_code
    } = req.body;

    if (!company_name) {
        return res.status(400).json({ error: 'Company name is required.' });
    }

    const sql = `
        UPDATE companies SET 
            company_name = $1, gstin = $2, address_line1 = $3, city_pincode = $4, 
            state = $5, phone = $6, email = $7, bank_name = $8, 
            bank_account_no = $9, bank_ifsc_code = $10
        WHERE id = $11`;

    const params = [
        company_name, gstin, address_line1, city_pincode, state, phone, email,
        bank_name, bank_account_no, bank_ifsc_code, companyIdFromToken
    ];

    try {
        const result = await dbQuery(sql, params);
        // In PG, UPDATE returns affected rows count, which is in result.rowCount
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Company not found or no changes made.' });
        }
        res.json({ message: 'Company profile updated successfully.' });
    } catch (err) {
        console.error("Error updating company profile:", err.message);
        return res.status(500).json({ error: 'Failed to update company profile.' });
    }
});

module.exports = router;