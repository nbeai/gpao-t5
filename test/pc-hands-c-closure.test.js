// PC 손발 배치 1 · C 감사 종결 반대시험 — 턴 수준 (F3.2 · F6.1 · F6.2)
//
// C 감사(에이전트 C, 대상 a059dca)가 찾은 세 결함을 **턴 경로 그대로** 재현한다.
//   F3.2/F6.4  같은 파일을 읽고 나서 쓰는 정상 걸음이 "같은 일 되풀이"로 차단된다
//              (지문에 action 이 없어서 read 와 write 가 같은 지문이 된다).
//   F6.1       사용자 턴 하나 안의 걸음마다 turnNo 가 +1 되어, 같은 턴 안에서
//              방금 다룬 대상이 스스로 "N턴 전"으로 늙는다.
//   F6.2       걸음 루프의 실패가 workingState.blocked 에 남지 않아, 다음 턴이
//              실패 사실과 다음 길을 이어받지 못한다(계획 단계 실패만 남고 있었다).
// 첫 도구는 계획 단계에서, 나머지는 걸음 루프에서 돈다 — 결함은 걸음 루프 쪽에 있으므로
// 시나리오가 반드시 걸음 루프를 밟게 짠다. 수정 전 실패를 실측했다(2026-08-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

/** 지정한 도구 호출을 순서대로 내놓는 모델. 다 쓰면 말로 끝낸다(tool-steps 와 같은 하네스). */
function 걸음마다(계획) {
  let i = 0;
  return {
    async respond(_tc, opts = {}) {
      if (!opts.tools?.length) return '정리했어요';
      if (i >= 계획.length) return { text: '다 했어요', toolCalls: [] };
      const 걸음 = 계획[i]; i += 1;
      return { text: '', toolCalls: [걸음] };
    },
  };
}

const 파일 = (args) => ({ name: 'local.file', args });

async function 임시루트() {
  const root = await mkdtemp(join(tmpdir(), 'gpao-t5-c종결-'));
  await writeFile(join(root, '견적서.md'), '단가 1000원\n수량 3\n', 'utf8');
  await writeFile(join(root, '견적서-최종.md'), '단가 1200원\n수량 3\n', 'utf8');
  return root;
}

/**
 * 실행 사실은 **도구 경계에서 직접 센다.** 사용자용 summary 문구나 ledger 투영 개수는
 * 실행의 대용물이 아니다(오너 계측 지적 2026-08-01 — confirmed 는 문자열 투영이라
 * 문구 대조가 허공을 쟀고, 그 단언은 0건에서도 조용히 통과할 수 있었다).
 */
const 손과기록 = (root) => {
  const tool = makeLocalFileTool({ roots: [root] });
  const 호출 = [];
  return {
    호출,
    ctx: (model) => ({
      env: demoEnv(),
      model,
      tools: demoTools({
        localFile: { ...tool, handler: async (args) => { 호출.push(args ?? {}); return tool.handler(args); } },
      }),
    }),
  };
};

// ── F3.2/F6.4 · 읽고 나서 쓰는 걸음은 되풀이가 아니다 ───────────────────
test('같은 파일을 읽은 뒤 같은 자리에 쓰는 걸음이 되풀이로 차단되지 않는다(F3.2)', async () => {
  const root = await 임시루트();
  const { ctx } = 손과기록(root);
  // 계획 단계: read 견적서.md → 걸음 루프: write 견적서.md (사용자의 흔한 "읽고 고쳐줘").
  const r = await runTurn({ text: '해줘' }, ctx(걸음마다([
    파일({ action: 'read', path: '견적서.md' }),
    파일({ action: 'write', path: '견적서.md', text: '단가 1000원 · 수량 3 (정리)' }),
  ])));
  // 쓰기는 승인 카드까지 가야 한다 — 되풀이 차단으로 멈추면 카드 자체가 안 뜬다.
  assert.equal(r.kind, 'approval',
    `읽기→쓰기가 승인에 도달하지 못했다: kind=${r.kind}, reply=${r.reply ?? ''}`);
});

test('같은 파일에 정확히 같은 읽기를 되풀이하는 것은 여전히 막는다(F3.1 보존)', async () => {
  const root = await 임시루트();
  const { ctx, 호출 } = 손과기록(root);
  await runTurn({ text: '해줘' }, ctx(걸음마다([
    파일({ action: 'read', path: '견적서.md' }),
    파일({ action: 'read', path: '견적서.md' }),
    파일({ action: 'read', path: '견적서.md' }),
  ])));
  const 읽기 = 호출.filter((a) => a.action === 'read' && a.path === '견적서.md');
  assert.equal(읽기.length, 1, `같은 읽기가 ${읽기.length}번 돌았다 — 되풀이 차단이 무너졌다`);
});

