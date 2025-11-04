const express = require('express');
const router = express.Router();
const { pool } = require('../db'); 

// Async Query Wrapper
async function dbQuery(sql, params = []) {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(sql, params);
        return result.rows;
    } catch (e) {
        console.error('PG Query Error:', e.message, 'SQL:', sql, 'PARAMS:', params);
        throw e;
    } finally {
        if (client) client.release();
    }
}

// --- Transactional Helpers (Fully Async PG using client) ---

async function generateNotificationForLowStock(client, productId, companyId) {
    // ... (This function relies on client.query, which we know works)
    const productSql = `SELECT product_name, current_stock, low_stock_threshold 
                        FROM products WHERE id = $1 AND company_id = $2`;
    const productResult = await client.query(productSql, [productId, companyId]);
    const product = productResult.rows[0];

    if (!product) return;
    
    if (product.low_stock_threshold > 0 && product.current_stock <= product.low_stock_threshold) {
        const message = `Low stock alert for ${product.product_name}. Current stock: ${product.current_stock}.`;
        
        const existingSql = `SELECT id FROM notifications WHERE message = $1 AND is_read = FALSE`;
        const existing = await client.query(existingSql, [message]);
        
        if (existing.rows.length === 0) {
            const insertSql = `INSERT INTO notifications (message, type, link) VALUES ($1, $2, $3)`;
            await client.query(insertSql, [message, 'warning', `/inventory#product-${productId}`]);
        }
    }
}

async function createAssociatedTransactionsAndStockUpdate(client, invoiceId, companyId, invoiceData, processedLineItems) {
    // ... (This function relies on client.query, which we know works)
    const { customer_id, invoice_number, total_amount, paid_amount, invoice_type, invoice_date, newPaymentMethod } = invoiceData;
    
    // 1. Create the main Sale/Credit Note transaction
    if (parseFloat(total_amount) !== 0) {
        const isReturn = invoice_type === 'SALES_RETURN';
        const saleCategoryName = isReturn ? "Product Return from Customer (Credit Note)" : "Sale to Customer (On Credit)";
        const saleTxActualAmount = parseFloat(total_amount); 
        
        const saleTransactionSql = `INSERT INTO transactions (company_id, user_id, amount, description, category, date, related_invoice_id) 
                                    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`;
        const saleTransactionParams = [companyId, customer_id, saleTxActualAmount, isReturn ? `Credit Note for ${invoice_number}` : `Invoice ${invoice_number}`, saleCategoryName, invoice_date, invoiceId];
        
        const saleTxResult = await client.query(saleTransactionSql, saleTransactionParams);
        const saleTransactionId = saleTxResult.rows[0].id;
        
        for (const item of processedLineItems) {
            if (!item.product_id) continue;
            
            const stockChange = item.quantity; 
            
            // Update Stock
            const updateStockSql = `UPDATE products SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`;
            await client.query(updateStockSql, [ -stockChange, item.product_id, companyId]);

            // Insert Transaction Line Item
            const txLineItemSql = `INSERT INTO transaction_line_items (transaction_id, product_id, quantity, unit_sale_price) VALUES ($1, $2, $3, $4)`;
            await client.query(txLineItemSql, [saleTransactionId, item.product_id, item.quantity, item.unit_price]);
            
            await generateNotificationForLowStock(client, item.product_id, companyId);
        }
    }

    // 2. Create the payment/refund transaction ONLY if a payment was made now
    const currentPaymentMade = parseFloat(paid_amount) || 0;
    if (currentPaymentMade !== 0 && newPaymentMethod) {
        let paymentCategoryName;
        if (newPaymentMethod.toLowerCase() === 'cash') {
            paymentCategoryName = currentPaymentMade > 0 ? "Payment Received from Customer (Cash)" : "Product Return from Customer (Refund via Cash)";
        } else { 
            paymentCategoryName = currentPaymentMade > 0 ? "Payment Received from Customer (Bank)" : "Product Return from Customer (Refund via Bank)";
        }
        
        const paymentTxActualAmount = -currentPaymentMade; 
        
        const paymentTransactionSql = `INSERT INTO transactions (company_id, user_id, amount, description, category, date, related_invoice_id) 
                                       VALUES ($1, $2, $3, $4, $5, $6, $7)`;
        const paymentTransactionParams = [companyId, customer_id, paymentTxActualAmount, `Payment/Refund for Invoice ${invoice_number}`, paymentCategoryName, invoice_date, invoiceId];
        
        await client.query(paymentTransactionSql, paymentTransactionParams);
    }
}
// -------------------------------------------------------------------------------


