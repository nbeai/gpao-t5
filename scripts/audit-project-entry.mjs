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
  'docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md',
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
  'GPAO-T5-FINAL-DEVELOPMENT-PLAN-2026-07-24-ko.md',
  'GPAO-T5-PRODUCT-CONSTITUTION-2026-07-24-ko.md',
  'GPAO-T5-PRODUCT-CONSTITUTION-AUDIT-2026-07-24-ko.md',
];
for (const path of retiredAtOldPath) {
  if (existsSync(resolve(root, path))) fail(`퇴역 문서가 현재 위치에 남음: ${path}`);
}

// 활성 문서 목록 — 선택 설치된 rg에 기대지 않는다. Git은 아래 worktree 감사도 이미 요구한다.
// cached+untracked(비무시) 목록은 기존 rg의 gitignore 경계를 보존해 로컬 메모가 정본에 섞이지 않는다.
// `design/archive` — 구현이 끝난 슬라이스 명세(2026-08-06 정리). 여기 것은 **활성 문서가 아니다.**
// 안 빼면 보관한 47개가 계속 활성으로 세어지고, 그러면 보관이 정리가 아니라 이름만 바꾼 게 된다.
const 제외경로 = ['docs/archive', 'design/archive', 'docs/03-verification/evidence', 'design/evidence', 'node_modules', '.git'];
const activeMarkdown = execFileSync('git', [
  'ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md',
], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  .filter((path) => existsSync(resolve(root, path)))
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
  'design/T5-TCELL-DEVELOPMENT-PLAN-2026-07-31-ko.md',
  'IMPLEMENTATION_CONTRACT_FROZEN',
  '최소 안전 제약, 최대 자동화',
  '/Users/jyp/Developer/t5-p-op',
]) {
  if (!handoff.includes(phrase)) fail(`현재 인수인계 핵심 사실 누락: ${phrase}`);
}
// 상태 토큰은 **가변값이다 — 여기 하드코딩하지 않는다.** 단계가 전진하면 하드코딩된 게이트가
// 낡아 참 진행을 막는다(실측: `TCELL_H_REMEDIATION` 고정이 `TCELL_H_SEAL_1` 전진을 FAIL 로
// 판정했다 — 12533ac 의 fixture 누락과 같은 계열). 진실은 H 진행표가 들고, 인수인계는 그
// 토큰을 그대로 담아야 한다(§0-A·§4·§9·§10 상호 일치는 audit:docs 가 본다).
const hBoard = read('docs/03-verification/T5-H-STAGE-BOARD-2026-08-01-ko.md');
const boardToken = /상태: `([A-Z0-9_]+)/.exec(hBoard)?.[1];
if (!boardToken) fail('H 진행표에 상태 토큰이 없음');
else if (!handoff.includes(boardToken)) {
  fail(`인수인계가 H 진행표의 현재 상태 토큰(${boardToken})을 담지 않음`);
}

const agents = read('AGENTS.md');
if (!agents.includes('docs/PROJECT-AUTHORITY-MAP-ko.md')) fail('AGENTS.md에 권위 지도 진입점이 없음');
if (!agents.includes('previous T-cell specification is retired')) fail('AGENTS.md에 T-cell 퇴역 경계가 없음');

const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], {
  cwd: root,
  encoding: 'utf8',
}).split('\n\n').map((덩이) => {
  const 줄 = 덩이.split('\n');
  const path = (줄.find((l) => l.startsWith('worktree ')) ?? '').slice(9);
  const head = (줄.find((l) => l.startsWith('HEAD ')) ?? '').slice(5);
  return path ? { path, head } : null;
}).filter(Boolean);

// ── **작업 방을 여는 것은 결함이 아니다** (F-101 · 오너 지적 2026-08-12) ─────────────
//
// 옛 판은 뿌리와 `/gpao-t5` 를 뺀 **모든 worktree 를 무조건 실패**시켰다. 그런데 메시지는
// *"인수인계에 없는"* 이라, **인계에 적어 두면 풀린다고 들렸다** — 코드는 인계 문서를 한 줄도
// 안 읽으므로 그런 길은 **없었다.** 자가 자기 기준을 거짓말하고 있었다.
//
// 그리고 오너가 병렬 작업을 **방 분리로** 하라고 정했다(`scripts/lane.mjs` · 장부 F-100).
// 옛 판대로면 **시킨 구조를 쓰는 순간 이 감사가 빨개진다.** 오너: *"방을 나눌수록 점검이 더
// 빨개진다 — 점검표 쪽을 고쳐야 한다."*
//
// **이 자가 원래 지키려던 것은 방 개수가 아니다** — ①「살아 있는데 잊힌 작업」과
// ②「낡은 방을 정본으로 착각」이다(AGENTS.md 병렬 개발 계약). 그래서 그 둘만 잰다:
//   · 작업 방이면 **본선에 안 들어간 커밋이 있을 때만** 실패한다(= 잊힌 작업)
//   · 작업 방이 아닌 자리에 열린 방은 **여전히 실패**한다(그물이 안 넓어진다)
// 바뀌는 것은 **깨끗한 작업 방 하나뿐**이다.
const 작업방인가 = (p) => p.includes('/t5-lanes/') || p.includes('/.claude/worktrees/');
for (const { path, head } of worktrees) {
  if (resolve(path) === resolve(root)) continue;
  if (path.endsWith('/gpao-t5')) {
    const marker = resolve(path, 'AGENTS.md');
    if (!existsSync(marker) || !readFileSync(marker, 'utf8').includes('HISTORICAL GIT ADMIN WORKTREE')) {
      fail(`Git 관리 worktree에 역사 표식이 없음: ${path}`);
    }
    continue;
  }
  if (작업방인가(path)) {
    // 본선(이 감사가 도는 자리의 HEAD)에 안 들어간 커밋만 센다. 0 이면 잊힌 것이 없다.
    let 남은 = 0;
    try {
      남은 = Number(execFileSync('git', ['rev-list', '--count', `HEAD..${head}`], {
        cwd: root, encoding: 'utf8',
      }).trim());
    } catch { 남은 = 0; }   // 못 세면 판정하지 않는다(모름을 결함으로 세우지 않는다)
    if (남은 > 0) {
      fail(`작업 방에 본선에 안 들어간 작업이 있음(커밋 ${남은}개): ${relative(root, path)}`);
    }
    continue;
  }
  fail(`작업 방이 아닌 자리에 worktree가 열려 있음: ${relative(root, path)}`);
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
