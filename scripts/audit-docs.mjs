#!/usr/bin/env node
// 정본 투영 검사 — 사람이 잊는 것을 기계가 잡는다.
//
// 왜: 같은 실수가 반복됐다. 정본의 사실 하나를 고치면 그 사실이 비치는 다른 문장(경로 참조,
// 상태 선언, 계획 지위)이 남았고, 앵커 문자열로 눈감고 편집하다 어긋났다. 이 검사는
// 그 계열을 커밋 전에 기계로 막는다. (T-cell 계획 감사 REPEAT 4번의 구조적 종결)
//
// 검사:
//  1. 경로 투영 — 진입 정본이 참조하는 저장소 경로가 실제로 존재하는가
//  2. 상태 단일성 — 인수인계 §0-A의 "현재 상태는 `…`" 선언이 정확히 하나인가
//  3. 지위 투영 — 계획 문서의 `지위` 토큰이 인수인계 §0-A에 투영돼 있는가
//  4. 퇴역 잔재 — 전역 퇴역 토큰이 허용 구역 밖 활성 문서에 남아 있지 않은가
//  5. 현재 작업 사본 일치 — 인수인계 안의 모든 "현재 작업:" 줄이 같은 내용인가
//     (v2 재감사 RP-1: 사본 드리프트를 잡는다)
//  6. 상태-단계 연동 — §0-A 상태 토큰이 요구하는 단계 문구가 "현재 작업:" 줄에 있는가
//     (RP-1: 사본이 전부 낡은 공유 노후도 잡는다. 상태가 바뀌면 이 표도 함께 바뀐다)
//  7. 여섯 줄 블록 노후 — §10 의 "현재 차단:"·"다음 작업과 종료 조건:" 이 이미 끝난 단계를
//     현재 사실로 말하지 않는가 (S0 감사 REPEAT: 검사 범위보다 문서가 넓었다)
//  8. 진입 문서 노후 — README·AGENTS·권위 지도·H 보드가 이미 끝난 준비 상태를 현재로 말하지 않는가
//  9. 제품 메타 노후 — package.json 이 첫 슬라이스를 현재 제품 이름·버전으로 계속 주장하지 않는가
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.T5_DOCS_AUDIT_ROOT
  ?? join(dirname(fileURLToPath(import.meta.url)), '..');

const ENTRY_DOCS = [
  'GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md',
  'docs/PROJECT-AUTHORITY-MAP-ko.md',
  'docs/03-verification/T5-TCELL-PRESTART-BRIEFING-2026-07-30-ko.md',
  'design/T5-TCELL-DEVELOPMENT-PLAN-2026-07-31-ko.md',
  'README.md',
  'AGENTS.md',
  'docs/03-verification/T5-H-STAGE-BOARD-2026-08-01-ko.md',
];

const STALE_CURRENT_PHRASES = [
  'T-cell implementation plan: **not yet issued**',
  '새 T-cell 계획은 아직 작성 전이다',
  'T-cell hold:',
  'H0_FROZEN · 제품 H 미실행',
];

// 전역 퇴역 토큰: {token, allow: 경로 부분 문자열(역사·감사 기록은 허용)}
const RETIRED_TOKENS = [
  { token: 'h-turns.json', allow: ['docs/archive/', 'evidence/human-baseline/'] },
  { token: '회차당 14턴', allow: ['docs/archive/', 'evidence/human-baseline/'] },
];

const PATH_REF = /(?:docs|design|scripts|src|test)\/[\w가-힣/.\-]+\.(?:json|mjs|md|js|py)(?![\w])/g;

// 상태 토큰 접두 → "현재 작업:" 줄이 반드시 담아야 하는 단계 문구.
// 상태가 다음 단계로 넘어가면 이 표에 행을 추가한다 — 표 갱신 자체가 투영 갱신을 강제한다.
const STATUS_PHASE = [
  { prefix: 'TCELL_PLAN', mustContain: '계획' },
  { prefix: 'TCELL_IMPL', mustContain: '구현' },
  { prefix: 'TCELL_H', mustContain: 'H 단계' },
  { prefix: 'T5_W6', mustContain: '완료' },
];

