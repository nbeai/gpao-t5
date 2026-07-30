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
];

// 상태 토큰이 지난 단계 — 여섯 줄 블록이 이 문구를 현재 사실로 말하면 낡은 것이다.
// 단계가 넘어갈 때 이 표에 한 줄을 더하는 것이 곧 투영 갱신 강제다.
const STATUS_PAST_PHRASES = [
  { prefix: 'TCELL_IMPL', past: ['오너 확인 → S0', '전체본', 'F3 replay', 'F5 실제 호출 신분', 'F6 웹/채널'] },
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