// GET all invoices
router.get('/', async (req, res) => {
    try {
        const companyId = req.user.active_company_id;
        if (!companyId) return res.status(400).json({ error: "No active company selected." });
        
        const sql = `SELECT i.*, u.username as customer_name 
                     FROM invoices i JOIN users u ON i.customer_id = u.id 
                     WHERE i.company_id = $1 ORDER BY i.invoice_date DESC, i.id DESC`;
        
        const rows = await dbQuery(sql, [companyId]);
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

        const invoiceSql = `SELECT i.*, c.username as customer_name, c.email as customer_email, c.phone as customer_phone, c.company as customer_company, c.address_line1 as customer_address_line1, c.address_line2 as customer_address_line2, c.city_pincode as customer_city_pincode, c.state as customer_state, c.gstin as customer_gstin, c.state_code as customer_state_code, comp.company_name as business_company_name, comp.address_line1 as business_address_line1, comp.address_line2 as business_address_line2, comp.city_pincode as business_city_pincode, comp.state as business_state, comp.gstin as business_gstin, comp.state_code as business_state_code, comp.phone as business_phone, comp.email as business_email, comp.bank_name as business_bank_name, comp.bank_account_no as business_bank_account_no, comp.bank_ifsc_code as business_bank_ifsc_code, comp.logo_url as business_logo_url 
                            FROM invoices i 
                            LEFT JOIN users c ON i.customer_id = c.id 
                            LEFT JOIN companies comp ON i.company_id = comp.id 
                            WHERE i.id = $1 AND i.company_id = $2`;
        
        const invoice = await dbQuery(invoiceSql, [id, companyId]).then(rows => rows[0]);
        
        if (!invoice) return res.status(404).json({ error: "Invoice not found or you do not have permission to view it." });

        // Consignee fallback logic (JS only)
        // ... (JS logic for populating consignee details)
        
        const itemsSql = `SELECT ili.*, p.product_name, p.sku as product_sku, COALESCE(ili.hsn_acs_code, p.hsn_acs_code) as final_hsn_acs_code, COALESCE(ili.unit_of_measure, p.unit_of_measure) as final_unit_of_measure 
                          FROM invoice_line_items ili 
                          LEFT JOIN products p ON ili.product_id = p.id 
                          WHERE ili.invoice_id = $1`;
        
        const items = await dbQuery(itemsSql, [id]);
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

    let client;
    try {
        if (isReturn) {
            const date = new Date();
            const prefix = `CN-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}-`;
            
            const lastCreditNoteSql = "SELECT invoice_number FROM invoices WHERE company_id = $1 AND invoice_number LIKE $2 ORDER BY id DESC LIMIT 1";
            const lastCreditNote = await dbQuery(lastCreditNoteSql, [companyId, `${prefix}%`]).then(rows => rows[0]);
            
            let nextNum = 1;
            if (lastCreditNote) {
                const lastNum = parseInt(lastCreditNote.invoice_number.split('-').pop());
                if (!isNaN(lastNum)) nextNum = lastNum + 1;
            }
            invoice_number = `${prefix}${String(nextNum).padStart(4, '0')}`;
        }

        if ((!invoice_number && !isReturn) || !customer_id || !invoice_date || !due_date || !invoice_type || !line_items || line_items.length === 0) {
            return res.status(400).json({ error: "Missing required fields." });
        }

        let amount_before_tax = 0, total_cgst_amount = 0, total_sgst_amount = 0, total_igst_amount = 0;
        
        // Ensure rates are numerical and default to 0
        const finalCgstRate = parseFloat(cgst_rate) || 0;
        const finalSgstRate = parseFloat(sgst_rate) || 0;
        const finalIgstRate = parseFloat(igst_rate) || 0;
        
        const processed_line_items = line_items.map(item => {
            const quantity = parseFloat(item.quantity);
            const signedQuantity = isReturn ? -Math.abs(quantity) : Math.abs(quantity);
            const unit_price = parseFloat(item.unit_price);
            const discount_amount = parseFloat(item.discount_amount || 0);
            const taxable_value = (signedQuantity * unit_price) - discount_amount;
            amount_before_tax += taxable_value;
            
            let item_cgst = 0, item_sgst = 0, item_igst = 0;
            
            if (invoice_type === 'TAX_INVOICE' || (isReturn && (finalCgstRate > 0 || finalSgstRate > 0 || finalIgstRate > 0))) {
                if (finalIgstRate > 0) item_igst = taxable_value * (finalIgstRate / 100);
                else { item_cgst = taxable_value * (finalCgstRate / 100); item_sgst = taxable_value * (finalSgstRate / 100); }
            }
            
            total_cgst_amount += item_cgst; 
            total_sgst_amount += item_sgst; 
            total_igst_amount += item_igst;
            
            return { 
                ...item, 
                quantity: signedQuantity, 
                taxable_value, 
                cgst_rate: finalCgstRate, 
                cgst_amount: item_cgst, 
                sgst_rate: finalSgstRate, 
                sgst_amount: item_sgst, 
                igst_rate: finalIgstRate, 
                igst_amount: item_igst, 
                line_total: taxable_value + item_cgst + item_sgst + item_igst 
            };
        });
        
        const final_total_amount = amount_before_tax + total_cgst_amount + total_sgst_amount + total_igst_amount - (parseFloat(party_bill_returns_amount) || 0);

        
        client = await pool.connect();
        await client.query("BEGIN");

        const invoiceSql = `INSERT INTO invoices (company_id, customer_id, invoice_number, invoice_date, due_date, total_amount, amount_before_tax, total_cgst_amount, total_sgst_amount, total_igst_amount, party_bill_returns_amount, status, invoice_type, notes, paid_amount, reverse_charge, transportation_mode, vehicle_number, date_of_supply, place_of_supply_state, place_of_supply_state_code, bundles_count, consignee_name, consignee_address_line1, consignee_address_line2, consignee_city_pincode, consignee_state, consignee_gstin, consignee_state_code, amount_in_words, original_invoice_number) 
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31) RETURNING id`;
                            
        const invoiceHeaderParams = [
            companyId, customer_id, invoice_number, invoice_date, due_date, final_total_amount, 
            amount_before_tax, total_cgst_amount, total_sgst_amount, total_igst_amount, 
            parseFloat(party_bill_returns_amount) || 0, status, invoice_type, notes, initialPaymentAmount, 
            reverse_charge, transportation_mode, vehicle_number, date_of_supply, place_of_supply_state, 
            place_of_supply_state_code, bundles_count, consignee_name, consignee_address_line1, 
            consignee_address_line2, consignee_city_pincode, consignee_state, consignee_gstin, 
            consignee_state_code, amount_in_words, original_invoice_number
        ];
        
        const insertResult = await client.query(invoiceSql, invoiceHeaderParams);
        const invoiceId = insertResult.rows[0].id;

        const itemInsertSql = `INSERT INTO invoice_line_items (invoice_id, product_id, description, hsn_acs_code, unit_of_measure, quantity, unit_price, discount_amount, taxable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, line_total) 
                               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`;
        
        for (const item of processed_line_items) {
            await client.query(itemInsertSql, [
                invoiceId, item.product_id, item.description, item.hsn_acs_code, item.unit_of_measure, 
                item.quantity, item.unit_price, item.discount_amount, item.taxable_value, 
                item.cgst_rate, item.cgst_amount, item.sgst_rate, item.sgst_amount, 
                item.igst_rate, item.igst_amount, item.line_total
            ]);
        }
        
        // Create associated transactions and stock updates using the transactional client
        await createAssociatedTransactionsAndStockUpdate(client, invoiceId, companyId, { customer_id, invoice_number, total_amount: final_total_amount, paid_amount: initialPaymentAmount, invoice_type, invoice_date, newPaymentMethod: payment_method_for_new_payment }, processed_line_items);

        await client.query("COMMIT");
        res.status(201).json({ id: invoiceId, invoice_number, message: "Invoice created successfully." });

    } catch (error) {
        if (client) await client.query("ROLLBACK");
        if (error.code === '23505') {
            return res.status(400).json({ error: `An invoice or credit note with number "${invoice_number}" already exists. Please try again.` });
        }
        // Log the error detail for debugging on the server console
        console.error("Error saving invoice:", error);
        res.status(500).json({ error: "An unexpected error occurred while saving the invoice.", details: error.message });
    } finally {
        if (client) client.release();
    }
});

// PUT (Update) an existing invoice
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });

    let client;
    try {
        client = await pool.connect();
        await client.query("BEGIN");

        // --- 1. Revert old stock movements and delete old transactions ---
        const oldTransactionsSql = "SELECT t.id, tli.product_id, tli.quantity FROM transactions t LEFT JOIN transaction_line_items tli ON t.id = tli.transaction_id WHERE t.related_invoice_id = $1 AND t.company_id = $2";
        const oldTransactions = await client.query(oldTransactionsSql, [id, companyId]).then(r => r.rows);
        
        for (const tx of oldTransactions) {
            if (tx.product_id) {
                // Revert stock change (by adding back the signed quantity)
                await client.query("UPDATE products SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2 AND company_id = $3", [tx.quantity, tx.product_id, companyId]);
            }
        }
        
        await client.query("DELETE FROM transactions WHERE related_invoice_id = $1 AND company_id = $2", [id, companyId]);
        await client.query("DELETE FROM invoice_line_items WHERE invoice_id = $1", [id]);

        // --- 2. Reprocess all data from the request body (same logic as POST) ---
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
        
        // Ensure rates are numerical and default to 0
        const finalCgstRate = parseFloat(cgst_rate) || 0;
        const finalSgstRate = parseFloat(sgst_rate) || 0;
        const finalIgstRate = parseFloat(igst_rate) || 0;
        
        // Recalculate line items 
        const processed_line_items = line_items.map(item => {
            const quantity = parseFloat(item.quantity);
            const signedQuantity = isReturn ? -Math.abs(quantity) : Math.abs(quantity);
            const unit_price = parseFloat(item.unit_price);
            const discount_amount = parseFloat(item.discount_amount || 0);
            const taxable_value = (signedQuantity * unit_price) - discount_amount;
            amount_before_tax += taxable_value;
            
            let item_cgst = 0, item_sgst = 0, item_igst = 0;
            if (invoice_type === 'TAX_INVOICE' || (isReturn && (finalCgstRate > 0 || finalSgstRate > 0 || finalIgstRate > 0))) {
                if (finalIgstRate > 0) item_igst = taxable_value * (finalIgstRate / 100);
                else { item_cgst = taxable_value * (finalCgstRate / 100); item_sgst = taxable_value * (finalSgstRate / 100); }
            }
            total_cgst_amount += item_cgst; total_sgst_amount += item_sgst; total_igst_amount += item_igst;
            
            return { 
                ...item, 
                quantity: signedQuantity, 
                taxable_value, 
                cgst_rate: finalCgstRate, 
                cgst_amount: item_cgst, 
                sgst_rate: finalSgstRate, 
                sgst_amount: item_sgst, 
                igst_rate: finalIgstRate, 
                igst_amount: item_igst, 
                line_total: taxable_value + item_cgst + item_sgst + item_igst 
            };
        });
        const final_total_amount = amount_before_tax + total_cgst_amount + total_sgst_amount + total_igst_amount - (parseFloat(party_bill_returns_amount) || 0);

        // --- 3. Update the invoice header ---
        const updateInvoiceSql = `UPDATE invoices SET customer_id = $1, invoice_number = $2, invoice_date = $3, due_date = $4, total_amount = $5, amount_before_tax = $6, total_cgst_amount = $7, total_sgst_amount = $8, total_igst_amount = $9, party_bill_returns_amount = $10, status = $11, invoice_type = $12, notes = $13, paid_amount = paid_amount + $14, reverse_charge = $15, transportation_mode = $16, vehicle_number = $17, date_of_supply = $18, place_of_supply_state = $19, place_of_supply_state_code = $20, bundles_count = $21, consignee_name = $22, consignee_address_line1 = $23, consignee_address_line2 = $24, consignee_city_pincode = $25, consignee_state = $26, consignee_gstin = $27, consignee_state_code = $28, amount_in_words = $29, original_invoice_number = $30, updated_at = NOW() WHERE id = $31 AND company_id = $32 RETURNING id`;
        
        const updateParams = [customer_id, invoice_number, invoice_date, due_date, final_total_amount, amount_before_tax, total_cgst_amount, total_sgst_amount, total_igst_amount, party_bill_returns_amount, status, invoice_type, notes, initialPaymentAmount, reverse_charge, transportation_mode, vehicle_number, date_of_supply, place_of_supply_state, place_of_supply_state_code, bundles_count, consignee_name, consignee_address_line1, consignee_address_line2, consignee_city_pincode, consignee_state, consignee_gstin, consignee_state_code, amount_in_words, original_invoice_number, id, companyId];
        
        await client.query(updateInvoiceSql, updateParams);

        // --- 4. Re-insert new line items ---
        const itemInsertSql = `INSERT INTO invoice_line_items (invoice_id, product_id, description, hsn_acs_code, unit_of_measure, quantity, unit_price, discount_amount, taxable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, line_total) 
                               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`;
        
        for (const item of processed_line_items) {
            await client.query(itemInsertSql, [id, item.product_id, item.description, item.hsn_acs_code, item.unit_of_measure, item.quantity, item.unit_price, item.discount_amount, item.taxable_value, item.cgst_rate, item.cgst_amount, item.sgst_rate, item.sgst_amount, item.igst_rate, item.igst_amount, item.line_total]);
        }
        
        // --- 5. Re-create new associated transactions and stock updates ---
        const invoiceFullDataForTxHelper = { customer_id, invoice_number, total_amount: final_total_amount, paid_amount: initialPaymentAmount, invoice_type, invoice_date, newPaymentMethod: payment_method_for_new_payment };
        await createAssociatedTransactionsAndStockUpdate(client, id, companyId, invoiceFullDataForTxHelper, processed_line_items);

        await client.query("COMMIT");
        res.json({ message: "Invoice updated successfully." });

    } catch (error) {
        if (client) await client.query("ROLLBACK");
        console.error("Error updating invoice:", error);
        res.status(500).json({ error: "Failed to update invoice.", details: error.message });
    } finally {
        if (client) client.release();
    }
});


