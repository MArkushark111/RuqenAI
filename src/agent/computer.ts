import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type ComputerAction = 'screenshot' | 'move' | 'click' | 'double_click' | 'mouse_down' | 'mouse_up' | 'drag' | 'scroll' | 'key' | 'key_down' | 'key_up' | 'type';
export interface ComputerInput { action: ComputerAction; x?: number; y?: number; toX?: number; toY?: number; button?: 'left' | 'right' | 'middle'; amount?: number; key?: string; text?: string; }
export interface ComputerFrame { data: string; width: number; height: number; }

let listener: ((active: boolean) => void) | undefined;
let active = false;
const heldKeys = new Set<string>();
const heldButtons = new Set<string>();
export function onComputerUse(fn?: (active: boolean) => void): void { listener = fn; }
let paused = false;

/** Esc-handed control back to the user without ending the turn. */
export function pauseComputerUse(): void {
  paused = true;
  stopComputerUse();
}

/** A fresh turn may use the computer again. */
export function resumeComputerUse(): void {
  paused = false;
}

export function stopComputerUse(): void {
  if (active) { active = false; listener?.(false); }
  if (!heldKeys.size && !heldButtons.size) return;
  const keys = [...heldKeys];
  const buttons = [...heldButtons];
  heldKeys.clear();
  heldButtons.clear();
  void releaseHeld(keys, buttons);
}

const helper = String.raw`param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RuqenInput {
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
 [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
}
'@
$a = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
function KeyCode([string]$name) {
 $map = @{ CTRL=17; CONTROL=17; SHIFT=16; ALT=18; WIN=91; WINDOWS=91; ENTER=13; RETURN=13; TAB=9; ESC=27; ESCAPE=27; BACKSPACE=8; DELETE=46; SPACE=32; UP=38; DOWN=40; LEFT=37; RIGHT=39; HOME=36; END=35; PAGEUP=33; PAGEDOWN=34; F1=112; F2=113; F3=114; F4=115; F5=116; F6=117; F7=118; F8=119; F9=120; F10=121; F11=122; F12=123 }
 $n = $name.Trim().ToUpperInvariant()
 if ($map.ContainsKey($n)) { return [byte]$map[$n] }
 if ($n.Length -eq 1 -and $n -match '[A-Z0-9]') { return [byte][char]$n }
 throw "Unsupported key: $name"
}
function Press([byte]$key,[bool]$down) { [RuqenInput]::keybd_event($key,0,[uint32]$(if($down){0}else{2}),[UIntPtr]::Zero) }
function MouseFlag([string]$button,[bool]$down) {
 if ($button -eq 'right') { return [uint32]$(if($down){8}else{16}) }
 if ($button -eq 'middle') { return [uint32]$(if($down){32}else{64}) }
 return [uint32]$(if($down){2}else{4})
}
function Mouse([string]$button,[bool]$down) { [RuqenInput]::mouse_event((MouseFlag $button $down),0,0,0,[UIntPtr]::Zero) }
function At([int]$x,[int]$y) { [void][RuqenInput]::SetCursorPos($x,$y); Start-Sleep -Milliseconds 60 }
$button = if($a.button){[string]$a.button}else{'left'}
switch ([string]$a.action) {
 'move' { At $a.x $a.y }
 'click' { At $a.x $a.y; Mouse $button $true; Start-Sleep -Milliseconds 55; Mouse $button $false }
 'double_click' { At $a.x $a.y; 1..2 | ForEach-Object { Mouse $button $true; Start-Sleep -Milliseconds 45; Mouse $button $false; Start-Sleep -Milliseconds 90 } }
 'mouse_down' { At $a.x $a.y; Mouse $button $true }
 'mouse_up' { Mouse $button $false }
 'drag' { At $a.x $a.y; Mouse $button $true; try { for($i=1;$i -le 12;$i++) { At ([int]($a.x+($a.toX-$a.x)*$i/12)) ([int]($a.y+($a.toY-$a.y)*$i/12)) } } finally { Mouse $button $false } }
 'scroll' { if($null -ne $a.x -and $null -ne $a.y){At $a.x $a.y}; [RuqenInput]::mouse_event(2048,0,0,[int]($a.amount*120),[UIntPtr]::Zero) }
 'key' { $parts = ([string]$a.key).Split('+'); $codes = @($parts | ForEach-Object { KeyCode $_ }); try { foreach($code in $codes){Press $code $true}; Start-Sleep -Milliseconds 55 } finally { [array]::Reverse($codes); foreach($code in $codes){Press $code $false} } }
 'key_down' { Press (KeyCode $a.key) $true }
 'key_up' { Press (KeyCode $a.key) $false }
 'release' { foreach($name in $a.keys){Press (KeyCode $name) $false}; foreach($name in $a.buttons){Mouse $name $false} }
 'type' { foreach($char in ([string]$a.text).ToCharArray()) { $s = [string]$char; if($char -eq [char]10){[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')} elseif($char -eq [char]13){} elseif($char -eq [char]9){[System.Windows.Forms.SendKeys]::SendWait('{TAB}')} elseif($s -match '[+^%~(){}\[\]]'){[System.Windows.Forms.SendKeys]::SendWait('{' + $s + '}')}else{[System.Windows.Forms.SendKeys]::SendWait($s)} } }
 'screenshot' { }
 default { throw "Unsupported computer action: $($a.action)" }
}
Start-Sleep -Milliseconds 140
$left = [RuqenInput]::GetSystemMetrics(76); $top = [RuqenInput]::GetSystemMetrics(77)
$width = [RuqenInput]::GetSystemMetrics(78); $height = [RuqenInput]::GetSystemMetrics(79)
$bitmap = New-Object System.Drawing.Bitmap($width,$height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try { $graphics.CopyFromScreen($left,$top,0,0,$bitmap.Size); $bitmap.Save([string]$a.output,[System.Drawing.Imaging.ImageFormat]::Png) }
finally { $graphics.Dispose(); $bitmap.Dispose() }
Write-Output ($left.ToString()+','+$top.ToString()+','+$width.ToString()+','+$height.ToString())
`;

