param(
  [switch]$AllowBash,
  [switch]$AllowDirty,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ClaudeArgs
)

$ErrorActionPreference = "Stop"

$claudeCommand = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claudeCommand) {
  throw "Claude CLI was not found in PATH. Install it first, then re-run this script."
}

$repoRootRaw = (& git rev-parse --show-toplevel 2>$null).Trim()
if (-not $repoRootRaw) {
  throw "This command must be run from inside a git repository."
}
$repoRoot = [System.IO.Path]::GetFullPath(($repoRootRaw -replace "/", "\"))

$currentPath = [System.IO.Path]::GetFullPath((Get-Location).Path)
$repoPrefix = $repoRoot + [System.IO.Path]::DirectorySeparatorChar
$isInsideRepo = $currentPath.Equals($repoRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
  $currentPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)
if (-not $isInsideRepo) {
  throw "Current path is outside the repository root ($repoRoot)."
}

Push-Location $repoRoot
try {
  $dirtyOutput = (& git status --porcelain)
  if ($dirtyOutput -and -not $AllowDirty) {
    throw "Working tree is not clean. Commit or stash first, or re-run with -AllowDirty."
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $checkpointTag = "claude-safe/$stamp"
  & git tag --annotate $checkpointTag --message "Pre-skip-permissions checkpoint ($stamp)" | Out-Null
  Write-Host "Created git safety tag: $checkpointTag"

  $launchArgs = @(
    "--dangerously-skip-permissions"
    "--permission-mode"
    "bypassPermissions"
    "--add-dir"
    $repoRoot
  )

  if (-not $AllowBash) {
    $launchArgs += @("--disallowed-tools", "Bash")
    Write-Host "Bash tool disabled (default). Use -AllowBash if you explicitly need shell commands."
  }

  if ($ClaudeArgs) {
    $launchArgs += $ClaudeArgs
  }

  & claude @launchArgs
}
finally {
  Pop-Location
}
