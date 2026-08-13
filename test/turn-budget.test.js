// **예산과 가드레일** — 상한 6을 걷기 전에 서야 하는 것들.
//
// 정본 §S3: *"가드레일 먼저, 6상한 제거는 마지막. 예산(비용·시간·반복)이 서고 그 사실이
// 모델의 방에 공급된 뒤에만 고정 6을 걷는다. 순서를 바꾸면 무한 루프·비용 폭주가 열린다."*
//
// ── 왜 축을 바꾸는가 ───────────────────────────────────────────────────────
// `MAX_TOOL_STEPS = 6` 은 **도구 실행 횟수**를 셌다. 그 시절엔 그것이 곧 비용이었다 —
// 한 왕복에 한 호출만 실행됐으므로 실행 6번 = 왕복 6번이었다.
//
// 다중 호출 병합을 걷어낸 뒤(2026-08-04) 그 등식이 깨졌다. 모델이 한 응답에 move 여섯을
// 내면 **왕복 하나에 실행 여섯**이다. 그런데 상한은 여전히 실행을 세므로, 비용이 안 드는
// 쪽을 조이고 비용이 드는 쪽은 안 센다. 실측: 회차 6 에서 여섯 개를 옮기고 예산이 다 됐다.
//
// 그래서 두 축으로 나눈다:
//   **왕복** — 실제 비용(토큰·시간)이 드는 축. 여기가 진짜 예산이다.
//   **걸음** — 실행 횟수. 폭주 방지 뒷단(backstop)이지 비용 축이 아니다.
//
// ── 가드레일은 멈추지 않는다 ────────────────────────────────────────────────
// Hermes `tool_guardrails` 의 원리를 흡수하되(같은 실패 2/5 · 같은 도구 3/8 · 무진전 2/5),
// **경고 기본 켬 · 하드스톱 기본 끔**이다. 런타임이 대신 멈추면 그게 다시 주객 전도다 —
// 사실을 모델 방에 놓고 판단은 모델이 한다(계약 ①·④).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  턴예산, 가드레일신호, 예산소진, 실행효과분류, 위험상한소진,
} from '../src/kernel/turn-budget.js';

const 성공 = (tool, i = 0) => ({
  intended: `${tool} 실행`, failureState: 'none', userSafeSummary: `${tool} 했어요.`,
  actualCall: { tool, args: { n: i } }, result: { ok: i },
});
const 실패 = (tool, i = 0) => ({
  intended: `${tool} 실행`, failureState: 'blocked', userSafeSummary: '막혔어요.',
  actualCall: { tool, args: { n: i } },
});

// ── ① 예산: 두 축을 나눈다 ─────────────────────────────────────────────────
test('예산은 세 축이다 — 왕복(비용) · 외부효과(뒷단) · 벽시계(사용자 대기)', () => {
  const b = 턴예산({});
  assert.ok(Number.isInteger(b.왕복) && b.왕복 > 0, '비용 축이 없다');
  assert.ok(Number.isInteger(b.되돌릴수있는것) && Number.isInteger(b.그밖),
    '외부효과 뒷단이 두 칸으로 안 나뉜다');
  assert.ok(b.되돌릴수있는것 > b.그밖,
    '되돌릴 수 없는 쪽이 더 헐거우면 뒷단의 뜻이 없다');
  assert.ok(Number.isInteger(b.벽시계ms) && b.벽시계ms > 0,
    '긴 실행을 막을 벽시계가 없다 — 도구 timeout 만으로는 큐 전체가 안 잡힌다');
  assert.ok(b.되돌릴수있는것 > b.왕복,
    '실행 뒷단이 왕복보다 빡빡하면 예전 상한과 같은 병이다');
});

test('예산은 환경으로 바꿀 수 있다(값을 코드에 못 박지 않는다)', () => {
  const b = 턴예산({ GPAO_T5_TURN_ROUNDTRIPS: '3', GPAO_T5_TURN_REVERSIBLE: '11', GPAO_T5_TURN_IRREVERSIBLE: '2' });
  assert.equal(b.왕복, 3);
  assert.equal(b.되돌릴수있는것, 11);
  assert.equal(b.그밖, 2);
});

test('말이 안 되는 값은 기본값으로 되돌린다(0 이나 음수로 손을 잠그지 않는다)', () => {
  const 기본 = 턴예산({});
  assert.deepEqual(턴예산({ GPAO_T5_TURN_ROUNDTRIPS: '0', GPAO_T5_TURN_REVERSIBLE: '-4' }), 기본);
  assert.deepEqual(턴예산({ GPAO_T5_TURN_ROUNDTRIPS: '헛소리' }), 기본);
});

