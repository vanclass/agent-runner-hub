// Native console access/lifetime only; Node owns selection, layout and rendering.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static class BuildConsole {
    [StructLayout(LayoutKind.Sequential)]
    private struct Cursor { public uint Size; public bool Visible; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Coordinate { public short X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Rectangle { public short Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ScreenInfo {
        public Coordinate Size, Position;
        public ushort Attributes;
        public Rectangle Window;
        public Coordinate Maximum;
    }
    private delegate bool ControlHandler(uint kind);
    private static readonly ControlHandler Interrupt = delegate(uint kind) { return kind == 0 || kind == 1; };
    [DllImport("kernel32.dll")] private static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll")] private static extern bool GetConsoleMode(IntPtr handle, out uint mode);
    [DllImport("kernel32.dll")] private static extern bool SetConsoleMode(IntPtr handle, uint mode);
    [DllImport("kernel32.dll")] private static extern bool GetConsoleCursorInfo(IntPtr handle, out Cursor cursor);
    [DllImport("kernel32.dll")] private static extern bool SetConsoleCursorInfo(IntPtr handle, ref Cursor cursor);
    [DllImport("kernel32.dll")] private static extern uint GetConsoleOutputCP();
    [DllImport("kernel32.dll")] private static extern bool SetConsoleOutputCP(uint codepage);
    [DllImport("kernel32.dll")] private static extern bool SetConsoleCtrlHandler(ControlHandler handler, bool add);
    [DllImport("kernel32.dll")] private static extern bool GetConsoleScreenBufferInfo(IntPtr handle, out ScreenInfo info);
    [DllImport("kernel32.dll")] private static extern bool SetConsoleCursorPosition(IntPtr handle, Coordinate position);
    [DllImport("kernel32.dll")] private static extern bool SetConsoleWindowInfo(IntPtr handle, bool absolute, ref Rectangle window);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool FillConsoleOutputCharacter(IntPtr handle, char value, uint length, Coordinate position, out uint written);
    [DllImport("kernel32.dll")] private static extern bool FillConsoleOutputAttribute(IntPtr handle, ushort value, uint length, Coordinate position, out uint written);
    private static long PositionSequence;
    private static bool Positioned;

    private static string Quote(string value) {
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char letter in value) {
            if (letter == '\\') { slashes++; continue; }
            result.Append('\\', letter == '"' ? slashes * 2 + 1 : slashes);
            result.Append(letter);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    private static void PositionBand(IntPtr output, string file, int child, ref ScreenInfo info) {
        string request = Path.Combine(Path.GetDirectoryName(file), "position.request");
        if (child == 0 || !File.Exists(request)) return;
        string[] fields;
        using (FileStream stream = new FileStream(request, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        using (StreamReader reader = new StreamReader(stream)) { fields = reader.ReadToEnd().Split(' '); }
        long[] values = new long[9];
        if (fields.Length != values.Length) throw new InvalidOperationException("Invalid console positioning request.");
        for (int index = 0; index < values.Length; index++)
            if (!long.TryParse(fields[index], out values[index])) throw new InvalidOperationException("Invalid console positioning value.");
        if (values[0] != 1 || values[1] != child || values[2] < 1 || values[5] < 0
            || values[5] > Math.Max(1, values[4] - 1) || values[6] < 0 || values[6] > 1)
            throw new InvalidOperationException("Invalid console positioning ownership or bounds.");
        if (values[2] <= PositionSequence) return;
        PositionSequence = values[2];
        Positioned = values[5] == 0 || values[3] == info.Window.Right - info.Window.Left + 1
            && values[4] == info.Window.Bottom - info.Window.Top + 1 && values[7] == info.Size.X && values[8] == info.Size.Y;
        if (!Positioned) return;
        // Node leaves the cursor at the first transient row, which Win32 tracks through reflow.
        Coordinate anchor = info.Position;
        int count = (int)values[5];
        int extent = Math.Min(count, info.Window.Bottom - info.Window.Top);
        if (anchor.X != 0) throw new InvalidOperationException("The console menu anchor is not at the start of a row.");
        if (anchor.Y + extent >= info.Size.Y) {
            // Reserve within the existing buffer; ordinary scrolling retains its fixed history bound.
            Console.Write(new string('\n', extent));
            if (!GetConsoleScreenBufferInfo(output, out info)) throw new InvalidOperationException("Unable to reserve console menu rows.");
            anchor.Y = (short)(info.Position.Y - extent);
        }
        Coordinate bottom = anchor;
        bottom.Y += (short)extent;
        if (!SetConsoleCursorPosition(output, bottom) || !SetConsoleCursorPosition(output, anchor)
            || !GetConsoleScreenBufferInfo(output, out info))
            throw new InvalidOperationException("Unable to position the console menu band.");
        if (values[6] == 1) {
            // The suffix belongs exclusively to the active menu, including off-window reflow cells.
            uint length = (uint)((info.Size.Y - anchor.Y) * info.Size.X), written;
            if (!FillConsoleOutputCharacter(output, ' ', length, anchor, out written) || written != length
                || !FillConsoleOutputAttribute(output, info.Attributes, length, anchor, out written) || written != length)
                throw new InvalidOperationException("Unable to retire the console menu cells.");
        }
        if (count == 0) {
            Rectangle window = info.Window;
            int height = window.Bottom - window.Top + 1;
            window.Bottom = (short)Math.Max(height - 1, anchor.Y);
            window.Top = (short)(window.Bottom - height + 1);
            if (!SetConsoleWindowInfo(output, true, ref window) || !GetConsoleScreenBufferInfo(output, out info))
                throw new InvalidOperationException("Unable to restore the committed console history viewport.");
        }
    }

    private static void PublishViewport(IntPtr output, string file, int owner, bool cursorVisible, bool wrap, ref string previous, int child = 0) {
        ScreenInfo info;
        if (!GetConsoleScreenBufferInfo(output, out info))
            throw new InvalidOperationException("Unable to read the visible console viewport.");
        PositionBand(output, file, child, ref info);
        string value = "{\"schema\":1,\"owner\":" + owner
            + ",\"columns\":" + (info.Window.Right - info.Window.Left + 1)
            + ",\"rows\":" + (info.Window.Bottom - info.Window.Top + 1)
            + ",\"position\":" + PositionSequence + ",\"positioned\":" + (Positioned ? "true" : "false")
            + ",\"bufferColumns\":" + info.Size.X + ",\"bufferRows\":" + info.Size.Y
            + ",\"cursorX\":" + info.Position.X + ",\"cursorY\":" + info.Position.Y
            + ",\"windowLeft\":" + info.Window.Left + ",\"windowTop\":" + info.Window.Top
            + ",\"cursorVisible\":" + (cursorVisible ? "true" : "false")
            + ",\"wrap\":" + (wrap ? "true" : "false") + "}";
        if (value == previous) return;
        File.WriteAllText(file + ".next", value, new UTF8Encoding(false));
        if (File.Exists(file)) File.Replace(file + ".next", file, null);
        else File.Move(file + ".next", file);
        previous = value;
    }

    private static int Main(string[] args) {
        IntPtr input = GetStdHandle(-10), output = GetStdHandle(-11);
        uint inputMode, outputMode, codepage = GetConsoleOutputCP();
        Cursor cursor;
        bool hasInput = GetConsoleMode(input, out inputMode);
        bool hasOutput = GetConsoleMode(output, out outputMode);
        bool hasCursor = GetConsoleCursorInfo(output, out cursor);
        bool handler = false;
        Process child = null;
        string viewport = null, previous = null;
        try {
            if (hasInput && hasOutput) {
                if (!hasCursor) throw new InvalidOperationException("Unable to snapshot the console cursor before starting Node.");
                if (!SetConsoleMode(output, outputMode | 4) || !SetConsoleOutputCP(65001))
                    throw new InvalidOperationException("Interactive menus require Windows virtual terminal / UTF-8 output support.");
            }
            // The child receives interrupts; this waiting parent must not consume input or exit early.
            handler = SetConsoleCtrlHandler(Interrupt, true);
            if (!handler) throw new InvalidOperationException("Unable to preserve console interrupts.");
            ProcessStartInfo start = new ProcessStartInfo("node.exe", string.Join(" ", Array.ConvertAll(args, Quote)));
            start.UseShellExecute = false;
            start.EnvironmentVariables.Remove("WEB_APP_BUILD_VIEWPORT");
            int owner;
            using (Process self = Process.GetCurrentProcess()) { owner = self.Id; }
            if (hasInput && hasOutput && args.Length == 1) {
                viewport = Path.Combine(Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location), "viewport.json");
                PublishViewport(output, viewport, owner, cursor.Visible, (outputMode & 2) != 0, ref previous);
                start.EnvironmentVariables["WEB_APP_BUILD_VIEWPORT"] = viewport;
            }
            child = Process.Start(start);
            if (viewport == null) child.WaitForExit();
            else while (!child.WaitForExit(100))
                PublishViewport(output, viewport, owner, cursor.Visible, (outputMode & 2) != 0, ref previous, child.Id);
            return child.ExitCode;
        } catch (Exception error) {
            Console.Error.WriteLine("Build System console failed: " + error.Message);
            if (child != null && !child.HasExited) {
                Console.Error.WriteLine("Exit the build menu to finish console cleanup.");
                child.WaitForExit();
            }
            return 1;
        } finally {
            if (child != null) child.Dispose();
            if (hasInput) SetConsoleMode(input, inputMode);
            if (hasOutput) SetConsoleMode(output, outputMode);
            if (hasCursor) SetConsoleCursorInfo(output, ref cursor);
            if (hasOutput) SetConsoleOutputCP(codepage);
            if (handler) SetConsoleCtrlHandler(Interrupt, false);
            if (viewport != null) {
                File.Delete(Path.Combine(Path.GetDirectoryName(viewport), "position.request.next"));
                File.Delete(Path.Combine(Path.GetDirectoryName(viewport), "position.request"));
                File.Delete(viewport + ".next");
                File.Delete(viewport);
            }
        }
    }
}
