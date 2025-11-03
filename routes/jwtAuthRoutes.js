// routes/jwtAuthRoutes.js (FINAL CORRECTED VERSION)
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { jwtSecret } = require('../config'); // CORRECTED: Was 'jwtConfig'
const { checkJwtAuth } = require('../middlewares/jwtAuthMiddleware');

router.post('/signup', (req, res) => {
    const { username, userEmail, password, company_name, state } = req.body;
    if (!username || !userEmail || !password || !company_name || !state) {
        return res.status(400).json({ error: "Username, Email, Password, Company Name, and State are required." });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION;");

        const companySql = `INSERT INTO companies (company_name, state) VALUES (?, ?)`;
        db.run(companySql, [company_name, state], function(err) {
            if (err) {
                db.run("ROLLBACK;");
                return res.status(500).json({ error: "Failed to create company. It might already exist.", details: err.message });
            }
            const newCompanyId = this.lastID;

            bcrypt.hash(password, 10, (hashErr, hashedPassword) => {
                if (hashErr) {
                    db.run("ROLLBACK;");
                    return res.status(500).json({ error: "Server error: Failed to secure password." });
                }

                const userSql = `INSERT INTO users (username, email, password, role, active_company_id) VALUES (?, ?, ?, ?, ?)`;
                db.run(userSql, [username, userEmail, hashedPassword, 'admin', newCompanyId], function(err) {
                    if (err) {
                        db.run("ROLLBACK;");
                        return res.status(500).json({ error: "Failed to create admin user. Username or Email may be taken.", details: err.message });
                    }
                    const newUserId = this.lastID;

                    const linkSql = `INSERT INTO user_companies (user_id, company_id) VALUES (?, ?)`;
                    db.run(linkSql, [newUserId, newCompanyId], (linkErr) => {
                        if (linkErr) {
                            db.run("ROLLBACK;");
                            return res.status(500).json({ error: "Fatal error: Failed to link user to the new company.", details: linkErr.message });
                        }
                        
                        db.run("COMMIT;", (commitErr) => {
                            if (commitErr) {
                                db.run("ROLLBACK;");
                                return res.status(500).json({ error: "Database commit failed during signup." });
                            }
                            res.status(201).json({ message: "Company and admin created successfully! Please log in." });
                        });
                    });
                });
            });
        });
    });
});

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Please enter all fields.' });

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) return res.status(500).json({ error: 'Database error during login.' });
        if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

        // --- START OF FIX ---
        // Add a defensive check to ensure the user account has a password set.
        // This prevents crashes and provides a clearer error message.
        if (!user.password) {
            return res.status(401).json({ error: 'This user account is not configured for password login.' });
        }
        // --- END OF FIX ---
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Invalid credentials.' });

        db.get('SELECT company_id FROM user_companies WHERE user_id = ? LIMIT 1', [user.id], (companyErr, companyRow) => {
            if (companyErr) return res.status(500).json({ error: 'Server error verifying company access.' });
            
            // --- START OF FIX ---
            // Ensure the user is linked to a company before creating a token.
            const activeCompanyId = user.active_company_id || (companyRow ? companyRow.company_id : null);
            if (!activeCompanyId) {
                console.error(`CRITICAL: User '${username}' has no active_company_id and is not linked to any company.`);
                return res.status(500).json({ error: 'Server configuration error. User is not linked to a company.' });
            }
            // --- END OF FIX ---

            db.run('UPDATE users SET active_company_id = ? WHERE id = ?', [activeCompanyId, user.id], (updateErr) => {
                if (updateErr) console.error("Non-fatal error: Could not set active company on login:", updateErr);
                
                const payload = { user: { id: user.id, username: user.username, role: user.role, active_company_id: activeCompanyId } };
                jwt.sign(payload, jwtSecret, { expiresIn: '8h' }, (jwtErr, token) => {
                    if (jwtErr) return res.status(500).json({ error: 'Error signing token.' });
                    res.json({ token });
                });
            });
        });
    });
});

router.get('/me', checkJwtAuth, (req, res) => {
    db.get('SELECT id, username, email, role, active_company_id FROM users WHERE id = ?', [req.user.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found.' });
        res.json(user);
    });
});

module.exports = router;