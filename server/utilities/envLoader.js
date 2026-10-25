const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

/**
 * Robust environment loader that searches for .env files in the root and secrets/ directory.
 * Prioritizes: 
 * 1. secrets/.env.[mode]
 * 2. .env.[mode]
 * 3. secrets/.env
 * 4. .env
 */
function loadEnv() {
    const envRoot = path.resolve(__dirname, '../..');
    const secretsDir = path.join(envRoot, 'secrets');
    
    const appEnvRaw = String(process.env.APP_ENV || process.env.NODE_ENV || '').toLowerCase();
    const appEnv = appEnvRaw === 'production' ? 'production' : 'local';
    const modeFile = appEnv === 'production' ? '.env.production' : '.env.local';

    const candidates = [
        path.join(secretsDir, modeFile),
        path.join(envRoot, modeFile),
        path.join(secretsDir, '.env'),
        path.join(envRoot, '.env')
    ];

    let loaded = false;
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            // Only use override for the very first file found to maintain priority
            dotenv.config({ path: candidate, override: !loaded });
            loaded = true;
        }
    }

    if (!loaded) {
        console.warn('⚠️  No environment files found in root or secrets directory. Using system defaults.');
    } else {
        // Ensure APP_ENV is set correctly if it wasn't in the files
        if (!process.env.APP_ENV) process.env.APP_ENV = appEnv;
    }

    return {
        appEnv,
        loaded
    };
}

module.exports = { loadEnv };
