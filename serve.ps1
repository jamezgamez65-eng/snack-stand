<#
  Snack Stand – tiny local web server for previewing on this PC (no installs needed).

  Easiest: double-click preview.cmd in this folder.
  Or run:  powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1
  Then open http://localhost:8080/ in your browser. Press Ctrl+C to stop.
#>
param([int]$Port = 8080)

$root = $PSScriptRoot
$rootDir = $root.TrimEnd('\') + '\'
$prefix = "http://localhost:$Port/"
$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.png'  = 'image/png'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.csv'  = 'text/csv; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host "Could not start on port $Port ($($_.Exception.Message))." -ForegroundColor Red
  Write-Host "Try another port:  powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8090"
  exit 1
}

Write-Host ""
Write-Host "  Snack Stand is running at $prefix" -ForegroundColor Green
Write-Host "  Serving files from $root"
Write-Host "  Press Ctrl+C to stop."
Write-Host ""

try {
  while ($listener.IsListening) {
    $task = $listener.GetContextAsync()
    while (-not $task.Wait(250)) { }   # short waits so Ctrl+C works
    $ctx = $task.Result
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      # Let pages on other sites (for example github.com in the preview pane) read these files.
      $res.AddHeader('Access-Control-Allow-Origin', '*')
      $res.AddHeader('Access-Control-Allow-Private-Network', 'true')
      if ($req.HttpMethod -eq 'OPTIONS') {
        $res.AddHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
        $res.AddHeader('Access-Control-Allow-Headers', '*')
        $res.StatusCode = 204
        $res.ContentLength64 = 0
        $res.OutputStream.Close()
        continue
      }
      $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
      if ($path.EndsWith('/')) { $path += 'index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $root (($path.TrimStart('/')) -replace '/', '\')))
      if ($file.StartsWith($rootDir, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
        $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
        if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] } else { $res.ContentType = 'application/octet-stream' }
        $res.AddHeader('Cache-Control', 'no-cache')
        $bytes = [IO.File]::ReadAllBytes($file)
        $res.StatusCode = 200
      } else {
        $res.StatusCode = 404
        $res.ContentType = 'text/plain; charset=utf-8'
        $bytes = [Text.Encoding]::UTF8.GetBytes("Not found: $path")
      }
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host ("  {0}  {1} {2}" -f $res.StatusCode, $req.HttpMethod, $path)
    } catch {
      try { $res.StatusCode = 500 } catch { }
      Write-Host "  error: $($_.Exception.Message)" -ForegroundColor Red
    } finally {
      try { $res.OutputStream.Close() } catch { }
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
