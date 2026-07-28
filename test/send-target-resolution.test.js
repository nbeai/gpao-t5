// P6-7 후반 · **대상이 확정되기 전에는 전송을 승인으로 보내지 않는다 — 두 경로 모두.**
//
// 라이브 실측(2026-07-29 F): "내 텔레그램으로 보내줘"에 모델이 도구 호출로 telegram.send 를
// 골랐고(target 빈칸), 걸음 경로가 그 인자를 그대로 봉인해 **받는 곳 미정 승인 카드**가 떴다.
// 승인해도 실행은 "보낼 대상이 지정되지 않았어요"로 막힐 수밖에 없는 카드다. 계획 경로에는
// 이미 있던 계약(정밀 분리 → 학습 기본값 → 미확정이면 질문)이 걸음 경로에 없었다 — 같은 계약이
// 한 자리에만 있으면 어느 길로 왔느냐에 따라 결과가 갈린다(매듭).
//
// 그리고 더 깊은 빈자리: "내 텔레그램"을 풀 현실(그 채널의 허용된 대화 목록)이 커널에 공급되지
// 않아 어느 경로도 이 요청을 영영 확정할 수 없었다. 서버가 ctx.channelTargets 로 사실을 공급한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { resolveSendTarget } from '../src/kernel/l1-intent/send-parse.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeSendPreview } from '../src/runtime/channel-sender.js';

// ── L1 확정 계약 ──────────────────────────────────────────────────────────
test('라벨을 말하면 실행 값으로 확정한다(사람 말 → 실행 값)', () => {
  const r = resolveSendTarget({ target: '오너', known: [{ target: '111', label: '오너' }] });
  assert.deepEqual(r, { target: '111', label: '오너' });
});

test('자기 지칭은 허용된 곳이 하나뿐일 때만 그곳이다', () => {
  const 하나 = [{ target: '111', label: '오너' }];
  assert.deepEqual(resolveSendTarget({ target: null, text: '내 텔레그램으로 보내줘.', known: 하나 }),
    { target: '111', label: '오너' });
  assert.deepEqual(resolveSendTarget({ target: null, text: '나한테 보내줘', known: 하나 }),
    { target: '111', label: '오너' });
  // 둘이면 조용히 확정하지 않는다(복수 후보 계약) — 부르는 쪽이 묻는다.
  const 둘 = [{ target: '111', label: '오너' }, { target: '222', label: '직원' }];
  assert.equal(resolveSendTarget({ target: null, text: '내 텔레그램으로 보내줘.', known: 둘 }), null);
});

test('무관한 이름을 아는 곳으로 몰래 돌리지 않는다', () => {
  // "거래처" 는 허용 목록의 누구도 아니다 — 오너의 대화로 자동 확정되면 엉뚱한 곳으로 간다.
  const r = resolveSendTarget({ target: '거래처', known: [{ target: '111', label: '오너' }] });
  assert.deepEqual(r, { target: '거래처' }, '명시한 대상을 아는 곳으로 바꿔쳤다');
  // 자기 지칭이 아닌 문장은 하나뿐이어도 자동 확정하지 않는다.
  assert.equal(resolveSendTarget({ target: null, text: '거래처에 보내줘', known: [{ target: '111', label: '오너' }] }), null);
});

test('"내일 보내줘" 는 자기 지칭이 아니다', () => {
  assert.equal(resolveSendTarget({ target: null, text: '내일 보내줘', known: [{ target: '111', label: '오너' }] }), null);
});

// ── 걸음 경로(모델 도구 호출)도 같은 계약을 탄다 ─────────────────────────
// 라이브가 간 길 그대로: 첫 걸음은 다른 손(읽기), **둘째 걸음에서** 전송을 고른다 — 그래야
// 계획 경로가 아니라 걸음 경로(실행 루프 안의 승인 자리)를 탄다.
function 전송거는모델(args) {
  const 계획 = [
    { name: 'local.terminal', args: { command: 'ls' } },
    { name: 'telegram.send', args },
  ];
  let i = 0;
  return {
    async respond(_tc, opts = {}) {
      if (!opts.tools?.length) return '알겠어요';
      if (i >= 계획.length) return { text: '다 했어요', toolCalls: [] };
      const 걸음 = 계획[i]; i += 1;
      return { text: '', toolCalls: [걸음] };
    },
  };
}

