// middlewares/auditLogMiddleware.js
const { pool } = require('../db'); // Use pool directly

const auditLogMiddleware = (req, res, next) => {
    
    res.on('finish', () => { // Use 'finish' event to ensure status code is set
        try {
            // Avoid logging for GET requests or viewing the audit log itself
            if (req.method === 'GET' || req.method === 'OPTIONS' || req.originalUrl.includes('/api/auditlog') || req.originalUrl.includes('/api/system/status')) {
                return;
            }
            
            // Only log successful actions (2xx) or client errors (4xx), not server errors (5xx)
            if (res.statusCode >= 500) {
                return;
            }
            
            console.log(`<<<<< AUDIT LOG MIDDLEWARE: Intercepted ${req.method} ${req.originalUrl}, Status: ${res.statusCode} >>>>>`);

            const pathParts = req.originalUrl.split('/').filter(p => p && p.toLowerCase() !== 'api');
            let entityType = 'Unknown';
            let entityId = req.params.id || null; // From URL like /api/users/:id

            if (pathParts.length > 0) {
                entityType = pathParts[0]; // e.g., 'users', 'products'
                if (pathParts.length > 1 && !isNaN(parseInt(pathParts[1]))) {
                    entityId = parseInt(pathParts[1]);
                }
            }

            if (req.method === 'POST' && req.body && req.body.id && !entityId) {
                entityId = req.body.id;
            }

            const auditEntry = {
                user_id_acting: req.user ? req.user.id : null, 
                action: `${req.method}_${entityType.toUpperCase()}`,
                entity_type: entityType.charAt(0).toUpperCase() + entityType.slice(1),
                entity_id: entityId,
                details_before: null, 
                details_after: (req.method === 'POST' || req.method === 'PUT') ? JSON.stringify(req.body) : null,
                ip_address: req.ip || req.socket?.remoteAddress
            };

            // Prevent logging sensitive info
            if (auditEntry.details_after) {
                try {
                    let details = JSON.parse(auditEntry.details_after);
                    if (details.password) delete details.password;
                    if (details.confirmPassword) delete details.confirmPassword;
                    auditEntry.details_after = JSON.stringify(details);
                } catch (e) { /* ignore if not valid JSON */ }
            }
            
            // Execute the insertion asynchronously without waiting for it to finish
            (async () => {
                let client;
                try {
                    client = await pool.connect();
                    const sql = 'INSERT INTO audit_log (user_id_acting, action, entity_type, entity_id, details_before, details_after, ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7)';
                    const params = [
                        auditEntry.user_id_acting, 
                        auditEntry.action, 
                        auditEntry.entity_type, 
                        auditEntry.entity_id, 
                        auditEntry.details_before, 
                        auditEntry.details_after, 
                        auditEntry.ip_address
                    ];
                    await client.query(sql, params);
                    console.log(`✅ Audit log entry created by user ${auditEntry.user_id_acting}.`);
                } catch (err) {
                    console.error("❌ Failed to write to audit log table:", err.message);
                } finally {
                    if (client) client.release();
                }
            })();


        } catch (error) {
            console.error("Error in auditLogMiddleware:", error);
        }
    });

    next();
};

module.exports = { auditLogMiddleware };