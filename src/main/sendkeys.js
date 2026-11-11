'use strict';
// Pastes the clipboard into PoE's stash/vendor search box: Ctrl+F, Ctrl+A, Ctrl+V.
// Uses one long-lived PowerShell process so each paste is instant. Client-side only,
// one hotkey press = one paste (same as the existing AHK vendor-regex script).
const { spawn } = require('child_process');

const PS_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null -or $line -eq 'exit') { break }
  if ($line -eq 'paste') {
    Start-Sleep -Milliseconds 40
    [System.Windows.Forms.SendKeys]::SendWait('^f')
    Start-Sleep -Milliseconds 60
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    [System.Windows.Forms.SendKeys]::SendWait('^v')
  }
}
`;

function createKeySender() {
  let proc = null;
  const ensure = () => {
    if (proc && !proc.killed && proc.exitCode === null) return proc;
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'],
    });
    proc.on('error', () => { proc = null; });
    proc.stdin.on('error', () => { proc = null; });
    return proc;
  };
  // warm up so the first paste is fast
  try { ensure(); } catch { /* ignore */ }
  return {
    paste() { try { ensure().stdin.write('paste\r\n'); } catch { /* ignore */ } },
    dispose() { try { proc && proc.stdin.write('exit\r\n'); proc && proc.kill(); } catch { /* ignore */ } },
  };
}

module.exports = { createKeySender };
