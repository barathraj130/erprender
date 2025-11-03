// routes/productRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

async function dbQuery(sql, params = []) {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(sql, params);
        // Ensure rowCount is attached to rows for consistency in UPDATE/DELETE checks
        const rows = result.rows;
        rows.rowCount = result.rowCount; 
        return rows;
    } catch (e) {
        console.error("PG Query Error:", e.message, "SQL:", sql, "Params:", params);
        throw e;
    } finally {
        if (client) client.release();
    }
}
// Helper function to convert JSON data to a CSV string (JS only)
function convertToCsv(data, headers) {
    if (!Array.isArray(data) || data.length === 0) { return ''; }
    const sanitizeValue = (value) => {
        if (value === null || value === undefined) { return ''; }
        const strValue = String(value);
        if (strValue.includes(',') || strValue.includes('\n') || strValue.includes('"')) {
            return `"${strValue.replace(/"/g, '""')}"`;
        }
        return strValue;
    };
    const headerRow = headers.map(h => sanitizeValue(h.label)).join(',');
    const dataRows = data.map(row => {
        return headers.map(header => {
            return sanitizeValue(row[header.key]);
        }).join(',');
    });
    return [headerRow, ...dataRows].join('\n');
}

// Get all products relevant to the logged-in user's company
router.get('/', async (req, res) => {
    const companyId = req.user.active_company_id;
    const showInactive = req.query.include_inactive === 'true'; 

    if (!companyId) return res.status(400).json({ error: "No active company selected for the user." });
    
    // FIX 1: Use boolean literal TRUE for PG
    const activeFilter = !showInactive ? 'AND p.is_active = TRUE' : '';
    
    // FIX 2 & 3: Use boolean literal TRUE in subqueries and STRING_AGG for concatenation
    const sql = `
        SELECT
            p.*,
            (SELECT l.lender_name 
             FROM product_suppliers ps_pref 
             JOIN lenders l ON ps_pref.supplier_id = l.id 
             WHERE ps_pref.product_id = p.id AND ps_pref.is_preferred = TRUE LIMIT 1) as preferred_supplier_name,
            (SELECT ps_pref.purchase_price 
             FROM product_suppliers ps_pref 
             WHERE ps_pref.product_id = p.id AND ps_pref.is_preferred = TRUE LIMIT 1) as preferred_supplier_purchase_price
        FROM products p
        WHERE p.company_id = $1 ${activeFilter}
        ORDER BY p.id DESC
    `;
    
    try {
        const rows = await dbQuery(sql, [companyId]);
        res.json(rows || []);
    } catch (err) {
        console.error("Error fetching products for company:", err.message);
        return res.status(500).json({ error: "Failed to fetch products.", details: err.message });
    }
});

// Get a single product by ID, including its linked suppliers
router.get('/:id', async (req, res) => {
    const productId = req.params.id;
    const companyId = req.user.active_company_id;
    
    try {
        const productRows = await dbQuery('SELECT * FROM products WHERE id = $1 AND company_id = $2', [productId, companyId]);
        const productData = productRows[0];
        
        if (!productData) return res.status(404).json({ error: "Product not found." });

        const suppliersSql = `
            SELECT 
                ps.id as product_supplier_id, 
                ps.supplier_id, 
                l.lender_name as supplier_name,
                ps.supplier_sku,
                ps.purchase_price,
                ps.lead_time_days,
                ps.is_preferred,
                ps.notes as supplier_specific_notes
            FROM product_suppliers ps
            JOIN lenders l ON ps.supplier_id = l.id
            WHERE ps.product_id = $1 AND l.entity_type = 'Supplier'
            ORDER BY ps.is_preferred DESC, l.lender_name ASC
        `;
        const supplierRows = await dbQuery(suppliersSql, [productId]);
        
        productData.suppliers = supplierRows || [];
        res.json(productData);

    } catch (error) {
        console.error("Error fetching product details:", error.message);
        return res.status(500).json({ error: "Failed to fetch product." });
    }
});

