import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { auditDocs } from '../scripts/audit-docs.mjs';

const ENTRY = [
  'GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md',
  'docs/PROJECT-AUTHORITY-MAP-ko.md',
  'docs/03-verification/T5-TCELL-PRESTART-BRIEFING-2026-07-30-ko.md',
  'design/T5-TCELL-DEVELOPMENT-PLAN-2026-07-31-ko.md',
];

function scaffold() {
  const repo = mkdtempSync(join(tmpdir(), 't5-docs-audit-'));
  // 깨끗한 상태 = 게이트가 요구하는 모든 구역이 **같은 상태 토큰**을 말하는 문서다.
  // 검사 7(§4·§9·§10 상태 토큰 연동, 12533ac)이 추가될 때 이 fixture 가 함께 갱신되지 않아
  // "깨끗한 상태" 시험이 실패하고 있었다 — 게이트와 그 게이트의 깨끗한 본보기는 같이 움직인다.
  const handoff = [
    '# 인수인계', '## 0-A. 상태',
    '- 현재 상태는 `SOME_STATE`이다.',
    '- 계획: `design/T5-TCELL-DEVELOPMENT-PLAN-2026-07-31-ko.md` 지위 DRAFT_X 반영.',
    '## 1. 다음',
    '## 4. 현재 작업 상태',
    '- 상태 토큰: `SOME_STATE`',
    '## 9. 다음 작업과 종료 조건',
    '상태 토큰: `SOME_STATE`',
    '## 10. 새 세션 시작용 여섯 줄',
    '현재 상태: `SOME_STATE`',
  ].join('\n');
  const plan = ['# 계획', '- 지위: `DRAFT_X`'].join('\n');
  const files = {
    [ENTRY[0]]: handoff,
    [ENTRY[1]]: '# 지도',
    [ENTRY[2]]: '# 브리핑',
    [ENTRY[3]]: plan,
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(repo, dirname(rel)), { recursive: true });
    writeFileSync(join(repo, rel), body);
  }
  return repo;
}

test('정본 투영: 깨끗한 상태는 통과한다', () => {
  const repo = scaffold();
  try {
    assert.deepEqual(auditDocs(repo), []);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('정본 투영: 끊긴 경로 참조를 잡는다', () => {
  const repo = scaffold();
  try {
    writeFileSync(join(repo, ENTRY[1]), '참조: `docs/없는-문서-ko.md`');
    const errors = auditDocs(repo);
    assert.ok(errors.some((e) => e.includes('끊긴 경로')), String(errors));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('정본 투영: 현재 상태 선언 중복을 잡는다', () => {
  const repo = scaffold();
  try {
    const p = join(repo, ENTRY[0]);
    writeFileSync(p, [
      '# 인수인계', '## 0-A. 상태',
      '- 현재 상태는 `A`이다.', '- 현재 상태는 `B`이다.',
      '- 지위 DRAFT_X 반영.', '## 1.',
    ].join('\n'));
    const errors = auditDocs(repo);
    assert.ok(errors.some((e) => e.includes('정확히 1개')), String(errors));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('정본 투영: 계획 지위가 인수인계에 투영되지 않으면 잡는다', () => {
  const repo = scaffold();
  try {
    writeFileSync(join(repo, ENTRY[3]), ['# 계획', '- 지위: `NEW_STATUS_TOKEN`'].join('\n'));
    const errors = auditDocs(repo);
    assert.ok(errors.some((e) => e.includes('투영되지 않았다')), String(errors));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('정본 투영: 퇴역 토큰이 현재 사실로 남으면 잡는다', () => {
  const repo = scaffold();
  try {
    writeFileSync(join(repo, ENTRY[2]), '실행표는 h-turns.json 을 쓴다 (회차당 14턴)');
    const errors = auditDocs(repo);
    assert.ok(errors.some((e) => e.includes('퇴역 토큰')), String(errors));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('정본 투영: 현재 작업 사본 드리프트를 잡는다', () => {
  const repo = scaffold();
  try {
    const p = join(repo, ENTRY[0]);
    writeFileSync(p, [
      '# 인수인계', '## 0-A. 상태',
      '- 현재 상태는 `SOME_STATE`이다.', '- 지위 DRAFT_X 반영.',
      '## 4.', '- 현재 작업: 새 일',
      '## 10.', '현재 작업: 옛날 일',
    ].join('\n'));
    const errors = auditDocs(repo);
    assert.ok(errors.some((e) => e.includes('서로 다르다')), String(errors));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('정본 투영: 상태-단계 연동으로 공유 노후를 잡는다', () => {
  const repo = scaffold();
  try {
    const p = join(repo, ENTRY[0]);
    writeFileSync(p, [
      '# 인수인계', '## 0-A. 상태',
      '- 현재 상태는 `TCELL_PLAN_AUDIT_BLOCKED`이다.', '- 지위 DRAFT_X 반영.',
      '## 4.', '- 현재 작업: 기준선 측정 계량 정립',
      '## 10.', '현재 작업: 기준선 측정 계량 정립',
    ].join('\n'));
    const errors = auditDocs(repo);
    assert.ok(errors.some((e) => e.includes('낡은 투영')), String(errors));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('정본 투영: 여섯 줄 블록이 지난 단계를 현재 사실로 말하면 잡는다', () => {
  const repo = scaffold();
  try {
    writeFileSync(join(repo, ENTRY[0]), [
      '# 인수인계', '## 0-A. 상태',
      '- 현재 상태는 `TCELL_IMPL_S0_SUBMITTED`이다.', '- 지위 DRAFT_X 반영.',
      '## 4.', '- 현재 작업: S0 구현 제출',
      '## 10. 새 세션 시작용 여섯 줄', '```text',
      '현재 작업: S0 구현 제출',
      '현재 차단: F3 replay 결합 · F5 실제 호출 신분.',
      '다음 작업과 종료 조건: 오너 확인 → S0 구현.',
      '```',
    ].join('\n'));
    const errors = auditDocs(repo);
    assert.ok(errors.some((e) => e.includes('지난 단계')), String(errors));
    assert.ok(errors.filter((e) => e.includes('지난 단계')).length >= 2, '차단·다음작업 둘 다 잡는다');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
