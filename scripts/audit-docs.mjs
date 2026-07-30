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
