const PRODUCT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

export function windowsProductVersion(packageMetadata) {
  const version = String(packageMetadata?.version ?? '');
  if (!PRODUCT_VERSION.test(version)) throw new TypeError('Windows product version is invalid');
  return version;
}

export function windowsRuntimeMaterial(input, architecture) {
  if (input?.schema !== 't5.windows-runtime-materials.v1'
    || !/^\d+\.\d+\.\d+$/u.test(String(input.nodeVersion ?? ''))
    || !['x64', 'arm64'].includes(architecture)) {
    throw new TypeError('Windows runtime material is invalid');
  }
  const material = input.architectures?.[architecture];
  let url;
  try { url = new URL(String(material?.url)); } catch { throw new TypeError('Windows runtime material is invalid'); }
  if (url.protocol !== 'https:' || url.hostname !== 'nodejs.org'
    || !url.pathname.endsWith(`/win-${architecture}/node.exe`)
    || !Number.isSafeInteger(material?.bytes) || material.bytes < 50 * 1024 * 1024
    || !/^[a-f0-9]{64}$/u.test(String(material?.sha256 ?? ''))) {
    throw new TypeError('Windows runtime material is invalid');
  }
  return Object.freeze({ version: input.nodeVersion, architecture, url: url.href,
    bytes: material.bytes, sha256: material.sha256, source: String(input.source ?? '') });
}

export function windowsNativeDependencyPaths(architecture) {
  if (!['x64', 'arm64'].includes(architecture)) throw new TypeError('Windows native dependency architecture is invalid');
  const pty = `node_modules/node-pty/prebuilds/win32-${architecture}`;
  return Object.freeze([
    `${pty}/pty.node`, `${pty}/conpty.node`, `${pty}/conpty_console_list.node`,
    `${pty}/conpty/OpenConsole.exe`, `${pty}/winpty-agent.exe`,
    `node_modules/@img/sharp-win32-${architecture}/lib/sharp-win32-${architecture}-0.35.3.node`,
  ]);
}

export const WINDOWS_INSTALL_SCRIPT = String.raw`param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\GPAO-T5')
)
$ErrorActionPreference = 'Stop'
$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Payload = Join-Path $PackageRoot 'payload'
$ManifestPath = Join-Path $Payload 'windows-product-manifest.json'
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ($Manifest.schema -ne 't5.windows-product-payload.v1') { throw 'Invalid GPAO-T5 payload manifest' }
$Parent = Split-Path -Parent $InstallRoot
$Incoming = Join-Path $Parent ('.GPAO-T5.incoming.' + [guid]::NewGuid().ToString('N'))
$Rollback = Join-Path $Parent ('.GPAO-T5.rollback.' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $Parent | Out-Null
Copy-Item -LiteralPath $Payload -Destination $Incoming -Recurse
foreach ($File in $Manifest.files) {
  $Candidate = Join-Path $Incoming $File.path
  if (-not (Test-Path -LiteralPath $Candidate -PathType Leaf)) { throw ('Missing payload file: ' + $File.role) }
  $Actual = (Get-FileHash -LiteralPath $Candidate -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne $File.sha256) { throw ('Changed payload file: ' + $File.role) }
}
try {
  $OldNode = Join-Path $InstallRoot 'bin\node.exe'
  $OldStop = Join-Path $InstallRoot 'app\refoundation\scripts\stop-local-runtime.mjs'
  $PortFile = Join-Path $env:LOCALAPPDATA 'GPAO-T5\state\console-port.json'
  if ((Test-Path -LiteralPath $OldNode -PathType Leaf) -and (Test-Path -LiteralPath $OldStop -PathType Leaf)) {
    & $OldNode $OldStop --port-file $PortFile --reason product_update
    if ($LASTEXITCODE -ne 0) { throw 'The running GPAO-T5 runtime could not be drained' }
  }
  if (Test-Path -LiteralPath $InstallRoot) { Move-Item -LiteralPath $InstallRoot -Destination $Rollback }
  Move-Item -LiteralPath $Incoming -Destination $InstallRoot
  $StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  New-Item -ItemType Directory -Force -Path $StartMenu | Out-Null
  $Shell = New-Object -ComObject WScript.Shell
  $Shortcut = $Shell.CreateShortcut((Join-Path $StartMenu 'GPAO-T5.lnk'))
  $Shortcut.TargetPath = Join-Path $InstallRoot 'bin\GPAO-T5.exe'
  $Shortcut.WorkingDirectory = $InstallRoot
  $Shortcut.IconLocation = (Join-Path $InstallRoot 'GPAO-T5.ico')
  $Shortcut.Save()
  $Startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
  New-Item -ItemType Directory -Force -Path $Startup | Out-Null
  $RuntimeShortcut = $Shell.CreateShortcut((Join-Path $Startup 'GPAO-T5 Runtime.lnk'))
  $RuntimeShortcut.TargetPath = Join-Path $InstallRoot 'bin\node.exe'
  $RuntimeShortcut.Arguments = ('"' + (Join-Path $InstallRoot 'app\refoundation\scripts\ensure-local-runtime.mjs') + '" --product-root "' + $InstallRoot + '" --port-file "' + (Join-Path $env:LOCALAPPDATA 'GPAO-T5\state\console-port.json') + '"')
  $RuntimeShortcut.WorkingDirectory = $InstallRoot
  $RuntimeShortcut.WindowStyle = 7
  $RuntimeShortcut.Save()
  Start-Process -FilePath (Join-Path $InstallRoot 'bin\GPAO-T5.exe')
  if (Test-Path -LiteralPath $Rollback) { Remove-Item -LiteralPath $Rollback -Recurse -Force }
} catch {
  if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
  if (Test-Path -LiteralPath $Rollback) { Move-Item -LiteralPath $Rollback -Destination $InstallRoot }
  if (Test-Path -LiteralPath $Incoming) { Remove-Item -LiteralPath $Incoming -Recurse -Force }
  throw
}
Write-Host 'GPAO-T5를 설치했습니다. 기존 대화와 기억은 그대로 유지됩니다.'
`;

