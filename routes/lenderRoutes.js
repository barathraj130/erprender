// routes/lenderRoutes.js

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

// Get all external entities
router.get('/', async (req, res) => {
  let sql = 'SELECT id, lender_name, entity_type, contact_person, phone, email, notes, initial_payable_balance, created_at FROM lenders ORDER BY lender_name ASC';
  const params = [];

  if (req.query.type) {
    sql = 'SELECT id, lender_name, entity_type, contact_person, phone, email, notes, initial_payable_balance, created_at FROM lenders WHERE entity_type = $1 ORDER BY lender_name ASC';
    params.push(req.query.type);
  }

  try {
    const rows = await dbQuery(sql, params);
    
    if (!rows || rows.length === 0) {
        return res.json([]);
    }

    // Only calculate detailed payables if the request is specifically for Suppliers
    if (req.query.type === 'Supplier') {
        const suppliersWithPayable = await Promise.all(rows.map(async (supplier) => {
            let currentPayable = parseFloat(supplier.initial_payable_balance || 0);

            // 1. Sum of actual financial transactions with this supplier.
            const financialTransactionsSql = `
              SELECT COALESCE(SUM(amount), 0) as transactions_sum
              FROM transactions
              WHERE lender_id = $1
            `;
            const ftRows = await dbQuery(financialTransactionsSql, [supplier.id]);
            const ftRow = ftRows[0];
            
            currentPayable += parseFloat(ftRow.transactions_sum || 0);
              
            return { ...supplier, current_payable: currentPayable };
        }));
        res.json(suppliersWithPayable);
    } else {
        res.json(rows);
    }
  } catch (err) {
    console.error("Error fetching external entities or calculating payables:", err.message);
    return res.status(500).json({ error: "Database error while fetching entities.", details: err.message });
  }
});


// Create a new external entity
router.post('/', async (req, res) => {
  const { lender_name, entity_type, contact_person, phone, email, notes, initial_payable_balance } = req.body;
  const companyId = req.user.active_company_id; 

  if (!lender_name) {
    return res.status(400).json({ error: 'Entity name is required' });
  }
  const actualInitialPayable = (entity_type === 'Supplier') ? (parseFloat(initial_payable_balance) || 0) : 0;

  const sql = `INSERT INTO lenders (company_id, lender_name, entity_type, contact_person, phone, email, notes, initial_payable_balance)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`;
  const params = [companyId, lender_name, entity_type || 'General', contact_person, phone, email, notes, actualInitialPayable];
  
  try {
    const insertResult = await dbQuery(sql, params);
    const newEntityId = insertResult[0].id;

    const fetchSql = 'SELECT id, lender_name, entity_type, contact_person, phone, email, notes, initial_payable_balance, created_at FROM lenders WHERE id = $1';
    const newEntity = await dbQuery(fetchSql, [newEntityId]).then(rows => rows[0]);

    const entityToSend = (newEntity && newEntity.entity_type === 'Supplier') 
        ? { ...newEntity, current_payable: parseFloat(newEntity.initial_payable_balance || 0) } 
        : newEntity;

    res.status(201).json({ entity: entityToSend, id: newEntityId, message: 'External entity created successfully' });

  } catch (err) {
    if (err.code === '23505') { 
      return res.status(400).json({ error: "Entity name already exists for this company." });
    }
    console.error("Error creating external entity:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Update an external entity
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.active_company_id;
  const { lender_name, entity_type, contact_person, phone, email, notes, initial_payable_balance } = req.body;
  
  if (!lender_name) {
    return res.status(400).json({ error: 'Entity name is required' });
  }
  const actualInitialPayable = (entity_type === 'Supplier') ? (parseFloat(initial_payable_balance) || 0) : 0;

  const sql = `UPDATE lenders
               SET lender_name = $1, entity_type = $2, contact_person = $3, phone = $4, email = $5, notes = $6, initial_payable_balance = $7
               WHERE id = $8 AND company_id = $9`;
  const params = [lender_name, entity_type || 'General', contact_person, phone, email, notes, actualInitialPayable, id, companyId];

  try {
    const updateResult = await dbQuery(sql, params);
    
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ message: 'External entity not found or no changes made (or forbidden).' });
    }
    
    const fetchSql = 'SELECT id, lender_name, entity_type, contact_person, phone, email, notes, initial_payable_balance, created_at FROM lenders WHERE id = $1';
    const updatedEntity = await dbQuery(fetchSql, [id]).then(rows => rows[0]);
    
    res.json({ entity: updatedEntity, message: 'External entity updated successfully' });

  } catch (err) {
    if (err.code === '23505') { 
      return res.status(400).json({ error: "Entity name already exists for another entity in this company." });
    }
    console.error("Error updating external entity:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Delete an external entity
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.active_company_id;

  try {
    const sql = 'DELETE FROM lenders WHERE id = $1 AND company_id = $2';
    const result = await dbQuery(sql, [id, companyId]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'External entity not found or forbidden.' });
    }
    res.json({ message: 'External entity deleted successfully.' });

  } catch (err) {
    console.error("Error deleting external entity:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;