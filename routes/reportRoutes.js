// routes/reportRoutes.js
const express = require('express');
const router = express.Router();
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
// --- Helper function to calculate ledger closing balances (Async PG version) ---
async function getLedgerClosingBalances(companyId, endDate) {
    const sql = `
        SELECT
            l.id as ledger_id,
            l.name as ledger_name,
            lg.id as group_id,
            lg.name as group_name,
            lg.nature,
            l.opening_balance,
            l.is_dr as isOpeningDr,
            COALESCE(SUM(ve.debit), 0) as total_debit,
            COALESCE(SUM(ve.credit), 0) as total_credit
        FROM ledgers l
        JOIN ledger_groups lg ON l.group_id = lg.id
        LEFT JOIN voucher_entries ve ON l.id = ve.ledger_id
        LEFT JOIN vouchers v ON ve.voucher_id = v.id AND v.date <= $1
        WHERE l.company_id = $2
        GROUP BY l.id, l.name, lg.id, lg.name, lg.nature, l.opening_balance, l.is_dr
        ORDER BY lg.name, l.name
    `;

    const rows = await dbQuery(sql, [endDate, companyId]);

    const closingBalances = (rows || []).map(row => {
        // PG boolean is 't'/'f' or true/false, accessed directly as boolean if not using client.query
        const isOpeningDr = row.isopeningdr === true || row.isopeningdr === 't' || row.isopeningdr === 1;
        
        const opening = parseFloat(row.opening_balance) * (isOpeningDr ? 1 : -1); // Debit is positive
        const netChange = parseFloat(row.total_debit) - parseFloat(row.total_credit);
        const closing = opening + netChange;
        
        return {
            ...row,
            isOpeningDr,
            closing_balance: closing
        };
    });
    return closingBalances;
}


// --- Main Report Endpoints ---

// GET /api/reports/trial-balance?endDate=YYYY-MM-DD
router.get('/trial-balance', async (req, res) => {
    const companyId = req.user.active_company_id;
    const { endDate } = req.query;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!endDate) return res.status(400).json({ error: "End date is required." });

    try {
        const balances = await getLedgerClosingBalances(companyId, endDate);
        
        let totalDebit = 0;
        let totalCredit = 0;
        const reportData = balances.map(item => {
            const closing = item.closing_balance;
            const debit = closing > 0 ? closing : 0;
            const credit = closing < 0 ? -closing : 0;
            totalDebit += debit;
            totalCredit += credit;
            return {
                ledger_name: item.ledger_name,
                group_name: item.group_name,
                debit: debit.toFixed(2),
                credit: credit.toFixed(2)
            };
        });

        res.json({
            reportData,
            totals: {
                debit: totalDebit.toFixed(2),
                credit: totalCredit.toFixed(2)
            }
        });
    } catch (err) {
        return res.status(500).json({ error: "Failed to calculate trial balance.", details: err.message });
    }
});

// GET /api/reports/pnl?startDate=...&endDate=...
router.get('/pnl', async (req, res) => {
    const companyId = req.user.active_company_id;
    const { startDate, endDate } = req.query;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!startDate || !endDate) return res.status(400).json({ error: "Start date and end date are required." });
    
    // Converted to PG syntax (COALESCE, $1, $2, $3 placeholders)
    const sql = `
        SELECT
            l.name as ledger_name,
            lg.name as group_name,
            lg.nature,
            COALESCE(SUM(ve.debit), 0) - COALESCE(SUM(ve.credit), 0) as net_change
        FROM ledgers l
        JOIN ledger_groups lg ON l.group_id = lg.id
        LEFT JOIN voucher_entries ve ON l.id = ve.ledger_id
        LEFT JOIN vouchers v ON ve.voucher_id = v.id AND v.date BETWEEN $1 AND $2
        WHERE l.company_id = $3 AND lg.nature IN ('Income', 'Expense')
        GROUP BY l.id, l.name, lg.name, lg.nature
        HAVING COALESCE(SUM(ve.debit), 0) - COALESCE(SUM(ve.credit), 0) != 0
    `;

    try {
        const rows = await dbQuery(sql, [startDate, endDate, companyId]);
        
        let totalIncome = 0;
        let totalExpense = 0;
        
        const incomeItems = [];
        const expenseItems = [];

        (rows || []).forEach(row => {
            const netChange = parseFloat(row.net_change);
            if (row.nature === 'Income') {
                const income = -netChange; // Income ledgers have credit balances (negative net)
                totalIncome += income;
                incomeItems.push({ name: row.ledger_name, amount: income.toFixed(2) });
            } else if (row.nature === 'Expense') {
                const expense = netChange; // Expense ledgers have debit balances (positive net)
                totalExpense += expense;
                expenseItems.push({ name: row.ledger_name, amount: expense.toFixed(2) });
            }
        });

        const netProfit = totalIncome - totalExpense;

        res.json({
            income: { items: incomeItems, total: totalIncome.toFixed(2) },
            expense: { items: expenseItems, total: totalExpense.toFixed(2) },
            netProfit: { amount: netProfit.toFixed(2), status: netProfit >= 0 ? 'Profit' : 'Loss' }
        });
    } catch (err) {
        return res.status(500).json({ error: "Failed to generate P&L statement.", details: err.message });
    }
});

