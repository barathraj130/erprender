// routes/transactionRoutes.js
const express = require('express');
const router = express.Router();
// --- PG FIX: Import pool for helper function ---
const { pool } = require('../db'); 

// Wrapper for simple queries (used for SELECTs and single updates/inserts outside of explicit transactions)
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


// ========= START: router.post('/') =========
router.post('/', async (req, res) => { 
  let { user_id, lender_id, agreement_id, amount, description, category, date, line_items, related_invoice_id } = req.body;
  const companyId = req.user.active_company_id; // Added for context/security

  let client;

  try {
    // --- Pre-check (Blocking logic outside main transaction) ---
    if (category && (category.startsWith('Opening Balance -'))) {
        const checkSql = `SELECT id FROM transactions WHERE category = $1 AND date = $2`;
        const existingRow = await dbQuery(checkSql, [category, date]);
        
        if (existingRow.length > 0) {
            console.warn(`[API WARNING] Blocked attempt to create duplicate opening balance for ${date}. Category: ${category}`);
            return res.status(400).json({ error: `An opening balance for '${category}' already exists for the date ${date}. It can only be set once per day.` });
        }
    }
    
    // --- Input Parsing and Validation (Moved into try block) ---
    let parsedUserId = user_id ? parseInt(user_id) : null;
    let parsedLenderId = lender_id ? parseInt(lender_id) : null;
    let parsedAgreementId = agreement_id ? parseInt(agreement_id) : null;
    let parsedRelatedInvoiceId = related_invoice_id ? parseInt(related_invoice_id) : null;

    if (user_id && isNaN(parsedUserId)) return res.status(400).json({ error: 'User ID, if provided, must be a valid number.' });
    if (lender_id && isNaN(parsedLenderId)) return res.status(400).json({ error: 'Lender ID, if provided, must be a valid number.' });
    if (agreement_id && isNaN(parsedAgreementId)) return res.status(400).json({ error: 'Agreement ID, if provided, must be a valid number.' });
    if (related_invoice_id && isNaN(parsedRelatedInvoiceId)) return res.status(400).json({ error: 'Related Invoice ID, if provided, must be a valid number.' });

    if (amount === undefined || amount === null || isNaN(parseFloat(amount))) {
        if (!((category.toLowerCase().includes('stock adjustment')) && Array.isArray(line_items) && line_items.length > 0)) {
            return res.status(400).json({ error: 'Amount is required and must be a number (or 0 for stock-only adjustments with items).' });
        }
    }
    amount = parseFloat(amount); 
  
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Date is required in YYYY-MM-DD format.' });
    }
    if (!category) {
        return res.status(400).json({ error: 'Category is required.' });
    }
    
    // --- Start Transaction ---
    client = await pool.connect();
    await client.query('BEGIN');
    
    const transactionSql = `INSERT INTO transactions (company_id, user_id, lender_id, agreement_id, amount, description, category, date, related_invoice_id)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`;
    const transactionParams = [companyId, parsedUserId, parsedLenderId, parsedAgreementId, amount, description, category, date, parsedRelatedInvoiceId];

    const txResult = await client.query(transactionSql, transactionParams);
    const transactionId = txResult.rows[0].id;
    
    console.log("<<<<< DEBUG: Transaction header created. ID:", transactionId, "for category:", category, "Amount:", amount, ">>>>>");
    
    // --- Invoice Payment Update ---
    if (parsedRelatedInvoiceId && category.toLowerCase().includes('payment received')) {
        const paymentAmount = Math.abs(amount); 
        const updateInvoiceSql = 'UPDATE invoices SET paid_amount = paid_amount + $1 WHERE id = $2';
        await client.query(updateInvoiceSql, [paymentAmount, parsedRelatedInvoiceId]);
        console.log(`<<<<< DEBUG: Invoice ${parsedRelatedInvoiceId} paid_amount updated by ${paymentAmount}. >>>>>`);
    }

    // --- Line Items and Stock Update ---
    const isProductRelated = category.toLowerCase().includes('sale') || 
                             category.toLowerCase().includes('purchase') || 
                             category.toLowerCase().includes('product return') ||
                             category.toLowerCase().includes('stock adjustment');
    
    if (isProductRelated && Array.isArray(line_items) && line_items.length > 0) {
        for (const item of line_items) {
            if (!item.product_id || item.quantity === undefined || item.unit_price === undefined) { 
                console.warn("<<<<< WARN: Skipping invalid line item in transaction processing:", item, ">>>>>");
                continue; 
            }
            
            // 1. Insert Line Item
            const lineItemSql = `INSERT INTO transaction_line_items (transaction_id, product_id, quantity, unit_sale_price) VALUES ($1, $2, $3, $4)`;
            await client.query(lineItemSql, [transactionId, item.product_id, item.quantity, item.unit_price]);
            
            // 2. Update Stock
            let stockChange = 0;
            const absQuantity = Math.abs(parseFloat(item.quantity));

            if (category.toLowerCase().includes('sale to customer') && !category.toLowerCase().includes('return')) { 
                stockChange = -absQuantity; 
            } else if (category.toLowerCase().includes('purchase from supplier') && !category.toLowerCase().includes('return')) { 
                stockChange = absQuantity; 
            } else if (category.toLowerCase().includes('product return from customer')) { 
                stockChange = absQuantity;
            } else if (category.toLowerCase().includes('product return to supplier')) { 
                stockChange = -absQuantity;
            } else if (category === "Stock Adjustment (Increase)") {
                stockChange = absQuantity;
            } else if (category === "Stock Adjustment (Decrease)") {
                stockChange = -absQuantity;
            }
            
            if (stockChange !== 0 && item.product_id) { 
                const stockUpdateSql = `UPDATE products SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`;
                const stockResult = await client.query(stockUpdateSql, [stockChange, item.product_id, companyId]);
                
                if (stockResult.rowCount === 0) {
                    console.warn(`<<<<< WARN: Product ID not found for stock update or stock unchanged: ${item.product_id} >>>>>`);
                } else {
                    console.log(`<<<<< DEBUG: Stock updated for product ID: ${item.product_id}. Change: ${stockChange} >>>>>`);
                }
            }
        }
    }
    
    // --- Commit Transaction ---
    await client.query('COMMIT');
    console.log(`✅ Transaction ${transactionId} and related updates processed successfully.`);

    // --- Fetch and Respond ---
    const fetchSql = `
        SELECT t.*, u.username AS customer_name, le.lender_name AS external_entity_name 
        FROM transactions t 
        LEFT JOIN users u ON t.user_id = u.id 
        LEFT JOIN lenders le ON t.lender_id = le.id 
        WHERE t.id = $1`;
        
    const newTransaction = await dbQuery(fetchSql, [transactionId]).then(rows => rows[0]);
    
    if (!newTransaction) {
        return res.status(201).json({ id: transactionId, message: 'Transaction and related updates processed (failed to fetch full details).' });
    }

    res.status(201).json({ transaction: newTransaction, message: 'Transaction and related updates processed.' });

  } catch (error) { 
      if (client) {
          try {
              await client.query('ROLLBACK');
              console.error("❌ [PG ROLLBACK] Rollback successful.");
          } catch (rollbackErr) {
              console.error("❌ [PG ROLLBACK FAIL] Rollback failed:", rollbackErr.message);
          }
      }
      console.error("❌ [API Logic/DB Error] Error processing transaction, rolling back:", error.message, error.stack);
      return res.status(500).json({ error: "Failed to process transaction: " + error.message });
  } finally {
      if (client) client.release();
  }
}); 
// ========= END: router.post('/') =========

