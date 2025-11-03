// jwtConfig.js
require('dotenv').config();

module.exports = {
    // Load the secret from an environment variable for security.
    // The fallback is for development convenience but should NOT be used in production.
    jwtSecret: process.env.JWT_SECRET || 'fallback_secret_for_dev_only_12345'
};