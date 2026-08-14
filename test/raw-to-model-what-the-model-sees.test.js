// **모델이 보는 것을 날것으로** — 셋을 한 덩어리로 (2026-08-11)
//
// 비교군(Hermes)에서 가져온 것은 문구가 아니라 **축** 셋이다. 전부 「모델이 무엇을 보는가」다.
//
//   ① 종결 판정을 문장이 아니라 **원장**에서   — 어미를 바꾸면 뚫리는 그물을 원장으로 옮긴다
//   ② 실패의 **기계 원문**을 모델에게          — 지금은 실패하면 내용이 0자 간다
//   ③ 잘라낸 가운데로 가는 **문**              — 뺀 양은 밝히는데 나머지로 갈 길이 없다
//
// 셋 다 T5 자신의 계약이 이미 요구하던 것이다:
//   · *"원장은 실제로 일어난 결과만 확정한다"* — 그런데 거짓 완료를 잡는 마지막 문에서 말투를 봤다
//   · *"실패한 결과를 사실로 승격하지 않는다"* — 승격하지 않는 것과 **안 주는 것**은 다르다
//   · 정본 §S3 *"조용한 절단 금지 — 뺀 양 · 뺀 것의 성질 · 문"* — 셋 중 문이 미구현이었다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 완료주장검증, 빈손으로끝났나 } from '../src/kernel/l2-plan/exit-verification.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { buildTaskContext, compactResult } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages, MODEL_PROVIDERS } from '../src/runtime/model-provider.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';

const selfState = buildSelfState({
  model: { id: 'beai5-stub' },
  connections: [{ id: 'local.file', connected: true, executable: true }],
});

const 읽음 = (이름) => ({
  intended: '자료 읽기',
  actualCall: { tool: 'local.file', args: { action: 'read', path: `/방/${이름}` } },
  failureState: 'none',
  userSafeSummary: `${이름} 을(를) 읽었어요.`,
  result: { path: `/방/${이름}`, text: '항목,금액\n임대료,500000\n' },
});

// ── ① 종결 판정을 문장이 아니라 원장에서 ─────────────────────────────────
//
// 지금 `완료주장인가` 는 **종성 ㅆ 구조**(했·갔·왔·뒀·냈…)로 과거형을 잡는다. 목록보다 낫지만
// 여전히 **말투**다. 그 아래에 걸린 두 그물(원장 밖 파일 이름 · 원장 밖 자리)은 판정 재료가
// 처음부터 원장인데, 문 앞에 말투 검사가 서 있어 어미 하나로 통째로 닫힌다.

test('① 원장 밖 파일 이름 그물은 어미가 과거형이 아니어도 열린다', () => {
  // 실측 모양(P-OP ⑥): 성공한 쓰기 0 인 턴이 "만든 통합 결과는 …csv" 라고 답했다.
  // 여기서는 같은 거짓을 **현재진행 어미**로 쓴다 — `담는 중이에요` 에는 ㅆ 받침이 없다.
  const r = 완료주장검증({
    reply: '세 자료를 합친 내용은 7월_통합_정산.csv 로 담는 중이에요.',
    receipts: [읽음('A사_7월.csv')],
    원장글: 'local.file read /방/A사_7월.csv — A사_7월.csv 을(를) 읽었어요.',
  });
  assert.equal(r.일치, false, '어미를 바꾸자 원장 대조가 통째로 닫혔다');
  assert.equal(r.사용자에게, false);
  assert.match(r.모델에게, /7월_통합_정산\.csv/);
});

test('① 원장 밖 자리 그물도 같은 문을 탄다', () => {
  const r = 완료주장검증({
    reply: '설치·압축 파일은 Downloads/_정리됨/설치_및_압축/ 으로 넘기는 중이에요.',
    receipts: [읽음('목록.txt')],
    원장글: 'local.file read /방/목록.txt',
  });
  assert.equal(r.일치, false, '자리 대조도 말투 뒤에 갇혀 있다');
  assert.match(r.모델에게, /설치_및_압축/);
});