// ========= START: router.get('/') =========
router.get('/', async (req, res) => {
    const sql = `
        SELECT
            t.id, t.company_id, t.user_id, t.lender_id, t.agreement_id, t.amount, t.description, t.category, t.date, t.related_invoice_id, t.created_at,
            u.username AS customer_name, 
            le.lender_name AS external_entity_name,
            i.invoice_number AS related_invoice_number 
        FROM transactions t
        LEFT JOIN users u ON t.user_id = u.id
        LEFT JOIN lenders le ON t.lender_id = le.id
        LEFT JOIN invoices i ON t.related_invoice_id = i.id 
        ORDER BY t.date DESC, t.id DESC`;
    
    try {
        const rows = await dbQuery(sql);
        res.json(rows || []);
    } catch (err) { 
        console.error("❌ [API DB Error] Error fetching transactions:", err.message); 
        return res.status(500).json({ error: err.message }); 
    }
});
// ========= END: router.get('/') =========

// ========= START: router.put('/:id') =========
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  let { user_id, lender_id, agreement_id, amount, description, category, date, related_invoice_id } = req.body;
  
  console.warn(`[API WARNING] PUT /api/transactions/${id}: Editing transactions via PUT does not support stock reversal for product line items.`);

  let parsedUserId = user_id ? parseInt(user_id) : null;
  let parsedLenderId = lender_id ? parseInt(lender_id) : null;
  let parsedAgreementId = agreement_id ? parseInt(agreement_id) : null;
  let parsedRelatedInvoiceId = related_invoice_id ? parseInt(related_invoice_id) : null;

  if (amount === undefined || amount === null || isNaN(parseFloat(amount))) {
    return res.status(400).json({ error: 'Amount is required and must be a number.' });
  }
  amount = parseFloat(amount); 

  if (!date || !category) {
    return res.status(400).json({ error: 'Date and Category are required.' });
  }

  const sql = `UPDATE transactions
               SET user_id = $1, lender_id = $2, agreement_id = $3, amount = $4, description = $5, category = $6, date = $7, related_invoice_id = $8
               WHERE id = $9`;
  const params = [parsedUserId, parsedLenderId, parsedAgreementId, amount, description, category, date, parsedRelatedInvoiceId, id];

  try {
    const result = await dbQuery(sql, params);
    
    if (result.rowCount === 0) return res.status(404).json({ message: 'Transaction not found or no changes made' });
    
    const fetchSql = `
        SELECT t.*, u.username AS customer_name, le.lender_name AS external_entity_name, i.invoice_number as related_invoice_number 
        FROM transactions t 
        LEFT JOIN users u ON t.user_id = u.id 
        LEFT JOIN lenders le ON t.lender_id = le.id 
        LEFT JOIN invoices i ON t.related_invoice_id = i.id
        WHERE t.id = $1`;
        
    const updatedTransaction = await dbQuery(fetchSql, [id]).then(rows => rows[0]);
    
    res.json({ transaction: updatedTransaction, message: 'Transaction updated successfully.' });
  } catch (err) {
      console.error("❌ [API DB Error] Error updating transaction:", err.message);
      if (err.message.includes("violates foreign key constraint")) {
          return res.status(400).json({ error: 'Invalid related ID: A specified User, Entity, or Agreement does not exist.' });
      }
      return res.status(500).json({ error: "Failed to update transaction: " + err.message });
  }
});
// ========= END: router.put('/:id') =========

