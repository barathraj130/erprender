// START OF FILE routes/authRoutes.js (FINAL CORRECTED VERSION)

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { jwtSecret } = require('../config');
const { checkAuth } = require('../middlewares/authMiddleware');

// @route   POST /auth/signup
// @desc    Register a new company and its first admin user
// @access  Public
router.post('/signup', (req, res) => {
    const { 
        username, 
        userEmail, // This comes from the 'name' attribute in the signup form
        password,
        company_name, 
        address_line1,
        city_pincode,
        state,
        gstin,
        phone,
        email: companyEmail // This also comes from the signup form
    } = req.body;

    if (!username || !password || !company_name || !userEmail) {
        return res.status(400).json({ error: "Admin username, admin email, password, and company name are required." });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION;");

        const companySql = `INSERT INTO companies (company_name, address_line1, city_pincode, state, gstin, phone, email) 
                            VALUES (?, ?, ?, ?, ?, ?, ?)`;
        
        db.run(companySql, [company_name, address_line1, city_pincode, state, gstin, phone, companyEmail], function(err) {
            if (err) {
                db.run("ROLLBACK;");
                if (err.code === 'SQLITE_CONSTRAINT') {
                    if (err.message.includes('companies.gstin')) return res.status(400).json({ error: "A company with this GSTIN is already registered." });
                    if (err.message.includes('companies.email')) return res.status(400).json({ error: "A company with this email is already registered." });
                }
                console.error("Signup DB Error (Company):", err);
                return res.status(500).json({ error: "Failed to create company profile." });
            }
            
            const newCompanyId = this.lastID;

            bcrypt.hash(password, 10, (hashErr, hashedPassword) => {
                if (hashErr) {
                    db.run("ROLLBACK;");
                    return res.status(500).json({ error: "Server error: Failed to secure password." });
                }

                const userSql = `INSERT INTO users (company_id, username, email, password, role) 
                                 VALUES (?, ?, ?, ?, ?)`;

                db.run(userSql, [newCompanyId, username, userEmail, hashedPassword, 'admin'], function(err) {
                    if (err) {
                        db.run("ROLLBACK;");
                        // *** THIS IS THE KEY FIX ***
                        // Check the error code for a constraint violation
                        if (err.code === 'SQLITE_CONSTRAINT') {
                            if (err.message.includes('users.username')) {
                                return res.status(400).json({ error: "This username is already taken. Please choose another." });
                            }
                            if (err.message.includes('users.email')) {
                                return res.status(400).json({ error: "This email is already registered to a user. Please use another." });
                            }
                        }
                        // For any other error, give a generic message
                        console.error("Signup DB Error (User):", err);
                        return res.status(500).json({ error: "Failed to create admin user." });
                    }

                    db.run("COMMIT;", (commitErr) => {
                        if (commitErr) {
                            return res.status(500).json({ error: "Database error: Failed to finalize signup." });
                        }
                        res.status(201).json({ message: "Company and admin user created successfully! You can now log in." });
                    });
                });
            });
        });
    });
});


// The rest of the file (login, me) is unchanged and correct.
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Please enter all fields.' });
    }
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) return res.status(500).json({ error: 'Database error during login.' });
        if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
        if (!user.password) return res.status(401).json({ error: 'This user account is not configured for password login.' });

        // **NEW DEFENSIVE CHECK**
        if ((user.role === 'admin' || user.role === 'user') && !user.company_id) {
            console.error(`CRITICAL: User '${username}' has no company_id. Database is not set up correctly.`);
            return res.status(500).json({ error: 'Server configuration error. User is not linked to a company.' });
        }

        try {
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) return res.status(401).json({ error: 'Invalid credentials.' });

            const payload = {
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    companyId: user.company_id
                }
            };

            jwt.sign(payload, jwtSecret, { expiresIn: '8h' }, (err, token) => {
                if (err) throw err;
                res.json({ token });
            });
        } catch (e) {
            res.status(500).json({ error: 'Server error during password comparison.' });
        }
    });
});

router.get('/me', checkAuth, (req, res) => {
    const { password, ...userWithoutPassword } = req.user;
    res.json(userWithoutPassword);
});


module.exports = router;