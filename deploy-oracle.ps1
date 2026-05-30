param(
  [string]$KeyPath = "C:\Users\hasna\Desktop\CodeSphere Agency LLP\Traventions\Trav Ai Marketing and Ai GBP\ssh-key-2026-05-06.key",
  [string]$ServerHost = "ubuntu@161.118.174.116",
  [string]$Branch = "main",
  [string]$ServerAppDir = "/home/ubuntu/travai-app",
  [switch]$NoBuild
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $KeyPath)) {
  throw "SSH key not found: $KeyPath"
}

$serverCommands = @(
  "set -e",
  "cd $ServerAppDir",
  "git fetch origin $Branch",
  "git checkout $Branch",
  "git pull origin $Branch",
  "cd travai-marketer",
  "npm ci --include=dev"
)

if (-not $NoBuild) {
  $serverCommands += "npm run build"
}

$serverCommands += @(
  "cd ..",
  "pm2 startOrRestart travai-marketer/ecosystem.config.cjs --env production",
  "pm2 save",
  "pm2 list"
)

$remoteScript = $serverCommands -join "; "
$escapedRemoteScript = $remoteScript -replace "'", "'\\''"

Write-Host "Deploying branch '$Branch' to $ServerHost ..."
ssh -o StrictHostKeyChecking=no -i "$KeyPath" $ServerHost "bash -lc '$escapedRemoteScript'"
if ($LASTEXITCODE -ne 0) {
  throw "Deployment failed on server. See logs above."
}

Write-Host "Deployment completed."
