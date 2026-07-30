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
  const handoff = [
    '# 인수인계', '## 0-A. 상태',
    '- 현재 상태는 `SOME_STATE`이다.',
    '- 계획: `design/T5-TCELL-DEVELOPMENT-PLAN-2026-07-31-ko.md` 지위 DRAFT_X 반영.',
    '## 1. 다음',
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