const 읽는손 = {
  async probe(command) { return { command, cwd: '/어딘가', changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
  async handler(args) { return { result: { command: args.command, exitCode: 0, stdout: '', cwd: '/어딘가' }, userSafeSummary: '봤어요.' }; },
};

function 기록전송손() {
  const 불린것 = [];
  return {
    불린것,
    hand: {
      toolKind: 'send',
      previewOf: makeSendPreview({ channel: 'telegram' }),
      async handler(a) { 불린것.push(a); return { result: { sent: true }, userSafeSummary: '보냈어요.' }; },
    },
  };
}

const 전송ctx = (model, 손, channelTargets) => ({
  env: demoEnv(), model,
  tools: demoTools({ senders: { 'telegram.send': 손.hand }, localTerminal: 읽는손 }),
  ...(channelTargets ? { channelTargets } : {}),
});

test('걸음 경로: 대상 미정 전송은 카드가 아니라 질문이다(수정 전 실패)', async () => {
  const 손 = 기록전송손();
  const r = await runTurn(
    { text: '이 내용 보내줘' },
    전송ctx(전송거는모델({ text: '시험 문면', target: '' }), 손),
  );
  assert.equal(r.kind, 'clarify', `받는 곳 미정인데 ${r.kind} 가 됐다 — 승인해도 실패할 카드는 승인이 아니다`);
  assert.equal(손.불린것.length, 0, '확정 전에 전송이 나갔다');
});

test('걸음 경로: 자기 지칭 + 허용된 대화 하나 → 확정된 카드 → 승인 → 실행 값으로 전송', async () => {
  const 손 = 기록전송손();
  const ctx = 전송ctx(
    전송거는모델({ text: '시험 문면', target: '' }), 손,
    { 'telegram.send': [{ target: '8601204821', label: '오너' }] },
  );
  const r = await runTurn({ text: '내 텔레그램으로 보내줘.' }, ctx);
  assert.equal(r.kind, 'approval', `확정됐는데 카드가 안 떴다: ${r.kind}`);
  // 카드는 사람 말(라벨)로 받는 곳을 말한다 — 실행 값(chat id)을 드러내지 않는다.
  const 카드 = r.pending?.[0];
  assert.ok(JSON.stringify(카드?.preview ?? {}).includes('오너'),
    `카드에 받는 곳이 없다: ${JSON.stringify(카드?.preview)}`);
  assert.equal(손.불린것.length, 0, '승인 전에 전송이 나갔다');
  // 승인 → 실행은 실행 값으로 나간다.
  const done = await runTurn({ approve: r.pendingId }, ctx);
  assert.equal(손.불린것.length, 1, '승인했는데 전송이 없다');
  assert.equal(손.불린것[0].target, '8601204821', `실행 값이 아니라 ${손.불린것[0].target} 로 보냈다`);
  assert.equal(손.불린것[0].text, '시험 문면');
  assert.ok(done.kind === 'reply' || done.kind === 'approval');
});

test('걸음 경로: 질문에는 실제 선택지가 실린다(이름을 지어내 맞히게 하지 않는다)', async () => {
  const 손 = 기록전송손();
  const r = await runTurn(
    { text: '이 내용 보내줘' },
    전송ctx(전송거는모델({ text: '시험 문면', target: '' }), 손,
      { 'telegram.send': [{ target: '111', label: '오너' }, { target: '222', label: '직원' }] }),
  );
  assert.equal(r.kind, 'clarify');
  assert.match(r.question ?? '', /오너/, `선택지가 없다: ${r.question}`);
  assert.match(r.question ?? '', /직원/);
});
