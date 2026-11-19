# Shared: caret rect (physical px, screen coords) via GetGUIThreadInfo, then UIA TextPattern.
Add-Type -ErrorAction SilentlyContinue @"
using System;
using System.Runtime.InteropServices;
public class VACaret {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public int cbSize; public int flags; public IntPtr hwndActive; public IntPtr hwndFocus; public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner; public IntPtr hwndMoveSize; public IntPtr hwndCaret; public RECT rcCaret; }
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint tid, ref GUITHREADINFO info);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  public static int[] Caret() {
    IntPtr fg = GetForegroundWindow(); uint pid;
    uint tid = GetWindowThreadProcessId(fg, out pid);
    GUITHREADINFO gi = new GUITHREADINFO(); gi.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    if (!GetGUIThreadInfo(tid, ref gi) || gi.hwndCaret == IntPtr.Zero) return null;
    POINT p = new POINT(); p.X = gi.rcCaret.Left; p.Y = gi.rcCaret.Top;
    if (!ClientToScreen(gi.hwndCaret, ref p)) return null;
    int w = gi.rcCaret.Right - gi.rcCaret.Left, h = gi.rcCaret.Bottom - gi.rcCaret.Top;
    if (h <= 0) return null;
    return new int[] { p.X, p.Y, Math.Max(1, w), h };
  }
}
"@
# Per-monitor-v2 DPI awareness so all coordinates are physical pixels.
try { [void][VACaret]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch {}

function Get-VACaretInfo($focused) {
  $r = [ordered]@{ caret=$null; element=$null; mouse=$null; caretSource='' }
  try { $c = [VACaret]::Caret(); if($c){ $r.caret = @{ x=$c[0]; y=$c[1]; width=$c[2]; height=$c[3] }; $r.caretSource='win32' } } catch {}
  if(-not $r.caret -and $focused){
    try {
      $tp = $focused.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      if($tp){
        $sel = $tp.GetSelection()
        if($sel -and $sel.Length -gt 0){
          $rng = $sel[0]
          $rects = $rng.GetBoundingRectangles()
          if(-not $rects -or $rects.Length -eq 0){
            $rng2 = $rng.Clone(); [void]$rng2.ExpandToEnclosingUnit([System.Windows.Automation.Text.TextUnit]::Character)
            $rects = $rng2.GetBoundingRectangles()
          }
          if($rects -and $rects.Length -gt 0){
            $b = $rects[$rects.Length-1]
            $r.caret = @{ x=[int]($b.X + $b.Width); y=[int]$b.Y; width=1; height=[int][Math]::Max(1,$b.Height) }; $r.caretSource='uia-text'
          }
        }
      }
    } catch {}
  }
  if($focused){
    try { $br = $focused.Current.BoundingRectangle
      if(-not $br.IsEmpty -and $br.Width -gt 0){ $r.element = @{ x=[int]$br.X; y=[int]$br.Y; width=[int]$br.Width; height=[int]$br.Height } } } catch {}
  }
  try { $p = New-Object VACaret+POINT; [void][VACaret]::GetCursorPos([ref]$p); $r.mouse = @{ x=$p.X; y=$p.Y } } catch {}
  return $r
}
