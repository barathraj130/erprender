// routes/productSupplierRoutes.js
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
// --- NEW HELPER FUNCTION TO CREATE THE MISSING TRANSACTION (CORRECTED AS PG ASYNC) ---
async function createInitialStockTransaction(productId, supplierId, purchasePrice) {
    console.log(`[AUTO-TX] Checking if initial stock transaction is needed for Product ID: ${productId}, Supplier ID: ${supplierId}`);
    
    try {
        // Step 1: Get the product's current stock.
        const productRows = await dbQuery('SELECT current_stock, company_id FROM products WHERE id = $1', [productId]);
        const product = productRows[0];
            
        if (!product || product.current_stock <= 0) {
            console.log(`[AUTO-TX] Product ${productId} has no stock. Skipping initial stock transaction.`);
            return;
        }

        const stockValue = product.current_stock * purchasePrice;
        if (stockValue <= 0) {
            console.log(`[AUTO-TX] Initial stock for product ${productId} has no value (stock * price = 0). Skipping transaction.`);
            return;
        }

        // Step 2: Check if an initial stock transaction has ALREADY been created.
        const checkSql = `SELECT id FROM transactions WHERE category = 'Initial Stock Purchase (On Credit)' AND description LIKE $1 AND company_id = $2`;
        const checkDesc = `Initial stock value for product ID ${productId}%`;

        const existingTx = await dbQuery(checkSql, [checkDesc, product.company_id]);
            
        if (existingTx.length > 0) {
            console.log(`[AUTO-TX] Initial stock transaction for product ${productId} already exists (ID: ${existingTx[0].id}). Skipping creation.`);
            return;
        }

        // Step 3: Create the financial transaction.
        const insertSql = `INSERT INTO transactions (company_id, lender_id, amount, description, category, date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`;
        const description = `Initial stock value for product ID ${productId} from supplier ID ${supplierId}`;
        const category = 'Initial Stock Purchase (On Credit)';
        const date = new Date().toISOString().split('T')[0]; 

        const txResult = await dbQuery(insertSql, [product.company_id, supplierId, stockValue, description, category, date]);
        const newTxId = txResult[0].id;
        
        console.log(`[AUTO-TX] SUCCESS: Automatically created initial stock purchase transaction ID: ${newTxId} for product ${productId}. Amount: ${stockValue}`);
    } catch (err) {
        console.error(`[AUTO-TX-ERROR] Failed in initial stock transaction logic:`, err.message);
        throw new Error('Failed to create automated stock transaction.');
    }
}


// Get all suppliers for a specific product
router.get('/product/:productId', async (req, res) => {
    const { productId } = req.params;
    const sql = `
        SELECT 
            ps.id as product_supplier_id, ps.product_id, ps.supplier_id, ps.supplier_sku, 
            ps.purchase_price, ps.lead_time_days, ps.is_preferred, ps.notes,
            l.lender_name as supplier_name, l.entity_type as supplier_type
        FROM product_suppliers ps
        JOIN lenders l ON ps.supplier_id = l.id
        WHERE ps.product_id = $1 AND l.entity_type = 'Supplier'
        ORDER BY ps.is_preferred DESC, l.lender_name ASC
    `;
    try {
        const rows = await dbQuery(sql, [productId]);
        res.json(rows || []);
    } catch (err) {
        console.error("Error fetching suppliers for product:", err.message);
        return res.status(500).json({ error: "Failed to fetch suppliers for product." });
    }
});

// Get all products for a specific supplier
router.get('/supplier/:supplierId', async (req, res) => {
    const { supplierId } = req.params;
    const sql = `
        SELECT 
            ps.id as product_supplier_id, ps.product_id, ps.supplier_id, ps.supplier_sku, 
            ps.purchase_price, ps.lead_time_days, ps.is_preferred, ps.notes,
            p.product_name, p.sku as product_sku, p.current_stock
        FROM product_suppliers ps
        JOIN products p ON ps.product_id = p.id
        WHERE ps.supplier_id = $1
        ORDER BY p.product_name ASC
    `;
    try {
        const rows = await dbQuery(sql, [supplierId]);
        res.json(rows || []);
    } catch (err) {
        console.error("Error fetching products for supplier:", err.message);
        return res.status(500).json({ error: "Failed to fetch products for supplier." });
    }
});


