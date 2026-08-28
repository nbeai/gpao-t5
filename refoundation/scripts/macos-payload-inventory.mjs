#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

const FORBIDDEN_DEPENDENCIES = [
  '@huggingface/transformers', '@hyzyla/pdfium', '@napi-rs/canvas',
  'onnxruntime-common', 'onnxruntime-node', 'onnxruntime-web', 'pdfjs-dist',
];
const DOCUMENT_NAME = /^(?:readme|changelog|history|contributing|authors?|security)(?:\..*)?$/iu;
const LICENSE_NAME = /^(?:licen[cs]e|copying|notice|copyright)(?:\..*)?$/iu;

function run(command, args) { return execFileSync(command, args, { encoding: 'utf8' }).trim(); }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

async function walk(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

function binaryKind(bytes) {
  const hex = bytes.subarray(0, 4).toString('hex');
  if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca'].includes(hex)) return 'mach-o';
  if (hex === '7f454c46') return 'elf';
  if (bytes.subarray(0, 2).toString('ascii') === 'MZ') return 'pe';
  if (hex === '0061736d') return 'wasm';
  return null;
}

async function packageBom(nodeModules, files) {
  const rows = [];
  for (const path of files.filter((candidate) => basename(candidate) === 'package.json'
    && candidate.startsWith(`${nodeModules}/`))) {
    let metadata;
    try { metadata = JSON.parse(await readFile(path, 'utf8')); } catch { continue; }
    if (!metadata.name || !metadata.version) continue;
    const root = path.slice(0, -'/package.json'.length);
    const licenseFiles = files.filter((candidate) => candidate.startsWith(`${root}/`)
      && !relative(root, candidate).includes('/') && LICENSE_NAME.test(basename(candidate)));
    rows.push({ name: metadata.name, version: metadata.version, license: metadata.license ?? null,
      root: relative(nodeModules, root), licenseFiles: licenseFiles.map((candidate) => relative(root, candidate)).sort(),
      packageJsonSha256: sha256(await readFile(path)) });
  }
  return rows.sort((left, right) => left.root.localeCompare(right.root, 'en'));
}

export async function inventoryMacApp(app) {
  const files = await walk(app);
  const appRoot = join(app, 'Contents', 'Resources', 'app');
  const nodeModules = join(appRoot, 'refoundation', 'node_modules');
  let installedBytes = 0;
  const artifacts = { sourceMaps: { files: 0, bytes: 0 }, declarations: { files: 0, bytes: 0 },
    packageDocs: { files: 0, bytes: 0 }, windowsDebug: { files: 0, bytes: 0 } };
  const binaries = [];
  for (const path of files) {
    const bytes = await readFile(path); installedBytes += bytes.length;
    const name = basename(path); const packagedDependency = path.startsWith(`${nodeModules}/`);
    const bucket = packagedDependency && name.endsWith('.map') ? artifacts.sourceMaps
      : packagedDependency && /\.d\.(?:ts|cts|mts)$/u.test(name) ? artifacts.declarations
        : packagedDependency && DOCUMENT_NAME.test(name) ? artifacts.packageDocs
          : name.endsWith('.pdb') ? artifacts.windowsDebug : null;
    if (bucket) { bucket.files += 1; bucket.bytes += bytes.length; }
    const kind = binaryKind(bytes); if (!kind) continue;
    const item = { path: relative(app, path), kind, bytes: bytes.length };
    if (kind === 'mach-o') item.architectures = run('lipo', ['-archs', path]).split(/\s+/u).sort();
    else if (kind !== 'wasm') item.description = run('file', ['-b', path]);
    binaries.push(item);
  }
  binaries.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const bom = await packageBom(nodeModules, files); const presentNames = new Set(bom.map(({ name }) => name));
  return { schema: 't5.macos-payload-inventory.v1', payload: { files: files.length, installedBytes }, artifacts,
    dependencies: { packages: bom.length, bom,
      forbiddenPresent: FORBIDDEN_DEPENDENCIES.filter((name) => presentNames.has(name)) },
    binaries: { inventory: binaries, machO: binaries.filter(({ kind }) => kind === 'mach-o'),
      portableWasm: binaries.filter(({ kind }) => kind === 'wasm'),
      nonMac: binaries.filter(({ kind }) => kind === 'elf' || kind === 'pe') } };
}

export function assertProductionMacPayload(inventory, {
  maxFiles = 6_000, maxInstalledBytes = 380 * 1024 * 1024,
} = {}) {
  const failures = [];
  if (inventory.payload.files > maxFiles) failures.push(`payload files ${inventory.payload.files} > ${maxFiles}`);
  if (inventory.payload.installedBytes > maxInstalledBytes) failures.push(`payload bytes ${inventory.payload.installedBytes} > ${maxInstalledBytes}`);
  if (inventory.dependencies.forbiddenPresent.length) failures.push(`forbidden dependencies: ${inventory.dependencies.forbiddenPresent.join(', ')}`);
  if (inventory.binaries.nonMac.length) failures.push(`non-mac binaries: ${inventory.binaries.nonMac.map(({ path }) => path).join(', ')}`);
  for (const [name, facts] of Object.entries(inventory.artifacts)) if (facts.files) failures.push(`${name}: ${facts.files}`);
  for (const [path, architecture] of [
    ['Contents/Resources/app/refoundation/node_modules/node-pty/prebuilds/darwin-arm64/pty.node', 'arm64'],
    ['Contents/Resources/app/refoundation/node_modules/node-pty/prebuilds/darwin-x64/pty.node', 'x86_64'],
    ['Contents/Resources/app/refoundation/node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64-0.35.3.node', 'arm64'],
    ['Contents/Resources/app/refoundation/node_modules/@img/sharp-darwin-x64/lib/sharp-darwin-x64-0.35.3.node', 'x86_64'],
  ]) {
    const binary = inventory.binaries.machO.find((candidate) => candidate.path === path);
    if (!binary?.architectures.includes(architecture)) failures.push(`missing ${architecture} native binary: ${path}`);
  }
  if (failures.length) throw new Error(`macOS production payload gate failed:\n- ${failures.join('\n- ')}`);
  return { passed: true, limits: { maxFiles, maxInstalledBytes } };
}