// Create a new product
router.post('/', async (req, res) => {
    const companyId = req.user.active_company_id;
    const { 
        product_name, sku, description, cost_price, sale_price, current_stock, 
        unit_of_measure, low_stock_threshold, hsn_acs_code, reorder_level 
    } = req.body;

    if (!companyId) return res.status(400).json({ error: "Could not identify the company for this operation." });
    if (!product_name || sale_price === undefined || current_stock === undefined ) {
        return res.status(400).json({ error: "Product Name, Sale Price, and Current Stock are required." });
    }
    
    const parsedSalePrice = parseFloat(sale_price);
    const parsedCurrentStock = parseInt(current_stock);
    const parsedCostPrice = (cost_price !== undefined && cost_price !== null) ? parseFloat(cost_price) : 0;
    
    if (isNaN(parsedSalePrice) || isNaN(parsedCurrentStock) || isNaN(parsedCostPrice)) {
        return res.status(400).json({ error: "Pricing and Stock must be valid numbers." });
    }
    
    const sql = `INSERT INTO products (
                    company_id, product_name, sku, description, cost_price, sale_price, current_stock, 
                    unit_of_measure, low_stock_threshold, hsn_acs_code, reorder_level, updated_at, created_at
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()) RETURNING id`;
    const params = [
        companyId, product_name, sku || null, description || null, parsedCostPrice, parsedSalePrice, parsedCurrentStock,
        unit_of_measure || 'pcs', low_stock_threshold ? parseInt(low_stock_threshold) : 0, hsn_acs_code || null,
        reorder_level ? parseInt(reorder_level) : 0
    ];

    try {
        const result = await dbQuery(sql, params);
        const newProductId = result[0].id;
        
        const newProduct = await dbQuery('SELECT * FROM products WHERE id = $1', [newProductId]).then(rows => rows[0]);
        res.status(201).json({ product: newProduct, message: "Product created successfully." });

    } catch (err) {
        if (err.code === '23505') {
            let errorMsg = "A product with this name already exists in your company.";
            if (err.constraint.includes('sku')) errorMsg = "A product with this SKU already exists in your company.";
            return res.status(400).json({ error: errorMsg });
        }
        console.error("Error creating product:", err.message);
        return res.status(500).json({ error: "Failed to create product." });
    }
});

// Update a product
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;
    const { 
        product_name, sku, description, cost_price, sale_price, current_stock, 
        unit_of_measure, low_stock_threshold, hsn_acs_code, reorder_level,
        is_active
    } = req.body;

    if (!companyId) return res.status(400).json({ error: "Could not identify the company for this operation." });
    if (!product_name || sale_price === undefined || current_stock === undefined) {
        return res.status(400).json({ error: "Product Name, Sale Price, and Current Stock are required." });
    }

    const parsedSalePrice = parseFloat(sale_price);
    const parsedCurrentStock = parseInt(current_stock);
    const parsedCostPrice = (cost_price !== undefined && cost_price !== null) ? parseFloat(cost_price) : 0;

    if (isNaN(parsedSalePrice) || isNaN(parsedCurrentStock) || isNaN(parsedCostPrice)) {
        return res.status(400).json({ error: "Pricing and Stock must be valid numbers." });
    }

    const sql = `UPDATE products
                 SET product_name = $1, sku = $2, description = $3, cost_price = $4, sale_price = $5, 
                     current_stock = $6, unit_of_measure = $7, low_stock_threshold = $8, hsn_acs_code = $9, 
                     reorder_level = $10, is_active = $11, updated_at = NOW()
                 WHERE id = $12 AND company_id = $13`;
    const params = [
        product_name, sku || null, description || null, parsedCostPrice, parsedSalePrice, parsedCurrentStock,
        unit_of_measure || 'pcs', low_stock_threshold ? parseInt(low_stock_threshold) : 0, hsn_acs_code || null,
        reorder_level ? parseInt(reorder_level) : 0, is_active === 0 ? false : true, id, companyId
    ];

    try {
        const result = await dbQuery(sql, params);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Product not found or you do not have permission to edit it." });
        }
        const updatedProduct = await dbQuery('SELECT * FROM products WHERE id = $1', [id]).then(rows => rows[0]);
        res.json({ product: updatedProduct, message: "Product updated successfully." });

    } catch (err) {
        if (err.code === '23505') {
            let errorMsg = "Product name already exists for another product.";
            if (err.constraint.includes('sku')) errorMsg = "SKU already exists for another product.";
            return res.status(400).json({ error: errorMsg });
        }
        console.error("Error updating product:", err.message);
        return res.status(500).json({ error: "Failed to update product." });
    }
});