test('reversible false 선언은 실제 무효과 증명 없이 action kind로 낮추지 않는다', () => {
  const receipt = (result) => ({ actualCall: { tool: 'future.hand' }, result });
  for (const actionKind of ['read', 'search', 'organize', 'future_kind']) {
    assert.equal(실행효과분류({
      actionKind, declaredReversible: false, receipt: receipt({ applied: true }),
    }).등급, '되돌릴수없음', `${actionKind}이 정적 false 상한을 낮춰다`);
  }
  assert.equal(실행효과분류({
    actionKind: 'future_kind', declaredReversible: false,
    receipt: receipt({ applied: false }),
  }).등급, '없음');
  assert.equal(실행효과분류({
    actionKind: 'future_kind', declaredReversible: false,
    receipt: receipt({ probeChangedNothing: true }),
  }).등급, '없음');
});

test('전역 종단은 왕복·벽시계이고 위험 상한은 같은 위험 호출에만 문다', () => {
  const b = { 왕복: 3, 되돌릴수있는것: 10, 그밖: 2, 벽시계ms: 1000 };
  assert.equal(예산소진({ 왕복쓴것: 2, 되돌릴수있는것쓴것: 2, 그밖쓴것: 1, 지난ms: 10 }, b), false);
  assert.equal(예산소진({ 왕복쓴것: 3, 되돌릴수있는것쓴것: 0, 그밖쓴것: 0, 지난ms: 0 }, b), true, '비용 축');
  assert.equal(예산소진({ 왕복쓴것: 0, 되돌릴수있는것쓴것: 10, 그밖쓴것: 2, 지난ms: 0 }, b), false,
    '위험 상한 하나가 턴 전체를 닫았다');
  assert.equal(위험상한소진({ 되돌릴수있는것쓴것: 10 }, b, '되돌릴수있음'), true);
  assert.equal(위험상한소진({ 그밖쓴것: 2 }, b, '되돌릴수없음'), true);
  assert.equal(위험상한소진({ 그밖쓴것: 2 }, b, '없음'), false,
    '비가역 상한이 안전한 읽기까지 막았다');
  assert.equal(예산소진({ 왕복쓴것: 0, 되돌릴수있는것쓴것: 0, 그밖쓴것: 0, 지난ms: 1000 }, b), true, '벽시계');
});

test('사용자 취소는 예산과 무관하게 즉시 소진이다', () => {
  const b = { 왕복: 9, 되돌릴수있는것: 9, 그밖: 9, 벽시계ms: 9e9 };
  assert.equal(예산소진({ 왕복쓴것: 0, 취소됨: true }, b), true, '취소 신호가 큐를 못 멈춘다');
});

// ── ② 가드레일: 사실만 낸다 ────────────────────────────────────────────────
test('성공 사이에 끼어도 같은 지문 반복 실패는 잡는다', () => {
  // 헬퍼 `실패(tool, i)` 는 인자를 매번 다르게 준다 — 새 계약에서 그건 전략 전환이다.
  // 되풀이는 **같은 인자로 또 막힌 것**이므로 인자를 같게 두고 잰다.
  const 같은실패 = () => ({
    intended: 'web 실행', failureState: 'blocked', userSafeSummary: '막혔어요.',
    actualCall: { tool: 'web.collect', args: { url: 'https://a' } },
  });
  const 신호 = 가드레일신호([성공('local.file', 1), 같은실패(), 성공('local.file', 2), 같은실패()]);
  assert.ok(신호.some((s) => s.종류 === '반복실패' && s.tool === 'web.collect'),
    `같은 지문 반복 실패가 안 잡혔다: ${JSON.stringify(신호)}`);
});

test('다른 손·다른 인자 실패는 되풀이가 아니다(다른 길을 시도한 것이다)', () => {
  assert.deepEqual(가드레일신호([실패('web.collect'), 실패('local.file')]), []);
  assert.deepEqual(가드레일신호([실패('web.collect', 1), 실패('web.collect', 2)]), []);
});

test('성공한 같은 도구 반복은 **경고하지 않는다**(437개를 옮기는 정상 동작이다)', () => {
  // 초안은 Hermes 의 `같은 도구 3/8` 을 값까지 그대로 가져왔다. 그런데 파일 정리는 같은 손을
  // 수백 번 부르는 게 정상이다 — 3번째부터 경고가 계속 뜨면 모델은 경고를 무시하는 법을
  // 배우고, 진짜 되풀이일 때도 안 듣는다. 흡수할 것은 문구가 아니라 원리였다(오너 지시).
  const 많이 = Array.from({ length: 12 }, (_, i) => 성공('local.file', i));
  assert.deepEqual(가드레일신호(많이), [], `성공한 진행에 경고가 붙었다: ${JSON.stringify(가드레일신호(많이))}`);
});

