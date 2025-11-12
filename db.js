const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// --- POSTGRES CONFIGURATION ---
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://erp_iglu_user:tQ6aeuLk4FIEqsSmYFuSMV6FB4xUwqtt@dpg-d4337g7gi27c73fn0os0-a.oregon-postgres.render.com/erp_iglu";

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, 
  }
});

console.log("ℹ️ [db.js] Attempting to connect to PostgreSQL...");

pool.on('error', (err, client) => {
  console.error('❌ [db.js] Unexpected error on idle client', err);
  process.exit(1);
});

async function initializeDb() {
  let client;
  try {
    client = await pool.connect();
    console.log("✅ [db.js] Connected to the PostgreSQL database.");
    
    // --- 1. ISOLATED ENUM CREATION ---
    try {
        await client.query(`CREATE TYPE nature_type AS ENUM ('Asset', 'Liability', 'Income', 'Expense')`);
        console.log("✅ [db.js] Custom type 'nature_type' created.");
    } catch (e) {
        if (e.code === '42710') { 
            console.log("ℹ️ [db.js] Custom type 'nature_type' already exists.");
        } else {
             throw e;
        }
    }
    
    // --- 2. START MAIN TRANSACTION FOR TABLES AND SEEDING ---
    await client.query('BEGIN');
    console.log("ℹ️ [db.js] Starting database initialization (creating tables)...");
    
    const createTableStatements = [
      `CREATE TABLE IF NOT EXISTS "companies" (id SERIAL PRIMARY KEY, company_name TEXT UNIQUE NOT NULL, address_line1 TEXT, address_line2 TEXT, city_pincode TEXT, state TEXT, gstin TEXT UNIQUE, state_code TEXT, phone TEXT, email TEXT UNIQUE, bank_name TEXT, bank_account_no TEXT, bank_ifsc_code TEXT, logo_url TEXT, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS "users" (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE, password TEXT, role TEXT NOT NULL DEFAULT 'user', phone TEXT, company TEXT, initial_balance REAL NOT NULL DEFAULT 0, address_line1 TEXT, address_line2 TEXT, city_pincode TEXT, state TEXT, gstin TEXT, state_code TEXT, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, active_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL)`,
      `CREATE TABLE IF NOT EXISTS "user_companies" (user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, PRIMARY KEY (user_id, company_id))`,
      `CREATE TABLE IF NOT EXISTS "products" (
            id SERIAL PRIMARY KEY, 
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            product_name TEXT NOT NULL, 
            sku TEXT, 
            description TEXT, 
            cost_price REAL DEFAULT 0, 
            sale_price REAL NOT NULL DEFAULT 0, 
            current_stock INTEGER NOT NULL DEFAULT 0, 
            unit_of_measure TEXT DEFAULT 'pcs', 
            hsn_acs_code TEXT, 
            low_stock_threshold INTEGER DEFAULT 0, 
            reorder_level INTEGER DEFAULT 0, 
            is_active INTEGER DEFAULT 1 NOT NULL, 
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, 
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(company_id, product_name),
            UNIQUE(company_id, sku)
        )`,
      `CREATE TABLE IF NOT EXISTS "audit_log" (id SERIAL PRIMARY KEY, timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, user_id_acting INTEGER REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER, details_before TEXT, details_after TEXT, ip_address TEXT)`,
      `CREATE TABLE IF NOT EXISTS "notifications" (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, message TEXT NOT NULL, type TEXT DEFAULT 'info', link TEXT, is_read BOOLEAN DEFAULT FALSE, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP)`,
      // Ledger tables
      `CREATE TABLE IF NOT EXISTS "ledger_groups" (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, name TEXT NOT NULL, parent_id INTEGER REFERENCES ledger_groups(id) ON DELETE CASCADE, nature nature_type, is_default BOOLEAN DEFAULT FALSE, UNIQUE(company_id, name))`,
      `CREATE TABLE IF NOT EXISTS "ledgers" (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, name TEXT NOT NULL, group_id INTEGER NOT NULL REFERENCES ledger_groups(id) ON DELETE RESTRICT, opening_balance REAL DEFAULT 0, is_dr BOOLEAN DEFAULT TRUE, gstin TEXT, state TEXT, is_default BOOLEAN DEFAULT FALSE, UNIQUE(company_id, name))`,
      // Inventory tables
      `CREATE TABLE IF NOT EXISTS "stock_units" (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, name TEXT NOT NULL, UNIQUE(company_id, name))`,
      `CREATE TABLE IF NOT EXISTS "stock_warehouses" (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, name TEXT NOT NULL, is_default BOOLEAN DEFAULT FALSE, UNIQUE(company_id, name))`,
      `CREATE TABLE IF NOT EXISTS "stock_items" (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, name TEXT NOT NULL, unit_id INTEGER NOT NULL REFERENCES stock_units(id) ON DELETE RESTRICT, gst_rate REAL DEFAULT 0, opening_qty REAL DEFAULT 0, opening_rate REAL DEFAULT 0, UNIQUE(company_id, name))`,
      // Voucher tables
      `CREATE TABLE IF NOT EXISTS "vouchers" (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, date DATE NOT NULL, voucher_number TEXT NOT NULL, voucher_type TEXT NOT NULL, narration TEXT, total_amount REAL NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, UNIQUE(company_id, voucher_number, voucher_type))`,
      `CREATE TABLE IF NOT EXISTS "voucher_entries" (id SERIAL PRIMARY KEY, voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE, ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE RESTRICT, debit REAL DEFAULT 0, credit REAL DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS "voucher_inventory_entries" (id SERIAL PRIMARY KEY, voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE, item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT, warehouse_id INTEGER REFERENCES stock_warehouses(id) ON DELETE SET NULL, quantity REAL NOT NULL, rate REAL NOT NULL, amount REAL NOT NULL)`,
      // Invoice tables
      `CREATE TABLE IF NOT EXISTS "invoices" (
            id SERIAL PRIMARY KEY,
            customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            invoice_number TEXT NOT NULL,
            invoice_date DATE NOT NULL,
            due_date DATE NOT NULL,
            total_amount REAL NOT NULL DEFAULT 0,
            amount_before_tax REAL NOT NULL DEFAULT 0,
            total_cgst_amount REAL DEFAULT 0,
            total_sgst_amount REAL DEFAULT 0,
            total_igst_amount REAL DEFAULT 0,
            party_bill_returns_amount REAL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'Draft',
            invoice_type TEXT NOT NULL DEFAULT 'TAX_INVOICE',
            notes TEXT,
            paid_amount REAL NOT NULL DEFAULT 0,
            reverse_charge TEXT DEFAULT 'No',
            transportation_mode TEXT,
            vehicle_number TEXT,
            date_of_supply DATE,
            place_of_supply_state TEXT,
            place_of_supply_state_code TEXT,
            bundles_count INTEGER,
            consignee_name TEXT,
            consignee_address_line1 TEXT,
            consignee_address_line2 TEXT,
            consignee_city_pincode TEXT,
            consignee_state TEXT,
            consignee_gstin TEXT,
            consignee_state_code TEXT,
            amount_in_words TEXT,
            original_invoice_number TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            UNIQUE(company_id, invoice_number)
        )`,
      `CREATE TABLE IF NOT EXISTS "invoice_line_items" (
            id SERIAL PRIMARY KEY,
            invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
            description TEXT NOT NULL,
            hsn_acs_code TEXT,
            unit_of_measure TEXT,
            quantity REAL NOT NULL,
            unit_price REAL NOT NULL,
            discount_amount REAL DEFAULT 0,
            taxable_value REAL NOT NULL,
            cgst_rate REAL DEFAULT 0,
            cgst_amount REAL DEFAULT 0,
            sgst_rate REAL DEFAULT 0,
            sgst_amount REAL DEFAULT 0,
            igst_rate REAL DEFAULT 0,
            igst_amount REAL DEFAULT 0,
            line_total REAL NOT NULL
        )`,
      // Finance tables (Lenders, Agreements, Transactions)
      `CREATE TABLE IF NOT EXISTS "lenders" (
            id SERIAL PRIMARY KEY,
            company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
            lender_name TEXT NOT NULL,
            entity_type TEXT DEFAULT 'General',
            contact_person TEXT,
            phone TEXT,
            email TEXT,
            notes TEXT,
            initial_payable_balance REAL DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(company_id, lender_name)
        )`,
      `CREATE TABLE IF NOT EXISTS "business_agreements" (
            id SERIAL PRIMARY KEY,
            company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
            lender_id INTEGER NOT NULL REFERENCES lenders(id) ON DELETE CASCADE,
            agreement_type TEXT NOT NULL,
            total_amount REAL NOT NULL,
            interest_rate REAL DEFAULT 0,
            start_date DATE NOT NULL,
            details TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )`,
      `CREATE TABLE IF NOT EXISTS "transactions" (
            id SERIAL PRIMARY KEY,
            company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            lender_id INTEGER REFERENCES lenders(id) ON DELETE SET NULL,
            agreement_id INTEGER REFERENCES business_agreements(id) ON DELETE SET NULL,
            amount REAL NOT NULL,
            description TEXT,
            category TEXT,
            date DATE NOT NULL,
            related_invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )`,
      `CREATE TABLE IF NOT EXISTS "transaction_line_items" (
            id SERIAL PRIMARY KEY,
            transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            quantity REAL NOT NULL,
            unit_sale_price REAL
        )`,
      `CREATE TABLE IF NOT EXISTS "product_suppliers" (
            id SERIAL PRIMARY KEY,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            supplier_id INTEGER NOT NULL REFERENCES lenders(id) ON DELETE CASCADE,
            supplier_sku TEXT,
            purchase_price REAL,
            lead_time_days INTEGER,
            is_preferred BOOLEAN DEFAULT FALSE,
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(product_id, supplier_id)
        )`
    ];
    
    // Execute DDL statements within the transaction
    for (const stmt of createTableStatements) {
         await client.query(stmt);
    }

    await setupSingleCompanyAndAdmin(client);

    await client.query('COMMIT');
    console.log("✅ [db.js] Database initialization complete.");
    
  } catch (err) {
    console.error("❌ [db.js] Database initialization FAILED:", err.message);
    if (client) {
      try {
        // Rollback only if the BEGIN succeeded
        await client.query('ROLLBACK'); 
        console.log('ℹ️ [db.js] Initialization rollback successful.');
      } catch (rollbackErr) {
        console.error('❌ [db.js] Failed to rollback initialization transaction:', rollbackErr.message);
      }
    }
    process.exit(1);
  } finally {
    if (client) client.release();
  }
}

