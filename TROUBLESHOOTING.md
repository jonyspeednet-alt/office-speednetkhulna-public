# SpeedNet Office - Troubleshooting Guide

## 503 Service Unavailable Error

### Root Cause
The 503 error occurs when the database SSH tunnel is not running. The application cannot connect to the remote PostgreSQL database on port 5433.

### Symptoms
- Admin dashboard shows "Request failed with status code 503"
- Backend logs show: `Error: connect ECONNREFUSED 127.0.0.1:5433`
- Application appears to be running but database queries fail

### Solution

#### Quick Fix (Immediate)
1. Double-click `run-local.bat` in the project root
   (starts DB tunnel + backend + frontend; auto-installs missing server deps)

#### Manual Fix
1. Start the database tunnel:
   ```powershell
   powershell -ExecutionPolicy Bypass -File "c:\Users\Speed Net IT\Documents\office.speednetkhulna.com\ops\start_db_tunnel.ps1" -PlinkPath "c:\Users\Speed Net IT\Documents\office.speednetkhulna.com\ops\plink.exe" -LogPath "c:\Users\Speed Net IT\Documents\office.speednetkhulna.com\ops\logs\local-db-tunnel.log"
   ```

2. Verify the tunnel is running:
   ```cmd
   netstat -ano | findstr "5433"
   ```
   You should see a line with `LISTENING` status.

3. Test the backend API:
   ```powershell
   Invoke-WebRequest -Uri "http://localhost:5000/api/health" -UseBasicParsing
   ```
   Should return status 200 OK.

#### Permanent Fix (Auto-start on System Boot)

**Option 1: Task Scheduler (Recommended)**
1. Open Task Scheduler (taskschd.msc)
2. Create a new task:
   - Name: "SpeedNet Office - Database Tunnel"
   - Trigger: At system startup
   - Action: Start a program
     - Program: `powershell.exe`
     - Arguments: `-ExecutionPolicy Bypass -WindowStyle Hidden -File "c:\Users\Speed Net IT\Documents\office.speednetkhulna.com\ops\db_tunnel_watchdog.ps1" -PlinkPath "c:\Users\Speed Net IT\Documents\office.speednetkhulna.com\ops\plink.exe" -LogPath "c:\Users\Speed Net IT\Documents\office.speednetkhulna.com\ops\logs\local-db-tunnel.log" -Port 5433`
   - Run whether user is logged on or not
   - Run with highest privileges

**Option 2: Startup Folder**
1. Press `Win + R` and type: `shell:startup`
2. Create a shortcut to `run-local.bat` (project root) in the startup folder

### Verification Steps

1. **Check Database Tunnel Status:**
   ```cmd
   netstat -ano | findstr "5433"
   ```
   Expected: Should show LISTENING on port 5433

2. **Check Plink Process:**
   ```powershell
   Get-Process plink -ErrorAction SilentlyContinue
   ```
   Expected: Should show at least one plink process

3. **Check Backend Health:**
   ```powershell
   Invoke-WebRequest -Uri "http://localhost:5001/api/health" -UseBasicParsing
   ```
   Expected: Status 200 OK with database status "Connected"

4. **Check Production Server:**
   ```powershell
   Invoke-WebRequest -Uri "https://office.speednetkhulna.com/api/health" -UseBasicParsing
   ```
   Expected: Status 200 OK

5. **Check Admin Dashboard:**
   Open browser: https://office.speednetkhulna.com/admin-dashboard
   Expected: Should load without 503 error

### Log Files

Check these log files for detailed error information:

- **Backend Errors:** `logs/backend-local.err.log`
- **Backend Output:** `logs/backend-local.log`
- **Database Tunnel:** `logs/local-db-tunnel.log`
- **Tunnel Errors:** `logs/local-db-tunnel.log.err`

### Common Issues

#### Issue: Tunnel keeps disconnecting
**Solution:** The watchdog script should automatically restart it. Check if watchdog is running:
```powershell
Get-Process | Where-Object {$_.ProcessName -eq 'powershell'} | ForEach-Object { (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine } | Select-String "db_tunnel_watchdog"
```

#### Issue: Port 5433 already in use
**Solution:** Kill the existing process and restart:
```cmd
netstat -ano | findstr "5433"
taskkill /PID <PID_NUMBER> /F
```
Then restart the tunnel.

#### Issue: SSH connection refused
**Solution:** Check if the remote server is accessible:
```cmd
ping [REDACTED]
```
Verify SSH port ${SSH_PORT} is open and credentials are correct.

### Architecture Overview

```
[Browser] → [Nginx/Apache on [REDACTED]]
              ↓
         [Node.js Backend on ports 5000/5001]
              ↓
         [SSH Tunnel on port 5433]
              ↓
         [PostgreSQL on [REDACTED]:5432]
```

### Contact

If issues persist after following this guide, check:
1. Network connectivity to [REDACTED]
2. SSH credentials in the local tunnel script (kept outside this repository)
3. PostgreSQL service status on remote server
4. PM2 process status: `pm2 list`

---

## 502 "API upstream unavailable" (Production Login Down)

### Symptoms
- `https://office.speednetkhulna.com/login` returns 502:
  `{"message":"API upstream unavailable","error":"Failed to connect to 127.0.0.1 port 5001: Connection refused"}`
- Both office and partner portals affected (same backends serve both).

### Root Cause
proxy.php tries Node :5000 then :5001 — if BOTH are down, PM2 daemon itself has died
and nothing resurrected it (missing cron entries). Also check that the heal script is not
broken by CRLF line endings (`/usr/bin/env: 'bash\r'` = Windows line endings uploaded).

### Quick Fix (SSH)
1. SSH in (plink, host key pinned — see `secrets/ACCESS_CREDENTIALS.md`)
2. Run the self-heal script manually:
   ```bash
   ${APP_ROOT}/scripts/auto_restart.sh
   ```
3. Verify:
   ```bash
   curl -sS http://127.0.0.1:5000/api/health/ready
   curl -sS http://127.0.0.1:5001/api/health/ready
   ```

### If PM2 daemon is dead (`pm2 list` spawns empty)
```bash
export PATH=$HOME/.nvm/versions/node/v24.13.1/bin:$PATH
pm2 resurrect   # restores from ~/.pm2/dump.pm2, then: pm2 save
```

### Verify crontab has the auto-restart entries
`crontab -l` must contain BOTH:
```
*/5 * * * * ${APP_ROOT}/scripts/auto_restart.sh > /dev/null 2>&1
@reboot sleep 10 && ${APP_ROOT}/scripts/auto_restart.sh > /dev/null 2>&1
```

### CRLF check for server scripts
If scripts fail with `'bash\r': No such file or directory`:
```bash
sed -i "s/\r$//" ${APP_ROOT}/scripts/*.sh
```
`.gitattributes` now forces `*.sh text eol=lf`, so fresh deploys stay LF.

---
**Last Updated:** Aug 22, 2026
**Issue Fixed:** Production 502 upstream unavailable (PM2 daemon + missing crons + CRLF)