test('① 반례 — 물음·제안·정직한 미완료는 그대로 지나간다', () => {
  // 문을 넓히면서 심문·제안까지 물면 그건 개입이다. 세 반례를 함께 못박는다.
  const 원장글 = 'local.file read /방/A사_7월.csv';
  for (const 답 of [
    '합친 결과를 7월_통합_정산.csv 로 만들까요?',
    'Downloads/_정리됨/설치_및_압축/ 으로 옮길지 골라 주세요.',
    '아직 7월_통합_정산.csv 는 못 만들었어요.',
  ]) {
    const r = 완료주장검증({ reply: 답, receipts: [읽음('A사_7월.csv')], 원장글 });
    assert.equal(r.일치, true, `대조 대상이 아닌 답을 물었다: ${답}`);
  }
});

test('① 반례 — 파일 손을 안 쓴 턴의 슬래시는 자리가 아니다 (f64-l6 실측)', () => {
  // 문 앞의 완료형 판정을 걷자 이 반례가 즉시 나왔다: 자동화 턴의 답에 든 `Asia/Seoul` 이
  // 「원장에 없는 자리」로 잡혀 **사용자 답이 통째로 막혔다.** 정의역은 파일 손을 쓴 턴이다.
  const r = 완료주장검증({
    reply: '{"jobRef":"status-job","trigger":{"timezone":"Asia/Seoul"},"state":"scheduled"}',
    receipts: [{
      intended: '자동화 조회',
      actualCall: { tool: 'automation.observe', args: {} },
      failureState: 'none',
      userSafeSummary: '예약을 확인했어요.',
      result: { jobs: 1 },
    }],
    원장글: '',
  });
  assert.equal(r.일치, true, '파일 손을 안 쓴 턴의 슬래시를 없는 자리로 물었다');
});

test('① 빈손 판정은 원장을 받으면 원장이 지배한다 — 어미는 보조로 내려간다', () => {
  // 지금은 `게요·겠습니다·겠어요` 와 물음표만 본다. 같은 뜻을 다른 어미로 쓰면 새 나간다.
  const 약속들 = [
    '바로 이 작업부터 해 볼게요',            // 지금도 잡힌다
    '바로 이 작업부터 해 봅니다',            // 어미만 바꿨다 — 지금은 샌다
    '이제 그 자리를 확인하러 갑니다',        // 같은 모양
  ];
  for (const 답 of 약속들) {
    assert.equal(빈손으로끝났나(답, { 가져온것: 0 }), true,
      `원장이 빈손인데 말투로 빠져나갔다: ${답}`);
  }
  // 반대 방향도 원장이 지배한다 — 원장에 성과가 있으면 말투가 약속형이어도 빈손이 아니다.
  assert.equal(빈손으로끝났나('이어서 나머지도 확인해 볼게요', { 가져온것: 2 }), false,
    '원장에 성과가 있는데 말투로 빈손이 됐다');
  // 정직한 미완료는 어느 쪽에서도 빈손이 아니다.
  assert.equal(빈손으로끝났나('아직 그 자리는 못 봤어요', { 가져온것: 0 }), false);
  // 원장을 안 주면 지금 그대로다(부르는 쪽이 아직 안 넘긴 자리를 깨지 않는다).
  assert.equal(빈손으로끝났나('바로 이 작업부터 해 볼게요'), true);
});

// ── ② 실패의 기계 원문을 모델에게 ────────────────────────────────────────
//
// 계약 *"실패한 결과를 사실로 승격하지 않는다"* 는 옳고 그대로 둔다. 그런데 예전에는 승격만
// 막는 게 아니라 **내용을 통째로 안 줬다** — 모델이 받는 것은 5값 상태 토큰과 사람말 요약뿐이었다.
// T5 자신의 시험이 이미 그 대가를 적어 뒀다(cu-c-effect-not-dispatch):
//   *"사유 없는 실패가 회차 원본에 남아 원인 확정을 막았고, 모델은 그 빈자리를
//     「환경이 막혀서」로 메웠다."*
//
// 계획서 §5-3(오너 승인 2026-08-12)이 이 절단을 닫았다 — Hermes model_tools.py 의
// `[TOOL_ERROR]`+실패 원문 2,000자 축을 흡수하되, 표식(`확인안됨`)을 반드시 단다.
// 봉인 셋과의 충돌은 **밭을 갈라** 푼다:
//   · 모델 입력(turnExchange)에는 실패 원문이 **실린다** — 이 파일이 그것을 문다.
//   · 저장 봉투(턴 결과·사용자 결과)에서는 **걷힌다** — recovery A·B·B' 가 그대로 문다.
//   · 실행 전에 막힌 호출의 diagnosticTrace(커널 내부 분류값)는 원문이 아니다 —
//     s1-execution-wall:141 이 그대로 문다.

