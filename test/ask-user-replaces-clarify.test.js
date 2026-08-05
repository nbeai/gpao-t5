// **묻는 일을 모델에게 돌려준다 — 그리고 질문이 늘지 않는다.**
//
// 오너가 착수 조건에 못 박았다(인수인계 §6-5):
// > `ask_user` 를 모델 도구로. **단 계약에 "런타임 `clarify` 를 대체했고 질문 총량이 안
// > 늘었다"를 박아라. 안 그러면 질문 수도꼭지가 된다.**
// > *"새 손이 자동성을 갉아먹는 가장 흔한 방식이 그거다."*
//
// 왜 필요한가 — 지금은 **런타임이 스스로 묻는다.** `turn.js` 세 자리에서 `kind:'clarify'` 를
// 만들고 문장도 커널이 쓴다. 그 사고가 파일에 그대로 적혀 있다:
//   `"그거 정리해줘"` → clarify(하드코딩 문장) / 정규식 단어 하나로 하나는 되묻고 하나는
//   완벽히 답했다. **모델은 할 수 있었다.**
// 커널이 프로세스 대신 말하는 자리이고(§1 소유의 분할), 걷어야 하는 병이다.
//
// ── 걷어내되 자동성을 갉지 않는다 ────────────────────────────────────────
// 손을 하나 더 주면 모델이 **더 자주 물 수 있다.** 그게 자동성 헌장을 정면으로 갉는다
// (§3.1 — 묻는 것은 넷뿐 · 마찰을 늘리는 변경은 개선이 아니라 실패).
// 그래서 이 파일이 재는 것은 "손이 생겼다"가 아니라 **총량이 안 늘었다**이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { splitModelControlCalls, modelSchemasFor } from '../src/kernel/l2-plan/model-control.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';

async function 무대(응답) {
  const dir = await mkdtemp(join(tmpdir(), 'ask-user-'));
  await writeFile(join(dir, '정산.csv'), '항목,금액\n임대료,500000\n');
  const 호출 = [];
  const model = { async respond(tc, opts = {}) { 호출.push({ tc, opts }); return 응답(tc, opts); } };
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  return { ctx: { env: demoEnv(), tools: demoTools({ localFile }), model }, 호출, dir };
}

// ── ① 채널이 실제로 서고 모델에게 보인다 ──────────────────────────────────
test('ask.user 가 모델에게 실린다 — 안 보이면 부를 수 없다', () => {
  const 이름 = modelSchemasFor(buildSelfState(demoEnv()), []).map((s) => s.name);
  assert.ok(이름.includes('ask.user'), `모델이 받은 목록에 없다: ${이름.join(', ')}`);
});

test('분리 경계가 ask.user 를 실행 후보로 흘리지 않는다 — 통제이지 손이 아니다', () => {
  const 분리 = splitModelControlCalls([
    { name: 'ask.user', args: { question: '어느 폴더요?', options: [{ label: '다운로드' }, { label: '문서' }] } },
    { name: 'local.file', args: { action: 'list' } },
  ]);
  assert.equal(분리.askUser?.question, '어느 폴더요?');
  assert.deepEqual(분리.rest.map((c) => c.name), ['local.file'], '통제 호출이 실행 경로로 샜다');
});

test('빈 질문·선택지 부족은 조용히 버린다 — 못 쓸 질문을 사용자에게 내보내지 않는다', () => {
  assert.equal(splitModelControlCalls([{ name: 'ask.user', args: { question: '  ' } }]).askUser, null);
  assert.equal(splitModelControlCalls([{ name: 'ask.user', args: { question: '뭐요?', options: [{ label: '하나뿐' }] } }]).askUser, null,
    '선택지가 하나면 고르는 게 아니라 떠넘기는 것이다');
});

// ── ② 대체: 모델이 물으면 런타임은 안 묻는다 ──────────────────────────────
test('모델이 물으면 그 질문이 나간다 — 커널이 자기 문장으로 갈아치우지 않는다', async () => {
  const { ctx } = await 무대((tc, o) => (o.tools?.length
    ? { text: '', toolCalls: [{ name: 'ask.user', args: {
      question: '어느 파일을 말씀하시는 걸까요?',
      options: [{ label: '정산.csv', why: '방금 폴더에서 본 것' }, { label: '다른 파일' }],
    } }] }
    : '알겠습니다.'));
  const r = await runTurn({ text: '그거 정리해줘' }, ctx);
  assert.equal(r.kind, 'clarify');
  assert.equal(r.question, '어느 파일을 말씀하시는 걸까요?', '모델의 문장이 아니라 커널 문장이 나갔다');
  assert.equal(r.options?.length, 2, '고를 것을 안 주면 사용자가 다시 문장을 써야 한다');
});

test('**한 턴에 질문은 최대 하나** — 모델이 물었으면 런타임 되묻기가 또 안 나간다', async () => {
  const { ctx } = await 무대((tc, o) => (o.tools?.length
    ? { text: '', toolCalls: [
      { name: 'ask.user', args: { question: '어느 파일이요?', options: [{ label: '가' }, { label: '나' }] } },
      // 같은 턴에 파일 손도 골랐다 — 예전이면 런타임이 대상 모호로 자기 질문을 또 만들었다.
      { name: 'local.file', args: { action: 'read' } },
    ] }
    : '알겠습니다.'));
  const r = await runTurn({ text: '그거 정리해줘' }, ctx);
  assert.equal(r.kind, 'clarify');
  assert.equal(r.question, '어느 파일이요?', '런타임 질문이 모델 질문을 밀어냈다 — 두 번 묻는 자리다');
});

// ── ③ 총량: 안 물으면 옛날 그대로 ────────────────────────────────────────
// **이게 오너가 박으라고 한 칸이다.** 손이 생겼다고 질문이 늘면 그건 개선이 아니라 실패다.
test('모델이 안 물으면 질문이 0이다 — 손이 생겼다고 묻기 시작하지 않는다', async () => {
  const { ctx } = await 무대((tc, o) => (o.tools?.length ? { text: '', toolCalls: [] } : '많이 힘드셨겠어요.'));
  const r = await runTurn({ text: '요즘 가게가 너무 힘들다' }, ctx);
  assert.equal(r.kind, 'reply', `대화 턴이 질문으로 끝났다(${r.kind}) — 질문 수도꼭지가 열렸다`);
  assert.equal(r.question, undefined);
});

test('묻지 않고 할 수 있으면 안 묻는다 — 채널이 있어도 자동이 먼저다', async () => {
  const { ctx } = await 무대((tc, o) => (o.tools?.length
    ? { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '정산.csv' } }] }
    : '정산.csv 읽었어요.'));
  const r = await runTurn({ text: '정산.csv 읽어줘' }, ctx);
  assert.notEqual(r.kind, 'clarify', '할 수 있는데 물었다 — 자동성 헌장이 갉인다');
});
