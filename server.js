const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const cron = require('node-cron');
const { exec } = require('child_process');
const disk = require('diskusage');

const { auditLogMiddleware } = require('./middlewares/auditLogMiddleware');
const { jwtAuthMiddleware, checkJwtAuth, checkJwtRole } = require('./middlewares/jwtAuthMiddleware');

// --- CORRECTED ROUTE IMPORTS ---
// Routes
const jwtAuthRoutes = require('./routes/jwtAuthRoutes');
const partyRoutes = require('./routes/partyRoutes'); // Formerly userRoutes, now correctly pointing to the logic for Parties/Customers
const companyRoutes = require('./routes/companyRoutes'); // Now correctly pointing to the new file for company profile management
const ledgerRoutes = require('./routes/ledgerRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const voucherRoutes = require('./routes/voucherRoutes');
const reportRoutes = require('./routes/reportRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const auditLogRoutes = require('./routes/auditLogRoutes');
const lenderRoutes = require('./routes/lenderRoutes');
const businessAgreementRoutes = require('./routes/businessAgreementRoutes');
const productRoutes = require('./routes/productRoutes');
const productSupplierRoutes = require('./routes/productSupplierRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const importRoutes = require('./routes/importRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(jwtAuthMiddleware); // Checks token if present

// API Router
const apiRouter = express.Router();

// Public
apiRouter.use('/jwt-auth', jwtAuthRoutes);

// --- CORRECTED ROUTE USAGE ---
// Protected
apiRouter.use(checkJwtAuth);
apiRouter.use('/users', auditLogMiddleware, partyRoutes); // Correctly uses partyRoutes for /api/users
apiRouter.use('/companies', auditLogMiddleware, companyRoutes); // Correctly uses companyRoutes for /api/companies
apiRouter.use('/ledgers', auditLogMiddleware, ledgerRoutes);
apiRouter.use('/inventory', auditLogMiddleware, inventoryRoutes);
apiRouter.use('/vouchers', auditLogMiddleware, voucherRoutes);
apiRouter.use('/invoices', auditLogMiddleware, invoiceRoutes);
apiRouter.use('/lenders', auditLogMiddleware, lenderRoutes);
apiRouter.use('/business-agreements', auditLogMiddleware, businessAgreementRoutes);
apiRouter.use('/products', auditLogMiddleware, productRoutes);
apiRouter.use('/product-suppliers', auditLogMiddleware, productSupplierRoutes);
apiRouter.use('/transactions', auditLogMiddleware, transactionRoutes);
apiRouter.use('/import', auditLogMiddleware, importRoutes);
apiRouter.use('/reports', reportRoutes);
apiRouter.use('/notifications', notificationRoutes);
apiRouter.use('/auditlog', checkJwtRole(['admin']), auditLogRoutes);

// System Status
apiRouter.get('/system/status', async (req, res) => {
  try {
    const dbPromise = new Promise(resolve => {
      db.get("SELECT 1", err => resolve(err ? 'Error' : 'Operational'));
    });

    const storagePromise = new Promise(resolve => {
      // Check the /var/data directory if deployed on Render, otherwise check root/C:
      const checkPath = (process.env.RENDER && process.platform !== 'win32') ? '/var/data' : (process.platform === 'win32' ? 'c:' : '/');
      
      disk.check(checkPath, (err, info) => {
        if (err) {
            console.error("Disk usage check error:", err);
            return resolve('Unknown');
        }
        const freePercent = (info.available / info.total) * 100;
        resolve(freePercent < 5 ? 'Critical' : freePercent < 15 ? 'High Usage' : 'Operational');
      });
    });

    const [dbStatus, storageStatus] = await Promise.all([dbPromise, storagePromise]);
    res.json({ database: dbStatus, api: 'Operational', storage: storageStatus });

  } catch (err) {
    res.status(500).json({ database: 'Unknown', api: 'Error', storage: 'Unknown' });
  }
});

// Mount API
app.use('/api', apiRouter);

// Frontend Routes
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    
    if (req.path === '/' || req.path === '/login.html') {
        res.sendFile(path.join(publicPath, 'login.html'));
    } 
    else if (req.path === '/signup.html') {
         res.sendFile(path.join(publicPath, 'signup.html'));
    } 
    else if (req.path.endsWith('.html')) { 
        res.sendFile(path.join(publicPath, 'dashboard.html'));
    } 
    else {
        next();
    }
});


// Error Handler
app.use((err, req, res, next) => {
  console.error('🆘 Server Error:', err.stack || err.message);
  if (res.headersSent) return next(err);
  res.status(err.statusCode || 500).json({ error: err.message });
});

// Scheduled Backup
cron.schedule('0 2 * * *', () => {
  console.log('🕒 Running backup job...');
  exec('node backup.js', (err, stdout, stderr) => {
    if (err) console.error(`❌ Backup failed: ${err.message}`);
    if (stderr) console.error(`stderr: ${stderr}`);
    if (stdout) console.log(`✅ Backup Output: ${stdout.trim()}`);
  });
}, { scheduled: true, timezone: "Asia/Kolkata" });

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log('🕒 Backup scheduled at 2:00 AM');
  db.get("SELECT 1", (err) => {
    if (err) console.error("❌ DB Connection Failed:", err.message);
    else console.log("✅ DB Connection OK");
  });
});