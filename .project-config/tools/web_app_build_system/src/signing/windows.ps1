param([ValidateSet('List','Tools','Verify')][string]$Action, [string]$File)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
if ($Action -eq 'List') {
    $now = Get-Date
    $items = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object {
        @($_.EnhancedKeyUsageList | Where-Object { $_.ObjectId -eq '1.3.6.1.5.5.7.3.3' }).Count -gt 0
    } | ForEach-Object {
        [ordered]@{ thumbprint=$_.Thumbprint; subject=$_.Subject; notBefore=$_.NotBefore.ToUniversalTime().ToString('o');
            notAfter=$_.NotAfter.ToUniversalTime().ToString('o'); hasPrivateKey=$_.HasPrivateKey;
            usable=($_.HasPrivateKey -and $_.NotBefore -le $now -and $_.NotAfter -gt $now) }
    } | Sort-Object { $_.subject }, { $_.thumbprint })
    ConvertTo-Json -InputObject $items -Depth 5 -Compress
} elseif ($Action -eq 'Tools') {
    $tool = $env:TAURI_WINDOWS_SIGNTOOL_PATH
    if (-not $tool) {
        $kits = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots').KitsRoot10
        $tool = Get-ChildItem -LiteralPath (Join-Path $kits 'bin') -Directory | Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    }
    if (-not $tool -or -not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw 'Install Windows SDK SignTool or set TAURI_WINDOWS_SIGNTOOL_PATH to its executable.' }
    $extractor = $env:WEB_APP_BUILD_7ZIP
    if (-not $extractor) { $extractor = (Get-Command 7z.exe -ErrorAction SilentlyContinue).Source }
    if (-not $extractor) { $extractor = Join-Path $env:ProgramFiles '7-Zip\7z.exe' }
    if (-not (Test-Path -LiteralPath $extractor -PathType Leaf)) { throw 'Install 7-Zip or set WEB_APP_BUILD_7ZIP to 7z.exe; signed NSIS payload verification requires extraction.' }
    @{ signtool=(Resolve-Path -LiteralPath $tool).Path; extractor=(Resolve-Path -LiteralPath $extractor).Path } | ConvertTo-Json -Compress
} else {
    Add-Type -Path (Join-Path $PSScriptRoot 'Authenticode.cs') -ReferencedAssemblies System.Security
    $proof = [BuildAuthenticode]::Verify($File)
    $trust = Get-AuthenticodeSignature -LiteralPath $File
    $proof['windowsTrustStatus'] = $trust.Status.ToString()
    $proof['publicCaTrust'] = 'not-verified'
    $proof | ConvertTo-Json -Depth 6 -Compress
}
