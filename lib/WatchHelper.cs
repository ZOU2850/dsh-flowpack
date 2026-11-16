// dsh-flowpack human screen-watching helper (C# 5 for .NET Framework 4.8 csc.exe).
// Captures meaningful human actions (window switches, clicks, UIA control names, hotkeys,
// typing bursts) and scaled JPEG screenshots over line-delimited stdin/stdout JSON.
// Never captures password fields, password managers, UAC dialogs, or DeepSeek Harness itself.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

namespace DshFlowPackWatch
{
    internal static class Native
    {
        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

        [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
        [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

        [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
        [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder sb, int max);
        [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hwnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder sb, int max);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

        [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
        [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hdc);
        [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
        [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
        [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
        [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);

        [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder sb, ref int size);

        public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        public const uint SRCCOPY = 0x00CC0020;
        public const uint CAPTUREBLT = 0x40000000;
    }

    internal sealed class WinInfo
    {
        public IntPtr Hwnd;
        public string Exe = "";
        public string Title = "";
        public string ClassName = "";
    }

    internal sealed class UiaMeta
    {
        public string ControlName = "";
        public string ControlType = "";
        public string ValueSnippet = "";
        public bool IsPassword = false;
    }

    internal sealed class WatchEngine
    {
        private static readonly HashSet<string> ExcludedExes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "deepseek harness.exe",
            "cu-helper.exe",
            "fp-watch.exe",
            "consent.exe",
            "lockapp.exe",
            "1password.exe",
            "bitwarden.exe",
            "keepass.exe",
            "keepassxc.exe",
            "lastpass.exe",
            "dashlane.exe",
            "enpass.exe",
            "nordpass.exe",
            "proton pass.exe",
            "textinputhost.exe"
        };

        private readonly object emitLock = new object();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private volatile bool running = false;
        private Thread worker = null;

        private string outDir = "";
        private int intervalMs = 130;
        private int maxLongEdge = 1280;
        private int quality = 65;
        private int seq = 0;

        public void Emit(object payload)
        {
            string line;
            lock (emitLock)
            {
                line = json.Serialize(payload);
                Console.Out.WriteLine(line);
                Console.Out.Flush();
            }
        }

        public void Start(string dir, int interval, int edge, int q)
        {
            Stop();
            outDir = dir ?? "";
            if (!string.IsNullOrEmpty(outDir) && !Directory.Exists(outDir))
            {
                Directory.CreateDirectory(outDir);
            }
            intervalMs = Math.Max(70, Math.Min(1000, interval));
            maxLongEdge = Math.Max(640, Math.Min(1920, edge));
            quality = Math.Max(35, Math.Min(92, q));
            running = true;
            worker = new Thread(Loop);
            worker.IsBackground = true;
            worker.SetApartmentState(ApartmentState.STA);
            worker.Start();
        }

        public void Stop()
        {
            running = false;
            Thread t = worker;
            worker = null;
            if (t != null && t.IsAlive)
            {
                try { t.Join(1200); } catch { }
            }
        }

        public Dictionary<string, object> CaptureNow(string reason)
        {
            WinInfo win = GetForegroundWin();
            Native.POINT pt;
            Native.GetCursorPos(out pt);
            UiaMeta uia = InspectFocusedOrPoint(pt, true);
            return BuildAndSaveEvent(string.IsNullOrEmpty(reason) ? "manual_capture" : reason, win, pt, uia, "");
        }

        private void Loop()
        {
            IntPtr prevHwnd = IntPtr.Zero;
            bool prevLeft = false;
            bool prevRight = false;
            bool prevEnter = false;
            bool prevTab = false;
            bool prevEsc = false;
            bool prevCtrlCombo = false;
            long lastLeftDownMs = 0;
            int lastLeftX = 0;
            int lastLeftY = 0;
            bool typingPending = false;
            long lastTypeTickMs = 0;

            // Prime current foreground state so initial focus is baseline only
            WinInfo initWin = GetForegroundWin();
            if (initWin != null && !ShouldSkipWindow(initWin))
            {
                prevHwnd = initWin.Hwnd;
                Native.POINT initPt;
                Native.GetCursorPos(out initPt);
                UiaMeta initUia = InspectFocusedOrPoint(initPt, false);
                EmitAction(BuildAndSaveEvent("watch_started", initWin, initPt, initUia, ""));
            }

            while (running)
            {
                try
                {
                    long now = Environment.TickCount & 0x7FFFFFFF;
                    WinInfo win = GetForegroundWin();
                    bool skip = ShouldSkipWindow(win);

                    bool leftNow = (Native.GetAsyncKeyState(0x01) & 0x8000) != 0;
                    bool rightNow = (Native.GetAsyncKeyState(0x02) & 0x8000) != 0;
                    bool enterNow = (Native.GetAsyncKeyState(0x0D) & 0x8000) != 0;
                    bool tabNow = (Native.GetAsyncKeyState(0x09) & 0x8000) != 0;
                    bool escNow = (Native.GetAsyncKeyState(0x1B) & 0x8000) != 0;
                    bool ctrlNow = (Native.GetAsyncKeyState(0x11) & 0x8000) != 0;
                    bool altNow = (Native.GetAsyncKeyState(0x12) & 0x8000) != 0;

                    if (!skip)
                    {
                        Native.POINT pt;
                        Native.GetCursorPos(out pt);

                        // 1. Foreground window changed
                        if (win.Hwnd != IntPtr.Zero && win.Hwnd != prevHwnd)
                        {
                            if (typingPending)
                            {
                                FlushTyping(win, pt);
                                typingPending = false;
                            }
                            prevHwnd = win.Hwnd;
                            UiaMeta uiaSw = InspectFocusedOrPoint(pt, false);
                            EmitAction(BuildAndSaveEvent("switch_window", win, pt, uiaSw, ""));
                        }

                        // 2. Left click edge (with double-click recognition)
                        if (leftNow && !prevLeft)
                        {
                            if (typingPending)
                            {
                                FlushTyping(win, pt);
                                typingPending = false;
                            }
                            int dx = Math.Abs(pt.X - lastLeftX);
                            int dy = Math.Abs(pt.Y - lastLeftY);
                            bool isDbl = (now - lastLeftDownMs) > 0 && (now - lastLeftDownMs) <= 450 && dx <= 10 && dy <= 10;
                            lastLeftDownMs = now;
                            lastLeftX = pt.X;
                            lastLeftY = pt.Y;
                            UiaMeta uia = InspectFocusedOrPoint(pt, true);
                            EmitAction(BuildAndSaveEvent(isDbl ? "double_click" : "left_click", win, pt, uia, ""));
                        }

                        // 3. Right click edge
                        if (rightNow && !prevRight)
                        {
                            UiaMeta uia = InspectFocusedOrPoint(pt, true);
                            EmitAction(BuildAndSaveEvent("right_click", win, pt, uia, ""));
                        }

                        // 4. Ctrl/Alt hotkeys
                        string combo = DetectHotkey(ctrlNow, altNow);
                        if (!string.IsNullOrEmpty(combo))
                        {
                            if (!prevCtrlCombo)
                            {
                                if (typingPending)
                                {
                                    FlushTyping(win, pt);
                                    typingPending = false;
                                }
                                UiaMeta uiaKey = InspectFocusedOrPoint(pt, false);
                                EmitAction(BuildAndSaveEvent("hotkey", win, pt, uiaKey, combo));
                                prevCtrlCombo = true;
                            }
                        }
                        else
                        {
                            prevCtrlCombo = false;
                        }

                        // 5. Enter / Tab / Esc
                        if (enterNow && !prevEnter)
                        {
                            if (typingPending)
                            {
                                FlushTyping(win, pt);
                                typingPending = false;
                            }
                            UiaMeta uiaEnter = InspectFocusedOrPoint(pt, false);
                            EmitAction(BuildAndSaveEvent("key", win, pt, uiaEnter, "Enter"));
                        }
                        else if (tabNow && !prevTab)
                        {
                            UiaMeta uiaTab = InspectFocusedOrPoint(pt, false);
                            EmitAction(BuildAndSaveEvent("key", win, pt, uiaTab, altNow ? "Alt+Tab" : "Tab"));
                        }
                        else if (escNow && !prevEsc)
                        {
                            UiaMeta uiaEsc = InspectFocusedOrPoint(pt, false);
                            EmitAction(BuildAndSaveEvent("key", win, pt, uiaEsc, "Esc"));
                        }

                        // 6. Track typing activity pause (>950ms)
                        if (!ctrlNow && !altNow && IsPrintableKeyPressed())
                        {
                            typingPending = true;
                            lastTypeTickMs = now;
                        }
                        else if (typingPending && ((now - lastTypeTickMs) >= 950 || (now < lastTypeTickMs)))
                        {
                            FlushTyping(win, pt);
                            typingPending = false;
                        }
                    }

                    prevLeft = leftNow;
                    prevRight = rightNow;
                    prevEnter = enterNow;
                    prevTab = tabNow;
                    prevEsc = escNow;
                }
                catch { }

                Thread.Sleep(intervalMs);
            }
        }

        private void FlushTyping(WinInfo win, Native.POINT pt)
        {
            UiaMeta uia = InspectFocusedOrPoint(pt, false);
            string summary = uia.IsPassword
                ? "[密码输入已脱敏]"
                : (!string.IsNullOrEmpty(uia.ValueSnippet) ? uia.ValueSnippet : "[文本输入]");
            EmitAction(BuildAndSaveEvent("type", win, pt, uia, summary));
        }

        private void EmitAction(Dictionary<string, object> evt)
        {
            if (evt == null) return;
            Emit(evt);
        }

        private Dictionary<string, object> BuildAndSaveEvent(string actionType, WinInfo win, Native.POINT pt, UiaMeta uia, string keySummary)
        {
            int nextSeq = Interlocked.Increment(ref seq);
            string shotFile = "";
            int shotW = 0;
            int shotH = 0;
            Rectangle bounds = Rectangle.Empty;

            try
            {
                Screen scr = Screen.FromPoint(new Point(pt.X, pt.Y));
                bounds = scr.Bounds;
                shotW = bounds.Width;
                shotH = bounds.Height;
                if (!uia.IsPassword && !string.IsNullOrEmpty(outDir))
                {
                    shotFile = "step-" + nextSeq.ToString("D3") + ".jpg";
                    string fullPath = Path.Combine(outDir, shotFile);
                    if (!CaptureScaledScreen(bounds, maxLongEdge, quality, fullPath))
                    {
                        shotFile = "";
                    }
                }
            }
            catch { shotFile = ""; }

            string cleanVal = uia.IsPassword ? "" : uia.ValueSnippet;
            string cleanKey = uia.IsPassword ? "[密码已脱敏]" : (keySummary ?? "");

            Dictionary<string, object> d = new Dictionary<string, object>();
            d["event"] = "action";
            d["seq"] = nextSeq;
            d["timestamp"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            d["actionType"] = actionType;
            d["exe"] = win != null ? win.Exe : "";
            d["windowTitle"] = win != null ? win.Title : "";
            d["x"] = pt.X;
            d["y"] = pt.Y;
            d["relX"] = bounds.Width > 0 ? (pt.X - bounds.Left) : pt.X;
            d["relY"] = bounds.Height > 0 ? (pt.Y - bounds.Top) : pt.Y;
            d["screenWidth"] = shotW;
            d["screenHeight"] = shotH;
            d["controlType"] = uia.ControlType ?? "";
            d["controlName"] = uia.IsPassword ? "[密码框]" : (uia.ControlName ?? "");
            d["valueSnippet"] = cleanVal ?? "";
            d["keySummary"] = cleanKey;
            d["isPassword"] = uia.IsPassword;
            d["screenshotFile"] = shotFile;
            return d;
        }

        private static bool ShouldSkipWindow(WinInfo win)
        {
            if (win == null || win.Hwnd == IntPtr.Zero) return true;
            if (!string.IsNullOrEmpty(win.Exe) && ExcludedExes.Contains(win.Exe)) return true;
            if (string.Equals(win.Exe, "explorer.exe", StringComparison.OrdinalIgnoreCase)
                && string.Equals(win.ClassName, "XamlExplorerHostIslandWindow", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
            return false;
        }

        private static WinInfo GetForegroundWin()
        {
            WinInfo info = new WinInfo();
            IntPtr hwnd = Native.GetForegroundWindow();
            if (hwnd == IntPtr.Zero || !Native.IsWindow(hwnd)) return info;
            info.Hwnd = hwnd;

            int len = Native.GetWindowTextLength(hwnd);
            if (len > 0)
            {
                StringBuilder sb = new StringBuilder(Math.Min(len + 1, 512));
                Native.GetWindowText(hwnd, sb, sb.Capacity);
                info.Title = sb.ToString();
            }

            StringBuilder cls = new StringBuilder(128);
            Native.GetClassName(hwnd, cls, cls.Capacity);
            info.ClassName = cls.ToString();

            uint pid;
            Native.GetWindowThreadProcessId(hwnd, out pid);
            if (pid != 0)
            {
                IntPtr proc = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
                if (proc != IntPtr.Zero)
                {
                    try
                    {
                        StringBuilder path = new StringBuilder(512);
                        int cap = path.Capacity;
                        if (Native.QueryFullProcessImageName(proc, 0, path, ref cap))
                        {
                            info.Exe = Path.GetFileName(path.ToString());
                        }
                    }
                    finally
                    {
                        Native.CloseHandle(proc);
                    }
                }
            }
            return info;
        }

        private static UiaMeta InspectFocusedOrPoint(Native.POINT pt, bool byPoint)
        {
            UiaMeta meta = new UiaMeta();
            try
            {
                AutomationElement el = byPoint
                    ? AutomationElement.FromPoint(new System.Windows.Point(pt.X, pt.Y))
                    : AutomationElement.FocusedElement;
                if (el == null) return meta;
                object pwdObj = el.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty);
                meta.IsPassword = pwdObj != null && pwdObj != AutomationElement.NotSupported && Convert.ToBoolean(pwdObj);
                object nameObj = el.GetCurrentPropertyValue(AutomationElement.NameProperty);
                object ctrlTypeObj = el.GetCurrentPropertyValue(AutomationElement.LocalizedControlTypeProperty);
                string rawName = (nameObj != null && nameObj != AutomationElement.NotSupported) ? Convert.ToString(nameObj) : "";
                string rawType = (ctrlTypeObj != null && ctrlTypeObj != AutomationElement.NotSupported) ? Convert.ToString(ctrlTypeObj) : "";
                if (string.IsNullOrEmpty(rawType))
                {
                    ControlType ct = el.Current.ControlType;
                    rawType = ct != null ? ct.ProgrammaticName.Replace("ControlType.", "") : "";
                }
                meta.ControlName = Truncate(rawName, 90);
                meta.ControlType = Truncate(rawType, 40);
                if (!meta.IsPassword)
                {
                    object vpObj;
                    if (el.TryGetCurrentPattern(ValuePattern.Pattern, out vpObj))
                    {
                        ValuePattern vp = vpObj as ValuePattern;
                        if (vp != null)
                        {
                            meta.ValueSnippet = Truncate(vp.Current.Value, 120);
                        }
                    }
                }
            }
            catch { }
            return meta;
        }

        private static string DetectHotkey(bool ctrl, bool alt)
        {
            if (ctrl)
            {
                int[] keys = new int[] { 0x41, 0x43, 0x46, 0x4E, 0x4F, 0x50, 0x53, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x0D };
                string[] names = new string[] { "Ctrl+A", "Ctrl+C", "Ctrl+F", "Ctrl+N", "Ctrl+O", "Ctrl+P", "Ctrl+S", "Ctrl+V", "Ctrl+W", "Ctrl+X", "Ctrl+Y", "Ctrl+Z", "Ctrl+Enter" };
                for (int i = 0; i < keys.Length; i++)
                {
                    if ((Native.GetAsyncKeyState(keys[i]) & 0x8000) != 0) return names[i];
                }
            }
            if (alt && (Native.GetAsyncKeyState(0x73) & 0x8000) != 0) return "Alt+F4";
            for (int fk = 0x70; fk <= 0x7B; fk++)
            {
                if ((Native.GetAsyncKeyState(fk) & 0x8000) != 0)
                {
                    return "F" + (fk - 0x6F).ToString();
                }
            }
            return "";
        }

        private static bool IsPrintableKeyPressed()
        {
            for (int k = 0x30; k <= 0x5A; k++)
            {
                if ((Native.GetAsyncKeyState(k) & 0x8000) != 0) return true;
            }
            if ((Native.GetAsyncKeyState(0x20) & 0x8000) != 0) return true; // Space
            if ((Native.GetAsyncKeyState(0x08) & 0x8000) != 0) return true; // Backspace
            return false;
        }

        private static string Truncate(string s, int max)
        {
            if (string.IsNullOrEmpty(s)) return "";
            string clean = s.Replace("\r", " ").Replace("\n", " ").Trim();
            return clean.Length > max ? clean.Substring(0, max - 3) + "..." : clean;
        }

        private static bool CaptureScaledScreen(Rectangle bounds, int maxLongEdge, int quality, string outPath)
        {
            if (bounds.Width <= 0 || bounds.Height <= 0) return false;
            int w = bounds.Width;
            int h = bounds.Height;
            double scale = 1.0;
            int maxDim = Math.Max(w, h);
            if (maxDim > maxLongEdge) scale = (double)maxLongEdge / maxDim;
            int tw = Math.Max(1, (int)Math.Round(w * scale));
            int th = Math.Max(1, (int)Math.Round(h * scale));

            using (Bitmap raw = new Bitmap(w, h, PixelFormat.Format24bppRgb))
            {
                using (Graphics g = Graphics.FromImage(raw))
                {
                    IntPtr dst = g.GetHdc();
                    IntPtr scr = Native.GetDC(IntPtr.Zero);
                    try
                    {
                        Native.BitBlt(dst, 0, 0, w, h, scr, bounds.Left, bounds.Top, Native.SRCCOPY | Native.CAPTUREBLT);
                    }
                    finally
                    {
                        Native.ReleaseDC(IntPtr.Zero, scr);
                        g.ReleaseHdc(dst);
                    }
                }
                if (tw == w && th == h)
                {
                    SaveJpeg(raw, quality, outPath);
                }
                else
                {
                    using (Bitmap scaled = new Bitmap(tw, th, PixelFormat.Format24bppRgb))
                    {
                        using (Graphics gs = Graphics.FromImage(scaled))
                        {
                            gs.InterpolationMode = InterpolationMode.HighQualityBicubic;
                            gs.DrawImage(raw, 0, 0, tw, th);
                        }
                        SaveJpeg(scaled, quality, outPath);
                    }
                }
            }
            return File.Exists(outPath);
        }

        private static void SaveJpeg(Bitmap bmp, int quality, string outPath)
        {
            ImageCodecInfo codec = null;
            ImageCodecInfo[] encoders = ImageCodecInfo.GetImageEncoders();
            for (int i = 0; i < encoders.Length; i++)
            {
                if (encoders[i].MimeType == "image/jpeg") { codec = encoders[i]; break; }
            }
            if (codec == null)
            {
                bmp.Save(outPath, ImageFormat.Jpeg);
                return;
            }
            using (EncoderParameters ep = new EncoderParameters(1))
            using (EncoderParameter p = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality))
            {
                ep.Param[0] = p;
                bmp.Save(outPath, codec, ep);
            }
        }
    }

    internal static class Program
    {
        public static int Main(string[] args)
        {
            try
            {
                if (!Native.SetProcessDpiAwarenessContext(new IntPtr(-4)))
                {
                    Native.SetProcessDPIAware();
                }
            }
            catch
            {
                try { Native.SetProcessDPIAware(); } catch { }
            }

            WatchEngine engine = new WatchEngine();
            JavaScriptSerializer serializer = new JavaScriptSerializer();

            Dictionary<string, object> ready = new Dictionary<string, object>();
            ready["event"] = "ready";
            engine.Emit(ready);

            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                line = line.Trim();
                if (line.Length == 0) continue;
                int id = 0;
                try
                {
                    Dictionary<string, object> req = serializer.Deserialize<Dictionary<string, object>>(line);
                    if (req == null) continue;
                    object idObj;
                    if (req.TryGetValue("id", out idObj) && idObj != null) id = Convert.ToInt32(idObj);
                    object cmdObj;
                    string cmd = req.TryGetValue("cmd", out cmdObj) ? Convert.ToString(cmdObj) : "";

                    if (cmd == "start")
                    {
                        string outDir = req.ContainsKey("outDir") ? Convert.ToString(req["outDir"]) : "";
                        int intervalMs = req.ContainsKey("intervalMs") ? Convert.ToInt32(req["intervalMs"]) : 130;
                        int maxLongEdge = req.ContainsKey("maxLongEdge") ? Convert.ToInt32(req["maxLongEdge"]) : 1280;
                        int quality = req.ContainsKey("quality") ? Convert.ToInt32(req["quality"]) : 65;
                        engine.Start(outDir, intervalMs, maxLongEdge, quality);
                        Dictionary<string, object> resp = new Dictionary<string, object>();
                        resp["id"] = id;
                        resp["ok"] = true;
                        resp["result"] = new Dictionary<string, object> { { "watching", true } };
                        engine.Emit(resp);
                    }
                    else if (cmd == "capture_now")
                    {
                        string reason = req.ContainsKey("reason") ? Convert.ToString(req["reason"]) : "manual_capture";
                        Dictionary<string, object> step = engine.CaptureNow(reason);
                        Dictionary<string, object> resp = new Dictionary<string, object>();
                        resp["id"] = id;
                        resp["ok"] = true;
                        resp["result"] = step;
                        engine.Emit(resp);
                    }
                    else if (cmd == "stop")
                    {
                        engine.Stop();
                        Dictionary<string, object> resp = new Dictionary<string, object>();
                        resp["id"] = id;
                        resp["ok"] = true;
                        resp["result"] = new Dictionary<string, object> { { "watching", false } };
                        engine.Emit(resp);
                    }
                    else
                    {
                        Dictionary<string, object> resp = new Dictionary<string, object>();
                        resp["id"] = id;
                        resp["ok"] = true;
                        resp["result"] = new Dictionary<string, object> { { "pong", true } };
                        engine.Emit(resp);
                    }
                }
                catch (Exception ex)
                {
                    Dictionary<string, object> err = new Dictionary<string, object>();
                    err["id"] = id;
                    err["ok"] = false;
                    err["error"] = ex.Message;
                    engine.Emit(err);
                }
            }

            engine.Stop();
            return 0;
        }
    }
}
