const sharedEnv = {
    // B8: pin the process timezone — month math, cron fire times and date
    // formatting must not depend on the host's TZ (Asia/Dhaka = business TZ).
    TZ: 'Asia/Dhaka',
    NODE_ENV: 'production',
    STRICT_DB_TARGET: 'true',
    STRICT_DB_CONNECTIVITY_EXIT: 'false',
    // FATAL_ON_UNHANDLED removed: the flag was dead (process always exits on
    // non-transient unhandled errors by design) and suggested otherwise.
    DB_VERIFY_RETRIES: '5',
    READY_GRACE_PERIOD_MS: '45000',
    READY_PROBE_RETRIES: '2',
    DB_KEEPALIVE_PING_INTERVAL_MS: '30000',
    DB_POOL_MAX: '10',
    DB_POOL_MAX_USES: '7500',
    SERVER_KEEPALIVE_TIMEOUT_MS: '65000',
    SERVER_HEADERS_TIMEOUT_MS: '70000',
    SERVER_REQUEST_TIMEOUT_MS: '120000',
};

module.exports = {
    apps: [
        {
            name: 'office-api-a',
            script: './server/index.js',
            cwd: __dirname,
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',
            min_uptime: '10s',
            max_restarts: 50,
            restart_delay: 3000,
            exp_backoff_restart_delay: 1000,
            kill_timeout: 10000,
            time: true,
            env: { ...sharedEnv, PORT: '5002' },
            env_production: { ...sharedEnv, PORT: '5002' },
        },
        {
            name: 'office-api-b',
            script: './server/index.js',
            cwd: __dirname,
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',
            min_uptime: '10s',
            max_restarts: 50,
            restart_delay: 3000,
            exp_backoff_restart_delay: 1000,
            kill_timeout: 10000,
            time: true,
            env: { ...sharedEnv, PORT: '5003' },
            env_production: { ...sharedEnv, PORT: '5003' },
        },
        {
            name: 'whatsapp-worker',
            script: './whatsapp-worker/server.js',
            cwd: __dirname,
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            watch: false,
            // whatsapp-web.js + puppeteer + full Chromium routinely exceed 256M
            // Node RSS (incident 2026-10-05: worker churn under the old 256M cap;
            // Chromium child RSS is invisible to this limit, host had 15GB free).
            max_memory_restart: '1G',
            // 10s min_uptime never tripped on Chrome flapping (>10s/incarnation
            // = infinite silent loop). 30s catches real crash loops.
            min_uptime: '30s',
            max_restarts: 30,
            restart_delay: 3000,
            exp_backoff_restart_delay: 1000,
            // client.destroy() needs time to release Chromium SingletonLock;
            // 10s SIGKILL orphaned Chrome holding the port/lock files.
            kill_timeout: 30000,
            time: true,
            // Explicit log files (PM2 default ~/.pm2/logs is unbounded; the
            // worker's QR ASCII spam grew out.log to 259MB in Oct 2026).
            // Pair with pm2-logrotate (max_size 50M, retain 5, compress).
            error_file: './logs/whatsapp-worker-error.log',
            out_file: './logs/whatsapp-worker-out.log',
            merge_logs: true,
            log_date_format: 'YYYY-MM-DDTHH:mm:ss',
            env: { ...sharedEnv, PORT: '4010' },
            env_production: { ...sharedEnv, PORT: '4010' },
        },
        {
            // GitHub push webhook (pull-model auto-deploy). Loopback only;
            // nginx proxies /deploy-webhook here. Secret lives server-side in
            // secrets/.webhook_secret (chmod 600) — never in repo.
            name: 'github-webhook',
            script: './server/webhook/deployWebhook.js',
            cwd: __dirname,
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '128M',
            min_uptime: '10s',
            max_restarts: 50,
            restart_delay: 3000,
            exp_backoff_restart_delay: 1000,
            kill_timeout: 10000,
            time: true,
            env: {
                ...sharedEnv,
                PORT: '4567',
                WEBHOOK_SECRET_FILE: '/srv/office_app/secrets/.webhook_secret',
                DEPLOY_SCRIPT: '/srv/office_app/server/scripts/deploy_from_github.sh',
                DEPLOY_LOG_DIR: '/srv/office_app/logs',
                GITHUB_REPO: process.env.GITHUB_REPO || '',
            },
            env_production: {
                ...sharedEnv,
                PORT: '4567',
                WEBHOOK_SECRET_FILE: '/srv/office_app/secrets/.webhook_secret',
                DEPLOY_SCRIPT: '/srv/office_app/server/scripts/deploy_from_github.sh',
                DEPLOY_LOG_DIR: '/srv/office_app/logs',
                GITHUB_REPO: process.env.GITHUB_REPO || '',
            },
        },
    ],
};