test('인자 키 순서만 달라도 같은 일이면 같은 지문이다(F3.1 정규화)', async () => {
  const root = await 임시루트();
  const { ctx, 호출 } = 손과기록(root);
  await runTurn({ text: '해줘' }, ctx(걸음마다([
    파일({ action: 'read', path: '견적서.md' }),
    파일({ path: '견적서.md', action: 'read' }),
  ])));
  const 읽기 = 호출.filter((a) => a.action === 'read' && a.path === '견적서.md');
  assert.equal(읽기.length, 1, '키 순서가 다르다고 다른 지문이 됐다');
});

// ── F6.1 · 한 사용자 턴 = turnNo 하나 ───────────────────────────────────
test('걸음이 여러 개라도 사용자 턴 하나에 turnNo 는 한 번만 는다(F6.1)', async () => {
  const root = await 임시루트();
  const { ctx, 호출 } = 손과기록(root);
  // 계획 read + 걸음 read(다른 파일) + 걸음 list — 서로 다른 지문이라 셋 다 실제로 돈다.
  const r = await runTurn({ text: '해줘' }, ctx(걸음마다([
    파일({ action: 'read', path: '견적서.md' }),
    파일({ action: 'read', path: '견적서-최종.md' }),
    파일({ action: 'list' }),
  ])));
  // 실행 사실 선행 단언 — 도구 경계에서 실제 호출을 셌다. 걸음 루프(둘째·셋째)가 안 돌면
  // 이 검사는 결함 자리에 도달하지 못한 것이므로 여기서 멈춘다.
  assert.equal(호출.length, 3, `걸음이 실제로 돌지 않았다(호출 ${호출.length}건) — 시나리오가 결함 자리를 못 밟는다`);
  assert.equal(r.workingState?.turnNo, 1,
    `사용자 턴 1개에 turnNo=${r.workingState?.turnNo} — 파생 호출이 같은 턴의 기억을 늙게 만든다`);
});

test('걸음이 늘어도 이번 턴에 다룬 대상은 "방금"으로 남는다(F6.1 시제)', async () => {
  const root = await 임시루트();
  const { ctx } = 손과기록(root);
  const r = await runTurn({ text: '해줘' }, ctx(걸음마다([
    파일({ action: 'read', path: '견적서.md' }),
    파일({ action: 'read', path: '견적서-최종.md' }),
    파일({ action: 'list' }),
  ])));
  const 사실 = r.contextShown ?? '';
  assert.ok(!/\d+턴 전/.test(사실),
    `같은 턴 안의 사실이 이미 늙었다: ${사실}`);
});

// ── F6.2 · 걸음 실패가 blocked 로 이어진다 ──────────────────────────────
test('걸음 루프의 읽기 실패가 workingState.blocked 에 남는다(F6.2)', async () => {
  const root = await 임시루트();
  const { ctx, 호출 } = 손과기록(root);
  // 계획 단계는 성공(read) — 실패는 **걸음 루프에서** 난다. 이게 H09 의 정상 모양이다.
  const r = await runTurn({ text: '해줘' }, ctx(걸음마다([
    파일({ action: 'read', path: '견적서.md' }),
    파일({ action: 'read', path: '없는-보고서.md' }),
  ])));
  assert.equal(호출.length, 2, `실패 걸음이 실제로 돌지 않았다(호출 ${호출.length}건)`);
  assert.ok(r.workingState?.blocked,
    '걸음 실패가 blocked 에 없다 — 다음 턴이 실패 이유와 다음 길을 이어받지 못한다');
});

test('실패 뒤 실제로 성공하면 blocked 는 풀린다(거짓 막힘 금지)', async () => {
  const root = await 임시루트();
  const { ctx } = 손과기록(root);
  const r = await runTurn({ text: '해줘' }, ctx(걸음마다([
    파일({ action: 'read', path: '없는-보고서.md' }),
    파일({ action: 'read', path: '견적서.md' }),
  ])));
  assert.equal(r.workingState?.blocked, undefined,
    `되는 길을 찾았는데 막혔다고 남았다: ${r.workingState?.blocked}`);
});


// ── 산출물 완료 계약 ────────────────────────────────────────────────────────
// 사용자 문구를 코드가 맞히지 않는다. 전용 모델 판단(FILE/CHAT)이 ActionPlan 에 들어가고,
// OS 는 실제 local.file write 영수증만 완료로 인정한다.
test('산출물 의무: FILE 판단이면 쓰기 영수증까지 파일 손 안에서 계속 걷는다', async () => {
  const root = await 임시루트();
  const { ctx } = 손과기록(root);
  let 도구응답 = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return 'FILE';
      if (!opts.tools?.length) return '정리했어요';
      도구응답 += 1;
      if (도구응답 === 1) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '견적서.md' } }] };
      if (도구응답 === 2) return { text: '내용을 확인했고 정리 방향을 잡았다.', toolCalls: [] };
      assert.equal(opts.requiredTool, 'local.file', '미충족 완료 계약이 파일 손을 구조로 요구하지 않았다');
      assert.deepEqual(opts.tools[0].parameters.properties.action.enum, ['write'],
        '완료 계약이 write 영수증을 요구하는데 읽기 손까지 다시 열었다');
      assert.ok(opts.tools[0].parameters.required.includes('source'),
        '변환 산출물인데 원본 결합 근거를 요구하지 않았다');
      return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: '견적서-정리.md', text: '정리', source: '견적서.md' } }] };
    },
  };
  const r = await runTurn({ text: '해줘' }, ctx(model));
  assert.equal(r.kind, 'approval',
    `선언-영수증 불일치가 실제 쓰기로 이어지지 않았다(kind=${r.kind})`);
});

