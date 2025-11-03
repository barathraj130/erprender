const express = require('express');
const router = express.Router();
const googleSheetService = require('../services/googleSheetService');
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
router.post('/google-sheets', async (req, res) => {
    try {
        const companyId = req.user.active_company_id;
        if (!companyId) {
            return res.status(400).json({ error: "No active company selected." });
        }
        
        console.log(`[API Import] Starting Google Sheets import for company ID: ${companyId}`);
        // NOTE: The googleSheetService functions (findOrCreateEntity/Party) MUST also be updated 
        // to use dbQuery/PG syntax to work correctly here. (Assuming that service file is next/updated)
        const summary = await googleSheetService.importAllSheetsData(companyId);

        res.json({ message: "Import process completed successfully!", summary });

    } catch (error) {
        console.error("❌ [API Import] Error during Google Sheets import process:", error);
        res.status(500).json({ error: "An error occurred during the import.", details: error.message });
    }
});

module.exports = router;