test('같은 지문으로 **반복 실패**하면 신호를 낸다(인자가 다르면 아니다)', () => {
  const 같은지문실패 = (i) => ({
    intended: 'web 실행', failureState: 'blocked', userSafeSummary: '막혔어요.',
    actualCall: { tool: 'web.collect', args: { url: 'https://a' } }, 순번: i,
  });
  assert.ok(가드레일신호([같은지문실패(1), 같은지문실패(2)]).some((s) => s.종류 === '반복실패'),
    '같은 인자로 두 번 막혔는데 신호가 없다');
  const 다른인자 = [
    { intended: 'web', failureState: 'blocked', userSafeSummary: '막', actualCall: { tool: 'web.collect', args: { url: 'https://a' } } },
    { intended: 'web', failureState: 'blocked', userSafeSummary: '막', actualCall: { tool: 'web.collect', args: { url: 'https://b' } } },
  ];
  assert.equal(가드레일신호(다른인자).some((s) => s.종류 === '반복실패'), false,
    '다른 주소를 시도한 것은 되풀이가 아니라 전략 전환이다');
});

test('읽기 전용에서 **같은 결과**를 다시 받으면 무진전이다(쓰기 반복은 아니다)', () => {
  const 같은읽기 = (i) => ({
    intended: 'read', failureState: 'none', userSafeSummary: '읽었어요.',
    actualCall: { tool: 'local.file', args: { action: 'list', path: '/다운로드' } },
    result: { path: '/다운로드', items: [{ name: 'a' }] }, 순번: i,
  });
  assert.ok(가드레일신호([같은읽기(1), 같은읽기(2)]).some((s) => s.종류 === '무진전'),
    '같은 목록을 두 번 받았는데 무진전이 안 잡혔다(사고 당시 list→list→list)');
  // 쓰기는 같은 손이라도 매번 실물이 바뀐다 — 무진전이 아니다.
  const 쓰기들 = Array.from({ length: 5 }, (_, i) => ({
    intended: 'move', failureState: 'none', userSafeSummary: '옮겼어요.',
    actualCall: { tool: 'local.file', args: { action: 'move', path: `a${i}`, to: `b/a${i}` } },
    result: { from: `a${i}`, to: `b/a${i}` },
  }));
  assert.deepEqual(가드레일신호(쓰기들), [], '진행 중인 이동이 무진전으로 잡혔다');
});

test('창 밖으로 나간 것은 안 센다(옛일이 영원히 경고로 남지 않는다)', () => {
  const 실패둘 = [실패('web.collect'), 실패('web.collect')];
  const 뒤 = Array.from({ length: 6 }, (_, i) => 성공(`t${i}`, i));
  assert.deepEqual(가드레일신호([...실패둘, ...뒤]), [], '지나간 실패가 영원히 경고로 남는다');
});

test('잘 굴러가는 흐름에는 아무 신호도 안 낸다(경고를 남발하지 않는다)', () => {
  assert.deepEqual(가드레일신호([성공('local.locate'), 성공('local.file', 1), 성공('local.terminal')]), []);
  assert.deepEqual(가드레일신호([]), []);
});

test('가드레일은 **멈추라고 하지 않는다** — 사실만 낸다', () => {
  const 신호 = 가드레일신호([실패('web.collect'), 실패('web.collect')]);
  const 전문 = JSON.stringify(신호);
  for (const 지시어 of ['멈추', '하지 마', '해라', '그만', '금지']) {
    assert.equal(전문.includes(지시어), false,
      `가드레일이 지시를 냈다("${지시어}") — 런타임이 대신 판단하면 그게 다시 주객 전도다: ${전문}`);
  }
  assert.ok(신호.every((s) => typeof s.사람말 === 'string' && s.사람말.trim()),
    '모델 방에 놓을 사람 말이 없다');
});

// ── ③ 방에 실제로 놓이는가 — 패킷에만 있으면 소용없다 ───────────────────────
test('예산 사실이 **실제 프롬프트 문자열**까지 간다', async () => {
  const { buildTaskContext } = await import('../src/kernel/l1-intent/task-context.js');
  const { buildModelMessages } = await import('../src/runtime/model-provider.js');
  const { buildSelfState } = await import('../src/kernel/l0-evidence/self-state.js');
  const { demoEnv } = await import('../src/surface/demo-context.js');
  const tc = buildTaskContext({
    intent: { currentRequest: '정리해줘' }, selfState: buildSelfState(demoEnv()),
    turnBudget: {
      왕복쓴것: 2, 왕복예산: 8,
      되돌릴수있는것쓴것: 11, 되돌릴수있는것예산: 200,
      그밖쓴것: 1, 그밖예산: 3,
    },
  });
  const 전문 = JSON.stringify(buildModelMessages(tc));
  assert.match(전문, /6번 남음/, '왕복 잔량이 프롬프트에 없다 — 모델은 남은 비용을 모른다');
  assert.match(전문, /되돌릴 수 있는 손 189번 남음/, '되돌릴 수 있는 손 잔량이 프롬프트에 없다');
  assert.match(전문, /그 밖의 손 2번 남음/, '되돌릴 수 없는 손 잔량이 프롬프트에 없다');
  assert.doesNotMatch(전문, /NaN|undefined/, '예산 사실이 깨진 숫자로 프롬프트에 들어갔다');
  assert.match(전문, /한 응답에 여러 손을 함께 내면/,
    '한 왕복에 여러 손을 낼 수 있다는 사실이 없으면, 모델은 예전처럼 하나씩 낸다');
});

