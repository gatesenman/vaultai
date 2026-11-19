# Low-level keyboard watch for a short text trigger (default "pp") after a word boundary.
# Prints "WAKE" lines to stdout when fired; prints "ERR ..." on fatal errors.
# Env: VAULTAI_TRIGGER (default pp). Stops when stdin closes or process killed.
# Does NOT log or forward keystrokes — only matches the configured trigger.
$ErrorActionPreference='Stop'
$trigger = $env:VAULTAI_TRIGGER
if(-not $trigger){ $trigger = 'pp' }
$trigger = $trigger.ToLowerInvariant()
Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Collections.Concurrent;

public class VAHook {
  public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr hMod, uint th);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hh);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hh, int n, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtra);

  const int WH_KEYBOARD_LL=13, WM_KEYDOWN=0x100, WM_SYSKEYDOWN=0x104;
  const uint KEYEVENTF_KEYUP=0x0002;
  static IntPtr _hook = IntPtr.Zero;
  static HookProc _proc;
  static string _trig;
  static string _buf = "";
  static ConcurrentQueue<string> _q = new ConcurrentQueue<string>();
  static bool _armed = true;

  public static void Start(string trigger){
    _trig = trigger;
    _proc = Callback;
    using(var p = Process.GetCurrentProcess())
    using(var m = p.MainModule){
      _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(m.ModuleName), 0);
    }
    if(_hook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  public static void Stop(){ if(_hook!=IntPtr.Zero){ UnhookWindowsHookEx(_hook); _hook=IntPtr.Zero; } }
  public static bool TryDequeue(out string s){ return _q.TryDequeue(out s); }

  static bool IsBoundary(){
    if(_buf.Length==0) return true;
    char c=_buf[_buf.Length-1];
    return !char.IsLetterOrDigit(c);
  }

  static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam){
    if(nCode>=0 && _armed && (wParam==(IntPtr)WM_KEYDOWN || wParam==(IntPtr)WM_SYSKEYDOWN)){
      int vk = Marshal.ReadInt32(lParam);
      bool shift = (GetKeyState(0x10) & 0x8000) != 0;
      // Ignore when Ctrl/Alt/Win held — those are hotkeys, not text trigger
      if((GetKeyState(0x11)&0x8000)!=0 || (GetKeyState(0x12)&0x8000)!=0 || (GetKeyState(0x5B)&0x8000)!=0){
        return CallNextHookEx(_hook, nCode, wParam, lParam);
      }
      char ch = VkToChar(vk, shift);
      if(ch==(char)8){ // backspace
        if(_buf.Length>0) _buf = _buf.Substring(0, _buf.Length-1);
      } else if(ch!=(char)0){
        if(char.IsLetterOrDigit(ch)){
          // word chars accumulate; check suffix==trigger only if char before trigger is boundary
          _buf += char.ToLowerInvariant(ch);
          if(_buf.Length > 32) _buf = _buf.Substring(_buf.Length-32);
          if(_buf.EndsWith(_trig)){
            string before = _buf.Length>_trig.Length ? _buf.Substring(0, _buf.Length-_trig.Length) : "";
            char prev = before.Length>0 ? before[before.Length-1] : '\0';
            if(prev=='\0' || !char.IsLetterOrDigit(prev)){
              // erase typed trigger
              _armed = false;
              for(int i=0;i<_trig.Length;i++){
                keybd_event(0x08, 0, 0, UIntPtr.Zero);
                keybd_event(0x08, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
              }
              _buf = "";
              _q.Enqueue("WAKE");
              // small cooldown so we don't re-fire on the backspaces
              ThreadPool.QueueUserWorkItem(_ => { Thread.Sleep(400); _armed = true; });
            }
          }
        } else {
          _buf += ch;
          if(_buf.Length > 32) _buf = _buf.Substring(_buf.Length-32);
        }
      }
    }
    return CallNextHookEx(_hook, nCode, wParam, lParam);
  }

  [DllImport("user32.dll")] static extern short GetKeyState(int nVirtKey);
  static char VkToChar(int vk, bool shift){
    if(vk>=0x30 && vk<=0x39) return (char)vk;
    if(vk>=0x41 && vk<=0x5A){ char c=(char)(vk+32); return shift ? char.ToUpperInvariant(c) : c; }
    if(vk==0x20) return ' ';
    if(vk==0x08) return (char)8;
    if(vk==0x09) return '\t';
    if(vk==0x0D) return '\n';
    return (char)0;
  }
}
"@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  [VAHook]::Start($trigger)
  Write-Output "READY $trigger"
  [Console]::Out.Flush()
} catch {
  Write-Output ("ERR " + $_.Exception.Message)
  exit 1
}
# Keep a message pump so the LL hook receives events
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 50
$timer.add_Tick({
  $s = $null
  while([VAHook]::TryDequeue([ref]$s)){ Write-Output $s; [Console]::Out.Flush() }
  if([Console]::In.Peek() -ge 0){
    $line = [Console]::In.ReadLine()
    if($line -eq 'STOP'){ [VAHook]::Stop(); [System.Windows.Forms.Application]::Exit() }
  }
})
$timer.Start()
[System.Windows.Forms.Application]::Run()
[VAHook]::Stop()
