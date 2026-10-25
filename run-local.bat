@echo off
cd /d "%~dp0"
title Speed Net - Local Development

echo.
echo  ==========================================
echo   Speed Net - Local Dev Startup
echo  ==========================================
echo.

:: -- Load credentials from .env and ops\deploy.env --------
set "SSH_HOST=${PROD_IP}"
set "SSH_PORT=${SSH_PORT}"
set "SSH_USER=%DEPLOY_USER%"
set "SSH_PASSWORD=${SSH_PASS}"
set "SSH_HOSTKEY=SHA256:/s0WMjqRbngnyZoelbD+m66omOJGuGxiQYZLV9LJXpU"

if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        if "%%A"=="SSH_HOST" if "%%B" NEQ "" set "SSH_HOST=%%B"
        if "%%A"=="SSH_PASSWORD" if "%%B" NEQ "" set "SSH_PASSWORD=%%B"
        if "%%A"=="SSH_PORT" if "%%B" NEQ "" set "SSH_PORT=%%B"
        if "%%A"=="SSH_USER" if "%%B" NEQ "" set "SSH_USER=%%B"
    )
)

rem ops\deploy.env is authoritative (current server) - loaded AFTER root .env so it wins
if exist "ops\deploy.env" (
    for /f "usebackq tokens=1,* delims==" %%A in ("ops\deploy.env") do (
        if "%%A"=="SSH_HOST" if "%%B" NEQ "" set "SSH_HOST=%%B"
        if "%%A"=="SSH_PASSWORD" if "%%B" NEQ "" set "SSH_PASSWORD=%%B"
        if "%%A"=="SSH_PORT" if "%%B" NEQ "" set "SSH_PORT=%%B"
        if "%%A"=="SSH_USER" if "%%B" NEQ "" set "SSH_USER=%%B"
        if "%%A"=="SSH_HOSTKEY" if "%%B" NEQ "" set "SSH_HOSTKEY=%%B"
        if "%%A"=="SSH_SERVER" (
            for /f "tokens=1,2 delims=@" %%U in ("%%B") do (
                set "SSH_USER=%%U"
                set "SSH_HOST=%%V"
            )
        )
    )
)

:: -- 1. DB Tunnel (plink) ---------------------------------
netstat -ano | findstr ":5433 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto db_already

echo  [1/4] Starting DB tunnel via plink...
if exist "%~dp0ops\plink.exe" (
    start "DB-Tunnel" /min cmd /c ""%~dp0ops\plink.exe" -ssh -batch -P %SSH_PORT% -l %SSH_USER% -pw "%SSH_PASSWORD%" -hostkey "%SSH_HOSTKEY%" -N -L 5433:127.0.0.1:5432 %SSH_HOST%"
) else (
    echo  [SKIP] plink.exe not found at ops\plink.exe
)

echo  Waiting for DB tunnel on port 5433...
set /a _tries=0
:wait_tunnel
ping 127.0.0.1 -n 2 >nul
netstat -ano | findstr ":5433 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto tunnel_ok
set /a _tries+=1
if %_tries% lss 10 goto wait_tunnel
echo  [WARN] DB Tunnel not confirmed after 10s, continuing...
goto tunnel_done

:tunnel_ok
echo  [OK] DB tunnel ready on :5433
goto tunnel_done

:db_already
echo  [1/4] DB tunnel already running on :5433
:tunnel_done

:: -- 1c. Preflight: Node.js / npm check -----------------
set "NO_NODE="
where node >nul 2>&1
if errorlevel 1 set "NO_NODE=1"
if defined NO_NODE (
    echo  [ERROR] Node.js not found in PATH.
    echo          Install LTS: winget install OpenJS.NodeJS.LTS -e
    echo          Then close this window, open a NEW cmd, and re-run run-local.bat
    echo  [SKIP] Backend + Frontend cannot start without Node.
    goto backend_done
)

:: -- 1b. Auto-install server deps if missing --------------
if not exist "server\node_modules\express" (
    echo  [FIX] Server dependencies missing - running npm install...
    pushd server
    call npm install --no-audit --no-fund
    popd
)

:: -- 2. Backend (port 5000) ----------------------------
netstat -ano | findstr ":5000 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto backend_already

echo  [2/4] Starting API server (node --watch index.js)...
start "Backend" /min cmd /c "cd /d "%~dp0server" && node --watch index.js"
echo  Waiting for backend on port 5000...
set /a _tries=0
:wait_backend
ping 127.0.0.1 -n 2 >nul
netstat -ano | findstr ":5000 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto backend_ok
set /a _tries+=1
if %_tries% lss 10 goto wait_backend
echo  [WARN] Backend not confirmed after 10s
goto backend_done

:backend_ok
echo  [OK] Backend running on :5000
goto backend_done

:backend_already
echo  [2/4] Backend already running on :5000
:backend_done

:: -- 3. Frontend (port 5173) ---------------------------
if defined NO_NODE goto frontend_done
netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto frontend_already

echo  [3/4] Starting React client (npm run dev)...
start "Frontend" /min cmd /c "cd /d "%~dp0client" && npm run dev"
echo  Waiting for Vite on port 5173...
set /a _tries=0
:wait_frontend
ping 127.0.0.1 -n 2 >nul
netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto frontend_ok
set /a _tries+=1
if %_tries% lss 10 goto wait_frontend
echo  [WARN] Frontend not confirmed after 10s
goto frontend_done

:frontend_ok
echo  [OK] Frontend running on :5173
goto frontend_done

:frontend_already
echo  [3/4] Frontend already running on :5173
:frontend_done

:: -- 4. Summary ----------------------------------------
echo.
echo  [4/4] Service status:
echo  ------------------------------------------
netstat -ano | findstr ":5433 " | findstr "LISTENING" >nul 2>&1 && echo   [OK] DB Tunnel    :5433 || echo   [--] DB Tunnel    :5433 (not running)
netstat -ano | findstr ":5000 " | findstr "LISTENING" >nul 2>&1 && echo   [OK] Backend     :5000 || echo   [--] Backend     :5000 (not running)
netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul 2>&1 && echo   [OK] Frontend    :5173 || echo   [--] Frontend    :5173 (not running)
echo  ------------------------------------------
echo.
echo   URL: http://localhost:5173
echo   API: http://localhost:5000/api/health
echo.
echo  ==========================================
echo.
start http://localhost:5173
pause
