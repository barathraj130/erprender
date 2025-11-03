// models/invoiceModel.js
const db = require('../db');

class Invoice {
    static create(invoiceData, lineItems, callback) {
        db.serialize(() => {
            db.run("BEGIN TRANSACTION;");

            const invoiceSql = `INSERT INTO invoices (customer_id, invoice_number, invoice_date, due_date, total_amount, status, notes, paid_amount, related_transaction_id, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`;
            db.run(invoiceSql, [
                invoiceData.customer_id, invoiceData.invoice_number, invoiceData.invoice_date, invoiceData.due_date,
                invoiceData.total_amount, invoiceData.status || 'Draft', invoiceData.notes, invoiceData.paid_amount || 0,
                invoiceData.related_transaction_id || null
            ], function (err) {
                if (err) {
                    db.run("ROLLBACK;");
                    return callback(err);
                }
                const invoiceId = this.lastID;
                if (!lineItems || lineItems.length === 0) {
                    db.run("COMMIT;");
                    return callback(null, invoiceId);
                }

                const itemPromises = lineItems.map(item => {
                    return new Promise((resolve, reject) => {
                        const itemSql = `INSERT INTO invoice_line_items (invoice_id, product_id, description, quantity, unit_price, line_total)
                                         VALUES (?, ?, ?, ?, ?, ?)`;
                        db.run(itemSql, [
                            invoiceId, item.product_id || null, item.description,
                            item.quantity, item.unit_price, item.line_total
                        ], (itemErr) => {
                            if (itemErr) reject(itemErr);
                            else resolve();
                        });
                    });
                });

                Promise.all(itemPromises)
                    .then(() => {
                        db.run("COMMIT;", (commitErr) => {
                            if (commitErr) {
                                db.run("ROLLBACK;"); // Attempt rollback
                                return callback(commitErr);
                            }
                            callback(null, invoiceId);
                        });
                    })
                    .catch(itemErr => {
                        db.run("ROLLBACK;");
                        callback(itemErr);
                    });
            });
        });
    }

    static getAll(callback) {
        const sql = `
            SELECT i.*, u.username as customer_name
            FROM invoices i
            JOIN users u ON i.customer_id = u.id
            ORDER BY i.invoice_date DESC, i.id DESC
        `;
        db.all(sql, [], callback);
    }

    static getById(id, callback) {
        const invoiceSql = `
            SELECT i.*, u.username as customer_name
            FROM invoices i
            JOIN users u ON i.customer_id = u.id
            WHERE i.id = ?
        `;
        db.get(invoiceSql, [id], (err, invoice) => {
            if (err) return callback(err);
            if (!invoice) return callback(null, null); // Not found

            const itemsSql = `SELECT il.*, p.product_name 
                              FROM invoice_line_items il 
                              LEFT JOIN products p ON il.product_id = p.id
                              WHERE il.invoice_id = ?`;
            db.all(itemsSql, [id], (itemErr, items) => {
                if (itemErr) return callback(itemErr);
                invoice.line_items = items || [];
                callback(null, invoice);
            });
        });
    }

    static update(id, invoiceData, lineItems, callback) {
        db.serialize(() => {
            db.run("BEGIN TRANSACTION;");

            const updateInvoiceSql = `UPDATE invoices SET
                customer_id = ?, invoice_number = ?, invoice_date = ?, due_date = ?,
                total_amount = ?, status = ?, notes = ?, paid_amount = ?, related_transaction_id = ?,
                updated_at = datetime('now')
                WHERE id = ?`;
            db.run(updateInvoiceSql, [
                invoiceData.customer_id, invoiceData.invoice_number, invoiceData.invoice_date, invoiceData.due_date,
                invoiceData.total_amount, invoiceData.status, invoiceData.notes, invoiceData.paid_amount,
                invoiceData.related_transaction_id, id
            ], function (err) {
                if (err) {
                    db.run("ROLLBACK;");
                    return callback(err);
                }
                if (this.changes === 0 && !(invoiceData.id && parseInt(invoiceData.id) === parseInt(id))) { // Check if ID exists if no changes
                    db.get("SELECT id FROM invoices WHERE id = ?", [id], (e, r) => {
                        if (!r) {
                            db.run("ROLLBACK;");
                            return callback(new Error("Invoice not found."));
                        }
                        // If invoice exists but no changes, proceed to line items
                    });
                }


                db.run("DELETE FROM invoice_line_items WHERE invoice_id = ?", [id], (deleteErr) => {
                    if (deleteErr) {
                        db.run("ROLLBACK;");
                        return callback(deleteErr);
                    }

                    if (!lineItems || lineItems.length === 0) {
                        db.run("COMMIT;");
                        return callback(null, this.changes); // this.changes here refers to DELETE op
                    }

                    const itemPromises = lineItems.map(item => {
                        return new Promise((resolve, reject) => {
                            const itemSql = `INSERT INTO invoice_line_items (invoice_id, product_id, description, quantity, unit_price, line_total)
                                             VALUES (?, ?, ?, ?, ?, ?)`;
                            db.run(itemSql, [
                                id, item.product_id || null, item.description,
                                item.quantity, item.unit_price, item.line_total
                            ], (itemErr) => {
                                if (itemErr) reject(itemErr);
                                else resolve();
                            });
                        });
                    });

                    Promise.all(itemPromises)
                        .then(() => {
                            db.run("COMMIT;", (commitErr) => {
                                if (commitErr) {
                                    db.run("ROLLBACK;");
                                    return callback(commitErr);
                                }
                                callback(null, 1); // Indicate success, even if main invoice header had no textual changes
                            });
                        })
                        .catch(itemErr => {
                            db.run("ROLLBACK;");
                            callback(itemErr);
                        });
                });
            });
        });
    }

    static delete(id, callback) {
        db.run("DELETE FROM invoices WHERE id = ?", [id], function (err) { // CASCADE deletes line items
            callback(err, this.changes);
        });
    }

    static getNextInvoiceNumber(callback) {
        db.get("SELECT MAX(CAST(SUBSTR(invoice_number, INSTR(invoice_number, '-') + 1) AS INTEGER)) as max_num FROM invoices WHERE invoice_number LIKE 'INV-%'", (err, row) => {
            if (err) return callback(err);
            const nextNum = (row && row.max_num) ? row.max_num + 1 : 1;
            callback(null, `INV-${String(nextNum).padStart(5, '0')}`);
        });
    }
}

module.exports = Invoice;