// Link a supplier to a product
router.post('/', async (req, res) => {
    const { 
        product_id, supplier_id, supplier_sku, 
        purchase_price, lead_time_days, is_preferred, notes 
    } = req.body;

    if (!product_id || !supplier_id) {
        return res.status(400).json({ error: "Product ID and Supplier ID are required." });
    }
    const finalPurchasePrice = purchase_price ? parseFloat(purchase_price) : 0;
    if (isNaN(finalPurchasePrice)) {
        return res.status(400).json({ error: "Purchase price must be a valid number if provided." });
    }

    const sql = `INSERT INTO product_suppliers 
                 (product_id, supplier_id, supplier_sku, purchase_price, lead_time_days, is_preferred, notes, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id`;
    const params = [
        product_id, supplier_id, supplier_sku || null, 
        finalPurchasePrice, 
        lead_time_days ? parseInt(lead_time_days) : null,
        is_preferred || false,
        notes || null
    ];
    
    try {
        const insertResult = await dbQuery(sql, params);
        const newLinkId = insertResult[0].id;

        if (is_preferred && finalPurchasePrice > 0) {
            await createInitialStockTransaction(product_id, supplier_id, finalPurchasePrice);
        }
        
        res.status(201).json({ id: newLinkId, message: "Product linked to supplier successfully." });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: "This product is already linked to this supplier." });
        }
        console.error("Error linking product to supplier:", err.message);
        return res.status(500).json({ error: "Failed to link product to supplier." });
    }
});

// Update a product-supplier link
router.put('/:productSupplierId', async (req, res) => {
    const { productSupplierId } = req.params;
    const { supplier_sku, purchase_price, lead_time_days, is_preferred, notes } = req.body;

    const finalPurchasePrice = purchase_price ? parseFloat(purchase_price) : 0;
    if (isNaN(finalPurchasePrice)) {
        return res.status(400).json({ error: "Purchase price must be a valid number if provided." });
    }
    
    const sql = `UPDATE product_suppliers 
                 SET supplier_sku = $1, purchase_price = $2, lead_time_days = $3, is_preferred = $4, notes = $5, updated_at = NOW()
                 WHERE id = $6 RETURNING product_id, supplier_id`;
    const params = [
        supplier_sku || null, finalPurchasePrice, 
        lead_time_days ? parseInt(lead_time_days) : null,
        is_preferred || false, notes || null, productSupplierId
    ];
    
    try {
        const updateResult = await dbQuery(sql, params);
        if (updateResult.rowCount === 0) {
            return res.status(404).json({ error: "Product-supplier link not found." });
        }
        
        const link = updateResult[0]; // Contains product_id and supplier_id
        
        if (is_preferred && finalPurchasePrice > 0) {
            await createInitialStockTransaction(link.product_id, link.supplier_id, finalPurchasePrice);
        }
        
        res.json({ message: "Product-supplier link updated successfully." });

    } catch (err) {
        console.error("Error updating product-supplier link:", err.message);
        return res.status(500).json({ error: "Failed to update product-supplier link." });
    }
});

// Unlink a supplier from a product
router.delete('/:productSupplierId', async (req, res) => {
    const { productSupplierId } = req.params;
    try {
        const sql = 'DELETE FROM product_suppliers WHERE id = $1';
        const result = await dbQuery(sql, [productSupplierId]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Product-supplier link not found." });
        }
        res.json({ message: "Product unlinked from supplier successfully." });
    } catch (err) {
        console.error("Error unlinking product from supplier:", err.message);
        return res.status(500).json({ error: "Failed to unlink product from supplier." });
    }
});

module.exports = router;