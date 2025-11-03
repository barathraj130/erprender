// --- START OF FULL FILE businessAgreementRoutes.js ---
const express = require('express');
const router = express.Router();
// --- PG FIX: Import pool for helper function ---
const { pool } = require('../db'); 

// Wrapper for queries
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

router.get('/', async (req, res) => {
    console.log('[API] GET /api/business-agreements request received.');
    const sql = `
        SELECT ba.id as agreement_id, ba.agreement_type, ba.total_amount, ba.start_date, ba.details, ba.lender_id,
               ba.interest_rate,
               l.lender_name
        FROM business_agreements ba
        LEFT JOIN lenders l ON ba.lender_id = l.id
        ORDER BY ba.start_date DESC, ba.id DESC
    `;
    
    try {
        const rows = await dbQuery(sql);
        
        if (!rows || rows.length === 0) {
            return res.json([]);
        }

        const agreementsWithCalculations = [];
        for (const agreement of rows) {
            let result = { ...agreement };

            // --- Regex parsing for EMI/Duration (Remains purely JS logic) ---
            if (agreement.details) {
                const emiMatch = agreement.details.match(/EMI:?\s*₹?([\d,.]+)/i);
                if (emiMatch && emiMatch[1]) {
                    result.emi_amount = parseFloat(emiMatch[1].replace(/,/g, ''));
                }
                const durationMatch = agreement.details.match(/(\d+)\s+months?/i);
                if (durationMatch && durationMatch[1]) {
                    result.duration_months = parseInt(durationMatch[1], 10);
                }
            }
            
            if (agreement.agreement_type === 'loan_taken_by_biz' || agreement.agreement_type === 'loan_given_by_biz') {
                
                let principal_repayment_category_like = '';
                let interest_payment_category_like = '';

                if (agreement.agreement_type === 'loan_taken_by_biz') {
                    principal_repayment_category_like = 'Loan Principal Repaid by Business%';
                    interest_payment_category_like = 'Loan Interest Paid by Business%';
                } else { // loan_given_by_biz
                    principal_repayment_category_like = 'Loan Repayment Received from Customer%';
                    interest_payment_category_like = 'Interest on Customer Loan Received%';
                }
                
                try {
                    // PG Query for all payments related to this agreement
                    const paymentsSql = `
                        SELECT amount, date, category 
                        FROM transactions 
                        WHERE agreement_id = $1 
                          AND (category LIKE $2 OR category LIKE $3) 
                        ORDER BY date ASC
                    `;
                    const allPayments = await dbQuery(paymentsSql, [
                        agreement.agreement_id, 
                        principal_repayment_category_like, 
                        interest_payment_category_like
                    ]);

                    const principalPayments = allPayments.filter(p => p.category.startsWith(principal_repayment_category_like.replace('%', '')));
                    const interestPayments = allPayments.filter(p => p.category.startsWith(interest_payment_category_like.replace('%', '')));
                    
                    let principalPaidOrReceived = principalPayments.reduce((sum, p) => sum + Math.abs(parseFloat(p.amount)), 0);
                    let interestPaidOrReceived = interestPayments.reduce((sum, p) => sum + Math.abs(parseFloat(p.amount)), 0);
                    
                    let outstandingPrincipal = parseFloat(agreement.total_amount || 0) - principalPaidOrReceived;

                    let total_accrued_interest = 0;
                    const monthly_breakdown = [];

                    // --- Interest Calculation Logic (Pure JS, remains the same) ---
                    // SCENARIO 1: Explicit interest rate is given. 
                    if (parseFloat(agreement.interest_rate) > 0) {
                        // ... (same calculation logic as before) ...
                        const monthlyRate = parseFloat(agreement.interest_rate) / 100;
                        let currentPrincipalForInterestCalc = parseFloat(agreement.total_amount || 0);
                        let loopDate = new Date(agreement.start_date);
                        const endDate = new Date();

                        while (loopDate <= endDate) {
                            const monthStr = `${loopDate.getFullYear()}-${String(loopDate.getMonth() + 1).padStart(2, '0')}`;
                            const interestDueThisMonth = currentPrincipalForInterestCalc * monthlyRate;
                            total_accrued_interest += interestDueThisMonth;
                            monthly_breakdown.push({ month: monthStr, interest_due: parseFloat(interestDueThisMonth.toFixed(2)), status: 'Pending' });

                            const principalPaymentsThisMonth = principalPayments.filter(p => new Date(p.date).toISOString().startsWith(monthStr));
                            principalPaymentsThisMonth.forEach(p => { currentPrincipalForInterestCalc -= Math.abs(parseFloat(p.amount)); });
                            loopDate.setMonth(loopDate.getMonth() + 1);
                        }
                    } 
                    // SCENARIO 2: No interest rate, but EMI details exist.
                    else if (result.emi_amount && result.duration_months) {
                         // ... (same calculation logic as before) ...
                        let principal = parseFloat(agreement.total_amount || 0);
                        const totalRepayment = result.emi_amount * result.duration_months;
                        
                        if (Math.abs(principal - totalRepayment) < 1.0) {
                            const assumedMonthlyRate = 0.015; 
                            const n = result.duration_months;
                            const r = assumedMonthlyRate;
                            const emi = result.emi_amount;
                            const calculatedPrincipal = emi * ((1 - Math.pow(1 + r, -n)) / r);
                            principal = calculatedPrincipal; 
                            outstandingPrincipal = principal - principalPaidOrReceived; 
                        }
                        
                        const totalInterestOverLoanTerm = totalRepayment - principal;
                        const interestPerMonth = (totalInterestOverLoanTerm > 0 && result.duration_months > 0) 
                                               ? totalInterestOverLoanTerm / result.duration_months 
                                               : 0;
                        
                        if (interestPerMonth > 0) {
                             let loopDate = new Date(agreement.start_date);
                             const endDate = new Date();
                             while (loopDate <= endDate && monthly_breakdown.length < result.duration_months) {
                                const monthStr = `${loopDate.getFullYear()}-${String(loopDate.getMonth() + 1).padStart(2, '0')}`;
                                total_accrued_interest += interestPerMonth;
                                monthly_breakdown.push({ month: monthStr, interest_due: parseFloat(interestPerMonth.toFixed(2)), status: 'Pending' });
                                loopDate.setMonth(loopDate.getMonth() + 1);
                            }
                        }
                    }

                    // Update status for all breakdown items based on payments
                    monthly_breakdown.forEach(item => {
                        if (interestPayments.some(p => new Date(p.date).toISOString().startsWith(item.month))) {
                            item.status = 'Paid';
                        } else if (new Date() > new Date(item.month + '-01T23:59:59')) {
                             item.status = 'Skipped';
                        }
                    });

                    const interest_payable_or_receivable = total_accrued_interest - interestPaidOrReceived;

                    result.outstanding_principal = parseFloat(outstandingPrincipal.toFixed(2));
                    result.interest_payable = parseFloat(interest_payable_or_receivable.toFixed(2));
                    result.calculated_principal_paid = parseFloat(principalPaidOrReceived.toFixed(2));
                    result.calculated_interest_paid = parseFloat(interestPaidOrReceived.toFixed(2));
                    result.monthly_breakdown = monthly_breakdown;

                } catch (calcError) {
                    console.error(`Error calculating details for agreement ${agreement.agreement_id}:`, calcError);
                    result.outstanding_principal = parseFloat(agreement.total_amount || 0);
                    result.interest_payable = 0;
                    result.calculated_principal_paid = 0;
                    result.calculated_interest_paid = 0;
                    result.monthly_breakdown = [];
                }
            }
            agreementsWithCalculations.push(result);
        }

        res.json(agreementsWithCalculations);
    } catch (err) {
        console.error("❌ [API PG Error] Error fetching business agreements:", err.message);
        return res.status(500).json({ error: "Database error while fetching business agreements.", details: err.message });
    }
});