// ========= START: router.delete('/:id') =========
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.active_company_id;
  let client;
  
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // 1. Get transaction details
    const txCheckSql = 'SELECT amount, related_invoice_id, category FROM transactions WHERE id = $1 AND company_id = $2';
    const txToDeleteRows = await client.query(txCheckSql, [id, companyId]);
    
    if (txToDeleteRows.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Transaction not found for deletion.' });
    }
    const txToDelete = txToDeleteRows.rows[0];
    
    // 2. Revert Invoice Payment (if applicable)
    const isPayment = (txToDelete.category || '').toLowerCase().includes('payment received');
    if (txToDelete.related_invoice_id && isPayment) {
        const amountToReverse = Math.abs(parseFloat(txToDelete.amount || 0));
        const invUpdateSql = 'UPDATE invoices SET paid_amount = paid_amount - $1 WHERE id = $2 AND company_id = $3';
        await client.query(invUpdateSql, [amountToReverse, txToDelete.related_invoice_id, companyId]);
        console.log(`✅ Invoice ${txToDelete.related_invoice_id} paid_amount reverted by ${amountToReverse}.`);
    }

    // 3. Fetch Line Items for Stock Reversal
    const lineItemsSql = 'SELECT product_id, quantity FROM transaction_line_items WHERE transaction_id = $1';
    const lineItemsResult = await client.query(lineItemsSql, [id]);
    const lineItems = lineItemsResult.rows;

    // 4. Revert Stock Changes
    for (const item of lineItems) {
        let stockChangeToRevert = 0;
        const absQuantity = Math.abs(parseFloat(item.quantity));
        const originalCategory = txToDelete.category;

        // Determine the reversal amount (opposite of post creation logic)
        if (originalCategory.toLowerCase().includes('sale to customer') && !originalCategory.toLowerCase().includes('return')) { 
            stockChangeToRevert = absQuantity; 
        } else if (originalCategory.toLowerCase().includes('purchase from supplier') && !originalCategory.toLowerCase().includes('return')) { 
            stockChangeToRevert = -absQuantity;
        } else if (originalCategory.toLowerCase().includes('product return from customer')) { 
            stockChangeToRevert = -absQuantity;
        } else if (originalCategory.toLowerCase().includes('product return to supplier')) { 
            stockChangeToRevert = absQuantity;
        } else if (originalCategory === "Stock Adjustment (Increase)") {
            stockChangeToRevert = -absQuantity;
        } else if (originalCategory === "Stock Adjustment (Decrease)") {
            stockChangeToRevert = absQuantity;
        }

        if (stockChangeToRevert !== 0 && item.product_id) {
            const stockUpdateSql = "UPDATE products SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2 AND company_id = $3";
            await client.query(stockUpdateSql, [stockChangeToRevert, item.product_id, companyId]);
            console.log(`✅ Stock for product ${item.product_id} reverted by ${stockChangeToRevert} due to transaction ${id} deletion.`);
        }
    }
    
    // 5. Delete transaction records (Line items are CASCADE deleted)
    const deleteTxResult = await client.query('DELETE FROM transactions WHERE id = $1 AND company_id = $2', [id, companyId]);
    
    if (deleteTxResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Transaction not found for final deletion (after reversal steps).' });
    }
    
    // 6. Commit
    await client.query('COMMIT');
    res.json({ message: 'Transaction and all related records processed successfully.' });

  } catch (error) {
    if (client) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackErr) {
            console.error("❌ [PG ROLLBACK FAIL] Rollback failed during deletion:", rollbackErr.message);
        }
    }
    console.error("❌ [API DB Error] Error during transaction deletion:", error.message);
    return res.status(500).json({ error: "Failed to delete transaction: " + error.message });
  } finally {
      if (client) client.release();
  }
}); 
// ========= END: router.delete('/:id') =========

module.exports = router;