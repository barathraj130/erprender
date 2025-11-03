const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper function to run a single DB query as a promise
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) {
                console.error('DB_RUN_ERROR:', err.message, 'SQL:', sql, 'PARAMS:', params);
                reject(err);
            } else {
                resolve(this);
            }
        });
    });
}

// Helper function to get data
function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                console.error('DB_ALL_ERROR:', err.message, 'SQL:', sql, 'PARAMS:', params);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}


async function generateNotificationForLowStock(productId, companyId) {
    db.get(`SELECT product_name, current_stock, low_stock_threshold 
            FROM products WHERE id = ? AND company_id = ?`, [productId, companyId], (err, product) => {
        if (err || !product) return;
        if (product.low_stock_threshold > 0 && product.current_stock <= product.low_stock_threshold) {
            const message = `Low stock alert for ${product.product_name}. Current stock: ${product.current_stock}.`;
            db.get(`SELECT id FROM notifications WHERE message = ? AND is_read = 0`, [message], (err, existing) => {
                if(err || existing) return;
                db.run(`INSERT INTO notifications (message, type, link) VALUES (?, ?, ?)`,
                    [message, 'warning', `/inventory#product-${productId}`]);
            });
        }
    });
}

// Helper function to create all transactions and stock updates related to an invoice
async function createAssociatedTransactionsAndStockUpdate(invoiceId, companyId, invoiceData, processedLineItems) {
    const { customer_id, invoice_number, total_amount, paid_amount, invoice_type, invoice_date, newPaymentMethod } = invoiceData;
    const transactionPromises = [];

    // 1. Create the main Sale/Credit Note transaction
    if (parseFloat(total_amount) !== 0) {
        const isReturn = invoice_type === 'SALES_RETURN';
        const saleCategoryName = isReturn ? "Product Return from Customer (Credit Note)" : "Sale to Customer (On Credit)";
        const saleTxActualAmount = isReturn ? -Math.abs(parseFloat(total_amount)) : parseFloat(total_amount);
        
        const saleTransactionSql = `INSERT INTO transactions (company_id, user_id, amount, description, category, date, related_invoice_id) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const saleTransactionParams = [companyId, customer_id, saleTxActualAmount, isReturn ? `Credit Note for ${invoice_number}` : `Invoice ${invoice_number}`, saleCategoryName, invoice_date, invoiceId];
        
        const saleTxPromise = new Promise((resolve, reject) => {
            db.run(saleTransactionSql, saleTransactionParams, function (err) {
                if (err) return reject(err);
                
                const saleTransactionId = this.lastID;
                const stockAndLineItemPromises = (processedLineItems || []).map(item => {
                    if (!item.product_id) return Promise.resolve();
                    const stockChange = parseFloat(item.quantity); // Already signed correctly
                    
                    const updateStockPromise = new Promise((resStock, rejStock) => {
                        db.run(`UPDATE products SET current_stock = current_stock - ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?`,
                            [stockChange, item.product_id, companyId], function (stockErr) {
                                if (stockErr) rejStock(stockErr);
                                else {
                                    generateNotificationForLowStock(item.product_id, companyId);
                                    resStock();
                                }
                            });
                    });

                    const txLineItemPromise = new Promise((resTxLi, rejTxLi) => {
                        db.run(`INSERT INTO transaction_line_items (transaction_id, product_id, quantity, unit_sale_price) VALUES (?, ?, ?, ?)`,
                            [saleTransactionId, item.product_id, item.quantity, item.unit_price], (txLiErr) => txLiErr ? rejTxLi(txLiErr) : resTxLi());
                    });

                    return Promise.all([updateStockPromise, txLineItemPromise]);
                });

                Promise.all(stockAndLineItemPromises).then(() => resolve()).catch(reject);
            });
        });
        transactionPromises.push(saleTxPromise);
    }

    // 2. Create the payment/refund transaction ONLY if a payment was made now
    const currentPaymentMade = parseFloat(paid_amount) || 0;
    if (currentPaymentMade !== 0 && newPaymentMethod) {
        let paymentCategoryName;
        if (newPaymentMethod.toLowerCase() === 'cash') {
            paymentCategoryName = currentPaymentMade > 0 ? "Payment Received from Customer (Cash)" : "Product Return from Customer (Refund via Cash)";
        } else if (newPaymentMethod.toLowerCase() === 'bank') {
            paymentCategoryName = currentPaymentMade > 0 ? "Payment Received from Customer (Bank)" : "Product Return from Customer (Refund via Bank)";
        }
        
        if (paymentCategoryName) {
            const paymentTxActualAmount = -currentPaymentMade; // Payment reduces customer's balance
            const paymentTransactionSql = `INSERT INTO transactions (company_id, user_id, amount, description, category, date, related_invoice_id) VALUES (?, ?, ?, ?, ?, ?, ?)`;
            const paymentTransactionParams = [companyId, customer_id, paymentTxActualAmount, `Payment/Refund for Invoice ${invoice_number}`, paymentCategoryName, invoice_date, invoiceId];
            
            transactionPromises.push(new Promise((resolve, reject) => {
                db.run(paymentTransactionSql, paymentTransactionParams, (err) => err ? reject(err) : resolve());
            }));
        }
    }

    return Promise.all(transactionPromises);
}


// GET all invoices
router.get('/', async (req, res) => {
    try {
        const companyId = req.user.active_company_id;
        if (!companyId) return res.status(400).json({ error: "No active company selected." });
        const sql = `SELECT i.*, u.username as customer_name FROM invoices i JOIN users u ON i.customer_id = u.id WHERE i.company_id = ? ORDER BY i.invoice_date DESC, i.id DESC`;
        const rows = await dbAll(sql, [companyId]);
        res.json(rows || []);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch invoices.", details: error.message });
    }
});

// GET a single invoice by ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user.active_company_id;
        if (!companyId) return res.status(400).json({ error: "No active company selected." });

        const invoiceSql = `SELECT i.*, c.username as customer_name, c.email as customer_email, c.phone as customer_phone, c.company as customer_company, c.address_line1 as customer_address_line1, c.address_line2 as customer_address_line2, c.city_pincode as customer_city_pincode, c.state as customer_state, c.gstin as customer_gstin, c.state_code as customer_state_code, comp.company_name as business_company_name, comp.address_line1 as business_address_line1, comp.address_line2 as business_address_line2, comp.city_pincode as business_city_pincode, comp.state as business_state, comp.gstin as business_gstin, comp.state_code as business_state_code, comp.phone as business_phone, comp.email as business_email, comp.bank_name as business_bank_name, comp.bank_account_no as business_bank_account_no, comp.bank_ifsc_code as business_bank_ifsc_code, comp.logo_url as business_logo_url FROM invoices i LEFT JOIN users c ON i.customer_id = c.id LEFT JOIN companies comp ON i.company_id = comp.id WHERE i.id = ? AND i.company_id = ?`;
        const invoice = await dbAll(invoiceSql, [id, companyId]).then(rows => rows[0]);
        if (!invoice) return res.status(404).json({ error: "Invoice not found or you do not have permission to view it." });

        if (!invoice.consignee_name) {
            invoice.consignee_name = invoice.customer_name;
            invoice.consignee_address_line1 = invoice.customer_address_line1;
            invoice.consignee_address_line2 = invoice.customer_address_line2;
            invoice.consignee_city_pincode = invoice.customer_city_pincode;
            invoice.consignee_state = invoice.customer_state;
            invoice.consignee_gstin = invoice.customer_gstin;
            invoice.consignee_state_code = invoice.customer_state_code;
        }
        
        const itemsSql = `SELECT ili.*, p.product_name, p.sku as product_sku, COALESCE(ili.hsn_acs_code, p.hsn_acs_code) as final_hsn_acs_code, COALESCE(ili.unit_of_measure, p.unit_of_measure) as final_unit_of_measure FROM invoice_line_items ili LEFT JOIN products p ON ili.product_id = p.id WHERE ili.invoice_id = ?`;
        const items = await dbAll(itemsSql, [id]);
        invoice.line_items = items.map(item => ({...item, cgst_rate: item.cgst_rate || 0, cgst_amount: item.cgst_amount || 0, sgst_rate: item.sgst_rate || 0, sgst_amount: item.sgst_amount || 0, igst_rate: item.igst_rate || 0, igst_amount: item.igst_amount || 0 })) || [];
        res.json(invoice);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch invoice details.", details: error.message });
    }
});

// POST (Create) a new invoice
router.post('/', async (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });

    let {
        invoice_number, customer_id, invoice_date, due_date, status, notes,
        invoice_type, line_items, cgst_rate = 0, sgst_rate = 0, igst_rate = 0,
        party_bill_returns_amount = 0, reverse_charge, transportation_mode, vehicle_number,
        date_of_supply, place_of_supply_state, place_of_supply_state_code, bundles_count,
        consignee_name, consignee_address_line1, consignee_address_line2,
        consignee_city_pincode, consignee_state, consignee_gstin, consignee_state_code,
        amount_in_words, original_invoice_number,
        payment_being_made_now, payment_method_for_new_payment
    } = req.body;

    const initialPaymentAmount = parseFloat(payment_being_made_now) || 0;
    const isReturn = invoice_type === 'SALES_RETURN';

    try {
        if (isReturn) {
            const date = new Date();
            const prefix = `CN-${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}-`;
            const lastCreditNote = await dbAll("SELECT invoice_number FROM invoices WHERE company_id = ? AND invoice_number LIKE ? ORDER BY id DESC LIMIT 1", [companyId, `${prefix}%`]).then(rows => rows[0]);
            
            let nextNum = 1;
            if (lastCreditNote) {
                const lastNum = parseInt(lastCreditNote.invoice_number.split('-').pop());
                if (!isNaN(lastNum)) {
                    nextNum = lastNum + 1;
                }
            }
            invoice_number = `${prefix}${String(nextNum).padStart(4, '0')}`;
        }

        if ((!invoice_number && !isReturn) || !customer_id || !invoice_date || !due_date || !invoice_type || !line_items || line_items.length === 0) {
            return res.status(400).json({ error: "Missing required fields. Customer, dates, type, and at least one line item are required." });
        }

        let amount_before_tax = 0, total_cgst_amount = 0, total_sgst_amount = 0, total_igst_amount = 0;
        const processed_line_items = line_items.map(item => {
            const quantity = parseFloat(item.quantity);
            const signedQuantity = isReturn ? -Math.abs(quantity) : Math.abs(quantity);
            const unit_price = parseFloat(item.unit_price);
            const discount_amount = parseFloat(item.discount_amount || 0);
            const taxable_value = (signedQuantity * unit_price) - discount_amount;
            amount_before_tax += taxable_value;
            let item_cgst = 0, item_sgst = 0, item_igst = 0;
            if (invoice_type === 'TAX_INVOICE' || (isReturn && (cgst_rate > 0 || sgst_rate > 0 || igst_rate > 0))) {
                if (igst_rate > 0) item_igst = taxable_value * (igst_rate / 100);
                else { item_cgst = taxable_value * (cgst_rate / 100); item_sgst = taxable_value * (sgst_rate / 100); }
            }
            total_cgst_amount += item_cgst; total_sgst_amount += item_sgst; total_igst_amount += item_igst;
            return { ...item, quantity: signedQuantity, taxable_value, cgst_rate, cgst_amount: item_cgst, sgst_rate, sgst_amount: item_sgst, igst_rate, igst_amount: item_igst, line_total: taxable_value + item_cgst + item_sgst + item_igst };
        });
        const final_total_amount = amount_before_tax + total_cgst_amount + total_sgst_amount + total_igst_amount - (parseFloat(party_bill_returns_amount) || 0);

        await dbRun("BEGIN TRANSACTION;");

        const invoiceSql = `INSERT INTO invoices (company_id, customer_id, invoice_number, invoice_date, due_date, total_amount, amount_before_tax, total_cgst_amount, total_sgst_amount, total_igst_amount, party_bill_returns_amount, status, invoice_type, notes, paid_amount, reverse_charge, transportation_mode, vehicle_number, date_of_supply, place_of_supply_state, place_of_supply_state_code, bundles_count, consignee_name, consignee_address_line1, consignee_address_line2, consignee_city_pincode, consignee_state, consignee_gstin, consignee_state_code, amount_in_words, original_invoice_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const invoiceHeaderParams = [companyId, customer_id, invoice_number, invoice_date, due_date, final_total_amount, amount_before_tax, total_cgst_amount, total_sgst_amount, total_igst_amount, party_bill_returns_amount, status, invoice_type, notes, initialPaymentAmount, reverse_charge, transportation_mode, vehicle_number, date_of_supply, place_of_supply_state, place_of_supply_state_code, bundles_count, consignee_name, consignee_address_line1, consignee_address_line2, consignee_city_pincode, consignee_state, consignee_gstin, consignee_state_code, amount_in_words, original_invoice_number];
        const { lastID: invoiceId } = await dbRun(invoiceSql, invoiceHeaderParams);

        const itemInsertPromises = processed_line_items.map(item => {
            const itemSql = `INSERT INTO invoice_line_items (invoice_id, product_id, description, hsn_acs_code, unit_of_measure, quantity, unit_price, discount_amount, taxable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            return dbRun(itemSql, [invoiceId, item.product_id, item.description, item.hsn_acs_code, item.unit_of_measure, item.quantity, item.unit_price, item.discount_amount, item.taxable_value, item.cgst_rate, item.cgst_amount, item.sgst_rate, item.sgst_amount, item.igst_rate, item.igst_amount, item.line_total]);
        });
        await Promise.all(itemInsertPromises);
        
        const invoiceFullDataForTxHelper = { customer_id, invoice_number, total_amount: final_total_amount, paid_amount: initialPaymentAmount, invoice_type, invoice_date, newPaymentMethod: payment_method_for_new_payment };
        await createAssociatedTransactionsAndStockUpdate(invoiceId, companyId, invoiceFullDataForTxHelper, processed_line_items);

        await dbRun("COMMIT;");
        res.status(201).json({ id: invoiceId, invoice_number, message: "Invoice created successfully." });

    } catch (error) {
        await dbRun("ROLLBACK;");
        if (error.message.includes("UNIQUE constraint failed")) {
            return res.status(400).json({ error: `An invoice or credit note with number "${invoice_number}" already exists. Please try again.` });
        }
        res.status(500).json({ error: "An unexpected error occurred while saving the invoice.", details: error.message });
    }
});

// PUT (Update) an existing invoice
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });

    try {
        await dbRun("BEGIN TRANSACTION;");

        // 1. Revert old stock movements and delete old transactions
        const oldTransactions = await dbAll("SELECT t.id, tli.product_id, tli.quantity FROM transactions t LEFT JOIN transaction_line_items tli ON t.id = tli.transaction_id WHERE t.related_invoice_id = ? AND t.company_id = ?", [id, companyId]);
        
        const stockReversalPromises = oldTransactions.map(tx => {
            if (tx.product_id) {
                return dbRun("UPDATE products SET current_stock = current_stock + ? WHERE id = ? AND company_id = ?", [tx.quantity, tx.product_id, companyId]);
            }
            return Promise.resolve();
        });
        await Promise.all(stockReversalPromises);
        
        await dbRun("DELETE FROM transactions WHERE related_invoice_id = ? AND company_id = ?", [id, companyId]);
        await dbRun("DELETE FROM invoice_line_items WHERE invoice_id = ?", [id]);

        // 2. Reprocess all data from the request body (same logic as POST)
        let {
            invoice_number, customer_id, invoice_date, due_date, status, notes,
            invoice_type, line_items, cgst_rate = 0, sgst_rate = 0, igst_rate = 0,
            party_bill_returns_amount = 0, reverse_charge, transportation_mode, vehicle_number,
            date_of_supply, place_of_supply_state, place_of_supply_state_code, bundles_count,
            consignee_name, consignee_address_line1, consignee_address_line2,
            consignee_city_pincode, consignee_state, consignee_gstin, consignee_state_code,
            amount_in_words, original_invoice_number,
            payment_being_made_now, payment_method_for_new_payment
        } = req.body;

        const initialPaymentAmount = parseFloat(payment_being_made_now) || 0;
        const isReturn = invoice_type === 'SALES_RETURN';
        let amount_before_tax = 0, total_cgst_amount = 0, total_sgst_amount = 0, total_igst_amount = 0;
        const processed_line_items = line_items.map(item => {
            const quantity = parseFloat(item.quantity);
            const signedQuantity = isReturn ? -Math.abs(quantity) : Math.abs(quantity);
            const unit_price = parseFloat(item.unit_price);
            const discount_amount = parseFloat(item.discount_amount || 0);
            const taxable_value = (signedQuantity * unit_price) - discount_amount;
            amount_before_tax += taxable_value;
            let item_cgst = 0, item_sgst = 0, item_igst = 0;
            if (invoice_type === 'TAX_INVOICE' || (isReturn && (cgst_rate > 0 || sgst_rate > 0 || igst_rate > 0))) {
                if (igst_rate > 0) item_igst = taxable_value * (igst_rate / 100);
                else { item_cgst = taxable_value * (cgst_rate / 100); item_sgst = taxable_value * (sgst_rate / 100); }
            }
            total_cgst_amount += item_cgst; total_sgst_amount += item_sgst; total_igst_amount += item_igst;
            return { ...item, quantity: signedQuantity, taxable_value, cgst_rate, cgst_amount: item_cgst, sgst_rate, sgst_amount: item_sgst, igst_rate, igst_amount: item_igst, line_total: taxable_value + item_cgst + item_sgst + item_igst };
        });
        const final_total_amount = amount_before_tax + total_cgst_amount + total_sgst_amount + total_igst_amount - (parseFloat(party_bill_returns_amount) || 0);

        // 3. Update the invoice header
        const updateInvoiceSql = `UPDATE invoices SET customer_id = ?, invoice_number = ?, invoice_date = ?, due_date = ?, total_amount = ?, amount_before_tax = ?, total_cgst_amount = ?, total_sgst_amount = ?, total_igst_amount = ?, party_bill_returns_amount = ?, status = ?, invoice_type = ?, notes = ?, paid_amount = paid_amount + ?, reverse_charge = ?, transportation_mode = ?, vehicle_number = ?, date_of_supply = ?, place_of_supply_state = ?, place_of_supply_state_code = ?, bundles_count = ?, consignee_name = ?, consignee_address_line1 = ?, consignee_address_line2 = ?, consignee_city_pincode = ?, consignee_state = ?, consignee_gstin = ?, consignee_state_code = ?, amount_in_words = ?, original_invoice_number = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?`;
        await dbRun(updateInvoiceSql, [customer_id, invoice_number, invoice_date, due_date, final_total_amount, amount_before_tax, total_cgst_amount, total_sgst_amount, total_igst_amount, party_bill_returns_amount, status, invoice_type, notes, initialPaymentAmount, reverse_charge, transportation_mode, vehicle_number, date_of_supply, place_of_supply_state, place_of_supply_state_code, bundles_count, consignee_name, consignee_address_line1, consignee_address_line2, consignee_city_pincode, consignee_state, consignee_gstin, consignee_state_code, amount_in_words, original_invoice_number, id, companyId]);

        // 4. Re-insert new line items
        const itemInsertPromises = processed_line_items.map(item => {
            const itemSql = `INSERT INTO invoice_line_items (invoice_id, product_id, description, hsn_acs_code, unit_of_measure, quantity, unit_price, discount_amount, taxable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            return dbRun(itemSql, [id, item.product_id, item.description, item.hsn_acs_code, item.unit_of_measure, item.quantity, item.unit_price, item.discount_amount, item.taxable_value, item.cgst_rate, item.cgst_amount, item.sgst_rate, item.sgst_amount, item.igst_rate, item.igst_amount, item.line_total]);
        });
        await Promise.all(itemInsertPromises);
        
        // 5. Re-create new associated transactions and stock updates
        const invoiceFullDataForTxHelper = { customer_id, invoice_number, total_amount: final_total_amount, paid_amount: initialPaymentAmount, invoice_type, invoice_date, newPaymentMethod: payment_method_for_new_payment };
        await createAssociatedTransactionsAndStockUpdate(id, companyId, invoiceFullDataForTxHelper, processed_line_items);

        await dbRun("COMMIT;");
        res.json({ message: "Invoice updated successfully." });

    } catch (error) {
        await dbRun("ROLLBACK;");
        console.error("Error updating invoice:", error);
        res.status(500).json({ error: "Failed to update invoice.", details: error.message });
    }
});


// DELETE an invoice
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });

    db.serialize(() => {
        db.run("BEGIN TRANSACTION;");
        db.all("SELECT tli.product_id, tli.quantity FROM transaction_line_items tli JOIN transactions t ON tli.transaction_id = t.id WHERE t.related_invoice_id = ? AND t.company_id = ?", [id, companyId], (err, itemsToRevert) => {
            if (err) { db.run("ROLLBACK;"); return res.status(500).json({ error: "Failed to prepare stock reversal.", details: err.message }); }

            const stockReversalPromises = (itemsToRevert || []).map(item => {
                return new Promise((resStock, rejStock) => {
                    const stockChangeToRevert = parseFloat(item.quantity);
                     if (stockChangeToRevert !== 0 && item.product_id) {
                        db.run("UPDATE products SET current_stock = current_stock + ? WHERE id = ? AND company_id = ?", [stockChangeToRevert, item.product_id, companyId], (errStock) => {
                            if (errStock) rejStock(errStock); else resStock();
                        });
                    } else resStock();
                });
            });

            Promise.all(stockReversalPromises)
            .then(() => {
                db.run("DELETE FROM transactions WHERE related_invoice_id = ? AND company_id = ?", [id, companyId], (errDelTX) => {
                    if (errDelTX) { db.run("ROLLBACK;"); return res.status(500).json({ error: "Failed to delete related financial transactions." }); }
                    
                    db.run('DELETE FROM invoices WHERE id = ? AND company_id = ?', [id, companyId], function(err) { 
                        if (err) { db.run("ROLLBACK;"); return res.status(500).json({ error: "Failed to delete invoice." }); }
                        if (this.changes === 0) { db.run("ROLLBACK;"); return res.status(404).json({ error: "Invoice not found or no permission." }); }
                        
                        db.run("COMMIT;", (commitErr) => {
                            if (commitErr) { return res.status(500).json({ error: "Failed to commit invoice deletion." }); }
                            res.json({ message: "Invoice and related data deleted successfully." });
                        });
                    });
                });
            })
            .catch(stockErr => {
                db.run("ROLLBACK;");
                return res.status(500).json({ error: "Failed during stock reversal.", details: stockErr.message });
            });
        });
    });
});