router.post('/', async (req, res) => {
    console.log('[API] POST /api/business-agreements request received. Body:', req.body);
    const { lender_id, agreement_type, total_amount, start_date, details, interest_rate } = req.body;
    
    if (!lender_id || !agreement_type || total_amount === undefined || total_amount === null || !start_date) {
        return res.status(400).json({ error: 'Missing required fields: lender, type, total amount, and start date are required.' });
    }
    const parsedAmount = parseFloat(total_amount);
    if (isNaN(parsedAmount)) {
        return res.status(400).json({ error: 'Total amount must be a valid number.' });
    }
    const parsedInterestRate = (agreement_type.includes('loan') && interest_rate !== undefined) ? parseFloat(interest_rate) : 0;
    if (isNaN(parsedInterestRate) || parsedInterestRate < 0) {
        return res.status(400).json({ error: 'Interest rate must be a valid non-negative number if provided for a loan.' });
    }

    const sql = `INSERT INTO business_agreements (lender_id, agreement_type, total_amount, start_date, details, interest_rate)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`;
    const params = [lender_id, agreement_type, parsedAmount, start_date, details, parsedInterestRate];

    try {
        const insertResult = await dbQuery(sql, params);
        const newAgreementId = insertResult[0].id;
        
        // Fetch the newly created agreement to send back to the client
        const fetchSql = `
            SELECT ba.id as agreement_id, ba.*, l.lender_name 
            FROM business_agreements ba 
            JOIN lenders l ON ba.lender_id = l.id 
            WHERE ba.id = $1`;
        
        const newAgreement = await dbQuery(fetchSql, [newAgreementId]).then(rows => rows[0]);

        if (!newAgreement) {
            console.error("❌ [API Logic Error] Newly created agreement not found by ID:", newAgreementId);
            return res.status(201).json({ id: newAgreementId, message: 'Business agreement created (but not found immediately after).' });
        }
        
        console.log("✅ [API DB Success] Successfully created and fetched business agreement:", newAgreement);
        res.status(201).json({ 
            agreement: newAgreement, 
            message: 'Business agreement created successfully.' 
        });

    } catch (err) {
        console.error("❌ [API PG Error] Error creating business agreement:", err.message);
        return res.status(500).json({ error: "Failed to create business agreement: " + err.message });
    }
});

