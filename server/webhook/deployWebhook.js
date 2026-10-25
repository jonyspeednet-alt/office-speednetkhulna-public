'use strict';
// GitHub push webhook listener — no external dependencies (node built-ins only).
// Listens on loopback; the reverse proxy forwards your deploy-webhook path here.
// Verifies X-Hub-Signature-256 (HMAC-SHA256) with a shared secret, then runs
// server/scripts/deploy_from_github.sh detached so the HTTP response is fast.
//
// Env:
//   PORT                listen port (default 4567)
//   WEBHOOK_SECRET_FILE path to file containing the raw secret (no trailing newline needed)
//   DEPLOY_SCRIPT       absolute path to deploy script
//   DEPLOY_LOG_DIR      where per-deploy logs go
//   GITHUB_REPO         "owner/repo" expected in payload (safety check)

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '4567', 10);
const SECRET_FILE = process.env.WEBHOOK_SECRET_FILE || '';
const DEPLOY_SCRIPT = process.env.DEPLOY_SCRIPT || '/srv/office_app/server/scripts/deploy_from_github.sh';
const LOG_DIR = process.env.DEPLOY_LOG_DIR || '/srv/office_app/logs';
const EXPECTED_REPO = process.env.GITHUB_REPO || '';
const MAX_BODY = 2 * 1024 * 1024;

let SECRET = '';
try {
    SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
} catch (e) {
    console.error('FATAL: cannot read secret file: ' + SECRET_FILE);
    process.exit(1);
}
if (!SECRET) {
    console.error('FATAL: empty webhook secret');
    process.exit(1);
}

function verifySignature(body, header) {
    if (!header || !header.startsWith('sha256=')) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url.split('?')[0] !== '/deploy-webhook') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found\n');
        return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
            res.writeHead(413, { 'Content-Type': 'text/plain' });
            res.end('too large\n');
            req.destroy();
            return;
        }
        chunks.push(c);
    });
    req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (!verifySignature(body, req.headers['x-hub-signature-256'])) {
            console.log(new Date().toISOString() + ' 403 bad signature from ' + req.socket.remoteAddress);
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('bad signature\n');
            return;
        }
        const event = req.headers['x-github-event'] || '';
        if (event === 'ping') {
            console.log(new Date().toISOString() + ' ping -> pong');
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('pong\n');
            return;
        }
        if (event !== 'push') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ignored (' + event + ')\n');
            return;
        }
        let payload;
        try {
            payload = JSON.parse(body.toString('utf8'));
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('bad json\n');
            return;
        }
        const repo = (payload.repository && payload.repository.full_name) || '';
        const ref = payload.ref || '';
        if (repo !== EXPECTED_REPO || ref !== 'refs/heads/main') {
            console.log(new Date().toISOString() + ' ignored push repo=' + repo + ' ref=' + ref);
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ignored\n');
            return;
        }
        const sha = String(payload.after || '');
        if (!/^[a-f0-9]{40}$/i.test(sha)) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('invalid commit\n');
            return;
        }
        console.log(new Date().toISOString() + ' push main ' + sha.substring(0, 12) + ' -> starting deploy');
        const logFile = path.join(LOG_DIR, 'github_deploy_' + new Date().toISOString().replace(/[:.]/g, '-') + '.log');
        const out = fs.openSync(logFile, 'a');
        // Minimal env on purpose: inheriting our PORT (or other app vars) once
        // poisoned PM2 apps via --update-env. The script sets what it needs.
        const child = spawn('bash', [DEPLOY_SCRIPT, sha], {
            detached: true,
            stdio: ['ignore', out, out],
            env: {
                PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
                HOME: process.env.HOME || '/srv',
                PM2_HOME: process.env.PM2_HOME || '/srv/.pm2',
                GITHUB_SHA: sha,
                DEPLOY_REPO: process.env.DEPLOY_REPO || '',
                APP_ROOT: process.env.APP_ROOT || '',
            },
        });
        child.unref();
        res.writeHead(202, { 'Content-Type': 'text/plain' });
        res.end('deploy started (' + sha + ')\n');
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('github-webhook listening on 127.0.0.1:' + PORT);
});
