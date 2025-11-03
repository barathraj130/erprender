const db = require('../db');

class User {
  static getAllUsers(callback) {
    const query = `SELECT * FROM users`;
    db.all(query, [], callback);
  }

  static createUser(username, email, phone, company, initial_balance, callback) {
    const query = `INSERT INTO users (username, email, phone, company, initial_balance) VALUES (?, ?, ?, ?, ?)`;
    db.run(query, [username, email, phone, company, initial_balance], function(err) {
      callback(err, this.lastID);
    });
  }

  static updateUser(id, username, email, phone, company, initial_balance, callback) {
    const query = `UPDATE users SET username = ?, email = ?, phone = ?, company = ?, initial_balance = ? WHERE id = ?`;
    db.run(query, [username, email, phone, company, initial_balance, id], function(err) {
      callback(err, this.changes);
    });
  }

  static deleteUser(id, callback) {
    const query = `DELETE FROM users WHERE id = ?`;
    db.run(query, [id], function(err) {
      callback(err, this.changes);
    });
  }
}

module.exports = User;