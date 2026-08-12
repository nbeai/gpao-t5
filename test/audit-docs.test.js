import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { auditDocs, ENTRY_DOCS } from '../scripts/audit-docs.mjs';

// 진입 정본 목록은 스크립트가 단일 진실이다. 여기 복사해 두면 목록이 늘 때 fixture 만 낡아
// "깨끗한 상태" 시험이 거짓으로 빨개진다 — 2026-08-04 비전 문서 승격에서 실측된 드리프트다.
// 색인이 아니라 **경로로** 집는다. 순서가 바뀌어도 역할이 안 밀리게.
const ENTRY = ENTRY_DOCS;
const 자리 = (파편) => {
  const hit = ENTRY.find((p) => p.includes(파편));
  if (!hit) throw new Error(`진입 정본에 '${파편}' 이 없다 — 시험 갱신 필요`);
  return hit;
};

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
  // 하나뿐인 계획서의 **깨끗한 본보기**: 맵이 가리킨 노드가 다 있고, 노드마다 파일·근거가 있다.
  // 저장소 경로는 일부러 안 쓴다 — 여기서 재는 것은 도달성이지 경로 투영(검사 1)이 아니다.
  const 계획서 = [
    '# T5 계획', '## 맵', '- ① 무언가 → 노드 ①', '- A 다른것 → 노드 A',
    '## 노드 ① — 무언가', '| 파일 | 어딘가 |', '| 근거 | 무엇 |',
    '## 노드 A — 다른것', '파일: 어딘가 · 근거: 무엇',
  ].join('\n');
  const files = {
    [자리('T5-PLAN')]: 계획서,
    [자리('HANDOFF')]: handoff,
    [자리('VISION-AND-PERFORMANCE')]: '# 비전\n오너 철학 원문',
    [자리('AUTHORITY-MAP')]: '# 지도',
    [자리('PRESTART-BRIEFING')]: '# 브리핑',
    [자리('TCELL-DEVELOPMENT-PLAN')]: plan,
    [자리('README')]: '# README\n현재 제품 본문',
    [자리('AGENTS')]: '# AGENTS\n현재 작업 규칙',
    [자리('H-STAGE-BOARD')]: '# H 진행표\n- 상태: `TCELL_H_REMEDIATION`',
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(repo, dirname(rel)), { recursive: true });
    writeFileSync(join(repo, rel), body);
  }
  writeFileSync(join(repo, 'package.json'), JSON.stringify({
    name: 'gpao-t5', version: '0.1.0-development', description: 'GPAO-T5 local development build',
  }));
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
    writeFileSync(join(repo, 자리('AUTHORITY-MAP')), '참조: `docs/없는-문서-ko.md`');
    const errors = auditDocs(repo);
    assert.ok(errors.some((e) => e.includes('끊긴 경로')), String(errors));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('정본 투영: 현재 상태 선언 중복을 잡는다', () => {
  const repo = scaffold();
  try {
    const p = join(repo, 자리('HANDOFF'));
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
    writeFileSync(join(repo, 자리('TCELL-DEVELOPMENT-PLAN')), ['# 계획', '- 지위: `NEW_STATUS_TOKEN`'].join('\n'));
    const errors = auditDocs(repo);
    assert.ok(errors.some((e) => e.includes('투영되지 않았다')), String(errors));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('정본 투영: 퇴역 토큰이 현재 사실로 남으면 잡는다', () => {
  const repo = scaffold();
  try {
    writeFileSync(join(repo, 자리('PRESTART-BRIEFING')), '실행표는 h-turns.json 을 쓴다 (회차당 14턴)');
    const errors = auditDocs(repo);
    assert.ok(errors.some((e) => e.includes('퇴역 토큰')), String(errors));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('정본 투영: 현재 작업 사본 드리프트를 잡는다', () => {
  const repo = scaffold();
  try {
    const p = join(repo, 자리('HANDOFF'));
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
    const p = join(repo, 자리('HANDOFF'));
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
    writeFileSync(join(repo, 자리('HANDOFF')), [
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

test('정본 투영: README·AGENTS·H 보드의 끝난 준비 상태를 잡는다', () => {
  const repo = scaffold();
  try {
    writeFileSync(join(repo, 'README.md'), 'T-cell implementation plan: **not yet issued**');
    writeFileSync(join(repo, 'AGENTS.md'), 'T-cell hold:');
    writeFileSync(join(repo, 자리('H-STAGE-BOARD')), '- 상태: `H0_FROZEN · 제품 H 미실행`');
    const errors = auditDocs(repo);
    assert.ok(errors.filter((e) => e.includes('끝난 준비 상태')).length >= 3, String(errors));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

// 검사 10 — 계획서 도달성. 오너 규칙 2·3(2026-08-06): 맵으로 찾아갈 수 있어야 하고,
// 거기서 연관 내용으로 단절 없이 이어져야 한다. 둘 다 맵만 읽으면 멀쩡해 보인다.

test('계획서 도달성: 맵이 없는 노드를 가리키면 잡는다', () => {
  const repo = scaffold();
  try {
    writeFileSync(join(repo, 자리('T5-PLAN')), [
      '# T5 계획', '## 맵', '- Z 어디로 → 노드 Z',
      '## 노드 ① — 무언가', '| 파일 | 어딘가 |', '| 근거 | 무엇 |',
    ].join('\n'));
    const errors = auditDocs(repo);
    assert.ok(errors.some((e) => e.includes("'노드 Z' 절이 없다")), String(errors));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('계획서 도달성: 노드에 파일·근거가 없으면 잡는다', () => {
  const repo = scaffold();
  try {
    writeFileSync(join(repo, 자리('T5-PLAN')), [
      '# T5 계획', '## 맵', '- ① 무언가 → 노드 ①',
      '## 노드 ① — 무언가', '설명만 있고 어디로 가는지가 없다',
    ].join('\n'));
    const errors = auditDocs(repo);
    assert.ok(errors.some((e) => e.includes('파일 칸이 없다')), String(errors));
    assert.ok(errors.some((e) => e.includes('근거 칸이 없다')), String(errors));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('계획서 도달성: 계획서가 사라지면 잡는다', () => {
  const repo = scaffold();
  try {
    rmSync(join(repo, 자리('T5-PLAN')));
    const errors = auditDocs(repo);
    assert.ok(errors.some((e) => e.includes('하나뿐인 계획서가 없다')), String(errors));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('정본 투영: package 메타가 첫 슬라이스에 머물면 잡는다', () => {
  const repo = scaffold();
  try {
    writeFileSync(join(repo, 'package.json'), JSON.stringify({
      version: '0.0.0-slice1', description: 'GPAO-T5 First Build Slice',
    }));
    const errors = auditDocs(repo);
    assert.ok(errors.some((e) => e.includes('version이 첫 슬라이스')), String(errors));
    assert.ok(errors.some((e) => e.includes('description이 첫 슬라이스')), String(errors));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