test('가드레일 사실도 프롬프트까지 가고, 지시로 변하지 않는다', async () => {
  const { buildTaskContext } = await import('../src/kernel/l1-intent/task-context.js');
  const { buildModelMessages } = await import('../src/runtime/model-provider.js');
  const { buildSelfState } = await import('../src/kernel/l0-evidence/self-state.js');
  const { demoEnv } = await import('../src/surface/demo-context.js');
  const 신호 = 가드레일신호([실패('web.collect'), 실패('web.collect')]);
  const tc = buildTaskContext({
    intent: { currentRequest: '찾아줘' }, selfState: buildSelfState(demoEnv()), guardrailNotes: 신호,
  });
  const m = buildModelMessages(tc);
  assert.match(JSON.stringify(m), /같은 자리에서 막혔다/, '되풀이 사실이 모델 방에 안 놓인다');
  // **가드레일이 실은 줄만** 본다. 전문을 보면 기본 헌장의 다른 문장까지 걸려 뜻이 흐려진다.
  const 가드레일줄 = String(m.system).split('\n').filter((l) => l.includes('막혔다') || l.includes('썼다') || l.includes('얻지 못했다'));
  assert.ok(가드레일줄.length, '가드레일 줄을 못 찾았다');
  for (const 지시어 of ['멈추', '그만', '하지 마', '해라', '금지']) {
    assert.equal(가드레일줄.join(' ').includes(지시어), false,
      `사실이 지시로 바뀌었다("${지시어}"): ${가드레일줄.join(' | ')}`);
  }
});

// ── ④ 6상한이 실제로 걷혔는가 — 이 슬라이스의 핵심 ─────────────────────────
test('한 응답에 낸 손 50개가 **한 왕복**에 전부 실행된다(예전엔 6에서 끊겼다)', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { runTurn } = await import('../src/kernel/turn.js');
  const { demoEnv, demoTools } = await import('../src/surface/demo-context.js');
  const { makeLocalFileTool } = await import('../src/runtime/local-file.js');

  const dir = await mkdtemp(join(tmpdir(), 'budget-50-'));
  await mkdir(join(dir, '모음'), { recursive: true });
  const 파일들 = Array.from({ length: 50 }, (_, i) => `자료-${String(i).padStart(2, '0')}.txt`);
  for (const f of 파일들) await writeFile(join(dir, f), `내용 ${f}`);

  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  let 왕복 = 0;
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      왕복 += 1;
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      // **심문에는 제대로 답한다.** `move` 는 안전 바닥(write)이라 A 팔에서 현재행동 재심사가
      // 돈다. 여기서 답을 안 주면 폴백이 고른 것을 통째로 버려 0개가 되는데, 그건 예산 축이
      // 아니라 심문 축의 벽이다(S1 플래그 ①의 정의역). 이 검사는 **예산만** 재야 한다.
      if (tc?.currentActionAssessment) {
        return { text: '', toolCalls: [{ name: 'work.current_actions', args: {
          unclear: false, requestedIndexes: tc.currentActionAssessment.candidates.map((c) => c.index),
        } }] };
      }
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: 파일들.map((f, i) => ({
          providerCallId: `call_${i}`, name: 'local.file',
          args: { action: 'move', path: join(dir, f), to: join(dir, '모음', f) },
        })) };
      }
      return '옮겼어요.';
    },
  };
  const r = await runTurn({ text: '자료 파일들 모음 폴더로 옮겨줘' },
    { env: demoEnv(), tools: demoTools({ localFile }), model });

  const 옮겨진것 = 파일들.filter((f) => existsSync(join(dir, '모음', f)));
  assert.equal(옮겨진것.length, 50,
    `50개를 냈는데 ${옮겨진것.length}개만 옮겨졌다 — 상한이 아직 실행을 세고 있다`);
  assert.equal(r.kind, 'reply');
  // **비용 축은 안 늘었다.** 이게 요점이다 — 50개를 옮겼는데 모델은 몇 번만 불렸다.
  assert.ok(왕복 <= 턴예산({}).왕복 + 2,
    `50개를 옮기는 데 모델을 ${왕복}번 불렀다 — 실행이 열렸어도 비용이 같이 터지면 안 된다`);
});
