const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

// --- RENDER PATH CONSISTENCY FIX ---
const DB_FILE_NAME = 'database.sqlite';
const DB_PATH = (process.env.NODE_ENV === 'production' && process.env.RENDER) 
    ? path.join('/var/data', DB_FILE_NAME) 
    : path.join(__dirname, DB_FILE_NAME);
// -------------------------------------

const db = new sqlite3.Database(DB_PATH);

bcrypt.hash('admin', 10, (err, hash) => {
  db.run(`INSERT INTO users (username, password, role, email, active_company_id) VALUES (?, ?, ?, ?, ?)`,
    ['admin', hash, 'admin', 'admin@example.com', 1], (err) => {
      if (err) console.error(err.message);
      else console.log('✅ Admin user inserted.');
  });
});