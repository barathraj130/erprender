const express = require('express');
const router = express.Router();
const googleSheetService = require('../services/googleSheetService');

router.post('/google-sheets', async (req, res) => {
    try {
        const companyId = req.user.active_company_id;
        if (!companyId) {
            return res.status(400).json({ error: "No active company selected." });
        }
        
        console.log(`[API Import] Starting Google Sheets import for company ID: ${companyId}`);
        const summary = await googleSheetService.importAllSheetsData(companyId);

        res.json({ message: "Import process completed successfully!", summary });

    } catch (error) {
        console.error("❌ [API Import] Error during Google Sheets import process:", error);
        res.status(500).json({ error: "An error occurred during the import.", details: error.message });
    }
});

module.exports = router;