param([Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256, [Parameter(Mandatory=$true)][int]$BudgetMs)
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'windows-job.cs')
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ForegroundFixture {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static IntPtr Window(int pid) {
    IntPtr found=IntPtr.Zero;
    EnumWindows((h,l) => { uint p; GetWindowThreadProcessId(h,out p);
      if(p==pid) { var s=new StringBuilder(256); GetWindowText(h,s,256);
        if(s.ToString()=="AgentRunnerHub foreground fixture") { found=h; return false; } }
      return true;
    },IntPtr.Zero); return found;
  }
}
"@
$owned = $null
$job = $null
$image = $null
$started = $false
$children = @{}
function Snapshot {
  if ($owned.HasExited) { throw "Owned process exited: $($owned.ExitCode)" }
  $window = [ForegroundFixture]::Window($owned.Id)
  $rect = [ForegroundFixture+Rect]::new()
  $null = [ForegroundFixture]::GetWindowRect($window, [ref]$rect)
  return @{ pid=$owned.Id; created=$owned.StartTime.ToUniversalTime().ToString('o'); hwnd=$window.ToInt64();
    executable=$owned.MainModule.FileName;executableSha256=$actualHash;ownership='job-before-resume';
    visible=[ForegroundFixture]::IsWindowVisible($window); enabled=[ForegroundFixture]::IsWindowEnabled($window);
    noActivateStyle=(([ForegroundFixture]::GetWindowLong($window,-20) -band 0x08000000) -ne 0);
    foreground=[ForegroundFixture]::GetForegroundWindow().ToInt64();
    rect=@{x=$rect.Left;y=$rect.Top;width=($rect.Right-$rect.Left);height=($rect.Bottom-$rect.Top)} }
}
function ObserveChildren {
  $members = @($job.Members())
  $all = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in $members -and $_.ProcessId -ne $owned.Id })
  foreach ($child in $all) { $children[[string]$child.ProcessId] = $child.CreationDate }
  return @($all | Where-Object { $_.CommandLine -and $env:WEBVIEW2_USER_DATA_FOLDER -and
    $_.CommandLine.Contains($env:WEBVIEW2_USER_DATA_FOLDER) }).Count -gt 0
}
try {
  $image = [IO.File]::Open($Executable, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $actualHash = ([BitConverter]::ToString($sha.ComputeHash($image))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
  if ($actualHash -ne $ExpectedSha256) { throw 'Launch image digest mismatch' }
  $job = [ForegroundJob]::new($Executable, $BudgetMs)
  $owned = $job.Root
  $started = $true
  @{ started=$true;pid=$owned.Id;created=$owned.StartTime.ToUniversalTime().ToString('o');
    executable=$owned.MainModule.FileName;executableSha256=$actualHash;ownership='job-before-resume' } | ConvertTo-Json -Compress
  while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $line | ConvertFrom-Json
    if ($request.action -eq 'stop') { break }
    try {
      $state = Snapshot
      if ($request.action -eq 'show') {
        if (-not $state.hwnd) { throw 'Owned window not ready' }
        $width=$state.rect.width; $height=$state.rect.height
        $x=[Math]::Max(0,([ForegroundFixture]::GetSystemMetrics(0)-$width)/2)
        $y=[Math]::Max(0,([ForegroundFixture]::GetSystemMetrics(1)-$height)/2)
        if (-not [ForegroundFixture]::SetWindowPos([IntPtr]$state.hwnd,[IntPtr]1,$x,$y,$width,$height,0x250)) {
          throw 'Owned nonactivating presentation failed'
        }
        $state = Snapshot
      } elseif ($request.action -eq 'inspect') {
        $state.profileCorrelated = ObserveChildren
        $ids=@([uint32]$owned.Id)+@($children.Keys | ForEach-Object { [uint32]$_ })
        $state.listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop |
          Where-Object { $_.OwningProcess -in $ids } | ForEach-Object { @{pid=$_.OwningProcess;address=$_.LocalAddress;port=$_.LocalPort} })
        $state.children=@($children.Keys | ForEach-Object { @{pid=[int]$_;created=$children[$_].ToUniversalTime().ToString('o')} })
      } elseif ($request.action -ne 'snapshot') { throw 'Unknown owner command' }
      $state | ConvertTo-Json -Depth 6 -Compress
    } catch { @{error=$_.Exception.Message} | ConvertTo-Json -Compress }
  }
} catch { @{error=$_.Exception.Message;stage=$(if($started){'owner'}else{'process-creation'})} | ConvertTo-Json -Compress }
finally {
  if ($started) {
    $forced=$false
    if (-not $owned.HasExited) {
      $window=[ForegroundFixture]::Window($owned.Id)
      if ($window -ne [IntPtr]::Zero) { $null=[ForegroundFixture]::PostMessage($window,0x10,[IntPtr]::Zero,[IntPtr]::Zero) }
      if (-not $owned.WaitForExit($BudgetMs)) { $owned.Kill();$forced=$true;$owned.WaitForExit() }
    }
    $deadline=[DateTime]::UtcNow.AddMilliseconds($BudgetMs)
    do {
      $remaining=@($job.Members())
      if ($remaining.Count -eq 0) { break }; Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    @{ stopped=$owned.HasExited;forced=$forced;exitCode=$owned.ExitCode;childrenSettled=($remaining.Count -eq 0);
      ownership='job-before-resume';remainingPids=$remaining;executable=$Executable;executableSha256=$actualHash } | ConvertTo-Json -Compress
  }
  if ($job) { $job.Dispose() }
  if ($image) { $image.Dispose() }
}
