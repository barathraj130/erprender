// middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config');

// This middleware TRIES to verify a token if present.
// It doesn't block requests, allowing public access to some routes.
// It attaches the user payload to req.user if the token is valid.
const authMiddleware = (req, res, next) => {
    const authHeader = req.header('Authorization');
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7, authHeader.length);
        if (token) {
            try {
                const decoded = jwt.verify(token, jwtSecret);
                req.user = decoded.user; // Attach user payload to request
            } catch (err) {
                // Token is invalid or expired, but we don't block the request here.
                // The checkAuth middleware will handle blocking.
                req.user = null;
            }
        }
    }
    next();
};

// This middleware ENFORCES authentication.
// Use this on routes that must be protected.
const checkAuth = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authorization denied. No token or token is invalid.' });
    }
    next();
};

const checkRole = (roles) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return res.status(401).json({ error: 'Authentication required for this action.' });
        }
        if (!Array.isArray(roles)) {
            return res.status(500).json({ error: 'Internal server error: Invalid role configuration.' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden: You do not have the necessary permissions.' });
        }
        next();
    };
};

module.exports = {
    authMiddleware,
    checkAuth, // Export the new enforcement middleware
    checkRole
};