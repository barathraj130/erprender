const User = require('../models/userModel');

exports.getAllUsers = (req, res) => {
  User.getAllUsers((err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
};

exports.createUser = (req, res) => {
  const { username, email, phone, company, initial_balance } = req.body;
  User.createUser(username, email, phone, company, initial_balance || 0, (err, id) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ id, message: 'User created successfully' });
  });
};

exports.updateUser = (req, res) => {
  const { id } = req.params;
  const { username, email, phone, company, initial_balance } = req.body;
  User.updateUser(id, username, email, phone, company, initial_balance || 0, (err, changes) => {
    if (err) return res.status(500).json({ error: err.message });
    if (changes === 0) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User updated' });
  });
};

exports.deleteUser = (req, res) => {
  const { id } = req.params;
  User.deleteUser(id, (err, changes) => {
    if (err) return res.status(500).json({ error: err.message });
    if (changes === 0) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User deleted' });
  });
};