// --- NEW ROUTE TO HANDLE ONBOARDING OF EXISTING LOANS (Simplified for PG, removing db.serialize) ---
router.post('/existing', async (req, res) => {
    console.log('[API] POST /api/business-agreements/existing request received. Body:', req.body);
    const { lender_id, original_amount, current_balance, start_date, last_paid_date, interest_rate, details } = req.body;
    const companyId = req.user.active_company_id;

    if (!lender_id || current_balance === undefined || !start_date || !last_paid_date) {
        return res.status(400).json({ error: 'Missing required fields for existing loan.' });
    }

    const parsedCurrentBalance = parseFloat(current_balance);
    const parsedInterestRate = parseFloat(interest_rate) || 0;

    if (isNaN(parsedCurrentBalance) || isNaN(parsedInterestRate)) {
        return res.status(400).json({ error: 'Amounts and interest rate must be valid numbers.' });
    }
    
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Create Agreement
        const agreementSql = `INSERT INTO business_agreements (company_id, lender_id, agreement_type, total_amount, start_date, details, interest_rate)
                              VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`;
        const agreementParams = [companyId, lender_id, 'loan_taken_by_biz', parsedCurrentBalance, start_date, details, parsedInterestRate];
        const agreementResult = await client.query(agreementSql, agreementParams);
        const newAgreementId = agreementResult.rows[0].id;

        // 2. Create Initial Transaction
        const initialFundsTxSql = `INSERT INTO transactions (company_id, agreement_id, lender_id, amount, description, category, date)
                                   VALUES ($1, $2, $3, $4, $5, $6, $7)`;
        const txDesc = `Onboarding existing loan balance for agreement #${newAgreementId}. Original Amount: ${original_amount || 'N/A'}`;
        const txCategory = 'Loan Received by Business (to Bank)'; 
        const txParams = [companyId, newAgreementId, lender_id, parsedCurrentBalance, txDesc, txCategory, start_date];

        await client.query(initialFundsTxSql, txParams);

        await client.query('COMMIT');
        res.status(201).json({ message: `Existing loan with balance of ₹${parsedCurrentBalance.toFixed(2)} recorded successfully.` });

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error("❌ [API PG Error] Error onboarding existing loan:", err.message);
        return res.status(500).json({ error: "Failed to onboard existing loan: " + err.message });
    } finally {
        if (client) client.release();
    }
});


router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { lender_id, agreement_type, total_amount, start_date, details, interest_rate } = req.body;
    
    if (!lender_id || !agreement_type || total_amount === undefined || total_amount === null || !start_date) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }
    const parsedAmount = parseFloat(total_amount);
    if (isNaN(parsedAmount)) { return res.status(400).json({ error: 'Total amount must be a valid number.' }); }
    
    const parsedInterestRate = (agreement_type.includes('loan') && interest_rate !== undefined) ? parseFloat(interest_rate) : 0;
    if (isNaN(parsedInterestRate) || parsedInterestRate < 0) {
        return res.status(400).json({ error: 'Interest rate must be a valid non-negative number if provided for a loan.' });
    }

    const sql = `UPDATE business_agreements SET lender_id = $1, agreement_type = $2, total_amount = $3, start_date = $4, details = $5, interest_rate = $6 WHERE id = $7`;
    const params = [lender_id, agreement_type, parsedAmount, start_date, details, parsedInterestRate, id];
    
    try {
        const result = await dbQuery(sql, params);
        if (result.rowCount === 0) { return res.status(404).json({ message: 'Business agreement not found.' }); }
        
        res.json({ message: 'Business agreement updated successfully. Details will refresh on next load.' });
    } catch (err) {
        console.error("Error updating business agreement:", err.message);
        return res.status(500).json({ error: "Failed to update business agreement: " + err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const sql = 'DELETE FROM business_agreements WHERE id = $1';
        const result = await dbQuery(sql, [id]);

        if (result.rowCount === 0) { return res.status(404).json({ message: 'Business agreement not found.' }); }
        
        res.json({ message: 'Business agreement deleted successfully.' });
    } catch (err) {
        console.error("Error deleting business agreement:", err.message);
        return res.status(500).json({ error: "Failed to delete business agreement: " + err.message });
    }
});

module.exports = router;