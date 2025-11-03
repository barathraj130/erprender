// db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

// --- RENDER PERMANENT STORAGE FIX ---
// Use a fixed path suitable for mounting a Render Persistent Disk in production.
const DB_FILE_NAME = 'database.sqlite';
const RENDER_DB_PATH = path.join(__dirname, DB_FILE_NAME); 
const DB_PATH = (process.env.NODE_ENV === 'production' && process.env.RENDER) 
    ? path.join('/var/data', DB_FILE_NAME) 
    : RENDER_DB_PATH;
// -------------------------------------

let dbInitialized = false;

console.log("ℹ️ [db.js] Attempting to open database at:", DB_PATH);
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("❌ [db.js] Error opening database:", err.message);
    process.exit(1);
  } else {
    console.log("✅ [db.js] Connected to the SQLite database.");
    initializeDb();
  }
});

function initializeDb() {
  if (dbInitialized) return;
  console.log("ℹ️ [db.js] Starting database initialization...");
  
  db.serialize(() => {
    const createTableStatements = [
        `CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL UNIQUE, address_line1 TEXT, address_line2 TEXT, city_pincode TEXT, state TEXT, gstin TEXT UNIQUE, state_code TEXT, phone TEXT, email TEXT UNIQUE, bank_name TEXT, bank_account_no TEXT, bank_ifsc_code TEXT, logo_url TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, email TEXT UNIQUE, password TEXT, role TEXT NOT NULL DEFAULT 'user', phone TEXT, company TEXT, initial_balance REAL NOT NULL DEFAULT 0, address_line1 TEXT, address_line2 TEXT, city_pincode TEXT, state TEXT, gstin TEXT, state_code TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, active_company_id INTEGER, FOREIGN KEY(active_company_id) REFERENCES companies(id) ON DELETE SET NULL)`,
        `CREATE TABLE IF NOT EXISTS user_companies (user_id INTEGER NOT NULL, company_id INTEGER NOT NULL, PRIMARY KEY (user_id, company_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE)`,
        `CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            company_id INTEGER NOT NULL,
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
            UNIQUE(company_id, product_name),
            UNIQUE(company_id, sku)
        )`,
        `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, user_id_acting INTEGER, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER, details_before TEXT, details_after TEXT, ip_address TEXT, FOREIGN KEY (user_id_acting) REFERENCES users(id) ON DELETE SET NULL)`,
        `CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, message TEXT NOT NULL, type TEXT DEFAULT 'info', link TEXT, is_read BOOLEAN DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
        `CREATE TABLE IF NOT EXISTS ledger_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL, parent_id INTEGER, nature TEXT CHECK(nature IN ('Asset', 'Liability', 'Income', 'Expense')), is_default BOOLEAN DEFAULT 0, UNIQUE(company_id, name), FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE, FOREIGN KEY(parent_id) REFERENCES ledger_groups(id) ON DELETE CASCADE)`,
        `CREATE TABLE IF NOT EXISTS ledgers (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL, group_id INTEGER NOT NULL, opening_balance REAL DEFAULT 0, is_dr BOOLEAN DEFAULT 1, gstin TEXT, state TEXT, is_default BOOLEAN DEFAULT 0, UNIQUE(company_id, name), FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE, FOREIGN KEY(group_id) REFERENCES ledger_groups(id) ON DELETE RESTRICT)`,
        `CREATE TABLE IF NOT EXISTS stock_units (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL, UNIQUE(company_id, name), FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE)`,
        `CREATE TABLE IF NOT EXISTS stock_warehouses (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL, is_default BOOLEAN DEFAULT 0, UNIQUE(company_id, name), FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE)`,
        `CREATE TABLE IF NOT EXISTS stock_items (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, name TEXT NOT NULL, unit_id INTEGER NOT NULL, gst_rate REAL DEFAULT 0, opening_qty REAL DEFAULT 0, opening_rate REAL DEFAULT 0, UNIQUE(company_id, name), FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE, FOREIGN KEY(unit_id) REFERENCES stock_units(id) ON DELETE RESTRICT)`,
        `CREATE TABLE IF NOT EXISTS vouchers (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, date TEXT NOT NULL, voucher_number TEXT NOT NULL, voucher_type TEXT NOT NULL, narration TEXT, total_amount REAL NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, created_by_user_id INTEGER, UNIQUE(company_id, voucher_number, voucher_type), FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE, FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL)`,
        `CREATE TABLE IF NOT EXISTS voucher_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, voucher_id INTEGER NOT NULL, ledger_id INTEGER NOT NULL, debit REAL DEFAULT 0, credit REAL DEFAULT 0, FOREIGN KEY(voucher_id) REFERENCES vouchers(id) ON DELETE CASCADE, FOREIGN KEY(ledger_id) REFERENCES ledgers(id) ON DELETE RESTRICT)`,
        `CREATE TABLE IF NOT EXISTS voucher_inventory_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, voucher_id INTEGER NOT NULL, item_id INTEGER NOT NULL, warehouse_id INTEGER, quantity REAL NOT NULL, rate REAL NOT NULL, amount REAL NOT NULL, FOREIGN KEY(voucher_id) REFERENCES vouchers(id) ON DELETE CASCADE, FOREIGN KEY(item_id) REFERENCES stock_items(id) ON DELETE RESTRICT, FOREIGN KEY(warehouse_id) REFERENCES stock_warehouses(id) ON DELETE SET NULL)`,
        `CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            invoice_number TEXT NOT NULL,
            invoice_date TEXT NOT NULL,
            due_date TEXT NOT NULL,
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
            date_of_supply TEXT,
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            company_id INTEGER NOT NULL,
            FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
            UNIQUE(company_id, invoice_number)
        )`,
        `CREATE TABLE IF NOT EXISTS invoice_line_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL,
            product_id INTEGER,
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
            line_total REAL NOT NULL,
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
        )`,
        `CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            user_id INTEGER,
            lender_id INTEGER,
            agreement_id INTEGER,
            amount REAL NOT NULL,
            description TEXT,
            category TEXT,
            date TEXT NOT NULL,
            related_invoice_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (lender_id) REFERENCES lenders(id) ON DELETE SET NULL,
            FOREIGN KEY (agreement_id) REFERENCES business_agreements(id) ON DELETE SET NULL,
            FOREIGN KEY (related_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
        )`,
        `CREATE TABLE IF NOT EXISTS transaction_line_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity REAL NOT NULL,
            unit_sale_price REAL,
            FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS lenders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            lender_name TEXT NOT NULL,
            entity_type TEXT DEFAULT 'General',
            contact_person TEXT,
            phone TEXT,
            email TEXT,
            notes TEXT,
            initial_payable_balance REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(company_id, lender_name),
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS business_agreements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            lender_id INTEGER NOT NULL,
            agreement_type TEXT NOT NULL,
            total_amount REAL NOT NULL,
            interest_rate REAL DEFAULT 0,
            start_date TEXT NOT NULL,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
            FOREIGN KEY (lender_id) REFERENCES lenders(id) ON DELETE CASCADE
        )`,
         `CREATE TABLE IF NOT EXISTS product_suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            supplier_id INTEGER NOT NULL,
            supplier_sku TEXT,
            purchase_price REAL,
            lead_time_days INTEGER,
            is_preferred BOOLEAN DEFAULT 0,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            FOREIGN KEY (supplier_id) REFERENCES lenders(id) ON DELETE CASCADE,
            UNIQUE(product_id, supplier_id)
        )`
    ];
    createTableStatements.forEach(stmt => db.run(stmt, (err) => {
        if (err) console.error("❌ [db.js] Error creating a table:", err.message);
    }));

    setupSingleCompanyAndAdmin();
  });
}

function setupSingleCompanyAndAdmin() {
    console.log("ℹ️ [db.js] Ensuring default company (ID 1) and admin user exist...");

    db.get("SELECT id FROM companies WHERE id = 1", (err, companyRow) => {
        if (err) return console.error("❌ Error checking for default company:", err.message);

        const onCompanyReady = (companyId) => {
            checkAndSeedAccounts(companyId, () => {
                db.get("SELECT id FROM users WHERE username = 'admin'", (userErr, userRow) => {
                    if (userErr) return console.error("❌ Error checking for admin user:", userErr.message);

                    if (!userRow) {
                        console.log("ℹ️ No admin user found, creating one for company ID:", companyId);
                        bcrypt.hash('admin', 10, (hashErr, hash) => {
                            if (hashErr) return console.error("❌ Error hashing default password:", hashErr);
                            
                            db.run(`INSERT INTO users (username, password, role, email, active_company_id) VALUES (?, ?, ?, ?, ?)`, 
                                ['admin', hash, 'admin', 'admin@example.com', companyId], function(insertUserErr) {
                                if (insertUserErr) return console.error("❌ Error creating default admin:", insertUserErr.message);
                                
                                const adminId = this.lastID;
                                db.run(`INSERT INTO user_companies (user_id, company_id) VALUES (?, ?)`, [adminId, companyId], (linkErr) => {
                                    if (linkErr) console.error("❌ Error linking admin to company:", linkErr.message);
                                    else console.log("✅ Default admin user created and linked to company.");
                                });
                            });
                        });
                    } else {
                        db.run(`INSERT OR IGNORE INTO user_companies (user_id, company_id) VALUES (?, ?)`, [userRow.id, companyId]);
                        db.run(`UPDATE users SET active_company_id = ? WHERE id = ?`, [companyId, userRow.id]);
                        console.log("ℹ️ Default admin user already exists. Ensured link to company 1.");
                    }
                });
                dbInitialized = true;
                console.log("✅ [db.js] Database initialization complete.");
            });
        };

        if (!companyRow) {
            const defaultCompanySql = `INSERT INTO companies (id, company_name, address_line1, address_line2, city_pincode, state, state_code, gstin, phone, email, bank_name, bank_account_no, bank_ifsc_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            const defaultCompanyParams = [
                1, 
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
            
            db.run(defaultCompanySql, defaultCompanyParams, function(companyErr) {
                if (companyErr) return console.error("❌ Error creating default company:", companyErr.message);
                
                console.log("✅ Default company (Adventurer Export) created with ID 1.");
                onCompanyReady(1);
            });
        } else {
            onCompanyReady(1);
        }
    });
}

