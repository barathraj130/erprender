// routes/chitFundRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// --- CHIT GROUP ROUTES ---

// GET all chit groups
router.get('/', (req, res) => {
    db.all(`SELECT * FROM chit_groups ORDER BY start_date DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// GET details for a single chit group
router.get('/:id', (req, res) => {
    const { id } = req.params;
    const responseData = {};

    db.get(`SELECT * FROM chit_groups WHERE id = ?`, [id], (err, group) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!group) return res.status(404).json({ error: "Chit group not found" });
        responseData.group = group;

        const membersSql = `SELECT cm.id, cm.user_id, cm.is_prized_subscriber, u.username 
                            FROM chit_group_members cm JOIN users u ON cm.user_id = u.id
                            WHERE cm.chit_group_id = ?`;
        db.all(membersSql, [id], (err, members) => {
            if (err) return res.status(500).json({ error: err.message });
            responseData.members = members;

            const auctionsSql = `SELECT ca.*, u.username as winner_name FROM chit_auctions ca
                                 JOIN users u ON ca.prized_subscriber_user_id = u.id
                                 WHERE ca.chit_group_id = ? ORDER BY ca.auction_month ASC`;
            db.all(auctionsSql, [id], (err, auctions) => {
                if (err) return res.status(500).json({ error: err.message });
                responseData.auctions = auctions;
                res.json(responseData);
            });
        });
    });
});

// POST a new chit group
router.post('/', (req, res) => {
    const { group_name, chit_value, monthly_contribution, member_count, duration_months, foreman_commission_percent, start_date } = req.body;
    const sql = `INSERT INTO chit_groups (group_name, chit_value, monthly_contribution, member_count, duration_months, foreman_commission_percent, start_date)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, [group_name, chit_value, monthly_contribution, member_count, duration_months, foreman_commission_percent, start_date], function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.status(201).json({ id: this.lastID, message: 'Chit group created.' });
    });
});

// --- CHIT MEMBER ROUTES ---

// POST a new member to a group
router.post('/:groupId/members', (req, res) => {
    const { groupId } = req.params;
    const { user_id } = req.body;
    const join_date = new Date().toISOString().split('T')[0];

    const sql = `INSERT INTO chit_group_members (chit_group_id, user_id, join_date) VALUES (?, ?, ?)`;
    db.run(sql, [groupId, user_id, join_date], function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.status(201).json({ id: this.lastID, message: 'Member added.' });
    });
});


// --- CHIT AUCTION ROUTES ---

// POST a new auction result
router.post('/:groupId/auctions', (req, res) => {
    const { groupId } = req.params;
    const { auction_month, auction_date, winning_bid_discount, prized_subscriber_user_id } = req.body;

    db.get('SELECT * FROM chit_groups WHERE id = ?', [groupId], (err, group) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!group) return res.status(404).json({ error: "Chit group not found" });

        const foreman_commission = group.chit_value * (group.foreman_commission_percent / 100);
        const total_discount_pool = winning_bid_discount - foreman_commission;
        const dividend_amount = total_discount_pool / group.member_count;
        const net_monthly_contribution = group.monthly_contribution - dividend_amount;
        const payout_amount = group.chit_value - winning_bid_discount;
        
        db.serialize(() => {
            db.run("BEGIN TRANSACTION;");
            
            const auctionSql = `INSERT INTO chit_auctions (chit_group_id, auction_month, auction_date, winning_bid_discount, dividend_amount, foreman_commission, net_monthly_contribution, prized_subscriber_user_id, payout_amount)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            db.run(auctionSql, [groupId, auction_month, auction_date, winning_bid_discount, dividend_amount, foreman_commission, net_monthly_contribution, prized_subscriber_user_id, payout_amount], function(err) {
                if (err) { db.run("ROLLBACK;"); return res.status(400).json({ error: err.message }); }

                const updateMemberSql = `UPDATE chit_group_members SET is_prized_subscriber = 1, prized_month = ? WHERE chit_group_id = ? AND user_id = ?`;
                db.run(updateMemberSql, [auction_month, groupId, prized_subscriber_user_id], (err) => {
                    if (err) { db.run("ROLLBACK;"); return res.status(500).json({ error: err.message }); }

                    // Create transactions for all members
                    db.all(`SELECT user_id FROM chit_group_members WHERE chit_group_id = ?`, [groupId], (err, members) => {
                        if (err) { db.run("ROLLBACK;"); return res.status(500).json({ error: err.message }); }

                        const txPromises = members.map(member => {
                            return new Promise((resolve, reject) => {
                                let amount, category, description;
                                if (member.user_id === prized_subscriber_user_id) {
                                    // Winner gets the payout
                                    amount = payout_amount;
                                    category = "Chit Payout to Customer";
                                    description = `Payout for ${group.group_name} - Month ${auction_month}`;
                                } else {
                                    // Others pay the installment
                                    amount = -net_monthly_contribution;
                                    category = "Chit Installment Received from Customer";
                                    description = `Installment for ${group.group_name} - Month ${auction_month}`;
                                }
                                const txSql = `INSERT INTO transactions (user_id, amount, description, category, date) VALUES (?, ?, ?, ?, ?)`;
                                db.run(txSql, [member.user_id, amount, description, category, auction_date], (err) => {
                                    if (err) reject(err); else resolve();
                                });
                            });
                        });
                        
                        Promise.all(txPromises)
                            .then(() => {
                                db.run("COMMIT;", (err) => {
                                    if(err) res.status(500).json({error: err.message});
                                    else res.status(201).json({ message: "Auction recorded and transactions created successfully." });
                                });
                            })
                            .catch(txErr => {
                                db.run("ROLLBACK;");
                                res.status(500).json({ error: "Failed to create transactions for all members.", details: txErr.message });
                            });
                    });
                });
            });
        });
    });
});

module.exports = router;