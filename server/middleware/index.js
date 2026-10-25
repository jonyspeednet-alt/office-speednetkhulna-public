// middleware/index.js — Middleware registration
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');
const corsMiddleware = require('../config/cors');
const { requestLogEnabled } = require('../config/env');
const { auditLogMiddleware } = require('../utilities/auditLogger');

function applyMiddleware(app) {
    // Gzip compression
    app.use(compression());

    // Security headers via helmet (CSP, HSTS, X-Frame-Options, etc.)
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "data:"],
                imgSrc: ["'self'", "data:", "blob:", "https://speednetkhulna.com", "https://ui-avatars.com", "https://*.google.com"],
                connectSrc: ["'self'"],
                frameSrc: ["'none'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
            },
        },
        crossOriginEmbedderPolicy: false,
    }));

    // CORS
    app.use(corsMiddleware);

    // Method override removed (2026-10-03): verb-confusion vector.
    // Apache proxy.php already forwards the real method via CURLOPT_CUSTOMREQUEST.
    // If a legacy client needs it, re-enable behind shared-secret check.

    // Cookie & body parsing (2mb cap: imports use multipart, JSON never legitimately larger)
    app.use(cookieParser());
    app.use(bodyParser.urlencoded({ extended: true, limit: '2mb' }));
    app.use(bodyParser.json({ limit: '2mb' }));

    // NID gate: files prefixed nid- (employee NID scans) require a login
    // session. Everything else stays public (profile photos, directory).
    // Lazy require avoids any middleware/auth load-order coupling.
    app.use('/uploads', (req, res, next) => {
        try {
            const base = decodeURIComponent(String(req.path || '')).split('/').pop();
            if (base && base.startsWith('nid-')) {
                // Sensitive documents must honor revocation across all workers.
                req.requireFreshAuth = true;
                return require('./auth')(req, res, (err) => {
                    if (err) return next(err);
                    return require('./nidAccess')(req, res, next);
                });
            }
        } catch (_) { return res.status(400).json({ message: 'Invalid upload path' }); }
        return next();
    });

    // Static uploads (S12): never let an uploaded file execute as same-origin
    // script — nosniff always, attachment for non-image content.
    app.use('/uploads', express.static(path.join(__dirname, '../../uploads'), {
        maxAge: '1d',
        etag: true,
        setHeaders: (res, filePath) => {
            res.set('X-Content-Type-Options', 'nosniff');
            if (path.basename(filePath).startsWith('nid-')) {
                res.set('Cache-Control', 'private, no-store');
            }
            if (!/\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(filePath || '')) {
                res.set('Content-Disposition', 'attachment');
            }
        },
    }));

    // Request logger (disabled in production by default)
    if (requestLogEnabled) {
        app.use((req, res, next) => {
            if (req.path.startsWith('/assets/') || req.path.startsWith('/uploads/')) return next();
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
            next();
        });
    }

    // API cache control
    app.use('/api', (req, res, next) => {
        res.set('Cache-Control', req.method === 'GET'
            ? 'private, no-cache, must-revalidate'
            : 'no-store');
        next();
    });

    // Audit logging
    app.use('/api', auditLogMiddleware);
}

module.exports = { applyMiddleware };
