// **S7 착수 조건 ① — 거른 것을 기록한다.**
//
// 오너 지시(2026-08-05):
//   *"안 보이는 이유가 정확하다 — **안 준 손은 흔적이 없다.**
//     지금: 손 22개 중 6개를 주고, 16개는 안 준 사실이 어디에도 안 남는다.
//     필요: 이 턴에 무엇을 줬고 무엇을 왜 걸렀는지가 남는다.
//     S0 가 S1 을 살린 것과 같은 자리다. 계측 없이 S7 을 하면 나중에 원인 없이 뒤지게 된다."*
//
// S7 이 남은 칸 중 가장 위험한 이유는 **틀려도 안 보이기 때문**이다.
// S6 은 틀리면 216칸 표가 잡았다. S7 은 "모델이 요즘 좀 이상한데"로만 나타난다.
//
// 그래서 이 그물이 재는 것은 계측기의 **정직함**이다:
//   "기록이 있다"(모양) ❌
//   → **"준 것이 모델이 실제로 받은 그 목록이다 · 안 준 손이 하나도 안 빠진다 ·
//      이유를 지어내지 않는다"**(계약) ⭕
//
// **계측기가 거짓말하면 없느니만 못하다** — 원인 없이 뒤지는 것보다, 틀린 원인을 믿는 게 나쁘다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 손제시, 손제시기록 } from '../src/kernel/l2-plan/tool-offer.js';
import { toolSchemasFor } from '../src/kernel/l2-plan/tool-schema.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const 실제상태 = () => buildSelfState(demoEnv());

test('① **준 것은 모델이 실제로 받는 그 목록이다** — 계측기가 따로 세지 않는다', () => {
  const selfState = 실제상태();
  const 실제 = toolSchemasFor(selfState).map((t) => t.name);
  assert.deepEqual(손제시(selfState).준것, 실제,
    '**계측기가 실제와 다른 것을 재고 있다.**\n'
    + `  모델이 받는 것: ${JSON.stringify(실제)}\n`
    + `  계측기가 적은 것: ${JSON.stringify(손제시(selfState).준것)}\n`
    + '기준이 두 벌이면 계측 기록은 원인이 아니라 또 하나의 거짓이 된다.');
});

test('② **안 준 손이 하나도 안 빠진다** — 준 것 + 거른 것 = 선언된 전부', () => {
  const selfState = 실제상태();
  const { 준것, 거른것, 전부 } = 손제시(selfState);
  assert.equal(준것.length + 거른것.length, 전부,
    `**손 하나가 기록에서 사라졌다**(전부 ${전부} · 준 것 ${준것.length} · 거른 것 ${거른것.length}).\n`
    + '이 그물의 본체다 — 안 준 사실이 흔적 없이 사라지는 것이 S7 을 눈 감고 하게 만든다.');
  const 이름들 = new Set([...준것, ...거른것.map((x) => x.id)]);
  for (const t of selfState.connectedTools ?? []) {
    assert.ok(이름들.has(t.id), `선언된 손 ${t.id} 이 기록 어느 쪽에도 없다`);
  }
});

test('③ **거른 손에는 왜 걸렀는지가 붙는다** — 이름만 남기면 다음 사람이 또 판다', () => {
  const selfState = {
    connectedTools: [
      { id: '준손', executable: true, schema: { description: 'x', parameters: {} } },
      { id: '연결안됨', executable: false, reason: 'needs_connection' },
      { id: '아직없음', executable: false, reason: 'planned' },
    ],
  };
  const { 거른것 } = 손제시(selfState);
  assert.deepEqual(거른것, [
    { id: '연결안됨', 이유: 'needs_connection' },
    { id: '아직없음', 이유: 'planned' },
  ], `거른 이유가 손 선언과 다르게 적혔다: ${JSON.stringify(거른것)}`);
});

test('④ **이유를 모르면 모른다고 적는다** — 그럴듯한 것을 지어내지 않는다', () => {
  const { 거른것 } = 손제시({ connectedTools: [{ id: '이유없는손', executable: false }] });
  assert.deepEqual(거른것, [{ id: '이유없는손', 이유: 'unknown' }],
    '**커널이 확신을 지어냈다.** 손이 왜 못 쓰는지 안 밝혔으면 모르는 것이다 —\n'
    + "그럴듯한 이유를 채우면 다음 사람이 그것을 근거로 엉뚱한 곳을 판다(S3 에서 같은 병을 밟았다).");
});

test('⑤ **스키마 없는 손은 준 것이 아니다** — 실행되는데 부를 방법이 없다', () => {
  const { 준것, 거른것 } = 손제시({
    connectedTools: [{ id: '스키마없음', executable: true }],
  });
  assert.deepEqual(준것, [], '모델이 부를 방법이 없는 손을 줬다고 적었다');
  assert.deepEqual(거른것, [{ id: '스키마없음', 이유: 'no_schema' }],
    '실행은 되는데 스키마가 없어 못 준 사실이 안 남았다 — 이건 **손의 선언 결함**이고 드러나야 한다');
});

test('⑥ **이유별 개수가 기록에 있다** — S7 이 움직일 숫자가 여기다', () => {
  const 기록 = 손제시기록(실제상태(), ['memory.propose']);
  assert.equal(기록.준수 + 기록.거른수, 기록.전부, '요약 숫자가 서로 안 맞는다');
  assert.ok(기록.준수 > 0, '이 판에서 준 손이 하나도 없다 — 그러면 이 검사가 아무것도 못 가른다');
  const 이유합 = Object.values(기록.이유별).reduce((a, b) => a + b, 0);
  assert.equal(이유합, 기록.거른수,
    `이유별 합(${이유합})과 거른 수(${기록.거른수})가 다르다 — 이유 없이 사라진 손이 있다`);
  assert.deepEqual(기록.통제채널, ['memory.propose'], '함께 준 통제 채널이 기록에 안 남았다');
});

// ── ⑦ **꺼져 있으면 아무 일도 안 한다** ────────────────────────────────────
//
// 계측은 본선을 세우지 않는다. S0 과 같은 계약이다 — 덤프 자리가 없으면 즉시 반환한다.
test('⑦ **덤프가 꺼져 있으면 파일을 안 만든다**(계측이 제품을 느리게 하지 않는다)', async () => {
  const { dump손제시 } = await import('../src/runtime/prompt-dump.js');
  assert.equal(await dump손제시(손제시기록(실제상태()), {}), null,
    '덤프 자리가 없는데 무언가를 썼다 — 계측이 사용자 설치에 파일을 남기면 안 된다');
});

test('⑧ **켜면 준 것과 거른 것이 그대로 남는다**', async () => {
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 't5-offer-'));
  const { dump손제시 } = await import('../src/runtime/prompt-dump.js');
  const 기록 = 손제시기록(실제상태());
  const 파일 = await dump손제시(기록, { GPAO_T5_PROMPT_DUMP: dir });
  assert.ok(파일, '켰는데 아무것도 안 썼다');
  const 남은것 = JSON.parse(await readFile(파일, 'utf8'));
  assert.equal(남은것.kind, 'tool_offer');
  assert.deepEqual(남은것.준것, 기록.준것, '준 손이 기록과 다르게 남았다');
  assert.deepEqual(남은것.거른것, 기록.거른것, '거른 손이 기록과 다르게 남았다');
  assert.ok(남은것.거른것.length > 0,
    '이 판에서 거른 손이 하나도 없다 — 그러면 이 검사가 계측기의 본체를 안 밟는다');
});