// GET /api/reports/balance-sheet?endDate=...
router.get('/balance-sheet', async (req, res) => {
    const companyId = req.user.active_company_id;
    const { endDate } = req.query;

    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    if (!endDate) return res.status(400).json({ error: "End date is required." });

    try {
        // Step 1: Get closing balances for all ledgers
        const balances = await getLedgerClosingBalances(companyId, endDate);

        // Step 2: Calculate Profit/Loss for the period (simplified P&L)
        const pnlSql = `
            SELECT
                lg.nature,
                COALESCE(SUM(ve.debit), 0) - COALESCE(SUM(ve.credit), 0) as net_change
            FROM ledgers l
            JOIN ledger_groups lg ON l.group_id = lg.id
            LEFT JOIN voucher_entries ve ON l.id = ve.ledger_id
            LEFT JOIN vouchers v ON ve.voucher_id = v.id AND v.date <= $1 
            WHERE l.company_id = $2 AND lg.nature IN ('Income', 'Expense')
            GROUP BY lg.nature
        `;
        const pnlRows = await dbQuery(pnlSql, [endDate, companyId]);
        
        let totalIncome = 0;
        let totalExpense = 0;
        (pnlRows || []).forEach(row => {
            if(row.nature === 'Income') totalIncome = -parseFloat(row.net_change);
            if(row.nature === 'Expense') totalExpense = parseFloat(row.net_change);
        });
        const netProfit = totalIncome - totalExpense;

        // Step 3: Assemble the Balance Sheet
        let totalAssets = 0;
        let totalLiabilities = 0;
        const assetItems = [];
        const liabilityItems = [];

        balances.forEach(item => {
            if (item.nature === 'Asset') {
                const balance = item.closing_balance;
                if (Math.abs(balance) > 0.001) {
                    totalAssets += balance;
                    assetItems.push({ name: item.ledger_name, amount: balance.toFixed(2) });
                }
            } else if (item.nature === 'Liability') {
                const balance = -item.closing_balance; // Liabilities have credit balances
                if (Math.abs(balance) > 0.001) {
                    totalLiabilities += balance;
                    liabilityItems.push({ name: item.ledger_name, amount: balance.toFixed(2) });
                }
            }
        });

        // Add P&L to liabilities side
        liabilityItems.push({ name: 'Profit & Loss A/c', amount: netProfit.toFixed(2) });
        totalLiabilities += netProfit;

        res.json({
            assets: { items: assetItems, total: totalAssets.toFixed(2) },
            liabilities: { items: liabilityItems, total: totalLiabilities.toFixed(2) }
        });
    } catch (err) {
        return res.status(500).json({ error: "Failed to generate balance sheet.", details: err.message });
    }
});

// POST /api/reports/export - Generic export to CSV (JS Only)
router.post('/export', async (req, res) => {
    const { reportType, data, totals } = req.body;
    if (!reportType || !data) {
        return res.status(400).json({ error: "Report type and data are required." });
    }

    try {
        let csv = '';
        if (data.length > 0) {
            const headers = Object.keys(data[0]).join(',');
            const rows = data.map(row => Object.values(row).join(',')).join('\n');
            csv = `${headers}\n${rows}`;
        }

        if (totals) {
            csv += '\n\nTotals,';
            csv += Object.values(totals).join(',');
        }

        res.header('Content-Type', 'text/csv');
        res.attachment(`${reportType}_export.csv`);
        res.send(csv);
    } catch (error) {
        res.status(500).json({ error: "Failed to generate CSV.", details: error.message });
    }
});

module.exports = router;