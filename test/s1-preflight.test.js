// S1 preflight 계약 검사 — **게이트가 정말 무는지**를 잰다.
//
// 왜 이 파일이 있는가: 첫 판 preflight 는 `off1 vs off2` 를 비교했다. 같은 것을 두 번 부르는
// 것이라 구조적으로 실패할 수 없었고, 판단 헌장에 라우팅 문구를 몰래 넣었는데도 전부
// 초록이었다(실측 2026-08-04). **통과만 하는 게이트는 게이트가 아니다** — 그래서 여기서
// 일부러 깨뜨려 걸리는 것을 확인한다(구조원칙 §2-C 그대로).
import test from 'node:test';
import assert from 'node:assert/strict';

import { preflight, 현실지문, 변경파일, 기준지문, 허용파일, 기준선 } from '../scripts/s1/preflight.mjs';

test('preflight: 현재 상태는 통과한다(기준선과 같다)', async () => {
  const { 결과, 통과 } = await preflight();
  assert.equal(통과, true, 결과.filter((r) => !r.통과).map((r) => `${r.이름}: ${r.근거}`).join(' / '));
});

test('preflight: 기준지문은 동결값이다(스스로 갱신되지 않는다)', async () => {
  // 지문이 코드에서 파생되면 무엇이 바뀌어도 늘 같다고 말한다 — 그건 기준선이 아니다.
  const 지문 = await 현실지문({ sovereign: false });
  assert.equal(지문.프롬프트, 기준지문.프롬프트, '제품 코드가 바뀌었으면 기준지문을 손으로 옮기고 이유를 적는다');
  assert.equal(지문.스키마, 기준지문.스키마);
  assert.equal(지문.도구수, 기준지문.도구수);
});

test('preflight: 판정이 동결 기준지문을 실제로 대조한다(자기 자신이 아니라)', async () => {
  // 첫 판의 병이 정확히 이것이었다 — 자기 자신과 비교하면 늘 통과한다.
  // 그러니 **근거 문자열에 동결값이 실려 있는지**를 본다. 실려 있지 않으면 대조 대상이
  // 코드에서 파생된 것이고, 그건 기준선이 아니다.
  const { 결과 } = await preflight();
  const 프롬프트항 = 결과.find((r) => r.이름.includes('시스템 프롬프트'));
  const 스키마항 = 결과.find((r) => r.이름.includes('도구 스키마'));
  assert.ok(프롬프트항, '프롬프트 대조 항목이 있다');
  assert.ok(프롬프트항.근거.includes(기준지문.프롬프트),
    `근거에 동결 기준값이 없다 — 자기 자신과 비교하는 중일 수 있다: ${프롬프트항.근거}`);
  assert.ok(스키마항.근거.includes(기준지문.스키마), `근거에 동결 스키마 기준값이 없다: ${스키마항.근거}`);

  // 실제 주입 반대검증(판단 헌장에 라우팅 문구 한 줄)은 소스를 건드려야 하므로 검사 밖에서
  // 수행했고 결과를 기록한다: 프롬프트 sha b5152b97 → 13c5adb1 로 바뀌며 이 항목이 **빨개졌다**.
  // 미커밋 오염(authority.js 한 줄)도 "목록 밖"으로 걸렸다.
});

test('preflight: 변경 파일 목록이 작업 트리와 미추적까지 본다', () => {
  // 첫 판은 `git diff base..HEAD` 라 커밋만 봤고, 미커밋 오염이 통째로 안 보였다
  // (실측: authority.js 에 한 줄 넣었는데 "제품 변경 0개"로 통과).
  const 목록 = 변경파일(process.cwd(), 기준선);
  assert.ok(Array.isArray(목록));
  // 이 시험 파일 자신은 test/ 라 무시 목록에 들어간다 — 제품 변경만 남는다.
  assert.ok(목록.every((p) => !p.startsWith('test/')), `검사 파일이 제품 변경으로 샜다: ${목록}`);
  assert.ok(목록.every((p) => !p.endsWith('.md')), '문서가 제품 변경으로 샜다');
});

test('preflight: 허용 파일 목록이 슬라이스 범위와 같다', () => {
  // 목록이 넓어지면 "플래그뿐"이 무너진다. 넓힐 때는 이 시험이 먼저 걸린다.
  assert.deepEqual(허용파일, [
    'src/kernel/turn.js',
    'src/kernel/l1-intent/task-context.js',
    'src/kernel/model-sovereign.js',
  ]);
});
