// --- START OF FULL FILE businessAgreementRoutes.js ---
const express = require('express');
const router = express.Router();
const db = require('../db');

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
    db.all(sql, [], async (err, rows) => {
        if (err) {
            console.error("❌ [API DB Error] Error fetching business agreements from DB:", err.message);
            return res.status(500).json({ error: "Database error while fetching business agreements.", details: err.message });
        }
        
        if (!rows || rows.length === 0) {
            return res.json([]);
        }

        const agreementsWithCalculations = [];
        for (const agreement of rows) {
            let result = { ...agreement };

            // --- FIX: Using more robust, independent Regex for parsing ---
            if (agreement.details) {
                // Looks for "EMI", optional colon/space/currency, then captures the number.
                const emiMatch = agreement.details.match(/EMI:?\s*₹?([\d,.]+)/i);
                if (emiMatch && emiMatch[1]) {
                    result.emi_amount = parseFloat(emiMatch[1].replace(/,/g, ''));
                }
                // Looks for a number followed by "month" or "months".
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
                    const allPayments = await new Promise((resolve, reject) => {
                        const sql = `
                            SELECT amount, date, category 
                            FROM transactions 
                            WHERE agreement_id = ? 
                              AND (category LIKE ? OR category LIKE ?) 
                            ORDER BY date ASC
                        `;
                        db.all(sql, [agreement.agreement_id, principal_repayment_category_like, interest_payment_category_like], (err, p_rows) => {
                            if (err) reject(err);
                            else resolve(p_rows || []);
                        });
                    });

                    const principalPayments = allPayments.filter(p => p.category.startsWith(principal_repayment_category_like.replace('%', '')));
                    const interestPayments = allPayments.filter(p => p.category.startsWith(interest_payment_category_like.replace('%', '')));
                    
                    let principalPaidOrReceived = principalPayments.reduce((sum, p) => sum + Math.abs(p.amount), 0);
                    let interestPaidOrReceived = interestPayments.reduce((sum, p) => sum + Math.abs(p.amount), 0);
                    
                    let outstandingPrincipal = parseFloat(agreement.total_amount || 0) - principalPaidOrReceived;

                    let total_accrued_interest = 0;
                    const monthly_breakdown = [];

                    // SCENARIO 1: Explicit interest rate is given. Use it for calculation.
                    if (parseFloat(agreement.interest_rate) > 0) {
                        const monthlyRate = parseFloat(agreement.interest_rate) / 100;
                        let currentPrincipalForInterestCalc = parseFloat(agreement.total_amount || 0);
                        let loopDate = new Date(agreement.start_date);
                        const endDate = new Date();

                        while (loopDate <= endDate) {
                            const monthStr = `${loopDate.getFullYear()}-${String(loopDate.getMonth() + 1).padStart(2, '0')}`;
                            const interestDueThisMonth = currentPrincipalForInterestCalc * monthlyRate;
                            total_accrued_interest += interestDueThisMonth;
                            monthly_breakdown.push({ month: monthStr, interest_due: parseFloat(interestDueThisMonth.toFixed(2)), status: 'Pending' });

                            const principalPaymentsThisMonth = principalPayments.filter(p => p.date.startsWith(monthStr));
                            principalPaymentsThisMonth.forEach(p => { currentPrincipalForInterestCalc -= Math.abs(p.amount); });
                            loopDate.setMonth(loopDate.getMonth() + 1);
                        }
                    } 
                    // SCENARIO 2: No interest rate, but EMI details exist.
                    else if (result.emi_amount && result.duration_months) {
                        let principal = parseFloat(agreement.total_amount || 0);
                        const totalRepayment = result.emi_amount * result.duration_months;
                        
                        // HEURISTIC FIX: If entered principal is same as total repayment, it's a data error.
                        // Recalculate principal assuming a standard interest rate to derive the interest component.
                        if (Math.abs(principal - totalRepayment) < 1.0) {
                            const assumedMonthlyRate = 0.015; // Assume 1.5% per month (18% p.a.)
                            const n = result.duration_months;
                            const r = assumedMonthlyRate;
                            const emi = result.emi_amount;
                            const calculatedPrincipal = emi * ((1 - Math.pow(1 + r, -n)) / r);
                            principal = calculatedPrincipal; 
                            outstandingPrincipal = principal - principalPaidOrReceived; // Recalculate outstanding based on new principal
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
                        if (interestPayments.some(p => p.date.startsWith(item.month))) {
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
    });
});

router.post('/', (req, res) => {
    console.log('[API] POST /api/business-agreements request received. Body:', req.body);
    const { lender_id, agreement_type, total_amount, start_date, details, interest_rate } = req.body;
    if (!lender_id || !agreement_type || total_amount === undefined || total_amount === null || !start_date) {
        return res.status(400).json({ error: 'Missing required fields: lender, type, total amount, and start date are required.' });
    }
    if (isNaN(parseFloat(total_amount))) {
        return res.status(400).json({ error: 'Total amount must be a valid number.' });
    }
    const parsedInterestRate = (agreement_type.includes('loan') && interest_rate !== undefined) ? parseFloat(interest_rate) : 0;
    if (isNaN(parsedInterestRate) || parsedInterestRate < 0) {
        return res.status(400).json({ error: 'Interest rate must be a valid non-negative number if provided for a loan.' });
    }

    const sql = `INSERT INTO business_agreements (lender_id, agreement_type, total_amount, start_date, details, interest_rate)
                 VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(sql, [lender_id, agreement_type, parseFloat(total_amount), start_date, details, parsedInterestRate], function(err) {
        if (err) {
            console.error("❌ [API DB Error] Error creating business agreement:", err.message);
            return res.status(500).json({ error: "Failed to create business agreement: " + err.message });
        }
        const newAgreementId = this.lastID;
        // Fetch the newly created agreement to send back to the client
        db.get(`SELECT ba.id as agreement_id, ba.*, l.lender_name 
                FROM business_agreements ba 
                JOIN lenders l ON ba.lender_id = l.id 
                WHERE ba.id = ?`, [newAgreementId], (fetchErr, newAgreement) => {
            if (fetchErr) {
                 console.error("❌ [API DB Error] Error fetching newly created agreement:", fetchErr.message);
                 return res.status(201).json({ id: newAgreementId, message: 'Business agreement created (but failed to fetch full details).' });
            }
            if (!newAgreement) {
                console.error("❌ [API Logic Error] Newly created agreement not found by ID:", newAgreementId);
                return res.status(201).json({ id: newAgreementId, message: 'Business agreement created (but not found immediately after).' });
            }
            console.log("✅ [API DB Success] Successfully created and fetched business agreement:", newAgreement);
            res.status(201).json({ 
                agreement: newAgreement, 
                message: 'Business agreement created successfully.' 
            });
        });
    });
});

// --- NEW ROUTE TO HANDLE ONBOARDING OF EXISTING LOANS ---
router.post('/existing', (req, res) => {
    console.log('[API] POST /api/business-agreements/existing request received. Body:', req.body);
    const { lender_id, original_amount, current_balance, start_date, last_paid_date, interest_rate, details } = req.body;

    if (!lender_id || current_balance === undefined || !start_date || !last_paid_date) {
        return res.status(400).json({ error: 'Missing required fields for existing loan: Entity, Current Balance, Start Date, and Last Paid Date are required.' });
    }

    const parsedCurrentBalance = parseFloat(current_balance);
    const parsedInterestRate = parseFloat(interest_rate) || 0;

    if (isNaN(parsedCurrentBalance) || isNaN(parsedInterestRate)) {
        return res.status(400).json({ error: 'Amounts and interest rate must be valid numbers.' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION;");

        // The total_amount for the new agreement IS the current outstanding balance.
        const agreementSql = `INSERT INTO business_agreements (lender_id, agreement_type, total_amount, start_date, details, interest_rate)
                              VALUES (?, ?, ?, ?, ?, ?)`;
        const agreementParams = [lender_id, 'loan_taken_by_biz', parsedCurrentBalance, start_date, details, parsedInterestRate];

        db.run(agreementSql, agreementParams, function(err) {
            if (err) {
                db.run("ROLLBACK;");
                console.error("❌ [API DB Error] Error creating agreement for existing loan:", err.message);
                return res.status(500).json({ error: "Failed to create business agreement record." });
            }

            const newAgreementId = this.lastID;
            // Create the initial transaction to show the business received these funds historically.
            const initialFundsTxSql = `INSERT INTO transactions (agreement_id, lender_id, amount, description, category, date)
                                       VALUES (?, ?, ?, ?, ?, ?)`;
            const txDesc = `Onboarding existing loan balance for agreement #${newAgreementId}. Original Amount: ${original_amount || 'N/A'}`;
            // This category assumes the funds went to the bank. It represents the start of the loan on the books.
            const txCategory = 'Loan Received by Business (to Bank)'; 
            const txParams = [newAgreementId, lender_id, parsedCurrentBalance, txDesc, txCategory, start_date];

            db.run(initialFundsTxSql, txParams, function(txErr) {
                if (txErr) {
                    db.run("ROLLBACK;");
                    console.error("❌ [API DB Error] Error creating historical transaction for existing loan:", txErr.message);
                    return res.status(500).json({ error: "Failed to create historical catch-up transaction." });
                }

                db.run("COMMIT;", (commitErr) => {
                    if (commitErr) {
                        db.run("ROLLBACK;"); // Attempt to rollback on commit failure
                        return res.status(500).json({ error: "Failed to commit transaction." });
                    }
                    res.status(201).json({ message: `Existing loan with balance of ₹${parsedCurrentBalance.toFixed(2)} recorded successfully.` });
                });
            });
        });
    });
});


