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
  // **이 검사는 통과하면서 깨져 있었다**(2026-08-05). git 은 비ASCII 경로를 따옴표로 감싸
  // 8진 이스케이프해서 준다(`"docs/…/\354\203\210-….md"`). 그러면 위 두 줄이 전부 빗나간다 —
  // `.md` 로 끝나지 않고 `test/` 로 시작하지도 않기 때문이다. 한글 이름이 대부분인 저장소에서
  // 무시 필터가 통째로 새고 있었고, 검사는 초록이었다. **재는 자리를 검증하지 않으면 그렇게 된다.**
  assert.ok(목록.every((p) => !p.startsWith('"')),
    `git 이 따옴표로 감싼 경로가 그대로 왔다 — 무시 필터가 전부 빗나간다: ${목록.filter((p) => p.startsWith('"'))}`);
  assert.ok(목록.every((p) => !/\\\d{3}/.test(p)),
    `8진 이스케이프된 경로가 그대로 왔다(한글 이름이 원문으로 안 온다): ${목록.filter((p) => /\\\d{3}/.test(p))}`);
});

test('preflight: 허용 파일 목록이 슬라이스 범위와 같다', () => {
  // 목록이 넓어지면 "플래그뿐"이 무너진다. 넓힐 때는 이 시험이 먼저 걸린다.
  // 넓힐 때는 이 시험이 먼저 걸린다 — 그게 이 시험의 일이다. 넓힌 이유는 `preflight.mjs`
  // 의 `허용파일` 주석에 적혀 있어야 한다(2026-08-04: 실행 벽 수정으로 기준선 이동).
  assert.deepEqual(허용파일, [
    'src/kernel/turn.js',
    'src/kernel/l1-intent/task-context.js',
    'src/kernel/l2-plan/action-plan.js',
    // 통제 채널 설명에 **되는 것**을 더했다(2026-08-04). 라이브 2회에서 모델이 자동화 채널을
    // 쥐고도 "예약 기능이 없다"며 사용자에게 cron 을 짜 줬다 — 설명이 안 되는 것만 말했다.
    'src/kernel/l2-plan/model-control.js',
    'src/kernel/model-sovereign.js',
    // §S2 본 전환 — 심문 ① 을 걷고 그 자리를 승인 경계로 대체했다(2026-08-04).
    'src/kernel/l2-plan/carryover.js',
    'src/kernel/turn-budget.js',
    'src/runtime/local-file.js',
    'src/runtime/model-provider.js',
    'src/runtime/tool-runner.js',
    'src/surface/demo-context.js',
    'src/runtime/chatgpt-model-client.js',
    'src/runtime/local-file.js',
    'src/runtime/local-locate.js',
    'src/runtime/session-search-tool.js',
    'src/kernel/l0-evidence/ledger.js',
    // **제안과 실행을 나눈다**(2026-08-04). 계약은 "호출 안 했으면 actualCall 은 null" 인데
    // 다중 호출 줄 세우기가 미실행 호출에도 채우고 있었다 — 원장이 "안 부른 것"을 "부른 것"으로
    // 말했다. `제안한호출` 칸을 세워 모델은 자기 호출을 그대로 돌려받고 원장은 정직해진다.
    'src/kernel/contracts.js',
    'src/kernel/l0-evidence/tool-receipt.js',
    // F-8 · answer_reset — 되돌린 답이 앞의 답에 이어붙지 않게(2026-08-04).
    'src/kernel/l0-evidence/turn-event.js',
    'src/kernel/turn-surface.js',
    // 표면 사실에 받는 쪽을 더했다(2026-08-04).
    'src/kernel/l0-evidence/response-surface.js',
    'src/surface/server.js',
    'src/runtime/capsule.js',
    'src/runtime/sandbox.js',
    'src/runtime/terminal-run.js',
    'src/surface/demo-context.js',
    'src/surface/live-context.js',
    'src/runtime/tool-runner.js',
    'src/surface/web/index.html',
    'src/kernel/l2-plan/exit-verification.js',
    'src/runtime/model-provider.js',
    // S0 계측(2026-08-05) — 조립된 프롬프트를 보는 모듈. 기본 꺼짐이라 제품 동작을 안 바꾼다.
    'src/runtime/prompt-dump.js',
    // F-15(2026-08-05) — 거짓 성공 게이트를 문구가 아니라 뒷받침 없는 구체 사실로 판정한다.
    'src/kernel/l2-plan/recovery-ladder.js',
    // S4 집(2026-08-05) — 사용자가 열어 고치는 지침·자기소개. 매 세션 실리고 예산이 있다.
    'src/surface/agent-home.js',
    // S5a 기억이 집에 산다(2026-08-05) — 줄을 지우면 T5 가 잊는다. 원장은 그대로.
    'src/surface/memory-home.js',
    // S6-a 실행 경계(2026-08-05) — 두 벌 판정을 한 벌로 만드는 첫 자리. 행동 변화 0.
    'src/kernel/l2-plan/tool-boundary.js',
    // **S7 착수 조건 ① — 손 제시 계측**(오너 지시 2026-08-05).
    // *"안 준 손은 흔적이 없다."* S7 은 손 집합 자체를 바꾸는 칸이라 틀려도 화면에 안 나타난다.
    // S6 은 216칸 표가 잡았지만 여기는 잡을 표가 없어, 거른 사실을 기록으로 만드는 것이
    // 착수 전 조건이다. 판정하지 않고 이미 난 결정을 볼 수 있게만 한다.
    'src/kernel/l2-plan/tool-offer.js',
  ]);
});
