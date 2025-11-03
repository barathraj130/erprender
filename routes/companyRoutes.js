// routes/companyRoutes.js (This is the NEW, correct content)
const express = require('express');
const router = express.Router();
const db = require('../db');

// This route is for the frontend to fetch the company profile for editing.
router.get('/:id', (req, res) => {
    const companyId = req.user.active_company_id;
    // Security check: A user can only get their own active company's details.
    if (parseInt(req.params.id) !== companyId) {
        return res.status(403).json({ error: 'Forbidden: You can only access your active company profile.' });
    }
    db.get('SELECT * FROM companies WHERE id = ?', [companyId], (err, row) => {
        if (err) return res.status(500).json({ error: "Failed to fetch company profile: " + err.message });
        if (!row) return res.status(404).json({ error: 'Company not found.' });
        res.json(row);
    });
});

// This route handles the "Save Company Profile" button click.
router.put('/:id', (req, res) => {
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
            company_name = ?, gstin = ?, address_line1 = ?, city_pincode = ?, 
            state = ?, phone = ?, email = ?, bank_name = ?, 
            bank_account_no = ?, bank_ifsc_code = ?
        WHERE id = ?`;

    const params = [
        company_name, gstin, address_line1, city_pincode, state, phone, email,
        bank_name, bank_account_no, bank_ifsc_code, companyIdFromToken
    ];

    db.run(sql, params, function(err) {
        if (err) {
            console.error("Error updating company profile:", err.message);
            return res.status(500).json({ error: 'Failed to update company profile.' });
        }
        res.json({ message: 'Company profile updated successfully.' });
    });
});

module.exports = router;