# Deploy Shadow Survivors to VPS (Mirror style)
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File deploy.ps1

$VPS = "root@91.98.135.72"
$REMOTE_DIR = "/root/projects/shadow-survivors"
$SERVICE = "roguelite.service"
$URL = "https://roguelite.shadowdog.cat"
$TAR_FILE = "deploy.tar"

$FILES = @(
    "server.js",
    "package.json",
    "package-lock.json",
    "Caddyfile",
    "changelog.md",
    "README.md",
    "public/"
)

Write-Host "=== Shadow Survivors Deploy ===" -ForegroundColor Cyan
Write-Host "VPS=$VPS  TARGET=$REMOTE_DIR  SERVICE=$SERVICE"
Write-Host ""

# Create tar archive
Write-Host "[1/4] Creating archive..." -ForegroundColor Yellow
& tar.exe -cf $TAR_FILE @FILES
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: tar failed" -ForegroundColor Red; exit 1 }

# Transfer and extract
Write-Host "[2/4] Transferring to VPS..." -ForegroundColor Yellow
cmd /c "ssh $VPS `"cat > /tmp/deploy.tar`" < $TAR_FILE"
& ssh $VPS "cd $REMOTE_DIR && tar xf /tmp/deploy.tar && rm /tmp/deploy.tar"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: transfer failed" -ForegroundColor Red; exit 1 }

# Restart service (npm install runs via ExecStartPre)
Write-Host "[3/4] Restarting $SERVICE..." -ForegroundColor Yellow
& ssh $VPS "systemctl restart $SERVICE"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: restart failed" -ForegroundColor Red; exit 1 }

Start-Sleep -Seconds 2

# Verify
Write-Host "[4/4] Verifying..." -ForegroundColor Yellow
$status = & ssh $VPS "systemctl is-active $SERVICE"
if ($status -ne "active") {
    Write-Host "ERROR: Service not active (status: $status)" -ForegroundColor Red
    exit 1
}

$httpCode = & curl.exe -s -o NUL -w "%{http_code}" $URL
if ($httpCode -ne "200") {
    Write-Host "ERROR: $URL returned HTTP $httpCode" -ForegroundColor Red
    exit 1
}

# Cleanup
Remove-Item $TAR_FILE -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Deploy successful! $URL is live (HTTP $httpCode)" -ForegroundColor Green
