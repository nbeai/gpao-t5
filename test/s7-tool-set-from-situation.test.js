// **S7 — 이번 런의 도구는 상황에서 나온다. 발화에서 나오지 않는다.**
//
// 오너가 못 박은 착수 조건 ②(2026-08-05):
//   *"자격과 의도의 경계가 실제로는 흐릿하다. 검사가 물 수 있는 형태로 좁혀라 —
//     **계산 함수의 인자에 `input.text` · `intent` · `currentRequest` 가 들어가면 실패.**
//     grep 으로 잰다. 지금 형태는 사람이 판단해야 해서 애매할 때 통과한다."*
//
// ── 밟아 보니 상당 부분이 이미 서 있었다 ──────────────────────────────────
// 계산 경로 네 파일에 발화가 **하나도** 안 들어간다. 같은 환경이면 같은 목록이고,
// 늘어날 때는 뒤에 붙는다. **그래서 S7 의 일은 새 계산을 만드는 것이 아니라
// 그 사실을 계약으로 못 박는 것**이다 — 안 박아 두면 다음 변경에서 조용히 무너진다.
// (실제로 이 흐름에서 F-18 이 그 자리였다: 기억 공급은 발화 낱말로 걸러지고 있었다.)
//
// §10 규율 12 — 개수가 아니라 **계약**:
//   "발화를 안 쓴다"(주장) ❌
//   → **"계산 경로에 발화 인자가 0 · 같은 상황이면 같은 집합 · 늘면 뒤에 붙는다 ·
//      상황이 다르면 다르게 · 안 준 손은 받지 않는다"**(계약) ⭕
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { toolSchemasFor, callsToIntentParts } from '../src/kernel/l2-plan/tool-schema.js';
import { modelSchemasFor } from '../src/kernel/l2-plan/model-control.js';
import { 손제시 } from '../src/kernel/l2-plan/tool-offer.js';
import { demoEnv } from '../src/surface/demo-context.js';

// **주의 — 이 그물이 재는 것은 "손 목록" 뿐이다**(오너 지적 2026-08-05).
// 착수 조건 ②가 겨눈 자리는 이 넷이 아니라 `task-context.js` · `context-mesh.js` 이기도 하다 —
// **F-18 의 병은 도구가 아니라 사실 공급**이다(limits 와 기억이 걸러진다).
// 그 자리는 `s7-facts-not-classified.test.js` 가 잰다. 여기만 보고 "발화가 안 들어간다"고
// 읽으면 안 된다 — 내가 그렇게 읽고 ③을 통과시켰다.

/** 손 집합을 계산하는 **모든** 자리. 여기 밖에서 목록이 만들어지면 그건 두 벌이다. */
const 계산경로 = [
  'src/kernel/l2-plan/tool-schema.js',
  'src/kernel/l2-plan/model-control.js',
  'src/kernel/l0-evidence/self-state.js',
  'src/kernel/l2-plan/tool-offer.js',
];

const 이름들 = (env) => toolSchemasFor(buildSelfState(env)).map((t) => t.name);
const 지문 = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 12);

