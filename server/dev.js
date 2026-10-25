require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('ssh2');
const net = require('net');
const { fork } = require('child_process');

if (!process.env.SSH_HOST) throw new Error('SSH_HOST environment variable is required');
if (!process.env.SSH_USER) throw new Error('SSH_USER environment variable is required');

const TUNNEL_PORT = 5433;
const TUNNEL_HOST = '127.0.0.1';
const REMOTE_HOST = '127.0.0.1';
const REMOTE_PORT = 5432;

const ssh = new Client();
let localServer = null;
let serverProcess = null;

function startTunnel() {
  return new Promise((resolve, reject) => {
    localServer = net.createServer((localSocket) => {
      ssh.forwardOut('127.0.0.1', 0, REMOTE_HOST, REMOTE_PORT, (err, remoteStream) => {
        if (err) { localSocket.end(); return; }
        localSocket.pipe(remoteStream).pipe(localSocket);
      });
    });

    ssh.on('ready', () => {
      localServer.listen(TUNNEL_PORT, TUNNEL_HOST, () => {
        console.log(`[dev] Tunnel ready: ${TUNNEL_HOST}:${TUNNEL_PORT} -> ${REMOTE_HOST}:${REMOTE_PORT}`);
        resolve();
      });
      localServer.on('error', (e) => console.error('[dev] Local server error:', e.message));
    });

    ssh.on('error', (err) => {
      console.error('[dev] SSH error:', err.message);
      reject(err);
    });

    ssh.on('close', () => {
      console.log('[dev] SSH connection closed');
      if (serverProcess) serverProcess.kill();
      if (localServer) localServer.close();
      process.exit(0);
    });

    ssh.connect({
      host: process.env.SSH_HOST,
      port: Number(process.env.SSH_PORT || 22),
      username: process.env.SSH_USER,
      password: process.env.SSH_PASSWORD,
      readyTimeout: 10000,
      keepaliveInterval: 10000,
    });
  });
}

async function main() {
  try {
    await startTunnel();

    serverProcess = fork('./index.js', [], {
      env: { ...process.env },
      stdio: 'inherit',
    });

    serverProcess.on('exit', (code) => {
      console.log(`[dev] Server exited with code ${code}`);
      ssh.end();
      process.exit(code);
    });

  } catch (err) {
    console.error('[dev] Failed to start:', err.message);
    process.exit(1);
  }
}

main();

process.on('SIGINT', () => {
  console.log('[dev] Shutting down...');
  if (serverProcess) serverProcess.kill();
  ssh.end();
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (serverProcess) serverProcess.kill();
  ssh.end();
  process.exit(0);
});