function checkAndSeedAccounts(companyId, onComplete) {
    db.get("SELECT id FROM ledger_groups WHERE company_id = ? AND name = 'Sundry Debtors'", [companyId], (err, groupRow) => {
        if (err) {
            console.error(`❌ [DB Check] Error checking for 'Sundry Debtors' for company ${companyId}:`, err.message);
            return;
        }

        if (!groupRow) {
            console.warn(`⚠️ Chart of accounts for company ${companyId} is missing. Seeding now...`);
            seedDefaultChartOfAccounts(companyId, (seedErr) => {
                if (seedErr) {
                    console.error(`❌ FAILED to seed chart of accounts for company ${companyId}:`, seedErr);
                } else {
                    console.log(`✅ Chart of accounts successfully seeded for company ${companyId}.`);
                    onComplete();
                }
            });
        } else {
            console.log(`ℹ️ Chart of accounts verified for company ${companyId}.`);
            onComplete();
        }
    });
}

function seedDefaultChartOfAccounts(companyId, callback) {
    const groups = [
        { name: 'Primary', children: [
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
        { name: 'Profit & Loss A/c', is_default: 1, groupName: null }, { name: 'Cash', groupName: 'Cash-in-Hand', is_default: 1 },
        { name: 'Sales', groupName: 'Sales Accounts', is_default: 1 }, { name: 'Purchase', groupName: 'Purchase Accounts', is_default: 1 },
        { name: 'CGST', groupName: 'Duties & Taxes', is_default: 1 }, { name: 'SGST', groupName: 'Duties & Taxes', is_default: 1 },
        { name: 'IGST', groupName: 'Duties & Taxes', is_default: 1 },
    ];
    
    db.serialize(() => {
        const groupMap = new Map();
        function insertGroups(groupList, parentId = null, onComplete) {
            let pending = groupList.length;
            if (pending === 0) return onComplete();
            groupList.forEach(group => {
                db.run('INSERT OR IGNORE INTO ledger_groups (company_id, name, parent_id, nature, is_default) VALUES (?, ?, ?, ?, ?)', 
                [companyId, group.name, parentId, group.nature, group.is_default || 0], function(err) {
                    if (err) console.error(`[Seed] Error inserting group ${group.name}:`, err.message);
                    db.get('SELECT id FROM ledger_groups WHERE company_id = ? AND name = ?', [companyId, group.name], (e, r) => {
                        if(r) groupMap.set(group.name, r.id);
                        if (group.children) {
                            insertGroups(group.children, r ? r.id : null, () => { if (--pending === 0) onComplete(); });
                        } else {
                            if (--pending === 0) onComplete();
                        }
                    });
                });
            });
        }
        insertGroups(groups[0].children, null, () => {
            let ledgersPending = ledgers.length;
            if (ledgersPending === 0) return callback(null);
            ledgers.forEach(ledger => {
                const groupId = ledger.groupName ? groupMap.get(ledger.groupName) : null;
                db.run('INSERT OR IGNORE INTO ledgers (company_id, name, group_id, is_default) VALUES (?, ?, ?, ?)', 
                [companyId, ledger.name, groupId, ledger.is_default || 0], (err) => {
                    if (err) console.error(`[Seed] Error inserting ledger ${ledger.name}:`, err.message);
                    if (--ledgersPending === 0) callback(null);
                });
            });
        });
    });
}

module.exports = db;