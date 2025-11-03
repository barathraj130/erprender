// routes/jwtAuthRoutes.js (FINAL CORRECTED VERSION)
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
// --- PG FIX: Import pool ---
const { pool } = require('../db'); 
const { jwtSecret } = require('../config'); 
const { checkJwtAuth } = require('../middlewares/jwtAuthMiddleware');

async function dbQuery(sql, params = []) {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(sql, params);
        // PG returns rows; lastID must be handled separately for inserts not using RETURNING
        return result.rows;
    } catch (e) {
        console.error("PG Query Error:", e.message, "SQL:", sql, "Params:", params);
        throw e;
    } finally {
        if (client) client.release();
    }
}

router.post('/signup', async (req, res) => {
    const { username, userEmail, password, company_name, state } = req.body;
    if (!username || !userEmail || !password || !company_name || !state) {
        return res.status(400).json({ error: "Username, Email, Password, Company Name, and State are required." });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Create Company
        const companySql = `INSERT INTO companies (company_name, state) VALUES ($1, $2) RETURNING id`;
        const companyResult = await client.query(companySql, [company_name, state]);
        const newCompanyId = companyResult.rows[0].id;

        // 2. Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 3. Create User
        const userSql = `INSERT INTO users (username, email, password, role, active_company_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`;
        const userResult = await client.query(userSql, [username, userEmail, hashedPassword, 'admin', newCompanyId]);
        const newUserId = userResult.rows[0].id;

        // 4. Link User to Company
        const linkSql = `INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2)`;
        await client.query(linkSql, [newUserId, newCompanyId]);
        
        await client.query('COMMIT');
        res.status(201).json({ message: "Company and admin created successfully! Please log in." });

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        
        if (err.code === '23505') { // PostgreSQL unique constraint violation
            let errorMsg = "Registration failed. ";
            if (err.constraint.includes('users_username_key')) errorMsg = "This username is already taken. Please choose another.";
            else if (err.constraint.includes('users_email_key')) errorMsg = "This email is already registered to a user. Please use another.";
            else if (err.constraint.includes('companies_company_name_key')) errorMsg = "A company with this name is already registered.";
            return res.status(400).json({ error: errorMsg, details: err.message });
        }
        
        console.error("Signup DB Error:", err);
        return res.status(500).json({ error: "Failed to complete signup.", details: err.message });
    } finally {
        if (client) client.release();
    }
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Please enter all fields.' });

    try {
        const userRows = await dbQuery('SELECT id, username, password, role, active_company_id FROM users WHERE username = $1', [username]);
        const user = userRows[0];
        
        if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
        if (!user.password) return res.status(401).json({ error: 'This user account is not configured for password login.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Invalid credentials.' });

        
        let activeCompanyId = user.active_company_id;
        
        if (!activeCompanyId) {
            const companyLinkRows = await dbQuery('SELECT company_id FROM user_companies WHERE user_id = $1 LIMIT 1', [user.id]);
            activeCompanyId = companyLinkRows.length > 0 ? companyLinkRows[0].company_id : null;
        }

        if (!activeCompanyId) {
            console.error(`CRITICAL: User '${username}' has no linked company.`);
            return res.status(500).json({ error: 'Server configuration error. User is not linked to a company.' });
        }

        // Update active_company_id on successful login (non-critical update)
        await dbQuery('UPDATE users SET active_company_id = $1 WHERE id = $2', [activeCompanyId, user.id]);
        
        const payload = { user: { id: user.id, username: user.username, role: user.role, active_company_id: activeCompanyId } };
        
        jwt.sign(payload, jwtSecret, { expiresIn: '8h' }, (jwtErr, token) => {
            if (jwtErr) return res.status(500).json({ error: 'Error signing token.' });
            res.json({ token });
        });
        
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: 'Server error during login.' });
    }
});

router.get('/me', checkJwtAuth, async (req, res) => {
    try {
        const userRows = await dbQuery('SELECT id, username, email, role, active_company_id FROM users WHERE id = $1', [req.user.id]);
        const user = userRows[0];
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Server error fetching user details.' });
    }
});

module.exports = router;