# One-shot: read focused control + foreground window via UI Automation. No vault secrets.
# Output: single JSON line on stdout. Exit 0 even when fields are empty (honest "unavailable").
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms,System.Web.Extensions | Out-Null
. (Join-Path $PSScriptRoot 'Caret-Common.ps1')
function Get-UrlFromBrowser($root) {
  try {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit)
    $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    foreach($e in $edits){
      $name = ''
      try { $name = [string]$e.Current.Name } catch {}
      $autoId = ''
      try { $autoId = [string]$e.Current.AutomationId } catch {}
      $val = ''
      try {
        $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if($vp){ $val = [string]$vp.Current.Value }
      } catch {}
      if($val -match '^https?://' -and ($name -match 'Address|地址|Search or|Omnibox|URL' -or $autoId -match 'url|omnibox|address')){
        return $val
      }
    }
    foreach($e in $edits){
      try {
        $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if($vp){ $val = [string]$vp.Current.Value; if($val -match '^https?://'){ return $val } }
      } catch {}
    }
  } catch {}
  return ''
}
$out = [ordered]@{ ok=$true; value=''; name=''; automationId=''; className=''; controlType=''; isPassword=$false; windowTitle=''; processName=''; processId=0; url=''; canSetValue=$false; caret=$null; element=$null; mouse=$null; caretSource=''; fg=0; error='' }
try {
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  $fw = [System.Windows.Forms.Form]::ActiveForm
  # foreground window via Win32
  Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class VAWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lp, int n);
}
"@ -ErrorAction SilentlyContinue
  $hwnd = [VAWin]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][VAWin]::GetWindowText($hwnd, $sb, $sb.Capacity)
  $out.windowTitle = $sb.ToString()
  $out.fg = [int64]$hwnd
  $procId = [uint32]0
  [void][VAWin]::GetWindowThreadProcessId($hwnd, [ref]$procId)
  $out.processId = [int]$procId
  try { $out.processName = (Get-Process -Id $procId -EA Stop).ProcessName } catch { $out.processName = '' }
  if($focused){
    $c = $focused.Current
    $out.name = [string]$c.Name
    $out.automationId = [string]$c.AutomationId
    $out.className = [string]$c.ClassName
    $out.controlType = [string]$c.ControlType.ProgrammaticName
    $out.isPassword = [bool]$c.IsPassword
    try {
      $vp = $focused.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      if($vp){ $out.value = [string]$vp.Current.Value; $out.canSetValue = -not $vp.Current.IsReadOnly }
    } catch {}
  }
  try { $ci = Get-VACaretInfo $focused; $out.caret=$ci.caret; $out.element=$ci.element; $out.mouse=$ci.mouse; $out.caretSource=$ci.caretSource } catch {}
  if($out.isPassword){ $out.value = '' }
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if($root -and $out.processName -match 'chrome|msedge|firefox|brave|opera|iexplore'){
      $out.url = Get-UrlFromBrowser $root
    }
  } catch {}
} catch {
  $out.ok = $false
  $out.error = $_.Exception.Message
}
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output ($ser.Serialize($out))