const 실패영수증 = () => ({
  intended: '창 앞으로',
  actualCall: { tool: 'desktop.act', args: { action: 'focus', app: 'KakaoTalk' } },
  failureState: 'failed',
  userSafeSummary: '그 창을 앞으로 못 옮겼어요.',
  diagnosticTrace: { 오류: 'AXUIElementPerformAction kAXErrorCannotComplete (-25204)' },
  nextSafeAction: '다시 시도할까요?',
});

test('② 실제로 부른 호출이 실패하면 기계 원문이 「확인 안 됨」 표식과 함께 모델 교환에 실린다', () => {
  const tc = buildTaskContext({
    intent: interpret('카카오톡 창을 앞으로 띄워줘'), selfState, receipts: [실패영수증()],
  });
  const x = (tc.turnExchange ?? [])[0];
  assert.ok(x, '실패 교환이 없다');
  assert.equal(x.failureState, 'failed', '상태 토큰이 사라졌다');
  assert.equal(x.확인안됨, true, '표식 없이 주면 실패 내용이 사실로 승격된다 — 표식이 계약이다');
  assert.match(String(x.실패원문 ?? ''), /kAXError/, '실패의 기계 원문이 모델 교환에 없다(§5-3 절단 그대로)');
  assert.equal(x.data, undefined, '실패한 결과를 data 로 승격했다');
  assert.match(String(x.summary ?? ''), /못 옮겼어요/, '사람말 요약은 그대로 남는다(다음 입력 봉인 유지)');
});

test('② 실패 원문은 와이어까지 간다 — 도구 결과 메시지에 「확인 안 됨」 딱지로 실린다', () => {
  const tc = buildTaskContext({
    intent: interpret('카카오톡 창을 앞으로 띄워줘'), selfState, receipts: [실패영수증()],
  });
  const 전문 = MODEL_PROVIDERS.openai.body(
    { modelId: 'm', maxTokens: 10, baseUrl: 'http://x' }, buildModelMessages(tc), {},
  );
  assert.match(전문, /kAXError/, '교환에는 실렸는데 와이어 렌더가 떨어뜨렸다 — 안 준 손은 흔적이 없다');
  assert.match(전문, /확인 안 됨/, '원문이 표식 없이 나가면 모델이 실패 내용을 사실로 읽는다');
});

test('② 실패 원문 상한 2,000자 — 자른 사실과 전체 크기를 밝힌다(조용한 절단 금지)', () => {
  const 긴 = `머리표식AA ${'x'.repeat(9000)}`;
  const tc = buildTaskContext({
    intent: interpret('실행해줘'), selfState,
    receipts: [{ ...실패영수증(), diagnosticTrace: { stderr: 긴 } }],
  });
  const x = tc.turnExchange[0];
  assert.ok(x.실패원문.includes('머리표식AA'), '앞머리가 사라졌다');
  assert.ok(x.실패원문.length <= 2200, `상한이 안 선다: ${x.실패원문.length}자`);
  assert.match(x.실패원문, /전체 \d+자/, '뺀 양을 안 밝히면 조용한 절단이다');
});

