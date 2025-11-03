// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
// --- POSTGRES FIX: Import pool and initializer function ---
const { pool, initializeDb } = require('./db');
const cron = require('node-cron');
const { exec } = require('child_process');
const disk = require('diskusage');

const { auditLogMiddleware } = require('./middlewares/auditLogMiddleware');
const { jwtAuthMiddleware, checkJwtAuth, checkJwtRole } = require('./middlewares/jwtAuthMiddleware');

// --- CORRECTED ROUTE IMPORTS ---
// Routes
const jwtAuthRoutes = require('./routes/jwtAuthRoutes');
const partyRoutes = require('./routes/partyRoutes'); 
const companyRoutes = require('./routes/companyRoutes'); 
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
apiRouter.use('/users', auditLogMiddleware, partyRoutes); 
apiRouter.use('/companies', auditLogMiddleware, companyRoutes); 
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
    const dbPromise = new Promise(async (resolve) => {
      let client;
      try {
        // Attempt a connection and a simple query to verify DB health
        client = await pool.connect();
        await client.query("SELECT 1");
        resolve('Operational');
      } catch (err) {
        resolve('Error');
      } finally {
        if (client) client.release();
      }
    });

    const storagePromise = new Promise(resolve => {
      // Check the /var/data directory if deployed on Render (even if PG is external, 
      // other files like backups might exist here, or we use a sensible fallback)
      const checkPath = (process.env.RENDER && process.platform !== 'win32') ? '/var/data' : (process.platform === 'win32' ? 'c:' : '/');
      
      disk.check(checkPath, (err, info) => {
        if (err) {
            return resolve('Unknown');
        }
        const freePercent = (info.available / info.total) * 100;
        resolve(freePercent < 5 ? 'Critical' : freePercent < 15 ? 'High Usage' : 'Operational');
      });
    });

    // Note: Awaiting both promises here
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
    
    // Assuming the public directory is set up for client-side routing
    if (req.path === '/' || req.path === '/login.html' || req.path.endsWith('.html')) {
        res.sendFile(path.join(publicPath, 'dashboard.html')); // Fallback to dashboard.html for all client routes
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


const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  
  // Call DB Initialization here, ensuring tables are created on startup
  await initializeDb(); 
});