async function setupSingleCompanyAndAdmin(client) {
    console.log("ℹ️ [db.js] Ensuring default company (ID 1) and admin user exist...");

    const companyCheck = await client.query("SELECT id FROM companies WHERE id = 1");
    let companyId = 1;

    const onCompanyReady = async (companyId) => {
        await checkAndSeedAccounts(client, companyId);
        
        const userCheck = await client.query("SELECT id FROM users WHERE username = 'admin'");
        
        if (userCheck.rows.length === 0) {
            console.log("ℹ️ No admin user found, creating one for company ID:", companyId);
            const hash = await new Promise((resolve, reject) => {
                bcrypt.hash('admin', 10, (err, h) => err ? reject(err) : resolve(h));
            });
            
            // Logic to handle user ID 1 creation (or conflict update)
            let insertUserSql = `INSERT INTO users (username, password, role, email, active_company_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`;
            let insertUserParams = ['admin', hash, 'admin', 'admin@example.com', companyId];
            
            if (companyId === 1) {
                insertUserSql = `INSERT INTO users (id, username, password, role, email, active_company_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET active_company_id = EXCLUDED.active_company_id RETURNING id`;
                insertUserParams = [1, 'admin', hash, 'admin', 'admin@example.com', companyId];
            }

            const insertUserResult = await client.query(insertUserSql, insertUserParams);
            const adminId = insertUserResult.rows[0].id;
            
            await client.query(`INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [adminId, companyId]);
            console.log("✅ Default admin user created and linked to company.");

        } else {
            const adminId = userCheck.rows[0].id;
            await client.query(`INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [adminId, companyId]);
            await client.query(`UPDATE users SET active_company_id = $1 WHERE id = $2`, [companyId, adminId]);
            console.log("ℹ️ Default admin user already exists. Ensured link to company 1.");
        }
    };

    if (companyCheck.rows.length === 0) {
        
        const defaultCompanySql = `INSERT INTO companies (company_name, address_line1, address_line2, city_pincode, state, state_code, gstin, phone, email, bank_name, bank_account_no, bank_ifsc_code) 
                                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`;
        
        const defaultCompanyParams = [
            "ADVENTURER EXPORT", 
            "3/2B, Nesavalar Colony, 2nd Street, PN Road",
            "",
            "TIRUPUR - 641602", 
            "TAMILNADU", 
            "33",
            "33ABCFA3111D1ZF", 
            "9791902205, 9842880404", 
            "contact@adventurerexport.com",
            "ICICI Bank",
            "106105501618",
            "ICIC0001061"
        ];
        
        const insertResult = await client.query(defaultCompanySql, defaultCompanyParams);
        companyId = insertResult.rows[0].id; 
        
        if (companyId === 1) {
            // Reset sequence to 1 if we inserted ID 1, ensuring consistency for subsequent inserts
            await client.query("SELECT setval('companies_id_seq', 1, false)");
            console.log("✅ Default company (Adventurer Export) created with ID 1.");
        } else {
            console.warn(`⚠️ Default company generated ID ${companyId}. Expected 1. Proceeding with generated ID.`);
        }
        
        await onCompanyReady(companyId);

    } else {
        companyId = companyCheck.rows[0].id;
        await onCompanyReady(companyId);
    }
}