// Delete a product (Hard Delete)
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;
    let client;
    
    if (!companyId) return res.status(400).json({ error: "Could not identify the company for this operation." });

    try {
        // 1. Check Usage 
        const checkTxSql = 'SELECT COUNT(*) as count FROM transaction_line_items WHERE product_id = $1';
        const checkInvSql = 'SELECT COUNT(*) as count FROM invoice_line_items WHERE product_id = $1';
        
        const txCount = await dbQuery(checkTxSql, [id]).then(rows => parseInt(rows[0].count, 10));
        const invCount = await dbQuery(checkInvSql, [id]).then(rows => parseInt(rows[0].count, 10));

        if (txCount > 0) return res.status(400).json({ error: "Cannot delete product. It is used in existing financial transactions. Consider deactivating it instead." });
        if (invCount > 0) return res.status(400).json({ error: "Cannot delete product. It is used in existing invoices. Consider deactivating it or removing it from invoices first." });
            
        client = await pool.connect();
        await client.query("BEGIN");
        
        // 2. Delete product links 
        await client.query('DELETE FROM product_suppliers WHERE product_id = $1', [id]);

        // 3. Delete Product
        const deleteResult = await client.query('DELETE FROM products WHERE id = $1 AND company_id = $2', [id, companyId]);

        if (deleteResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Product not found for deletion or you do not have permission." });
        }
        
        await client.query("COMMIT");
        res.json({ message: "Product and its supplier links deleted successfully." });

    } catch (error) {
        if (client) await client.query("ROLLBACK");
        console.error("Error deleting product:", error.message);
        return res.status(500).json({ error: "Failed to delete product." });
    } finally {
        if (client) client.release();
    }
});

// ROUTE: Deactivate a product
router.put('/:id/deactivate', async (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "Company not identified." });

    const sql = `UPDATE products SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND company_id = $2`;
    try {
        const result = await dbQuery(sql, [id, companyId]);
        if (result.rowCount === 0) return res.status(404).json({ error: "Product not found or no permission." });
        res.json({ message: "Product deactivated successfully." });
    } catch (err) {
        return res.status(500).json({ error: "Failed to deactivate product." });
    }
});

// ROUTE: Reactivate a product
router.put('/:id/reactivate', async (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "Company not identified." });
    
    const sql = `UPDATE products SET is_active = TRUE, updated_at = NOW() WHERE id = $1 AND company_id = $2`;
    try {
        const result = await dbQuery(sql, [id, companyId]);
        if (result.rowCount === 0) return res.status(404).json({ error: "Product not found or no permission." });
        res.json({ message: "Product reactivated successfully." });
    } catch (err) {
        return res.status(500).json({ error: "Failed to reactivate product." });
    }
});


// EXPORT ROUTE
router.get('/export', async (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "Company not identified for export." });

    // PG SQL using string_agg
    const sql = `
        SELECT 
            p.id, p.product_name, p.sku, p.description, p.cost_price, p.sale_price, p.current_stock, 
            p.unit_of_measure, p.hsn_acs_code, p.low_stock_threshold, p.reorder_level,
            STRING_AGG(l.lender_name, '; ') as suppliers
        FROM products p 
        LEFT JOIN product_suppliers ps ON ps.product_id = p.id
        LEFT JOIN lenders l ON ps.supplier_id = l.id
        WHERE p.company_id = $1
        GROUP BY p.id
        ORDER BY p.id DESC
    `;
    
    try {
        const rows = await dbQuery(sql, [companyId]);

        const headers = [
            { key: 'id', label: 'Product ID' },
            { key: 'product_name', label: 'Product Name' },
            { key: 'sku', label: 'SKU' },
            { key: 'description', label: 'Description' },
            { key: 'cost_price', label: 'Cost Price' },
            { key: 'sale_price', label: 'Sale Price' },
            { key: 'current_stock', label: 'Current Stock' },
            { key: 'unit_of_measure', label: 'Unit' },
            { key: 'hsn_acs_code', label: 'HSN/ACS Code' },
            { key: 'low_stock_threshold', label: 'Low Stock Threshold' },
            { key: 'suppliers', label: 'Linked Suppliers' }
        ];

        const csv = convertToCsv(rows, headers);
        res.header('Content-Type', 'text/csv');
        res.attachment('products_export.csv');
        res.send(csv);
    } catch (err) {
        return res.status(500).json({ error: "Failed to fetch product data for export.", details: err.message });
    }
});

module.exports = router;