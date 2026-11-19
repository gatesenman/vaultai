# Fill username/password into focused (or nearby) fields via UI Automation, with SendKeys fallback.
# Args as env: VAULTAI_FILL_USER, VAULTAI_FILL_PASS, VAULTAI_FILL_MODE=uia|clipboard
# Never echoes the password. Prints JSON {ok, method, error}.
$ErrorActionPreference='Stop'
$user = $env:VAULTAI_FILL_USER
$pass = $env:VAULTAI_FILL_PASS
$mode = $env:VAULTAI_FILL_MODE
if(-not $mode){ $mode = 'uia' }
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms,System.Web.Extensions | Out-Null
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VAFill {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@ -ErrorAction SilentlyContinue
$out = [ordered]@{ ok=$false; method=''; error='' }
function Set-Value($el, $text) {
  $vp = $null
  try { $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch {}
  if($vp -and -not $vp.Current.IsReadOnly){ $vp.SetValue($text); return $true }
  return $false
}
try {
  $hwnd = [VAFill]::GetForegroundWindow()
  [void][VAFill]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 80
  if($mode -eq 'clipboard'){
    # Caller (Electron) already put password on clipboard; we only send Ctrl+V for password field assumption
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    $out.ok = $true; $out.method = 'clipboard-paste'
  } else {
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    $userEl = $null; $passEl = $null
    if($focused){
      if($focused.Current.IsPassword){ $passEl = $focused }
      else { $userEl = $focused }
    }
    if($root -and -not $passEl){
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::IsPasswordProperty, $true)
      $passEl = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    }
    $didUser = $false; $didPass = $false
    if($userEl -and $user){ $didUser = Set-Value $userEl $user }
    if($passEl -and $pass){ $didPass = Set-Value $passEl $pass }
    if($didPass -or $didUser){
      $out.ok = $true; $out.method = 'uia'
    } else {
      # Fallback: type username, Tab, then rely on clipboard paste for password (Electron sets clipboard)
      if($user){
        [System.Windows.Forms.SendKeys]::SendWait('^a')
        Start-Sleep -Milliseconds 30
        # Use clipboard for unicode safety
        $prev = $null
        try { $prev = [System.Windows.Forms.Clipboard]::GetText() } catch {}
        [System.Windows.Forms.Clipboard]::SetText($user)
        [System.Windows.Forms.SendKeys]::SendWait('^v')
        Start-Sleep -Milliseconds 40
        [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
        Start-Sleep -Milliseconds 40
        [System.Windows.Forms.Clipboard]::SetText($pass)
        [System.Windows.Forms.SendKeys]::SendWait('^v')
        Start-Sleep -Milliseconds 40
        if($null -ne $prev){ [System.Windows.Forms.Clipboard]::SetText($prev) } else { [System.Windows.Forms.Clipboard]::Clear() }
        $out.ok = $true; $out.method = 'sendkeys-clipboard'
      } else {
        [System.Windows.Forms.Clipboard]::SetText($pass)
        [System.Windows.Forms.SendKeys]::SendWait('^v')
        $out.ok = $true; $out.method = 'sendkeys-pass-only'
      }
    }
  }
} catch {
  $out.error = $_.Exception.Message
}
# scrub env so child dumps don't retain secrets longer than needed
$env:VAULTAI_FILL_PASS = ''
$env:VAULTAI_FILL_USER = ''
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output ($ser.Serialize($out))
