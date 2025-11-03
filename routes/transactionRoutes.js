// routes/transactionRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// ========= START: router.post('/') =========
router.post('/', (req, res) => { // Route handler starts
  let { user_id, lender_id, agreement_id, amount, description, category, date, line_items, related_invoice_id } = req.body;

  // Server-side check to prevent duplicate opening balance entries for the same day.
  if (category && (category.startsWith('Opening Balance -'))) {
      const checkSql = `SELECT id FROM transactions WHERE category = ? AND date = ?`;
      db.get(checkSql, [category, date], (err, row) => {
          if (err) {
              console.error("❌ [API DB Error] Error checking for existing opening balance:", err.message);
              return res.status(500).json({ error: "Database error during pre-check." });
          }
          if (row) {
              console.warn(`[API WARNING] Blocked attempt to create duplicate opening balance for ${date}. Category: ${category}`);
              return res.status(400).json({ error: `An opening balance for '${category}' already exists for the date ${date}. It can only be set once per day.` });
          }
          // If no duplicate is found, proceed with transaction creation.
          createTransaction();
      });
  } else {
      // For all other transaction types, proceed directly.
      createTransaction();
  }
  
  function createTransaction() {
    let parsedUserId = null;
    if (user_id !== null && user_id !== undefined && user_id !== '') {
      parsedUserId = parseInt(user_id);
      if (isNaN(parsedUserId)) {
          return res.status(400).json({ error: 'User ID, if provided, must be a valid number.' });
      }
    }
    let parsedLenderId = null;
    if (lender_id !== null && lender_id !== undefined && lender_id !== '') {
      parsedLenderId = parseInt(lender_id);
      if (isNaN(parsedLenderId)) {
          return res.status(400).json({ error: 'Lender ID, if provided, must be a valid number.' });
      }
    }
    let parsedAgreementId = null;
    if (agreement_id !== null && agreement_id !== undefined && agreement_id !== '') {
      parsedAgreementId = parseInt(agreement_id);
      if (isNaN(parsedAgreementId)) {
          return res.status(400).json({ error: 'Agreement ID, if provided, must be a valid number.' });
      }
    }
    let parsedRelatedInvoiceId = null;
    if (related_invoice_id !== null && related_invoice_id !== undefined && related_invoice_id !== '') {
      parsedRelatedInvoiceId = parseInt(related_invoice_id);
      if (isNaN(parsedRelatedInvoiceId)) {
          return res.status(400).json({ error: 'Related Invoice ID, if provided, must be a valid number.' });
      }
    }
  
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
  
    const isProductRelated = category.toLowerCase().includes('sale') || 
                             category.toLowerCase().includes('purchase') || 
                             category.toLowerCase().includes('product return') ||
                             category.toLowerCase().includes('stock adjustment');
  
    if (isProductRelated && (!Array.isArray(line_items) || line_items.length === 0)) {
        if (!category.toLowerCase().includes('stock adjustment (value')) { 
            console.warn(`Warning: Category '${category}' typically involves products but was created without line items. Stock will not be updated.`);
        }
    }
  
  
    db.serialize(() => { 
      db.run("BEGIN TRANSACTION;", (beginErr) => {
          if (beginErr) {
              console.error("❌ [API DB Error] Failed to start DB transaction for transaction post:", beginErr.message);
              return res.status(500).json({ error: "Failed to start DB transaction: " + beginErr.message });
          }
  
          const transactionSql = `INSERT INTO transactions (user_id, lender_id, agreement_id, amount, description, category, date, related_invoice_id)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
          const transactionParams = [parsedUserId, parsedLenderId, parsedAgreementId, amount, description, category, date, parsedRelatedInvoiceId];
  
          db.run(transactionSql, transactionParams, function(txErr) { 
              if (txErr) {
                  console.error("❌ [API DB Error] Error inserting transaction record:", txErr.message, "Params:", transactionParams);
                  db.run("ROLLBACK;");
                  return res.status(500).json({ error: "Failed to create transaction record: " + txErr.message });
              }
              const transactionId = this.lastID;
              console.log("<<<<< DEBUG: Transaction header created. ID:", transactionId, "for category:", category, "Amount:", amount, ">>>>>");
              let itemPromises = [];
  
              // --- START: NEW INVOICE PAYMENT UPDATE LOGIC ---
              if (parsedRelatedInvoiceId && category.toLowerCase().includes('payment received')) {
                  const paymentAmount = Math.abs(amount); // Payment txns are negative, so we take the absolute value
                  const updateInvoicePromise = new Promise((resolve, reject) => {
                      db.run('UPDATE invoices SET paid_amount = paid_amount + ? WHERE id = ?', [paymentAmount, parsedRelatedInvoiceId], function(invErr) {
                          if (invErr) {
                              console.error(`<<<<< DB ERROR: Error updating paid_amount for invoice ID ${parsedRelatedInvoiceId}:`, invErr.message, ">>>>>");
                              reject(invErr);
                          } else {
                              console.log(`<<<<< DEBUG: Invoice ${parsedRelatedInvoiceId} paid_amount updated by ${paymentAmount}. >>>>>`);
                              resolve();
                          }
                      });
                  });
                  itemPromises.push(updateInvoicePromise);
              }
              // --- END: NEW INVOICE PAYMENT UPDATE LOGIC ---
  
              if (Array.isArray(line_items) && line_items.length > 0) {
                   line_items.forEach(item => { 
                      if (!item.product_id || item.quantity === undefined || item.unit_price === undefined) { 
                          console.warn("<<<<< WARN: Skipping invalid line item in transaction processing:", item, ">>>>>");
                          return; 
                      }
                      const lineItemSql = `INSERT INTO transaction_line_items (transaction_id, product_id, quantity, unit_sale_price)
                                           VALUES (?, ?, ?, ?)`;
                      itemPromises.push(new Promise((resolve, reject) => { 
                          db.run(lineItemSql, [transactionId, item.product_id, item.quantity, item.unit_price], function(liErr) { 
                              if (liErr) {
                                  console.error("<<<<< DB ERROR: Error inserting transaction_line_item:", liErr.message, "for item:", item, ">>>>>");
                                  reject(liErr);
                              } else {
                                  console.log("<<<<< DEBUG: transaction_line_item inserted. ID:", this.lastID, "for Tx ID:", transactionId, ">>>>>");
                                  resolve();
                              }
                          }); 
                      })); 
  
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
                          const stockUpdateSql = `UPDATE products SET current_stock = current_stock + ?, updated_at = datetime('now') WHERE id = ?`;
                          itemPromises.push(new Promise((resolve, reject) => {
                              db.run(stockUpdateSql, [stockChange, item.product_id], function(stockErr) {
                                  if (stockErr) {
                                       console.error("<<<<< DB ERROR: Error updating stock for product ID:", item.product_id, stockErr.message, ">>>>>");
                                      reject(stockErr);
                                  } else if (this.changes === 0 && item.product_id) { 
                                      console.warn("<<<<< WARN: Product ID not found for stock update or stock unchanged:", item.product_id, ">>>>>");
                                      resolve(); 
                                  } else {
                                      console.log("<<<<< DEBUG: Stock updated for product ID:", item.product_id, "Change:", stockChange, ">>>>>");
                                      resolve();
                                  }
                              });
                          }));
                      }
                  });
              } 
  
              Promise.all(itemPromises)
                  .then(() => { 
                      db.run("COMMIT;", (commitErr) => { 
                          if (commitErr) {
                               console.error("❌ [API DB Error] Error committing transaction:", commitErr.message);
                               db.run("ROLLBACK;");
                               return res.status(500).json({ error: "Failed to commit DB transaction: " + commitErr.message });
                          }
                          console.log(`✅ Transaction ${transactionId} and related updates processed successfully.`);
                          db.get(`SELECT t.*, u.username AS customer_name, le.lender_name AS external_entity_name 
                                  FROM transactions t 
                                  LEFT JOIN users u ON t.user_id = u.id 
                                  LEFT JOIN lenders le ON t.lender_id = le.id 
                                  WHERE t.id = ?`, [transactionId], (fetchErr, newTransaction) => { 
                              if (fetchErr) {
                                  return res.status(201).json({ id: transactionId, message: 'Transaction and related updates processed (failed to fetch full details).' });
                              }
                              res.status(201).json({ transaction: newTransaction, message: 'Transaction and related updates processed.' });
                          }); 
                      }); 
                  }) 
                  .catch(itemProcessingError => { 
                      console.error("❌ [API Logic/DB Error] Error processing transaction details, rolling back:", itemProcessingError.message, itemProcessingError.stack);
                      db.run("ROLLBACK;", (rollbackErr) => { 
                          if(rollbackErr) console.error("❌ [API DB Error] Rollback failed after item processing error:", rollbackErr.message);
                      }); 
                      return res.status(500).json({ error: "Failed to process transaction details: " + itemProcessingError.message });
                  }); 
          }); 
      }); 
    }); 
  }
}); 
// ========= END: router.post('/') =========

// ========= START: router.get('/') =========
router.get('/', (req, res) => {
  db.all(
    `SELECT
        t.*,
        u.username AS customer_name, 
        le.lender_name AS external_entity_name,
        i.invoice_number AS related_invoice_number 
     FROM transactions t
     LEFT JOIN users u ON t.user_id = u.id
     LEFT JOIN lenders le ON t.lender_id = le.id
     LEFT JOIN invoices i ON t.related_invoice_id = i.id 
     ORDER BY t.date DESC, t.id DESC`,
    (err, rows) => {
      if (err) { console.error("❌ [API DB Error] Error fetching transactions:", err.message); return res.status(500).json({ error: err.message }); }
      res.json(rows || []);
    }
  );
});
// ========= END: router.get('/') =========

// ========= START: router.put('/:id') =========
router.put('/:id', (req, res) => {
  const { id } = req.params;
  let { user_id, lender_id, agreement_id, amount, description, category, date, related_invoice_id } = req.body;
  
  console.warn(`[API WARNING] PUT /api/transactions/${id}: Editing transactions with line items via this generic PUT endpoint is NOT fully supported for stock and line item integrity. Edit associated Invoices or re-create the transaction for complex changes.`);

  let parsedUserId = null;
  if (user_id !== null && user_id !== undefined && user_id !== '') {
    parsedUserId = parseInt(user_id);
    if (isNaN(parsedUserId)) return res.status(400).json({ error: 'User ID, if provided, must be a valid number.' });
  }
  let parsedLenderId = null;
  if (lender_id !== null && lender_id !== undefined && lender_id !== '') {
    parsedLenderId = parseInt(lender_id);
    if (isNaN(parsedLenderId)) return res.status(400).json({ error: 'Lender ID, if provided, must be a valid number.' });
  }
   let parsedAgreementId = null;
  if (agreement_id !== null && agreement_id !== undefined && agreement_id !== '') {
    parsedAgreementId = parseInt(agreement_id);
    if (isNaN(parsedAgreementId)) return res.status(400).json({ error: 'Agreement ID, if provided, must be a valid number.' });
  }
  let parsedRelatedInvoiceId = null;
  if (related_invoice_id !== null && related_invoice_id !== undefined && related_invoice_id !== '') {
    parsedRelatedInvoiceId = parseInt(related_invoice_id);
    if (isNaN(parsedRelatedInvoiceId)) return res.status(400).json({ error: 'Related Invoice ID, if provided, must be a valid number.' });
  }

  if (amount === undefined || amount === null || isNaN(parseFloat(amount))) {
    return res.status(400).json({ error: 'Amount is required and must be a number.' });
  }
  amount = parseFloat(amount); 

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date is required in YYYY-MM-DD format.' });
  }
  if (!category) {
    return res.status(400).json({ error: 'Category is required.' });
  }

  const sql = `UPDATE transactions
               SET user_id = ?, lender_id = ?, agreement_id = ?, amount = ?, description = ?, category = ?, date = ?, related_invoice_id = ?
               WHERE id = ?`;
  const params = [parsedUserId, parsedLenderId, parsedAgreementId, amount, description, category, date, parsedRelatedInvoiceId, id];

  db.run(sql, params, function(err) {
    if (err) { 
        console.error("❌ [API DB Error] Error updating transaction:", err.message);
        if (err.message.includes("FOREIGN KEY constraint failed")) {
            return res.status(400).json({ error: 'Invalid related ID: A specified User, Entity, or Agreement does not exist.' });
        }
        return res.status(500).json({ error: "Failed to update transaction: " + err.message });
    }
    if (this.changes === 0) return res.status(404).json({ message: 'Transaction not found or no changes made' });
    
    db.get(`SELECT t.*, u.username AS customer_name, le.lender_name AS external_entity_name, i.invoice_number as related_invoice_number 
            FROM transactions t 
            LEFT JOIN users u ON t.user_id = u.id 
            LEFT JOIN lenders le ON t.lender_id = le.id 
            LEFT JOIN invoices i ON t.related_invoice_id = i.id
            WHERE t.id = ?`, [id], (fetchErr, updatedTransaction) => {
        if (fetchErr) {
            return res.json({ message: 'Transaction updated successfully (failed to fetch full details).' });
        }
        res.json({ transaction: updatedTransaction, message: 'Transaction updated successfully.' });
    });
  });
});
// ========= END: router.put('/:id') =========

// ========= START: router.delete('/:id') =========
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  
  db.serialize(() => { 
    db.run("BEGIN TRANSACTION;");

    // --- START: MODIFIED LOGIC TO REVERT INVOICE PAYMENT ON DELETE ---
    // First, get the details of the transaction we are about to delete.
    db.get('SELECT amount, related_invoice_id, category FROM transactions WHERE id = ?', [id], (fetchErr, txToDelete) => {
        if (fetchErr) {
            db.run("ROLLBACK;");
            return res.status(500).json({ error: "Failed to fetch transaction details before deletion." });
        }
        if (!txToDelete) {
             db.run("ROLLBACK;");
            return res.status(404).json({ message: 'Transaction not found for deletion.' });
        }
        
        const isPayment = (txToDelete.category || '').toLowerCase().includes('payment received');
        const paymentReversalPromises = [];

        // If it's a payment linked to an invoice, create a promise to reverse the paid amount.
        if (txToDelete.related_invoice_id && isPayment) {
            const amountToReverse = Math.abs(parseFloat(txToDelete.amount || 0));
            paymentReversalPromises.push(new Promise((resolve, reject) => {
                db.run('UPDATE invoices SET paid_amount = paid_amount - ? WHERE id = ?', [amountToReverse, txToDelete.related_invoice_id], (invErr) => {
                    if (invErr) reject(invErr);
                    else {
                         console.log(`✅ Invoice ${txToDelete.related_invoice_id} paid_amount reverted by ${amountToReverse}.`);
                         resolve();
                    }
                });
            }));
        }
        
        // Now, continue with the original stock reversal and deletion logic
        Promise.all(paymentReversalPromises).then(() => {
            db.all('SELECT product_id, quantity FROM transaction_line_items WHERE transaction_id = ?', [id], (errTLI, lineItems) => {
                if (errTLI) {
                    db.run("ROLLBACK;");
                    console.error("❌ [API DB Error] Error fetching transaction line items for stock reversal:", errTLI.message);
                    return res.status(500).json({ error: "Failed to prepare for transaction deletion (fetch TLI)." });
                }

                const stockReversalPromises = (lineItems || []).map(item => {
                    return new Promise((resolve, reject) => {
                        let stockChangeToRevert = 0;
                        const absQuantity = Math.abs(parseFloat(item.quantity));
                        const originalCategory = txToDelete.category;

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
                            db.run("UPDATE products SET current_stock = current_stock + ? WHERE id = ?", [stockChangeToRevert, item.product_id], (stockErr) => {
                                if (stockErr) {
                                    console.error(`❌ [API DB Error] Error reverting stock for product ${item.product_id}:`, stockErr.message);
                                    return reject(stockErr);
                                }
                                console.log(`✅ Stock for product ${item.product_id} reverted by ${stockChangeToRevert} due to transaction ${id} deletion.`);
                                resolve();
                            });
                        } else {
                            resolve();
                        }
                    });
                });

                Promise.all(stockReversalPromises).then(() => {
                    db.run('DELETE FROM transaction_line_items WHERE transaction_id = ?', [id], (liErr) => {
                        if (liErr) { 
                            db.run("ROLLBACK;");
                            console.error("❌ [API DB Error] Error deleting transaction line items:", liErr.message);
                            return res.status(500).json({ error: "Failed to delete transaction details." });
                        }
                        db.run('DELETE FROM transactions WHERE id = ?', [id], function(txErr) { 
                            if (txErr) { 
                                db.run("ROLLBACK;");
                                console.error("❌ [API DB Error] Error deleting transaction:", txErr.message);
                                return res.status(500).json({ error: "Failed to delete transaction." });
                            }
                            if (this.changes === 0) {
                                db.run("ROLLBACK;");
                                return res.status(404).json({ message: 'Transaction not found for final deletion.' });
                            }
                            db.run("COMMIT;", (commitErr) => { 
                                if (commitErr){
                                    console.error("❌ [API DB Error] Error committing delete transaction:", commitErr.message);
                                    db.run("ROLLBACK;"); 
                                    return res.status(500).json({ error: "Failed to commit delete operation." });
                                }
                                res.json({ message: 'Transaction and all related records processed successfully.' });
                            }); 
                        }); 
                    }); 
                }).catch(reversalError => {
                    db.run("ROLLBACK;");
                    console.error("❌ [API DB Error] Error during stock reversal for transaction deletion:", reversalError.message);
                    return res.status(500).json({ error: "Failed during stock reversal for transaction deletion." });
                });
            }); 
        }).catch(reversalError => {
             db.run("ROLLBACK;");
             return res.status(500).json({ error: "Failed during invoice payment reversal for transaction deletion." });
        });
    });
  }); 
}); 
// ========= END: router.delete('/:id') =========

module.exports = router;