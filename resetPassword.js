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

const newPassword = 'admin';

bcrypt.hash(newPassword, 10, (err, hash) => {
  if (err) return console.error('Hashing error:', err);

  db.run(`UPDATE users SET password = ? WHERE username = 'admin'`, [hash], function(err) {
    if (err) return console.error('❌ Update failed:', err.message);
    console.log('✅ Admin password updated to "admin"');
  });
});