let helperPath: string | undefined;
async function scriptPath(): Promise<string> {
  if (helperPath) return helperPath;
  const file = path.join(os.tmpdir(), 'ruqenai-computer-' + process.pid + '.ps1');
  await fs.writeFile(file, helper, { mode: 0o600 });
  helperPath = file;
  return file;
}

async function releaseHeld(keys: string[], buttons: string[]): Promise<void> {
  const output = path.join(os.tmpdir(), 'ruqenai-screen-' + randomUUID() + '.png');
  try {
    const script = await scriptPath();
    const payload = Buffer.from(JSON.stringify({ action: 'release', keys, buttons, output }), 'utf8').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-Payload', payload], { windowsHide: true });
    await new Promise<void>((resolve) => { child.once('error', () => resolve()); child.once('close', () => resolve()); });
  } catch { /* Releasing a held input must not obscure the original tool result. */ }
  finally { await fs.rm(output, { force: true }).catch(() => {}); }
}

export async function computerAction(input: ComputerInput, signal?: AbortSignal): Promise<ComputerFrame> {
  if (process.platform !== 'win32') throw new Error('Computer control currently supports Windows only.');
  signal?.throwIfAborted();
  if (!active) { active = true; listener?.(true); }
  if (input.action === 'key_down' && input.key) heldKeys.add(input.key);
  if (input.action === 'mouse_down') heldButtons.add(input.button ?? 'left');
  const output = path.join(os.tmpdir(), 'ruqenai-screen-' + randomUUID() + '.png');
  const payload = Buffer.from(JSON.stringify({ ...input, output }), 'utf8').toString('base64');
  const script = await scriptPath();
  try {
    const dimensions = await new Promise<string>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-Payload', payload], { windowsHide: true });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      const abort = () => child.kill();
      signal?.addEventListener('abort', abort, { once: true });
      child.once('error', reject);
      child.once('close', (code) => { signal?.removeEventListener('abort', abort); if (code === 0) resolve(stdout.trim()); else reject(new Error(stderr.trim() || 'Computer action failed.')); });
    });
    signal?.throwIfAborted();
    if (paused) throw new Error('The user stopped computer control. Continue without using the computer.');
    if (input.action === 'key_up' && input.key) heldKeys.delete(input.key);
    if (input.action === 'mouse_up') heldButtons.delete(input.button ?? 'left');
    const [, , width, height] = dimensions.split(',').map(Number);
    const data = (await fs.readFile(output)).toString('base64');
    return { data, width, height };
  } finally { await fs.rm(output, { force: true }).catch(() => {}); }
}