test('산출물 의무: CHAT 판단이면 어떤 재확인도 일어나지 않는다(읽기 기본 무변화)', async () => {
  const root = await 임시루트();
  const { ctx } = 손과기록(root);
  let 도구응답 = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return 'CHAT';
      if (!opts.tools?.length) return '정리했어요';
      도구응답 += 1;
      if (도구응답 === 1) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '견적서.md' } }] };
      return { text: '내용을 확인했고 정리 방향을 잡았다.', toolCalls: [] };
    },
  };
  await runTurn({ text: '해줘' }, ctx(model));
  assert.equal(도구응답, 2, `선언 없는 턴에 재확인이 갔다(도구 응답 ${도구응답}회)`);
});

test('산출물 의무: 모델이 처음부터 write 를 고르면 추가 판단·재확인 없이 승인 경로에 오른다', async () => {
  const root = await 임시루트();
  const { ctx } = 손과기록(root);
  let 도구응답 = 0; let 재확인수 = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) throw new Error('write 호출 자체가 완료 계약인데 다시 판단했다');
      if (tc?.unmetDeliverable) 재확인수 += 1;
      if (!opts.tools?.length) return '정리했어요';
      도구응답 += 1;
      if (도구응답 === 1) {
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: '정리.md', text: '정리' } }] };
      }
      return { text: '다 만들었다.', toolCalls: [] };
    },
  };
  const r = await runTurn({ text: '해줘' }, ctx(model));
  // 쓰기는 승인 카드가 곧 결과다 — 선언이 계획으로 이어졌으니 재확인 대조는 돌지 않는다.
  assert.equal(r.kind, 'approval');
  assert.equal(재확인수, 0, `산출물이 계획에 있는데도 재확인이 갔다(${재확인수})`);
});

test('산출물 의무: FILE 판단 뒤에도 안 만들면 완료로 기록하지 않는다(거짓 완료 금지)', async () => {
  const root = await 임시루트();
  const { ctx } = 손과기록(root);
  let 도구응답 = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return 'FILE';
      if (!opts.tools?.length) return '정리했어요';
      도구응답 += 1;
      if (도구응답 === 1) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '견적서.md' } }] };
      return { text: '방향만 잡았다.', toolCalls: [] };
    },
  };
  const r = await runTurn({ text: '해줘' }, ctx(model));
  assert.equal(r.kind, 'reply');
  assert.notEqual(r.workingState?.recentOutcome?.status, 'completed',
    '산출물 의무가 미이행인데 완료로 남았다 — 다음 턴이 이어갈 자리를 잃는다');
});

test('산출물 의무: 첫 응답이 도구를 고르지 않아도 Intent 의 파일 작업이면 판단을 우회하지 않는다', async () => {
  const root = await 임시루트();
  const { ctx } = 손과기록(root);
  let contractCalls = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) { contractCalls += 1; return 'FILE'; }
      if (!opts.tools?.length) return '정리본을 만들 예정입니다.';
      return { text: '정리본을 만들 예정입니다.', toolCalls: [] };
    },
  };
  const r = await runTurn({ text: '견적서를 읽어서 별도 정리본 파일로 만들어줘' }, ctx(model));
  assert.equal(contractCalls, 1, '모델이 파일 손을 안 골랐다는 이유로 완료 계약 판단을 건너뛰었다');
  assert.notEqual(r.workingState?.recentOutcome?.status, 'completed');
});

test('산출물 의무: 전용 판단 형식이 두 번 깨지면 CHAT 으로 꾸미지 않고 완료를 보류한다', async () => {
  const root = await 임시루트();
  const { ctx } = 손과기록(root);
  let contractCalls = 0; let 도구응답 = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) { contractCalls += 1; return '아마 파일일 것 같아요'; }
      if (!opts.tools?.length) return '확인했어요.';
      도구응답 += 1;
      if (도구응답 === 1) {
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '견적서.md' } }] };
      }
      return { text: '견적서를 확인했어요.', toolCalls: [] };
    },
  };
  const r = await runTurn({ text: '견적서를 읽어서 별도 정리본 파일로 만들어줘' }, ctx(model));
  assert.equal(contractCalls, 2);
  assert.notEqual(r.workingState?.recentOutcome?.status, 'completed',
    '판단 불능을 CHAT 으로 꾸며 완료 처리했다');
});
