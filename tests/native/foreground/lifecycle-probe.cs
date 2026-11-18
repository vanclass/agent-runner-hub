using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

// Deterministic test-only process tree: a descendant can outlive the window root.
public class ForegroundLifecycleProbe : Form {
  static string Folder = Environment.GetEnvironmentVariable("FOREGROUND_PROBE_FOLDER");
  static int Budget = int.Parse(Environment.GetEnvironmentVariable("FOREGROUND_PROBE_BUDGET"));
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override void SetVisibleCore(bool value) { if (!IsHandleCreated) CreateHandle(); base.SetVisibleCore(false); }
  static void Spawn(string argument) {
    var info = new ProcessStartInfo(Application.ExecutablePath, argument);
    info.UseShellExecute = false; info.CreateNoWindow = true;
    using (var child = Process.Start(info)) { }
  }
  static bool Wait(string name) {
    var timer = Stopwatch.StartNew();
    while (!File.Exists(Path.Combine(Folder, name)) && timer.ElapsedMilliseconds < Budget) Thread.Sleep(20);
    return File.Exists(Path.Combine(Folder, name));
  }
  public ForegroundLifecycleProbe() {
    Text = "AgentRunnerHub foreground fixture"; ShowInTaskbar = false;
    FormClosed += (sender, args) => File.WriteAllText(Path.Combine(Folder, "root-closed"), "closed");
  }
  [STAThread] public static void Main(string[] args) {
    if (args.Length > 0) {
      File.WriteAllText(Path.Combine(Folder, args[0] + "-started"), Process.GetCurrentProcess().Id.ToString());
      if (args[0] == "child" && Wait("root-closed")) Spawn("grandchild");
      Wait("release"); return;
    }
    File.WriteAllText(Path.Combine(Folder, "image-version"), "VERSION");
    if (Environment.GetEnvironmentVariable("FOREGROUND_PROBE_TREE") == "1") Spawn("child");
    Application.Run(new ForegroundLifecycleProbe());
  }
}
