// routes/chitFundRoutes.js
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
// --- CHIT GROUP ROUTES ---

// GET all chit groups
router.get('/', async (req, res) => {
    try {
        const rows = await dbQuery(`SELECT * FROM chit_groups ORDER BY start_date DESC`);
        res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET details for a single chit group
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    const responseData = {};

    try {
        const groupRows = await dbQuery(`SELECT * FROM chit_groups WHERE id = $1`, [id]);
        const group = groupRows[0];
        if (!group) return res.status(404).json({ error: "Chit group not found" });
        responseData.group = group;

        const membersSql = `SELECT cm.id, cm.user_id, cm.is_prized_subscriber, u.username 
                            FROM chit_group_members cm JOIN users u ON cm.user_id = u.id
                            WHERE cm.chit_group_id = $1`;
        const members = await dbQuery(membersSql, [id]);
        responseData.members = members;

        // Note: PG does not have GROUP_CONCAT or sqlite-style dynamic joins, relying on application logic to stitch the winner name.
        const auctionsSql = `SELECT ca.*, u.username as winner_name FROM chit_auctions ca
                             JOIN users u ON ca.prized_subscriber_user_id = u.id
                             WHERE ca.chit_group_id = $1 ORDER BY ca.auction_month ASC`;
        const auctions = await dbQuery(auctionsSql, [id]);
        responseData.auctions = auctions;
        res.json(responseData);

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// POST a new chit group
router.post('/', async (req, res) => {
    const { group_name, chit_value, monthly_contribution, member_count, duration_months, foreman_commission_percent, start_date } = req.body;
    const sql = `INSERT INTO chit_groups (group_name, chit_value, monthly_contribution, member_count, duration_months, foreman_commission_percent, start_date)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`;
    try {
        const result = await dbQuery(sql, [group_name, chit_value, monthly_contribution, member_count, duration_months, foreman_commission_percent, start_date]);
        res.status(201).json({ id: result[0].id, message: 'Chit group created.' });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
});

// --- CHIT MEMBER ROUTES ---

// POST a new member to a group
router.post('/:groupId/members', async (req, res) => {
    const { groupId } = req.params;
    const { user_id } = req.body;
    const join_date = new Date().toISOString().split('T')[0];

    const sql = `INSERT INTO chit_group_members (chit_group_id, user_id, join_date) VALUES ($1, $2, $3) RETURNING id`;
    try {
        const result = await dbQuery(sql, [groupId, user_id, join_date]);
        res.status(201).json({ id: result[0].id, message: 'Member added.' });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
});


// --- CHIT AUCTION ROUTES (Transactionally correct in PG) ---

router.post('/:groupId/auctions', async (req, res) => {
    const { groupId } = req.params;
    const { auction_month, auction_date, winning_bid_discount, prized_subscriber_user_id } = req.body;
    let client;
    
    try {
        // 1. Get Group Details
        const groupRows = await dbQuery('SELECT * FROM chit_groups WHERE id = $1', [groupId]);
        const group = groupRows[0];
        if (!group) return res.status(404).json({ error: "Chit group not found" });

        const foreman_commission = group.chit_value * (group.foreman_commission_percent / 100);
        const total_discount_pool = winning_bid_discount - foreman_commission;
        const dividend_amount = total_discount_pool / group.member_count;
        const net_monthly_contribution = group.monthly_contribution - dividend_amount;
        const payout_amount = group.chit_value - winning_bid_discount;
        
        client = await pool.connect();
        await client.query("BEGIN");
            
        // 2. Insert Auction Result
        const auctionSql = `INSERT INTO chit_auctions (chit_group_id, auction_month, auction_date, winning_bid_discount, dividend_amount, foreman_commission, net_monthly_contribution, prized_subscriber_user_id, payout_amount)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`;
        await client.query(auctionSql, [groupId, auction_month, auction_date, winning_bid_discount, dividend_amount, foreman_commission, net_monthly_contribution, prized_subscriber_user_id, payout_amount]);

        // 3. Update Member Status
        const updateMemberSql = `UPDATE chit_group_members SET is_prized_subscriber = TRUE, prized_month = $1 WHERE chit_group_id = $2 AND user_id = $3`;
        await client.query(updateMemberSql, [auction_month, groupId, prized_subscriber_user_id]);

        // 4. Create Transactions for all members
        const membersResult = await client.query(`SELECT user_id FROM chit_group_members WHERE chit_group_id = $1`, [groupId]);
        const members = membersResult.rows;

        const txSql = `INSERT INTO transactions (user_id, amount, description, category, date) VALUES ($1, $2, $3, $4, $5)`;
        
        for (const member of members) {
            let amount, category, description;
            if (member.user_id === prized_subscriber_user_id) {
                amount = payout_amount;
                category = "Chit Payout to Customer";
                description = `Payout for ${group.group_name} - Month ${auction_month}`;
            } else {
                amount = -net_monthly_contribution;
                category = "Chit Installment Received from Customer";
                description = `Installment for ${group.group_name} - Month ${auction_month}`;
            }
            await client.query(txSql, [member.user_id, amount, description, category, auction_date]);
        }
        
        await client.query("COMMIT");
        res.status(201).json({ message: "Auction recorded and transactions created successfully." });

    } catch (err) {
        if (client) await client.query("ROLLBACK");
        console.error("PG CHIT AUCTION ERROR:", err.message);
        res.status(500).json({ error: "Failed to record auction and transactions.", details: err.message });
    } finally {
        if (client) client.release();
    }
});

module.exports = router;