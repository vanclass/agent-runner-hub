using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

// This fixture-local job owns descendants before the suspended root can spawn them.
public sealed class ForegroundJob : IDisposable {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct StartupInfo {
    public int cb; public string reserved, desktop, title;
    public int x, y, width, height, xChars, yChars, fill, flags;
    public short show, reservedSize; public IntPtr reservedBytes, stdin, stdout, stderr;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInfo { public IntPtr process, thread; public int pid, tid; }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern IntPtr CreateJobObject(IntPtr security, string name);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool CreateProcess(string application, StringBuilder command, IntPtr ps, IntPtr ts,
    bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfo startup, out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr data, int size, out int returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  IntPtr job;
  public Process Root { get; private set; }

  public ForegroundJob(string executable, uint rollbackBudgetMs) {
    job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception();
    var startup = new StartupInfo(); startup.cb = Marshal.SizeOf(startup);
    ProcessInfo process = new ProcessInfo();
    bool resumed = false;
    try {
      if (!CreateProcess(executable, new StringBuilder("\"" + executable + "\""), IntPtr.Zero, IntPtr.Zero,
        false, 0x08000004, IntPtr.Zero, System.IO.Path.GetDirectoryName(executable), ref startup, out process))
        throw new Win32Exception();
      if (!AssignProcessToJobObject(job, process.process)) throw new Win32Exception();
      Root = Process.GetProcessById(process.pid);
      var retainedHandle = Root.Handle;
      var created = Root.StartTime;
      if (ResumeThread(process.thread) == 0xffffffff) throw new Win32Exception();
      resumed = true;
    } finally {
      if (!resumed && process.process != IntPtr.Zero) {
        if (!TerminateProcess(process.process, 1) || WaitForSingleObject(process.process, rollbackBudgetMs) != 0)
          throw new InvalidOperationException("Suspended root rollback failed; preserve attempt");
      }
      if (process.thread != IntPtr.Zero) CloseHandle(process.thread);
      if (process.process != IntPtr.Zero) CloseHandle(process.process);
      if (!resumed) Dispose();
    }
  }

  public int[] Members() {
    int capacity = 16;
    while (true) {
      int size = 8 + capacity * IntPtr.Size, returned;
      IntPtr data = Marshal.AllocHGlobal(size);
      try {
        if (!QueryInformationJobObject(job, 3, data, size, out returned)) {
          int error = Marshal.GetLastWin32Error();
          if (error != 234) throw new Win32Exception(error);
          capacity = checked(capacity * 2); continue;
        }
        int count = Marshal.ReadInt32(data, 4);
        var ids = new int[count];
        for (int n = 0; n < count; n++) ids[n] = checked((int)Marshal.ReadIntPtr(data, 8 + n * IntPtr.Size));
        return ids;
      } finally { Marshal.FreeHGlobal(data); }
    }
  }

  public void Dispose() {
    if (Root != null) { Root.Dispose(); Root = null; }
    if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
  }
}
