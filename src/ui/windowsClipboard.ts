import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function clipboardPaths(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  // Explorer may paste quoted paths separated by spaces, or one path per line.
  const entries = /^(?:"[^"]+"\s*)+$/.test(trimmed)
    ? [...trimmed.matchAll(/"([^"]+)"/g)].map((match) => match[1])
    : trimmed.split(/\r\n|\r|\n/).map((line) => line.trim().replace(/^(["'])(.*)\1$/, '$2'));
  return entries.flatMap((entry) => {
    if (/^file:\/\//i.test(entry)) {
      try { return [fileURLToPath(entry, { windows: true })]; } catch { return []; }
    }
    return win32.isAbsolute(entry) ? [entry] : [];
  });
}

const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$data = [System.Windows.Forms.Clipboard]::GetDataObject()
if ($null -eq $data) { '{}'; return }
$files = @($data.GetData([System.Windows.Forms.DataFormats]::FileDrop, $true) | Where-Object { $_ -is [string] })
if ($files.Count -gt 0) {
  @{ files = $files } | ConvertTo-Json -Compress
  return
}

$png = $data.GetData('PNG', $false)
if ($null -eq $png) { $png = $data.GetData('image/png', $false) }
if ($png -is [byte[]]) { $png = [IO.MemoryStream]::new($png, $false) }
$image = $null
if ($png -is [IO.Stream]) {
  try {
    if ($png.CanSeek) { $png.Position = 0 }
    $image = [Drawing.Image]::FromStream($png)
  } catch { $image = $null }
}
if ($null -eq $image) {
  $image = $data.GetData([System.Windows.Forms.DataFormats]::Bitmap, $true)
}
if ($image -is [Drawing.Image]) {
  try {
    $file = $env:RUQENAI_CLIPBOARD_IMAGE
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))
    $image.Save($file, [Drawing.Imaging.ImageFormat]::Png)
    @{ files = @($file) } | ConvertTo-Json -Compress
    return
  } finally { $image.Dispose() }
}
$text = $data.GetData([System.Windows.Forms.DataFormats]::UnicodeText, $true)
if ($text -is [string]) { @{ text = $text } | ConvertTo-Json -Compress }
else { '{}' }
`;

export async function readWindowsClipboard(): Promise<{ files?: string[]; text?: string }> {
  if (process.platform !== 'win32') return {};
  const directory = join(homedir(), '.ruqenai', 'attachments');
  const image = join(directory, 'Clipboard-' + randomUUID().slice(0, 8) + '.png');
  const { stdout } = await promisify(execFile)('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], { windowsHide: true, timeout: 7000, maxBuffer: 512_000, env: { ...process.env, RUQENAI_CLIPBOARD_IMAGE: image } });
  return JSON.parse(stdout.trim());
}
