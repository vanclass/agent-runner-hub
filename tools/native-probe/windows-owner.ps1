param([Parameter(Mandatory=$true)][string]$Executable, [Parameter(Mandatory=$true)][int]$Port,
      [Parameter(Mandatory=$true)][int]$BudgetMs)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class ProbeWindows {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect rect);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint command);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  public static ConcurrentQueue<uint> ForegroundPids = new ConcurrentQueue<uint>();
  public static Timer Monitor;
  public static void Begin() {
    Monitor = new Timer(_ => { uint p; GetWindowThreadProcessId(GetForegroundWindow(), out p); ForegroundPids.Enqueue(p); }, null, 0, 10);
  }
  public static IntPtr Window(int pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h,l) => {
      uint p; GetWindowThreadProcessId(h,out p);
      if(p == pid) {
        var title = new StringBuilder(256); GetWindowText(h,title,title.Capacity);
        if(title.ToString() == "AgentRunnerHub native probe") { found=h; return false; }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static bool ForegroundAbove(IntPtr h) {
    var foreground = GetForegroundWindow();
    for(var next=GetWindow(h,3); next!=IntPtr.Zero; next=GetWindow(next,3)) if(next==foreground) return true;
    return false;
  }
}
"@
$owned = [Diagnostics.Process]::new()
$owned.StartInfo.FileName = $Executable
$owned.StartInfo.WorkingDirectory = [IO.Path]::GetDirectoryName($Executable)
$owned.StartInfo.UseShellExecute = $false
$owned.StartInfo.CreateNoWindow = $true
$owned.StartInfo.RedirectStandardOutput = $true
$owned.StartInfo.RedirectStandardError = $true
$initialForeground = [ProbeWindows]::GetForegroundWindow().ToInt64()
[ProbeWindows]::Begin()
$started = $false
function Snapshot {
  if ($owned.HasExited) { throw "Owned Hub exited: $($owned.ExitCode)" }
  $window = [ProbeWindows]::Window($owned.Id)
  return @{ pid=$owned.Id; hwnd=$window.ToInt64(); visible=[ProbeWindows]::IsWindowVisible($window);
    foreground=[ProbeWindows]::GetForegroundWindow().ToInt64(); initialForeground=$initialForeground;
    foregroundAbove=[ProbeWindows]::ForegroundAbove($window);
    activationObserved=([ProbeWindows]::ForegroundPids.ToArray() -contains [uint32]$owned.Id) }
}
try {
  if (-not $owned.Start()) { throw 'Hub process creation failed' }
  $started = $true
  # Keep the original process handle open, including across exit/PID reuse.
  $null = $owned.Handle
  $stdout = $owned.StandardOutput.ReadToEndAsync()
  $stderr = $owned.StandardError.ReadToEndAsync()
  @{ pid=$owned.Id; started=$true } | ConvertTo-Json -Compress
  while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $line | ConvertFrom-Json
    if ($request.action -eq 'stop') { break }
    try {
      $state = Snapshot
      if ($request.action -eq 'show') {
        if (-not $state.hwnd) { throw 'Owned main window is not ready' }
        # Primary-monitor placement; only the owned HWND changes. HWND_BOTTOM + SWP_NOACTIVATE.
        $rect = [ProbeWindows+Rect]::new()
        if (-not [ProbeWindows]::GetWindowRect([IntPtr]$state.hwnd, [ref]$rect)) { throw 'Owned window geometry unavailable' }
        $width = $rect.Right - $rect.Left; $height = $rect.Bottom - $rect.Top
        $x = [Math]::Max(0, ([ProbeWindows]::GetSystemMetrics(0) - $width) / 2)
        $y = [Math]::Max(0, ([ProbeWindows]::GetSystemMetrics(1) - $height) / 2)
        if (-not [ProbeWindows]::SetWindowPos([IntPtr]$state.hwnd, [IntPtr]1, $x, $y, $width, $height, 0x250)) {
          throw "Nonactivating placement failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
        }
        $state = Snapshot
      } elseif ($request.action -eq 'listener') {
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $owned.Id })
        $state.listeners = @($listeners | ForEach-Object { @{ address=$_.LocalAddress; port=$_.LocalPort } })
        if ($listeners.Count -gt 0 -and ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1' -or $listeners[0].LocalPort -ne $Port)) {
          throw 'Owned Hub must expose exactly the selected loopback WebDriver listener'
        }
      } elseif ($request.action -ne 'snapshot') { throw 'Unknown owner command' }
      $state | ConvertTo-Json -Depth 5 -Compress
    } catch { @{ error=$_.Exception.Message } | ConvertTo-Json -Compress }
  }
} catch {
  @{ error=$_.Exception.Message; stage=$(if ($started) { 'native-owner' } else { 'process-creation' }) } | ConvertTo-Json -Compress
} finally {
  if ($started) {
    $forced = $false
    if (-not $owned.HasExited) {
      $window = [ProbeWindows]::Window($owned.Id)
      if ($window -ne [IntPtr]::Zero) { $null = [ProbeWindows]::PostMessage($window, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
      if (-not $owned.WaitForExit($BudgetMs)) { $owned.Kill(); $forced = $true; $owned.WaitForExit() }
    }
    [ProbeWindows]::Monitor.Dispose()
    $remaining = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    @{ stopped=$owned.HasExited; forced=$forced; exitCode=$owned.ExitCode; listenerReleased=($remaining.Count -eq 0);
      activationObserved=([ProbeWindows]::ForegroundPids.ToArray() -contains [uint32]$owned.Id);
      foreground=[ProbeWindows]::GetForegroundWindow().ToInt64() } | ConvertTo-Json -Compress
    $owned.Dispose()
  } else {
    [ProbeWindows]::Monitor.Dispose()
    $owned.Dispose()
  }
}