test('① **계산에 사용자 발화가 안 들어간다** — 자격이지 의도가 아니다(착수 조건 ②)', async () => {
  const 걸린것 = [];
  for (const 파일 of 계산경로) {
    const 글 = await readFile(파일, 'utf8');
    글.split('\n').forEach((줄, i) => {
      const 코드 = 줄.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');   // 주석은 뺀다
      if (/\binput\.text\b|\bcurrentRequest\b|\brequestText\b|\bintent\b/.test(코드)) {
        걸린것.push(`${파일}:${i + 1}  ${줄.trim().slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(걸린것, [],
    '**손 집합 계산에 사용자 발화가 들어갔다 — 그건 자격이 아니라 의도다(심문의 부활).**\n'
    + `  ${걸린것.join('\n  ')}\n\n`
    + '입력이 자격이면(누구의 세션인가 · 무엇이 연결됐는가) 환경이고,\n'
    + '입력이 의도면(이 사람이 무슨 일을 하려는가) 분류기가 능력을 정하는 것이다.\n'
    + '같은 병을 기억에서 이미 밟았다(F-18: 낱말 겹침이 사실 공급을 정했다).');
});

test('② **같은 상황이면 같은 집합** — 대화 안에서 안 흔들린다(불변식 A)', () => {
  const env = demoEnv();
  const 셋 = [이름들(env), 이름들(env), 이름들(env)].map(지문);
  assert.equal(new Set(셋).size, 1,
    `**같은 환경인데 목록이 흔들렸다**: ${JSON.stringify(셋)}\n`
    + '턴마다 손이 바뀌면 모델은 자기가 무엇을 쓸 수 있는지 매번 다시 배우고,\n'
    + '프롬프트 접두가 죽어 캐시도 함께 깨진다.');
});

test('③ **능력이 늘면 뒤에 붙는다** — 접두가 산다(불변식 A 의 예외는 append-only)', () => {
  const 적게 = demoEnv({ include: ['local.file', 'web.collect'], hands: ['local.file', 'web.collect'] });
  const 많게 = demoEnv({
    include: ['local.file', 'web.collect', 'session.search'],
    hands: ['local.file', 'web.collect', 'session.search'],
  });
  const a = 이름들(적게); const b = 이름들(많게);
  assert.ok(b.length > a.length, `손이 안 늘었다 — 이 검사가 성립하려면 늘어야 한다(${a.length}→${b.length})`);
  assert.deepEqual(b.slice(0, a.length), a,
    `**늘어난 손이 앞을 밀어냈다** — 중간 삽입·재정렬은 그 순간 프롬프트 접두를 죽인다.\n`
    + `  전: ${JSON.stringify(a)}\n  후: ${JSON.stringify(b)}`);
});

test('④ **상황이 다르면 다른 집합** — 연결이 없으면 안 준다', () => {
  const 많게 = 이름들(demoEnv());
  const 적게 = 이름들(demoEnv({ include: ['local.file'], hands: ['local.file'] }));
  assert.notDeepEqual(적게, 많게, '상황이 달라도 같은 목록이 나왔다 — 계산이 상황을 안 본다');
  assert.ok(적게.length < 많게.length, `좁은 상황인데 손이 안 줄었다(${적게.length} vs ${많게.length})`);
});

test('⑤ **안 준 손은 모델이 불러도 안 받는다** — 제시가 곧 능력 선언이다', () => {
  const selfState = buildSelfState(demoEnv({ include: ['local.file'], hands: ['local.file'] }));
  const 받은것 = callsToIntentParts([
    { name: 'local.file', args: { action: 'list' } },
    { name: 'telegram.send', args: { target: '111', text: 'x' } },   // 안 준 손
  ], selfState);
  assert.deepEqual(받은것.neededTools, ['local.file'],
    `**안 준 손을 실행 후보로 받았다**: ${JSON.stringify(받은것.neededTools)}\n`
    + '제시가 곧 능력 선언이다(원리 ③) — 안 보여준 것을 받으면 그 선언이 거짓이 된다.');
});

test('⑥ **계측기가 그 계산과 같은 것을 잰다** — 거짓말하는 계측기는 없느니만 못하다', () => {
  const env = demoEnv();
  const selfState = buildSelfState(env);
  assert.deepEqual(손제시(selfState).준것, toolSchemasFor(selfState).map((t) => t.name),
    '계측기가 실제 제시 목록과 다른 것을 적고 있다 — S7 이 틀려도 안 보이는 칸이라 이게 유일한 눈이다');

  // **두 기준이 갈리는 판에서 잰다.** 평범한 설치에서는 `executable` 과 `executable && schema` 가
  // 같은 답을 내서, 계측기가 자기 기준으로 세도 안 걸린다 — 돌연변이가 그렇게 빠져나갔다
  // (2026-08-05). 실행은 되는데 **부를 방법을 안 밝힌 손**이 그 둘을 가른다.
  const 갈리는판 = { connectedTools: [
    { id: '준손', executable: true, schema: { description: 'x', parameters: {} } },
    { id: '스키마없음', executable: true },
  ] };
  assert.deepEqual(손제시(갈리는판).준것, ['준손'],
    '**계측기가 모델이 받는 목록과 다른 것을 적었다.** 부를 방법이 없는 손을 "줬다"고 세면\n'
    + '나중에 "왜 안 골랐지"를 엉뚱한 곳에서 찾게 된다 — 틀린 원인을 믿는 게 원인 없는 것보다 나쁘다.');
  assert.deepEqual(손제시(갈리는판).거른것, [{ id: '스키마없음', 이유: 'no_schema' }],
    '거른 이유가 안 남았다');
});

// ── **⑦ 이 좁혀졌다**(라이브 실측 2026-08-10 · P-OP 원인 ①) ────────────────────────
//
// 원래 계약은 *"통제 채널은 손이 있을 때만 얹힌다"* 였고, 그 커밋의 말대로 **이미 서 있던
// 사실을 못 박은 것**이지 지켜야 할 해악이 적혀 있지는 않았다. 실측이 해악을 찾았다:
// S1(고객 문의 운영안)은 손이 필요 없는 대화 작업이라 `connectedTools` 가 비고, 그 순간
// `work.state` 까지 사라져 **12턴 · 2회차 내내 WorkEvent 0** 이었다 — 확정·수정·철회가
// 원장에 하나도 안 남는다. 계약이 지키려던 것은 **못 지킬 약속**(손도 없이 "다음부터
// 그렇게 할게요")이고 그건 실행 제안 채널 셋의 성질이다. 그 셋으로 정의역을 좁힌다.
test('⑦ **실행 제안 채널만 손에 매인다** — 상태·기억은 손이 없어도 선다', () => {
  const 있음 = buildSelfState(demoEnv());
  const 없음 = { connectedTools: [] };
  assert.ok(modelSchemasFor(있음, ['memory.propose']).length > toolSchemasFor(있음).length,
    '손이 있는데 통제 채널이 안 얹혔다');
  for (const 실행제안 of ['skill.propose', 'automation.propose', 'agent.propose']) {
    assert.deepEqual(modelSchemasFor(없음, [실행제안]).map((s) => s.name).filter((n) => n === 실행제안), [],
      `손이 하나도 없는데 실행 제안 채널이 실렸다(${실행제안}) — 못 지킬 약속의 자리다`);
  }
  const 손없는상태채널 = modelSchemasFor(없음, ['work.state']).map((s) => s.name);
  assert.ok(손없는상태채널.includes('work.state'),
    '손이 없다고 상태 채널까지 지웠다 — 대화만으로 하는 작업에서 원장이 시작될 수 없다(실측: WorkEvent 0)');
  assert.ok(손없는상태채널.includes('memory.propose'),
    '손이 없다고 기억 채널까지 지웠다 — 기억은 실행이 아니다');
});