async function checkAndSeedAccounts(client, companyId) {
    const groupCheck = await client.query("SELECT id FROM ledger_groups WHERE company_id = $1 AND name = 'Sundry Debtors'", [companyId]);

    if (groupCheck.rows.length === 0) {
        console.warn(`⚠️ Chart of accounts for company ${companyId} is missing. Seeding now...`);
        await seedDefaultChartOfAccounts(client, companyId);
        console.log(`✅ Chart of accounts successfully seeded for company ${companyId}.`);
    } else {
        console.log(`ℹ️ Chart of accounts verified for company ${companyId}.`);
    }
}

async function seedDefaultChartOfAccounts(client, companyId) {
    const groups = [
        { name: 'Primary', children: [
            { name: 'Capital Account', nature: 'Liability' }, // <-- Added to fix P&L constraint
            { name: 'Current Assets', nature: 'Asset', children: [
                { name: 'Cash-in-Hand', nature: 'Asset' }, { name: 'Bank Accounts', nature: 'Asset' },
                { name: 'Sundry Debtors', nature: 'Asset' }, { name: 'Stock-in-Hand', nature: 'Asset' },
            ]},
            { name: 'Fixed Assets', nature: 'Asset' },
            { name: 'Current Liabilities', nature: 'Liability', children: [
                { name: 'Sundry Creditors', nature: 'Liability' }, { name: 'Duties & Taxes', nature: 'Liability' }
            ]},
            { name: 'Loans (Liability)', nature: 'Liability' }, { name: 'Direct Incomes', nature: 'Income' },
            { name: 'Indirect Incomes', nature: 'Income' }, { name: 'Sales Accounts', nature: 'Income' },
            { name: 'Direct Expenses', nature: 'Expense' }, { name: 'Indirect Expenses', nature: 'Expense' },
            { name: 'Purchase Accounts', nature: 'Expense' }
        ]}
    ];
    const ledgers = [
        { name: 'Profit & Loss A/c', is_default: true, groupName: 'Capital Account' }, // <-- Assigned to Capital Account
        { name: 'Owner\'s Capital A/c', is_default: true, groupName: 'Capital Account' }, // <-- NEW: For owner deposits/withdrawals
        { name: 'Cash', groupName: 'Cash-in-Hand', is_default: true },
        { name: 'Sales', groupName: 'Sales Accounts', is_default: true }, { name: 'Purchase', groupName: 'Purchase Accounts', is_default: true },
        { name: 'CGST', groupName: 'Duties & Taxes', is_default: true }, { name: 'SGST', groupName: 'Duties & Taxes', is_default: true },
        { name: 'IGST', groupName: 'Duties & Taxes', is_default: true },
    ];
    
    const groupMap = new Map();

    async function insertGroups(groupList, parentId = null) {
        for (const group of groupList) {
            const result = await client.query(
                `INSERT INTO ledger_groups (company_id, name, parent_id, nature, is_default) 
                 VALUES ($1, $2, $3, $4, $5) ON CONFLICT (company_id, name) DO NOTHING RETURNING id`,
                [companyId, group.name, parentId, group.nature, group.is_default || false]
            );

            let currentId;
            if (result.rows.length > 0) {
                currentId = result.rows[0].id;
            } else {
                const existing = await client.query(`SELECT id FROM ledger_groups WHERE company_id = $1 AND name = $2`, [companyId, group.name]);
                currentId = existing.rows[0].id;
            }
            
            groupMap.set(group.name, currentId);
            
            if (group.children) {
                await insertGroups(group.children, currentId);
            }
        }
    }
    
    await insertGroups(groups[0].children);

    for (const ledger of ledgers) {
        const groupId = ledger.groupName ? groupMap.get(ledger.groupName) : null;
        if (!groupId && ledger.name !== 'Profit & Loss A/c') {
             // Safety check: All standard ledgers MUST have a group ID now.
             console.error(`Skipping ledger insert for ${ledger.name}: Missing required group ID.`);
             continue;
        }

        await client.query(
            'INSERT INTO ledgers (company_id, name, group_id, is_default) VALUES ($1, $2, $3, $4) ON CONFLICT (company_id, name) DO NOTHING', 
            [companyId, ledger.name, groupId, ledger.is_default || false]
        );
    }
}

// Export the pool connection, not the initialize function.
// Route handlers must use this pool to acquire clients.
module.exports = {
    pool,
    initializeDb // Export for server.js to call setup
};