// DELETE an invoice
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });

    let client;
    try {
        client = await pool.connect();
        await client.query("BEGIN");
        
        // 1. Get transaction and line item data to determine stock reversal
        const oldTransactionsSql = "SELECT t.id, tli.product_id, tli.quantity FROM transactions t LEFT JOIN transaction_line_items tli ON t.id = tli.transaction_id WHERE t.related_invoice_id = $1 AND t.company_id = $2";
        const itemsToRevert = await client.query(oldTransactionsSql, [id, companyId]).then(r => r.rows);

        // 2. Revert Stock Changes
        for (const item of itemsToRevert) {
            if (item.product_id) {
                // Revert stock change (by adding back the signed quantity)
                await client.query("UPDATE products SET current_stock = current_stock + $1 WHERE id = $2 AND company_id = $3", [item.quantity, item.product_id, companyId]);
            }
        }
        
        // 3. Delete related transactions (deletes transaction_line_items due to CASCADE)
        await client.query("DELETE FROM transactions WHERE related_invoice_id = $1 AND company_id = $2", [id, companyId]);
        
        // 4. Delete Invoice (deletes invoice_line_items due to CASCADE)
        const deleteInvResult = await client.query('DELETE FROM invoices WHERE id = $1 AND company_id = $2', [id, companyId]);
        
        if (deleteInvResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Invoice not found or no permission." });
        }
        
        await client.query("COMMIT");
        res.json({ message: "Invoice and related data deleted successfully." });

    } catch (error) {
        if (client) await client.query("ROLLBACK");
        console.error("Error deleting invoice:", error);
        return res.status(500).json({ error: "Failed to delete invoice.", details: error.message });
    } finally {
        if (client) client.release();
    }
});

// GET business profile
router.get('/config/business-profile', async (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(403).json({ error: "No company associated with this user session." });
    
    try {
        const profile = await dbQuery('SELECT * FROM companies WHERE id = $1', [companyId]).then(rows => rows[0]);
        res.json(profile || {}); 
    } catch (err) {
        return res.status(500).json({ error: "Failed to fetch business profile." });
    }
});

// GET next invoice number suggestion
router.get('/suggest-next-number', async (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "No active company selected." });
    
    const sql = `
        SELECT invoice_number
        FROM invoices 
        WHERE company_id = $1 AND invoice_type != 'SALES_RETURN' 
        ORDER BY id DESC LIMIT 1`;

    try {
        const row = await dbQuery(sql, [companyId]).then(rows => rows[0]);

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

    } catch (err) {
        return res.status(500).json({ error: "Could not fetch last invoice number.", details: err.message });
    }
});


module.exports = router;