test('② 실행 전에 막힌 호출(부르지 않은 것)에는 실패 원문을 만들지 않는다 — 내부 분류값 봉인 유지', () => {
  // s1-execution-wall:141 과 같은 정의역: 이 diagnosticTrace 는 기계 원문이 아니라
  // 커널 내부 분류값(순번·callId·reason)이다. 여기에 문을 열면 그 봉인이 문다.
  const tc = buildTaskContext({
    intent: interpret('옮겨줘'), selfState,
    receipts: [{
      intended: '파일 도구 실행',
      actualCall: null,
      제안한호출: { tool: 'local.file', args: { action: 'move', path: 'a.png', to: 'images/a.png' } },
      failureState: 'blocked',
      userSafeSummary: '한 번에 할 수 있는 만큼만 하고 나머지는 남겨 뒀어요.',
      diagnosticTrace: { callId: 'wire_5', 순번: 5, tool: 'local.file', reason: '걸음상한' },
    }],
  });
  const x = (tc.turnExchange ?? [])[0];
  assert.ok(x, '못 부른 호출도 교환으로는 돌아간다(계약 ②)');
  assert.equal(x.실패원문, undefined, '부르지도 않은 호출에 실패 원문이 생겼다');
  assert.equal(JSON.stringify(tc).includes('걸음상한'), false, '진단면 내부 분류값이 모델 입력으로 샜다');
});

