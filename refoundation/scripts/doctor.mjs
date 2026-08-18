#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const failures = [];

const major = Number(process.versions.node.split('.')[0]);
if (!Number.isInteger(major) || major < 20) failures.push(`Node 20+ 필요, 현재 ${process.version}`);

let gitRoot = null;
try {
  gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
} catch (error) {
  failures.push(`Git 작업트리 확인 실패: ${error?.message ?? error}`);
}
if (gitRoot && resolve(gitRoot) !== root) failures.push(`예상 저장소 ${root}, 실제 ${gitRoot}`);

for (const path of [
  'AGENTS.md', 'T5-PRODUCT.md', 'T5-REFOUNDATION.md',
  'refoundation/src', 'refoundation/test', 'refoundation/scripts', 'refoundation/evidence',
]) {
  if (!existsSync(resolve(root, path))) failures.push(`필수 경로 없음: ${path}`);
}

try {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  for (const name of [
    'refoundation:doctor', 'refoundation:boundary', 'refoundation:test', 'refoundation:check',
    'refoundation:integration', 'refoundation:ci', 'refoundation:isolated', 'refoundation:live',
    'refoundation:connections',
    'refoundation:connect:oauth',
  ]) {
    if (!pkg.scripts?.[name]) failures.push(`루트 npm script 없음: ${name}`);
  }
} catch (error) {
  failures.push(`package.json 확인 실패: ${error?.message ?? error}`);
}

if (failures.length) {
  console.error('T5 refoundation 환경 FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`T5 refoundation 환경 OK — Node ${process.version}, root ${root}`);