// GET business profile
router.get('/config/business-profile', (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(403).json({ error: "No company associated with this user session." });
    
    db.get('SELECT * FROM companies WHERE id = ?', [companyId], (err, profile) => {
        if (err) return res.status(500).json({ error: "Failed to fetch business profile." });
        res.json(profile || {}); 
    });
});

// GET next invoice number suggestion
router.get('/suggest-next-number', (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    
    db.get("SELECT invoice_number FROM invoices WHERE company_id = ? AND invoice_type != 'SALES_RETURN' ORDER BY id DESC LIMIT 1", [companyId], (err, row) => {
        if (err) return res.status(500).json({ error: "Could not fetch last invoice number." });

        if (!row || !row.invoice_number) {
            const defaultFirstNumber = "INV-00001";
            return res.json({ next_invoice_number: defaultFirstNumber, message: "No previous invoices. Suggested first number." });
        }

        const lastInvoiceNumber = row.invoice_number;
        const match = lastInvoiceNumber.match(/^(.*?)(\d+)$/);

        if (match) {
            const prefix = match[1]; 
            const numericPartStr = match[2];
            const nextNumericVal = parseInt(numericPartStr, 10) + 1;
            const nextNumericPartStr = String(nextNumericVal).padStart(numericPartStr.length, '0');
            return res.json({ next_invoice_number: prefix + nextNumericPartStr });
        }
        
        const fallbackSuggestion = lastInvoiceNumber + "-1";
        return res.json({ message: "Could not automatically determine next number from pattern: '" + lastInvoiceNumber + "'. Fallback suggested.", next_invoice_number: fallbackSuggestion });
    });
});


module.exports = router;