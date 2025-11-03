// routes/productRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper function to convert JSON data to a CSV string
function convertToCsv(data, headers) {
    if (!Array.isArray(data) || data.length === 0) {
        return '';
    }

    const sanitizeValue = (value) => {
        if (value === null || value === undefined) {
            return '';
        }
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
router.get('/', (req, res) => {
    // --- FIX: Correct property name for company ID from JWT payload ---
    const companyId = req.user.active_company_id;
    const showInactive = req.query.include_inactive === 'true'; // Check for query parameter

    // --- FIX: Check if companyId exists ---
    if (!companyId) {
        return res.status(400).json({ error: "No active company selected for the user." });
    }
    
    const activeFilter = !showInactive ? 'AND p.is_active = 1' : '';

    // --- FIX: Corrected SQL to fetch products by company_id, not through complex and incorrect joins ---
    const sql = `
        SELECT
            p.*,
            (SELECT l.lender_name 
             FROM product_suppliers ps_pref 
             JOIN lenders l ON ps_pref.supplier_id = l.id 
             WHERE ps_pref.product_id = p.id AND ps_pref.is_preferred = 1 LIMIT 1) as preferred_supplier_name,
            (SELECT ps_pref.purchase_price 
             FROM product_suppliers ps_pref 
             WHERE ps_pref.product_id = p.id AND ps_pref.is_preferred = 1 LIMIT 1) as preferred_supplier_purchase_price
        FROM products p
        WHERE p.company_id = ? ${activeFilter}
        ORDER BY p.id DESC
    `;
    
    db.all(sql, [companyId], (err, rows) => {
        if (err) {
            console.error("Error fetching products for company:", err.message);
            return res.status(500).json({ error: "Failed to fetch products.", details: err.message });
        }
        res.json(rows || []);
    });
});

// Get a single product by ID, including its linked suppliers
router.get('/:id', (req, res) => {
    const productId = req.params.id;
    let productData;

    db.get('SELECT * FROM products WHERE id = ?', [productId], (err, productRow) => {
        if (err) {
            console.error("Error fetching product:", err.message);
            return res.status(500).json({ error: "Failed to fetch product." });
        }
        if (!productRow) {
            return res.status(404).json({ error: "Product not found." });
        }
        productData = productRow;

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
            WHERE ps.product_id = ? AND l.entity_type = 'Supplier'
            ORDER BY ps.is_preferred DESC, l.lender_name ASC
        `;
        db.all(suppliersSql, [productId], (supplierErr, supplierRows) => {
            if (supplierErr) {
                console.error("Error fetching suppliers for product:", supplierErr.message);
                productData.suppliers = [];
                productData.supplier_error = "Could not fetch supplier details.";
                return res.json(productData);
            }
            productData.suppliers = supplierRows || [];
            res.json(productData);
        });
    });
});

// Create a new product
router.post('/', (req, res) => {
    // --- FIX: Get company_id from authenticated user ---
    const companyId = req.user.active_company_id;
    const { 
        product_name, sku, description, cost_price,
        sale_price, current_stock, 
        unit_of_measure, low_stock_threshold, hsn_acs_code, reorder_level 
    } = req.body;

    if (!companyId) {
        return res.status(400).json({ error: "Could not identify the company for this operation." });
    }
    if (!product_name || sale_price === undefined || current_stock === undefined ) {
        return res.status(400).json({ error: "Product Name, Sale Price, and Current Stock are required." });
    }
    if (isNaN(parseFloat(sale_price)) || isNaN(parseInt(current_stock))) {
        return res.status(400).json({ error: "Sale Price and Current Stock must be valid numbers." });
    }
    if (cost_price !== undefined && cost_price !== null && isNaN(parseFloat(cost_price)) ) {
        return res.status(400).json({ error: "Cost Price must be a valid number if provided."})
    }

    // --- FIX: Add company_id to the INSERT statement ---
    const sql = `INSERT INTO products (
                    company_id, product_name, sku, description, cost_price, sale_price, current_stock, 
                    unit_of_measure, low_stock_threshold, hsn_acs_code, reorder_level, updated_at, created_at
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`;
    db.run(sql, [
        companyId,
        product_name,
        sku || null,
        description || null,
        (cost_price !== undefined && cost_price !== null) ? parseFloat(cost_price) : 0,
        parseFloat(sale_price),
        parseInt(current_stock),
        unit_of_measure || 'pcs',
        low_stock_threshold ? parseInt(low_stock_threshold) : 0,
        hsn_acs_code || null,
        reorder_level ? parseInt(reorder_level) : 0
    ], function(err) {
        if (err) {
            if (err.message.includes("UNIQUE constraint failed") && err.message.includes("product_name")) {
                return res.status(400).json({ error: "A product with this name already exists in your company." });
            }
            if (sku && err.message.includes("UNIQUE constraint failed") && err.message.includes("sku")) {
                return res.status(400).json({ error: "A product with this SKU already exists in your company." });
            }
            console.error("Error creating product:", err.message);
            return res.status(500).json({ error: "Failed to create product." });
        }
        db.get('SELECT * FROM products WHERE id = ?', [this.lastID], (fetchErr, newProduct) => {
            if (fetchErr) {
                return res.status(201).json({ id: this.lastID, product_name, message: "Product created successfully, but failed to fetch details."});
            }
            res.status(201).json({ product: newProduct, message: "Product created successfully." });
        });
    });
});

// Update a product
router.put('/:id', (req, res) => {
    const { id } = req.params;
    // --- FIX: Get company_id from authenticated user ---
    const companyId = req.user.active_company_id;
    const { 
        product_name, sku, description, cost_price, sale_price, current_stock, 
        unit_of_measure, low_stock_threshold, hsn_acs_code, reorder_level,
        is_active
    } = req.body;

    if (!companyId) {
        return res.status(400).json({ error: "Could not identify the company for this operation." });
    }

    if (!product_name || sale_price === undefined || current_stock === undefined) {
        return res.status(400).json({ error: "Product Name, Sale Price, and Current Stock are required." });
    }
    if (isNaN(parseFloat(sale_price)) || isNaN(parseInt(current_stock))) {
        return res.status(400).json({ error: "Sale Price and Current Stock must be valid numbers." });
    }
    if (cost_price !== undefined && cost_price !== null && isNaN(parseFloat(cost_price))) {
        return res.status(400).json({ error: "Cost Price must be a valid number if provided."})
    }

    // --- FIX: Add company_id to the WHERE clause for security ---
    const sql = `UPDATE products
                 SET product_name = ?, sku = ?, description = ?, cost_price = ?, sale_price = ?, 
                     current_stock = ?, unit_of_measure = ?, low_stock_threshold = ?, hsn_acs_code = ?, 
                     reorder_level = ?, is_active = ?, updated_at = datetime('now')
                 WHERE id = ? AND company_id = ?`;
    db.run(sql, [
        product_name,
        sku || null,
        description || null,
        (cost_price !== undefined && cost_price !== null) ? parseFloat(cost_price) : 0,
        parseFloat(sale_price),
        parseInt(current_stock),
        unit_of_measure || 'pcs',
        low_stock_threshold ? parseInt(low_stock_threshold) : 0,
        hsn_acs_code || null,
        reorder_level ? parseInt(reorder_level) : 0,
        is_active === 0 ? 0 : 1, // Ensure it's 0 or 1
        id,
        companyId
    ], function(err) {
        if (err) {
            if (err.message.includes("UNIQUE constraint failed") && err.message.includes("product_name")) {
                return res.status(400).json({ error: "Product name already exists for another product." });
            }
            if (sku && err.message.includes("UNIQUE constraint failed") && err.message.includes("sku")) {
                return res.status(400).json({ error: "SKU already exists for another product." });
            }
            console.error("Error updating product:", err.message);
            return res.status(500).json({ error: "Failed to update product." });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: "Product not found or you do not have permission to edit it." });
        }
        db.get('SELECT * FROM products WHERE id = ?', [id], (fetchErr, updatedProduct) => {
             if (fetchErr) {
                return res.json({ message: "Product updated successfully, but failed to fetch details."});
            }
            res.json({ product: updatedProduct, message: "Product updated successfully." });
        });
    });
});

// Delete a product (Hard Delete)
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;

    if (!companyId) {
        return res.status(400).json({ error: "Could not identify the company for this operation." });
    }

    db.get('SELECT COUNT(*) as count FROM transaction_line_items WHERE product_id = ?', [id], (err, row) => {
        if (err) {
            console.error("Error checking product usage in transactions:", err.message);
            return res.status(500).json({ error: "Failed to check product usage in transactions." });
        }
        if (row && row.count > 0) {
            return res.status(400).json({ error: "Cannot delete product. It is used in existing financial transactions. Consider deactivating it instead." });
        }

        db.get('SELECT COUNT(*) as count FROM invoice_line_items WHERE product_id = ?', [id], (errInv, rowInv) => {
            if (errInv) {
                console.error("Error checking product usage in invoices:", errInv.message);
                return res.status(500).json({ error: "Failed to check product usage in invoices." });
            }
            if (rowInv && rowInv.count > 0) {
                return res.status(400).json({ error: "Cannot delete product. It is used in existing invoices. Consider deactivating it or removing it from invoices first." });
            }
            
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                db.run('DELETE FROM product_suppliers WHERE product_id = ?', [id], (psErr) => { // This doesn't need company_id as product_id is unique
                    if (psErr) {
                        db.run("ROLLBACK");
                        console.error("Error deleting product-supplier links:", psErr.message);
                        return res.status(500).json({ error: "Failed to delete product-supplier links." });
                    }
                    db.run('DELETE FROM products WHERE id = ? AND company_id = ?', [id, companyId], function(prodErr) { // --- FIX: Add company_id check
                        if (prodErr) {
                            db.run("ROLLBACK");
                            console.error("Error deleting product:", prodErr.message);
                            return res.status(500).json({ error: "Failed to delete product." });
                        }
                        if (this.changes === 0) {
                            db.run("ROLLBACK");
                            return res.status(404).json({ error: "Product not found for deletion or you do not have permission." });
                        }
                        db.run("COMMIT");
                        res.json({ message: "Product and its supplier links deleted successfully." });
                    });
                });
            });
        });
    });
});

// ROUTE: Deactivate a product
router.put('/:id/deactivate', (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "Company not identified." });

    const sql = `UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND company_id = ?`;
    db.run(sql, [id, companyId], function(err) {
        if (err) {
            console.error("Error deactivating product:", err.message);
            return res.status(500).json({ error: "Failed to deactivate product." });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: "Product not found or no permission." });
        }
        res.json({ message: "Product deactivated successfully." });
    });
});

// ROUTE: Reactivate a product
router.put('/:id/reactivate', (req, res) => {
    const { id } = req.params;
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "Company not identified." });
    
    const sql = `UPDATE products SET is_active = 1, updated_at = datetime('now') WHERE id = ? AND company_id = ?`;
    db.run(sql, [id, companyId], function(err) {
        if (err) {
            console.error("Error reactivating product:", err.message);
            return res.status(500).json({ error: "Failed to reactivate product." });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: "Product not found or no permission." });
        }
        res.json({ message: "Product reactivated successfully." });
    });
});


// EXPORT ROUTE
router.get('/export', (req, res) => {
    const companyId = req.user.active_company_id;
    if (!companyId) return res.status(400).json({ error: "Company not identified for export." });

    const sql = `
        SELECT 
            p.id, p.product_name, p.sku, p.description, p.cost_price, p.sale_price, p.current_stock, 
            p.unit_of_measure, p.hsn_acs_code, p.low_stock_threshold, p.reorder_level,
            (SELECT GROUP_CONCAT(l.lender_name, '; ') FROM product_suppliers ps JOIN lenders l ON ps.supplier_id = l.id WHERE ps.product_id = p.id) as suppliers
        FROM products p 
        WHERE p.company_id = ?
        ORDER BY p.id DESC
    `;
    db.all(sql, [companyId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: "Failed to fetch product data for export." });
        }

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
    });
});

module.exports = router;