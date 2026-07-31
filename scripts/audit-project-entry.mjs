#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

// 활성 문서 목록 — 선택 설치된 rg에 기대지 않는다. Git은 아래 worktree 감사도 이미 요구한다.
// cached+untracked(비무시) 목록은 기존 rg의 gitignore 경계를 보존해 로컬 메모가 정본에 섞이지 않는다.
const 제외경로 = ['docs/archive', 'docs/03-verification/evidence', 'design/evidence', 'node_modules', '.git'];
const activeMarkdown = execFileSync('git', [
  'ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md',
], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  .filter((path) => !제외경로.some((p) => path === p || path.startsWith(`${p}/`)));

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

// 시험 서버는 **루프백에만 붙는다.** 주소를 안 주면 와일드카드(`::`)로 붙는데, macOS·BSD 는
// 다른 프로세스가 이미 `127.0.0.1:P` 를 쥐고 있어도 그 바인딩을 **성공시킨다**(SO_REUSEADDR).
// 그러면 시험은 포트 P 가 제 것이라 믿지만 `127.0.0.1:P` 로 보낸 요청은 전부 남의 프로세스가
// 받는다 — 실제로 그렇게 나서, JSON 을 기대한 자리에 남의 SPA 가 준 `<!doctype html>` 이 왔다.
// 주소를 주면 OS 가 그 주소에서 **정말 빈 포트**를 고르고, 겹치면 조용한 오답 대신 EADDRINUSE 로
// 시끄럽게 실패한다. 조용히 틀리는 것보다 시끄럽게 멈추는 것이 낫다.
// `git grep` 은 걸린 것이 없으면 1 로 끝난다 — 그건 실패가 아니라 **깨끗하다는 뜻**이다.
let 바인딩줄 = '';
try {
  바인딩줄 = execFileSync('git', ['grep', '-n', 'listen(0', '--', 'test/'], { cwd: root, encoding: 'utf8' });
} catch (e) { if (e.status !== 1) throw e; }
const 바인딩샌곳 = 바인딩줄.split('\n').filter((l) => l.trim() && !l.includes("'127.0.0.1'"));
for (const line of 바인딩샌곳) fail(`시험 서버가 주소 없이 붙는다(남의 프로세스와 겹칠 수 있다): ${line.trim()}`);

if (failures.length) {
  console.error('PROJECT ENTRY AUDIT: FAIL');
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`PROJECT ENTRY AUDIT: PASS (${activeMarkdown.length} active docs, ${worktrees.length} worktrees)`);