export const WINDOWS_UNINSTALL_SCRIPT = String.raw`param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\GPAO-T5')
)
$ErrorActionPreference = 'Stop'
$Node = Join-Path $InstallRoot 'bin\node.exe'
$Stop = Join-Path $InstallRoot 'app\refoundation\scripts\stop-local-runtime.mjs'
$PortFile = Join-Path $env:LOCALAPPDATA 'GPAO-T5\state\console-port.json'
if ((Test-Path -LiteralPath $Node -PathType Leaf) -and (Test-Path -LiteralPath $Stop -PathType Leaf)) {
  & $Node $Stop --port-file $PortFile --reason product_uninstall
  if ($LASTEXITCODE -ne 0) { throw 'The running GPAO-T5 runtime could not be drained' }
}
$Shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\GPAO-T5.lnk'
if (Test-Path -LiteralPath $Shortcut) { Remove-Item -LiteralPath $Shortcut -Force }
$RuntimeShortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\GPAO-T5 Runtime.lnk'
if (Test-Path -LiteralPath $RuntimeShortcut) { Remove-Item -LiteralPath $RuntimeShortcut -Force }
if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
Write-Host 'GPAO-T5 앱을 제거했습니다. 대화와 기억은 그대로 두었습니다.'
`;

export function makeWindowsIconIco(png) {
  const image = Buffer.from(png);
  if (image.length < 8 || image.subarray(1, 4).toString('ascii') !== 'PNG') {
    throw new TypeError('PNG icon bytes are required');
  }
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header[6] = 0; header[7] = 0; header[8] = 0; header[9] = 0;
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(image.length, 14); header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, image]);
}

export function windowsPeArchitecture(bytes) {
  const value=Buffer.from(bytes);if(value.length<64||value[0]!==0x4d||value[1]!==0x5a)return null;
  const pe=value.readUInt32LE(0x3c);if(pe<0||pe+6>value.length||value.toString('ascii',pe,pe+4)!=='PE\0\0')return null;
  const machine=value.readUInt16LE(pe+4);return machine===0x8664?'x64':machine===0xaa64?'arm64':null;
}
