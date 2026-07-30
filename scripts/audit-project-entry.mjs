#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];
const fail = (message) => failures.push(message);
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const required = [
  'AGENTS.md',
  'README.md',
  'GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md',
  'docs/PROJECT-AUTHORITY-MAP-ko.md',
  'docs/archive/README-ko.md',
  'docs/03-verification/T5-OPERATOR-HARNESS-EXECUTION-BOARD-2026-07-28-ko.md',
];
for (const path of required) {
  if (!existsSync(resolve(root, path))) fail(`필수 진입 문서 없음: ${path}`);
}

const retiredAtOldPath = [
  'design/T5-TCELL-GOVERNANCE-ENGINE-IMPLEMENTATION-SPEC-2026-07-28-ko.md',
  'design/P6-1-MEMORY-POM-TCELL-2026-07-25-ko.md',
  'SESSION-HANDOFF-2026-07-26-ko.md',
  'HANDOFF-2026-07-27-terminal-surface-ko.md',
];
for (const path of retiredAtOldPath) {
  if (existsSync(resolve(root, path))) fail(`퇴역 문서가 현재 위치에 남음: ${path}`);
}

// 활성 문서 목록 — **외부 바이너리에 기대지 않는다.**
// 예전엔 `rg` 를 spawn 했는데, ripgrep 이 없는 환경에서 `spawnSync rg ENOENT` 로 이 감사가
// 죽고 공식 게이트가 BLOCKED 됐다(실측 2026-07-30). 재발 방지용 감사가 환경에 따라 게이트를
// 막으면 그건 방지가 아니라 새 차단이다. Node 표준 순회로 같은 목록을 만든다.
const 제외경로 = ['docs/archive', 'docs/03-verification/evidence', 'design/evidence', 'node_modules', '.git'];
function 마크다운모으기(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (제외경로.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
    if (entry.isDirectory()) out.push(...마크다운모으기(rel, rel));
    else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
}
const activeMarkdown = 마크다운모으기('.');

const forbiddenReferences = [
  'design/T5-TCELL-GOVERNANCE-ENGINE-IMPLEMENTATION-SPEC-2026-07-28-ko.md',
  '→ T-cell TG-0~TG-8',
];
for (const path of activeMarkdown) {
  const text = read(path);
  for (const phrase of forbiddenReferences) {
    if (text.includes(phrase)) fail(`현재 문서가 퇴역 지시를 참조함: ${path} -> ${phrase}`);
  }
}

const handoff = read('GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md');
for (const phrase of [
  'T-cell 구현은 전면 롤백',
  '새 T-cell 계획',
  '최소 안전 제약, 최대 자동화',
  '/Users/jyp/Developer/t5-p-op',
]) {
  if (!handoff.includes(phrase)) fail(`현재 인수인계 핵심 사실 누락: ${phrase}`);
}

const agents = read('AGENTS.md');
if (!agents.includes('docs/PROJECT-AUTHORITY-MAP-ko.md')) fail('AGENTS.md에 권위 지도 진입점이 없음');
if (!agents.includes('previous T-cell specification is retired')) fail('AGENTS.md에 T-cell 퇴역 경계가 없음');

const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], {
  cwd: root,
  encoding: 'utf8',
}).split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice(9));
for (const path of worktrees) {
  if (resolve(path) === resolve(root)) continue;
  if (path.endsWith('/gpao-t5')) {
    const marker = resolve(path, 'AGENTS.md');
    if (!existsSync(marker) || !readFileSync(marker, 'utf8').includes('HISTORICAL GIT ADMIN WORKTREE')) {
      fail(`Git 관리 worktree에 역사 표식이 없음: ${path}`);
    }
    continue;
  }
  fail(`인수인계에 없는 sidecar worktree가 열려 있음: ${relative(root, path)}`);
}

if (failures.length) {
  console.error('PROJECT ENTRY AUDIT: FAIL');
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`PROJECT ENTRY AUDIT: PASS (${activeMarkdown.length} active docs, ${worktrees.length} worktrees)`);
