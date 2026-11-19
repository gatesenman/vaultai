# While the mini picker is open: stream JSON lines with the focused field's
# text (never for password fields), caret rect, foreground hwnd and mouse-downs.
# Stops on stdin "STOP" / EOF or when parent kills it. No vault secrets.
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Web.Extensions | Out-Null
. (Join-Path $PSScriptRoot 'Caret-Common.ps1')
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$stdin = [Console]::In
$readTask = $stdin.ReadLineAsync()
$last = ''; $wasDown = $false; $tick = 0
while($true){
  if($readTask.IsCompleted){ $l = $readTask.Result; if($l -eq $null -or $l -eq 'STOP'){ break }; $readTask = $stdin.ReadLineAsync() }
  $down = ([VACaret]::GetAsyncKeyState(1) -band 0x8000) -ne 0 -or ([VACaret]::GetAsyncKeyState(2) -band 0x8000) -ne 0
  if($down -and -not $wasDown){
    $p = New-Object VACaret+POINT; [void][VACaret]::GetCursorPos([ref]$p)
    Write-Output ($ser.Serialize(@{ t='click'; x=$p.X; y=$p.Y })); [Console]::Out.Flush()
  }
  $wasDown = $down
  if(($tick % 3) -eq 0){
    $val = ''; $isPw = $false
    try {
      $f = [System.Windows.Automation.AutomationElement]::FocusedElement
      if($f){ $isPw = [bool]$f.Current.IsPassword
        if(-not $isPw){ try { $vp = $f.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); if($vp){ $val = [string]$vp.Current.Value } } catch {} } }
    } catch {}
    $fg = [int64][VACaret]::GetForegroundWindow()
    $c = $null; try { $c = [VACaret]::Caret() } catch {}
    $msg = @{ t='state'; value=$val; isPassword=$isPw; fg=$fg }
    if($c){ $msg.caret = @{ x=$c[0]; y=$c[1]; width=$c[2]; height=$c[3] } }
    $j = $ser.Serialize($msg)
    if($j -ne $last){ Write-Output $j; [Console]::Out.Flush(); $last = $j }
  }
  $tick++
  Start-Sleep -Milliseconds 40
}