router.put('/:id', (req, res) => {
    const { id } = req.params;
    const { lender_id, agreement_type, total_amount, start_date, details, interest_rate } = req.body;
    if (!lender_id || !agreement_type || total_amount === undefined || total_amount === null || !start_date) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }
    if (isNaN(parseFloat(total_amount))) { return res.status(400).json({ error: 'Total amount must be a valid number.' }); }
    
    const parsedInterestRate = (agreement_type.includes('loan') && interest_rate !== undefined) ? parseFloat(interest_rate) : 0;
    if (isNaN(parsedInterestRate) || parsedInterestRate < 0) {
        return res.status(400).json({ error: 'Interest rate must be a valid non-negative number if provided for a loan.' });
    }

    const sql = `UPDATE business_agreements SET lender_id = ?, agreement_type = ?, total_amount = ?, start_date = ?, details = ?, interest_rate = ? WHERE id = ?`;
    db.run(sql, [lender_id, agreement_type, parseFloat(total_amount), start_date, details, parsedInterestRate, id], function(err) {
        if (err) {
            console.error("Error updating business agreement:", err.message);
            return res.status(500).json({ error: "Failed to update business agreement: " + err.message });
        }
        if (this.changes === 0) { return res.status(404).json({ message: 'Business agreement not found.' }); }
        
        res.json({ message: 'Business agreement updated successfully. Details will refresh on next load.' });
    });
});

router.delete('/:id', (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM business_agreements WHERE id = ?', [id], function(err) {
        if (err) {
            console.error("Error deleting business agreement:", err.message);
            return res.status(500).json({ error: "Failed to delete business agreement: " + err.message });
        }
        if (this.changes === 0) { return res.status(404).json({ message: 'Business agreement not found.' }); }
        res.json({ message: 'Business agreement deleted successfully.' });
    });
});

module.exports = router;
// --- END OF FULL FILE businessAgreementRoutes.js ---