test('② 실패 원문은 모델 입력에만 산다 — 턴 결과(저장 봉투)에서는 걷힌다', async () => {
  // 수리 전/후 한 쌍의 자리: 같은 실패 영수증이 예전엔 {failureState}만 갔고,
  // 지금은 실패 원문+표식이 **모델 입력에** 실리되 저장 봉투에는 없다(봉인 A 그대로).
  const { runTurn } = await import('../src/kernel/turn.js');
  const { demoEnv, demoTools } = await import('../src/surface/demo-context.js');
  const 던지는손 = {
    async probe(command) { return { command, cwd: '/x', changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler() {
      return {
        failed: true,
        failureResult: { stdout: 'FAILURE_STDOUT_MARKER', stderr: 'FAILURE_STDERR_MARKER', exitCode: 7, cwd: '/failure-origin' },
        userSafeSummary: '명령이 오류로 끝났어요.',
      };
    },
  };
  const 입력들 = [];
  let 냈나 = false;
  const 모델 = {
    async respond(tc, opts = {}) {
      입력들.push(JSON.stringify(tc));
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (!opts.tools?.length) return '못 봐서 확인하지 못했어요';
      if (!냈나) {
        냈나 = true;
        return {
          text: '',
          toolCalls: [{
            name: 'local.terminal',
            args: {
              command: 'ls',
              probeResult: { stdout: 'FAILURE_STDOUT_MARKER', stderr: 'FAILURE_STDERR_MARKER' },
            },
          }],
        };
      }
      return { text: '못 봐서 확인하지 못했어요', toolCalls: [] };
    },
  };
  const r = await runTurn(
    { text: '작업 폴더 봐줘' },
    { env: demoEnv(), tools: demoTools({ localTerminal: 던지는손 }), model: 모델 },
  );
  const 뒤입력 = 입력들[입력들.length - 1];
  assert.ok(뒤입력.includes('FAILURE_STDOUT_MARKER') && 뒤입력.includes('FAILURE_STDERR_MARKER'),
    '실패 실행 결과가 다음 모델 입력에 없다');
  assert.ok(뒤입력.includes('확인안됨') || 뒤입력.includes('확인 안 됨'), '실패 결과가 표식 없이 실렸다');
  assert.ok(!JSON.stringify(r).includes('FAILURE_STDOUT_MARKER') && !JSON.stringify(r).includes('FAILURE_STDERR_MARKER'),
    '실패 실행 결과가 저장 봉투(사용자 결과)로 샜다 — 봉인 A 가 물어야 할 자리다');
});

test('② 성공한 실행에는 진단면이 붙지 않는다 — 문은 실패에만 열린다', () => {
  const tc = buildTaskContext({
    intent: interpret('뉴스 수집해줘'),
    selfState,
    receipts: [{
      intended: '수집',
      actualCall: { tool: 'web.collect', args: {} },
      failureState: 'none',
      userSafeSummary: '공개 자료로 확인',
      diagnosticTrace: { stack: '내부스택표식ZZ' },
      result: { title: '뉴스', markdown: '본문' },
    }],
  });
  assert.doesNotMatch(JSON.stringify(tc), /내부스택표식ZZ/, '성공 교환에 진단면이 샜다');
});

// ── ③ 잘라낸 가운데로 가는 문 ────────────────────────────────────────────
//
// `local.file read` 는 이미 `offset`·`limit`·`nextOffset` 을 갖고 있다(local-file.js §문).
// **문은 손에 있는데 모델 입력에 안 실렸다** — 모델은 "가운데 N자 생략" 만 받고 나머지로 갈
// 인자를 몰랐다. 새 저장소를 만들 일이 아니라 있는 문을 여는 일이다.

test('③ 접힌 파일 본문에 나머지로 가는 문이 실린다', () => {
  const 줄들 = Array.from({ length: 400 }, (_, i) => `${i}행,${i * 1000}`).join('\n');
  const 요약 = compactResult({
    path: '/방/큰표.csv', text: 줄들, bytes: 줄들.length, totalChars: 줄들.length, offset: 0,
  });
  assert.match(요약, /생략/, '뺀 양 표식이 사라졌다');
  assert.match(요약, /offset=\d+/, '나머지로 가는 문이 없다 — 잘렸다는 말만 하고 막은 것이다');
  assert.match(요약, /0행,0/, '앞부분이 사라졌다');
  assert.match(요약, /399행,399000/, '결론(뒷부분)이 사라졌다');
});

test('③ 손이 이미 쪽을 넘긴 파일은 그 다음 쪽 문을 그대로 옮긴다', () => {
  const 요약 = compactResult({
    path: '/방/아주큰표.csv',
    text: '가운데쪽 내용',
    bytes: 100_000,
    totalChars: 100_000,
    offset: 20_000,
    nextOffset: 40_000,
  });
  assert.match(요약, /전체 100000자/, '전체 크기를 모델이 못 본다');
  assert.match(요약, /offset=40000/, '손이 쥔 다음 쪽 문이 모델 입력에서 사라졌다');
});

test('③ 반례 — 통째로 실린 짧은 파일에는 문을 달지 않는다', () => {
  const 요약 = compactResult({ path: '/방/작은표.csv', text: '항목,금액\n임대료,500000\n', bytes: 30 });
  assert.doesNotMatch(요약, /offset=/, '자르지도 않았는데 문을 달아 소음을 만들었다');
});

// ── ④ 그 밖 결과의 접기와 큰 결과 흘리기 (§5-3 b·c) ──────────────────────
//
// b: 갈래 없는 결과(맨 아래 JSON 갈래)가 산문 접기(`…가운데 N자 생략…`)로 뭉개졌다 —
//    뺀 양은 밝히는데 **전체 크기·실은 범위·다음 위치**가 없어 모델이 나머지를 셈할 수 없었다.
// c: 결과 원문이 창 예산의 결과자를 크게 넘으면(기준은 tool-runner 에 값으로 있다) 상태 자리
//    아래 파일로 흘리고, 모델에는 요약+경로+전체 크기를 준다(Hermes tool_result_storage 축).
//    흘린 경로는 local.file read 로 **실제로 이어 읽혀야** 문이다.

test('④ 갈래 없는 큰 결과는 산문으로 뭉개지 않는다 — 전체 크기·실은 범위·다음 위치를 밝힌다', () => {
  const 요약 = compactResult({ 목록: Array.from({ length: 300 }, (_, i) => `항목${i}`) }, 500);
  assert.match(요약, /전체 \d+자/, '전체 크기를 모델이 못 본다');
  assert.match(요약, /실은 범위/, '실은 범위 표식이 없다 — 조용한 절단이다');
  assert.match(요약, /다음 위치 \d+/, '다음 위치가 없다 — 잘렸다는 말만 하고 막은 것이다');
  assert.ok(요약.includes('항목0'), '앞머리가 사라졌다');
  assert.ok(요약.includes('항목299'), '결론(끝부분)이 사라졌다');
});

const 흘림방 = async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { dir: await mkdtemp(join(tmpdir(), 'raw-spill-')), join };
};
const 큰결과손 = {
  async handler() {
    return {
      result: { rows: Array.from({ length: 400 }, (_, i) => ({ i, note: `자료${i}` })) },
      userSafeSummary: '자료를 읽었어요.',
    };
  },
};
const 흘림셀프 = buildSelfState({
  model: { id: 'beai5-stub' },
  connections: [{ id: 'local.terminal', connected: true, executable: true }],
});

test('④ 결과 원문이 기준을 넘으면 상태 자리 아래 파일로 흘리고, 모델 입력에 경로·전체 크기가 실린다', async () => {
  const { dir, join } = await 흘림방();
  const 원래 = process.env.GPAO_T5_DATA_DIR;
  process.env.GPAO_T5_DATA_DIR = dir;
  try {
    const runner = new ToolRunner({ 'local.terminal': 큰결과손 });
    const rec = await runner.run('local.terminal', {}, 흘림셀프, { 결과자: 200 });
    assert.equal(rec.failureState, 'none');
    assert.ok(rec.흘린원문?.path, '큰 결과가 파일로 흘러가지 않았다');
    assert.ok(rec.흘린원문.path.startsWith(join(dir, 'results')),
      `상태 자리 아래 한 디렉터리가 아니다: ${rec.흘린원문.path}`);
    const { readFile } = await import('node:fs/promises');
    assert.equal(await readFile(rec.흘린원문.path, 'utf8'), JSON.stringify(rec.result),
      '흘린 파일이 원문 그대로가 아니다');
    // 모델 입력의 결과 자리에 문이 실린다 — 경로·전체 크기·이어 읽는 손.
    const tc = buildTaskContext({
      intent: interpret('자료 봐줘'), selfState: 흘림셀프, receipts: [rec], 창예산: { 결과자: 200 },
    });
    const x = tc.turnExchange[0];
    assert.ok(x.data.includes(rec.흘린원문.path), '흘린 경로가 모델에게 안 갔다 — 문이 없는 절단이다');
    assert.match(x.data, /전체 \d+자/, '전체 크기가 모델에게 안 갔다');
    assert.match(x.data, /local\.file read/, '이어 읽을 손이 안 적혔다');
  } finally {
    if (원래 === undefined) delete process.env.GPAO_T5_DATA_DIR;
    else process.env.GPAO_T5_DATA_DIR = 원래;
  }
});

test('④ 흘린 파일은 local.file read 로 실제로 이어 읽힌다', async () => {
  const { dir } = await 흘림방();
  const 원래 = process.env.GPAO_T5_DATA_DIR;
  process.env.GPAO_T5_DATA_DIR = dir;
  try {
    const runner = new ToolRunner({ 'local.terminal': 큰결과손 });
    const rec = await runner.run('local.terminal', {}, 흘림셀프, { 결과자: 200 });
    assert.ok(rec.흘린원문?.path, '흘린 파일이 없다');
    const { makeLocalFileTool } = await import('../src/runtime/local-file.js');
    const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
    const out = await localFile.handler({ action: 'read', path: rec.흘린원문.path });
    assert.ok(!out.failed && !out.blocked, `흘린 경로를 읽는 손이 막혔다: ${out.userSafeSummary}`);
    assert.ok(String(out.result?.text ?? '').includes('자료399'), '이어 읽은 내용이 원문이 아니다');
  } finally {
    if (원래 === undefined) delete process.env.GPAO_T5_DATA_DIR;
    else process.env.GPAO_T5_DATA_DIR = 원래;
  }
});

test('④ 반례 — 기준 아래 결과는 흘리지 않는다(파일 소음 금지)', async () => {
  const { dir } = await 흘림방();
  const 원래 = process.env.GPAO_T5_DATA_DIR;
  process.env.GPAO_T5_DATA_DIR = dir;
  try {
    const runner = new ToolRunner({
      'local.terminal': { async handler() { return { result: { ok: true }, userSafeSummary: '했어요.' }; } },
    });
    const rec = await runner.run('local.terminal', {}, 흘림셀프, { 결과자: 200 });
    assert.equal(rec.흘린원문, undefined, '작은 결과까지 파일로 흘렸다 — 소음이다');
  } finally {
    if (원래 === undefined) delete process.env.GPAO_T5_DATA_DIR;
    else process.env.GPAO_T5_DATA_DIR = 원래;
  }
});