// 상태 토큰이 지난 단계 — 여섯 줄 블록이 이 문구를 현재 사실로 말하면 낡은 것이다.
// 단계가 넘어갈 때 이 표에 한 줄을 더하는 것이 곧 투영 갱신 강제다.
const STATUS_PAST_PHRASES = [
  { prefix: 'TCELL_IMPL', past: ['오너 확인 → S0', '전체본', 'F3 replay', 'F5 실제 호출 신분', 'F6 웹/채널'] },
  // 구현이 끝났는데 "S5 진행 중"이라 말하면 낡은 것이다.
  { prefix: 'TCELL_H', past: ['S5 구현 완료 · 봉인 감사 제출', 'S5_IN_PROGRESS'] },
  { prefix: 'T5_W6', past: ['AC-1·Automation 준비', 'Agent Core 전까지 착수 금지'] },
];

export function auditDocs(repo = REPO) {
  const errors = [];

  for (const rel of ENTRY_DOCS) {
    const file = join(repo, rel);
    if (!existsSync(file)) {
      errors.push(`${rel}: 진입 정본이 없다`);
      continue;
    }
    const text = readFileSync(file, 'utf8');

    // 1. 경로 투영
    for (const ref of new Set(text.match(PATH_REF) ?? [])) {
      if (!existsSync(join(repo, ref))) {
        errors.push(`${rel}: 끊긴 경로 참조 ${ref}`);
      }
    }

    // 4. 퇴역 잔재 (진입 정본에서만 — 역사 기록은 검사 대상 아님)
    for (const { token, allow } of RETIRED_TOKENS) {
      if (allow.some((a) => rel.includes(a))) continue;
      // "삭제했다/퇴역" 같은 계보 서술 줄은 허용 — 현재 사실 서술만 잡는다
      const lines = text.split('\n').filter((l) => l.includes(token)
        && !/삭제|퇴역|폐기|역사|무효 판정|기록이며/.test(l));
      if (lines.length) errors.push(`${rel}: 퇴역 토큰 '${token}'이 현재 사실로 남아 있다 (${lines.length}줄)`);
    }

    // 8. 이미 끝난 준비 상태를 현재 진입 문서가 다시 지시하지 않는가.
    for (const phrase of STALE_CURRENT_PHRASES) {
      if (text.includes(phrase)) errors.push(`${rel}: 끝난 준비 상태 '${phrase}'를 현재 사실로 말한다`);
    }
  }

  // 2. 상태 단일성 + 3. 지위 투영
  const handoffPath = join(repo, ENTRY_DOCS[0]);
  if (existsSync(handoffPath)) {
    const handoff = readFileSync(handoffPath, 'utf8');
    const zeroA = handoff.split(/^## 0-A[^\n]*$/m)[1]?.split(/^## /m)[0] ?? '';
    const statusDecls = [...zeroA.matchAll(/현재 상태는\s*`([^`]+)`/g)];
    if (statusDecls.length !== 1) {
      errors.push(`인수인계 §0-A: '현재 상태는' 선언이 ${statusDecls.length}개 (정확히 1개여야 한다)`);
    }
    const planPath = join(repo, ENTRY_DOCS[3]);
    if (existsSync(planPath)) {
      const plan = readFileSync(planPath, 'utf8');
      const st = plan.match(/^- 지위:\s*`([^`]+)`/m);
      if (st && !handoff.includes(st[1])) {
        errors.push(`계획 지위 '${st[1]}'가 인수인계에 투영되지 않았다`);
      }
    }

    // 5. 현재 작업 사본 일치 (§4·§10 등 어디에 있든 전부 같아야 한다)
    const workLines = [...handoff.matchAll(/^[-\s]*현재 작업:\s*(.+)$/gm)]
      .map((m) => m[1].trim().replace(/[.。]$/, ''));
    if (new Set(workLines).size > 1) {
      errors.push(`인수인계: '현재 작업:' 사본 ${workLines.length}개가 서로 다르다 — ${JSON.stringify([...new Set(workLines)])}`);
    }

    // 6. 상태-단계 연동 (사본이 전부 낡은 경우를 잡는다)
    const status = statusDecls[0]?.[1] ?? '';

    // 7. 상태 토큰이 **본문 구역에도** 서 있는가.
    //
    // 왜 생겼나: 2026-08-01 교대 준비에서 §0-A 는 H 단계를 말하는데 §9 는 "v3 감사 고정 종료
    // 4건 → S1 제품 구현 시작"을, §10 은 `S4_PASS / S5_IN_PROGRESS` 를 말하고 있었다.
    // **이 검사는 그걸 통과시켰다.** §0-A 한 곳만 봤기 때문이다 — 상태를 한 자리에서만 재면
    // 나머지 구역은 얼마든지 낡을 수 있고, 새 세션은 그 낡은 구역을 읽고 지난 일을 다시 한다.
    // 상태가 바뀌면 §4·§9·§10 이 **같은 토큰을 말해야** 한다.
    const 구역 = [['4', '현재 작업 상태'], ['9', '다음 작업과 종료 조건'], ['10', '새 세션 시작용']];
    for (const [번호, 이름] of 구역) {
      const 시작 = handoff.indexOf(`## ${번호}. `);
      if (시작 < 0) { errors.push(`인수인계: §${번호}(${이름}) 구역이 없다`); continue; }
      const 다음 = handoff.indexOf('\n## ', 시작 + 1);
      const 본문 = handoff.slice(시작, 다음 < 0 ? undefined : 다음);
      if (!본문.includes(status)) {
        errors.push(`인수인계 §${번호}(${이름}): 상태 '${status}' 를 말하지 않는다 — 낡은 구역`);
      }
    }

    const phase = STATUS_PHASE.find((p) => status.startsWith(p.prefix));
    if (phase && workLines.length && !workLines.every((l) => l.includes(phase.mustContain))) {
      errors.push(`인수인계: 상태 '${status}'인데 '현재 작업:' 줄에 '${phase.mustContain}'이 없다 — 낡은 투영`);
    }

    // 7. 여섯 줄 블록(§10)의 현재 차단·다음 작업이 지난 단계를 말하는가
    const sixLines = handoff.split(/^## 10\./m)[1] ?? '';
    const claims = [...sixLines.matchAll(/^(?:현재 차단|다음 작업과 종료 조건):\s*(.+)$/gm)].map((m) => m[1]);
    const pastSpec = STATUS_PAST_PHRASES.find((p) => status.startsWith(p.prefix));
    if (pastSpec) {
      for (const claim of claims) {
        const hit = pastSpec.past.find((phrase) => claim.includes(phrase));
        if (hit) errors.push(`인수인계 §10: 상태 '${status}'인데 지난 단계 '${hit}'를 현재 사실로 말한다`);
      }
    }
  }

  // 9. package 메타는 사용자에게 실제로 도달하는 산출물의 이름이다. README만 고쳐서는 부족하다.
  const packagePath = join(repo, 'package.json');
  if (!existsSync(packagePath)) {
    errors.push('package.json: 제품 메타가 없다');
  } else {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
      if (String(pkg.version ?? '').includes('slice1')) errors.push('package.json: version이 첫 슬라이스에 머물러 있다');
      if (/First Build Slice/i.test(String(pkg.description ?? ''))) errors.push('package.json: description이 첫 슬라이스를 현재 제품으로 말한다');
    } catch {
      errors.push('package.json: JSON을 읽을 수 없다');
    }
  }

  return errors;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const errors = auditDocs();
  if (errors.length) {
    for (const e of errors) console.error(`FAIL · ${e}`);
    process.exit(1);
  }
  console.log(`DOCS PROJECTION: PASS (${ENTRY_DOCS.length} entry docs)`);
}
