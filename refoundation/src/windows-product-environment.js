import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { win32 } from 'node:path';

const MANIFEST_SCHEMA = 't5.windows-product-payload.v1';
const ARCHITECTURES = new Set(['x64', 'arm64']);

function windowsAbsolute(value, label) {
  const candidate = String(value ?? '').trim();
  if (!candidate || !win32.isAbsolute(candidate) || candidate.includes('\0')) {
    throw new Error(`${label} is unavailable`);
  }
  return win32.resolve(candidate);
}

function relativePayloadPath(value) {
  const candidate = String(value ?? '').replaceAll('/', '\\');
  if (!candidate || win32.isAbsolute(candidate) || candidate.split('\\').includes('..')) {
    throw new Error('Windows product manifest path is invalid');
  }
  return candidate;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function windowsCanonicalRoots({ env = process.env } = {}) {
  const localAppData = windowsAbsolute(env.LOCALAPPDATA, 'Windows LOCALAPPDATA');
  const productRoot = win32.join(localAppData, 'GPAO-T5');
  return Object.freeze({
    localAppData,
    productRoot,
    stateDir: win32.join(productRoot, 'state', 'refoundation-console'),
    connectionFile: win32.join(productRoot, 'state', 'sessions', 'model-connection.json'),
    credentialDirectory: win32.join(productRoot, 'credentials'),
    workspace: windowsAbsolute(env.USERPROFILE, 'Windows USERPROFILE'),
  });
}

export async function resolveWindowsProductEnvironment({
  env = process.env,
  architecture = process.arch,
  productRoot,
  read = readFile,
  canAccess = access,
} = {}) {
  if (!ARCHITECTURES.has(architecture)) throw new Error('Windows product architecture is unsupported');
  const installRoot = windowsAbsolute(productRoot, 'Windows product root');
  const manifestPath = win32.join(installRoot, 'windows-product-manifest.json');
  let manifest;
  try { manifest = JSON.parse(await read(manifestPath, 'utf8')); }
  catch { throw new Error('Windows product manifest is unavailable'); }
  if (manifest?.schema !== MANIFEST_SCHEMA || manifest.architecture !== architecture
    || !Array.isArray(manifest.files) || !manifest.roles || typeof manifest.roles !== 'object') {
    throw new Error('Windows product manifest does not match this computer');
  }
  const fileByPath = new Map();
  for (const item of manifest.files) {
    if (!item || typeof item !== 'object' || !/^[a-f0-9]{64}$/u.test(String(item.sha256 ?? ''))) {
      throw new Error('Windows product manifest is invalid');
    }
    const relative = relativePayloadPath(item.path);
    const path = win32.resolve(installRoot, relative);
    if (!path.toLowerCase().startsWith(`${installRoot.toLowerCase()}\\`)) {
      throw new Error('Windows product manifest escapes its install root');
    }
    if (fileByPath.has(relative.toLowerCase())) throw new Error('Windows product manifest contains duplicate paths');
    fileByPath.set(relative.toLowerCase(), { path, sha256: item.sha256 });
  }
  const fileByRole = new Map();
  for (const role of [
    'node_runtime', 'job_credential_host', 'launcher', 'console_entry',
    'file_activity_helper', 'app_activity_helper', 'folder_picker_helper', 'image_ocr_helper',
    'audio_reality_helper',
  ]) {
    const relative = relativePayloadPath(manifest.roles[role]);
    const record = fileByPath.get(relative.toLowerCase());
    if (!record) throw new Error(`Windows product file is unavailable: ${role}`);
    let bytes;
    try { await canAccess(record.path); bytes = await read(record.path); }
    catch { throw new Error(`Windows product file is unavailable: ${role}`); }
    if (digest(bytes) !== record.sha256) throw new Error(`Windows product file identity changed: ${role}`);
    fileByRole.set(role, record.path);
  }
  return Object.freeze({
    platform: 'win32', architecture, installRoot, manifestPath,
    ...windowsCanonicalRoots({ env }),
    nodeRuntime: fileByRole.get('node_runtime'),
    jobCredentialHost: fileByRole.get('job_credential_host'),
    launcher: fileByRole.get('launcher'),
    consoleEntry: fileByRole.get('console_entry'),
    fileActivityHelper: fileByRole.get('file_activity_helper') ?? null,
    appActivityHelper: fileByRole.get('app_activity_helper') ?? null,
    folderPickerHelper: fileByRole.get('folder_picker_helper') ?? null,
    imageOcrHelper: fileByRole.get('image_ocr_helper') ?? null,
    audioRealityHelper: fileByRole.get('audio_reality_helper') ?? null,
    manifest: structuredClone(manifest),
  });
}

export const WINDOWS_PRODUCT_MANIFEST_SCHEMA = MANIFEST_SCHEMA;
