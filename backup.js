// backup.js
const fs = require('fs');
const path = require('path');

// --- RENDER PERMANENT STORAGE FIX: Use the production path if deployed ---
const DB_FILE_NAME = 'database.sqlite';
const dbDir = (process.env.NODE_ENV === 'production' && process.env.RENDER) 
    ? '/var/data' 
    : __dirname;
const dbPath = path.join(dbDir, DB_FILE_NAME); 
// ------------------------------------------------------------------------

const backupFolder = path.join(__dirname, 'backups');

if (!fs.existsSync(backupFolder)) {
  fs.mkdirSync(backupFolder);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupFolder, `erp-backup-${timestamp}.db`);

// Check if the DB file exists before copying (important for Render environment)
if (!fs.existsSync(dbPath)) {
    console.error(`❌ Cannot create backup: Database file not found at ${dbPath}`);
    // Do not exit 1 in production environment during cron run, just log and finish
    if (process.env.NODE_ENV === 'production') {
        console.warn("Continuing despite missing DB file on backup attempt (may be first run).");
        return; 
    }
    process.exit(1);
}

fs.copyFileSync(dbPath, backupPath);

console.log(`✅ Backup created at: ${backupPath}`);