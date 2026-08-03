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
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

/** 지정한 도구 호출을 순서대로 내놓는 모델. 다 쓰면 말로 끝낸다(tool-steps 와 같은 하네스). */
function 걸음마다(계획) {
  let i = 0;
  return {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return {
        text: '', toolCalls: [
          { name: 'work.deliverable', args: {} },
          { name: 'work.deliverable', args: { output: 'chat' } },
        ],
      };
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
  const { ctx, 호출 } = 손과기록(root);
  // 계획 단계: read 견적서.md → 걸음 루프: write 견적서.md (사용자의 흔한 "읽고 고쳐줘").
  const r = await runTurn({ text: '해줘' }, ctx(걸음마다([
    파일({ action: 'read', path: '견적서.md' }),
    파일({ action: 'write', path: '견적서.md', text: '단가 1000원 · 수량 3 (정리)' }),
  ])));
  // 헌장(2026-08-03): 되돌릴 수 있는 쓰기는 자동이다. **재는 것은 그대로다** — 읽고 나서
  // 같은 자리에 쓰는 걸음이 "되풀이"로 차단되지 않는가.
  // **실행 사실로 잰다**: 지문에서 action 이 빠지면 read 와 write 가 같은 지문이 되어
  // write 가 조용히 차단되고, 턴은 그래도 `reply` 로 끝난다 — kind 만 보면 못 잡는다
  // (돌연변이 스윕이 이 구멍을 잡았다, 2026-08-03).
  assert.equal(r.kind, 'reply', `읽기→쓰기가 끝까지 걷지 못했다: kind=${r.kind}, reply=${r.reply ?? ''}`);
  const 쓰기 = 호출.filter((a) => a.action === 'write' && a.path === '견적서.md');
  assert.equal(쓰기.length, 1, `읽은 자리에 쓰는 걸음이 되풀이로 차단됐다(write ${쓰기.length}건)`);
  assert.equal(await readFile(join(root, '견적서.md'), 'utf8'), '단가 1000원 · 수량 3 (정리)',
    '쓰기가 차단돼 파일이 그대로다');
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
  const { ctx, 호출 } = 손과기록(root);
  let 도구응답 = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return 'FILE';
      if (!opts.tools?.length) return '정리했어요';
      도구응답 += 1;
      if (도구응답 === 1) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '견적서.md' } }] };
      if (도구응답 === 2) return { text: '내용을 확인했고 정리 방향을 잡았다.', toolCalls: [] };
      // 헌장 뒤에는 쓰기가 실제로 돌고 턴이 이어진다 — 쓴 다음에는 말로 끝낸다.
      // (예전엔 승인 카드에서 턴이 멈춰 이 뒤가 없었다.)
      if (도구응답 > 3) return { text: '정리본을 만들었어요.', toolCalls: [] };
      // **강제하지 않는다**(2026-08-03). `requiredTool` 은 모델에게서 "안 한다"는 선택지를
      // 뺏어, 낼 것이 없을 때 억지로 무언가를 만들게 한다(실측: 쓰레기 로그 파일이 완료 계약을
      // 충족시켰다). 재는 계약은 그대로다 — **미충족이면 파일 손을 다시 쥐여 주고 턴이 이어진다.**
      assert.ok(tc.unmetDeliverable, '계약이 아직 안 찼다는 사실을 줘야 모델이 이어간다');
      assert.equal(opts.tools?.[0]?.name, 'local.file', '미충족 완료 계약이 파일 손을 다시 주지 않았다');
      assert.ok(!opts.requiredTool, '고르는 것은 모델 몫이다 — 강제하면 없는 산출물을 지어낸다');
      assert.deepEqual(opts.tools[0].parameters.properties.action.enum, ['write'],
        '완료 계약이 write 영수증을 요구하는데 읽기 손까지 다시 열었다');
      assert.ok(opts.tools[0].parameters.required.includes('source'),
        '변환 산출물인데 원본 결합 근거를 요구하지 않았다');
      return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: '견적서-정리.md', text: '정리', source: '견적서.md' } }] };
    },
  };
  const r = await runTurn({ text: '해줘' }, ctx(model));
  // 헌장(2026-08-03) 뒤 되돌릴 수 있는 쓰기는 자동이다. **재는 계약은 그대로다** —
  // FILE 판단이면 쓰기 영수증까지 파일 손 안에서 계속 걷는가(위 콜백 단언 셋이 그 본체다).
  // 관측점을 카드에서 **실제 실행**으로 옮긴다 — 더 강한 증거다.
  assert.equal(r.kind, 'reply', `완료 계약이 쓰기까지 걷지 못했다(kind=${r.kind})`);
  const 쓰기 = 호출.filter((a) => a.action === 'write');
  assert.equal(쓰기.length, 1, `write 영수증이 정확히 한 번 서지 않았다(${쓰기.length}건)`);
  assert.equal(쓰기[0].path, '견적서-정리.md');
  assert.equal(쓰기[0].source, '견적서.md', '변환 산출물의 원본 결합 근거가 사라졌다');
});

test('산출물 의무: CHAT 판단이면 어떤 재확인도 일어나지 않는다(읽기 기본 무변화)', async () => {
  const root = await 임시루트();
  const { ctx } = 손과기록(root);
  let 도구응답 = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return {
        text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }],
      };
      if (!opts.tools?.length) return '정리했어요';
      도구응답 += 1;
      if (도구응답 === 1) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '견적서.md' } }] };
      return { text: '내용을 확인했고 정리 방향을 잡았다.', toolCalls: [] };
    },
  };
  await runTurn({ text: '해줘' }, ctx(model));
  assert.equal(도구응답, 2, `선언 없는 턴에 재확인이 갔다(도구 응답 ${도구응답}회)`);
});

test('대화 초안을 요청하고 파일 생성을 미룬 턴은 파일 이름을 되묻지 않는다', async () => {
  const root = await 임시루트();
  const { ctx, 호출 } = 손과기록(root);
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return 'CHAT';
      if (opts.tools?.length) return {
        text: '어떤 파일로 할까요? (파일 이름을 알려주세요)',
        toolCalls: [{ name: 'local.file', args: { action: 'read' } }],
      };
      assert.equal(tc.chatOutputContract, true, 'CHAT 판정이 최종 답 호출에 전달되지 않았다');
      return '체크리스트 초안을 대화에 보여드릴게요.';
    },
  };
  const r = await runTurn({
    text: '이 기준으로 실행 체크리스트 초안을 대화에 먼저 보여줘. 파일은 아직 만들지 마.',
  }, ctx(model));
  assert.equal(r.kind, 'reply');
  assert.match(r.reply, /체크리스트 초안/);
  assert.doesNotMatch(r.reply, /어떤 파일|파일 이름/);
  assert.equal(호출.length, 0, '대화 초안 요청이 파일 손을 실행했다');
});

test('앞선 읽기와 현재 저장이 함께 잡혀도 현재 파일의 write 본문을 보존한다', async () => {
  const root = await 임시루트();
  const { ctx } = 손과기록(root);
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.currentActionAssessment) return { text: '', toolCalls: [] }; // 구조 판정 불능 재현
      if (tc?.workContractAssessment) return 'FILE';
      if (opts.tools?.length) return {
        text: '',
        toolCalls: [
          { name: 'local.file', args: { action: 'read', path: '견적서.md' } },
          { name: 'local.file', args: { action: 'write', path: '행사운영-체크리스트.md', text: '실행 체크리스트' } },
        ],
      };
      return '저장할게요.';
    },
  };
  const runtime = ctx(model);
  const r = await runTurn({
    text: '방금 보여준 초안을 행사운영-체크리스트.md로 저장해줘.',
  }, runtime);
  // 헌장(2026-08-03) 뒤 되돌릴 수 있는 쓰기는 자동이라 봉인(pending)에 담기지 않는다.
  // **재는 계약은 그대로다** — 모델이 문맥에서 만든 본문이 실행까지 살아서 가는가.
  // 관측점을 승인 봉인에서 **실제 실행 인자**로 옮긴다(더 강한 증거: 본문이 없으면 빈 파일이 생긴다).
  assert.equal(r.kind, 'reply', `현재 저장 요청이 다시 확인으로 막혔다: ${r.reply ?? r.kind}`);
  const 만든것 = await readFile(join(root, '행사운영-체크리스트.md'), 'utf8');
  assert.equal(만든것, '실행 체크리스트', '모델이 문맥에서 만든 본문을 잃었다(빈 파일이 생겼다)');
});

test('현재 발화와 같은 write 후보가 둘이면 하나를 임의 선택하지 않는다', async () => {
  const root = await 임시루트();
  const { ctx } = 손과기록(root);
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.currentActionAssessment) return { text: '', toolCalls: [] };
      if (opts.tools?.length) return {
        text: '',
        toolCalls: [
          { name: 'local.file', args: { action: 'write', path: '결과.md', text: '첫째' } },
          { name: 'local.file', args: { action: 'write', path: '결과.md', text: '둘째' } },
        ],
      };
      return '확인할게요.';
    },
  };
  const { ctx: 기록, 호출 } = 손과기록(root);
  const r = await runTurn({ text: '결과.md로 저장해줘.' }, 기록(model));
  // 계약은 그대로다 — 코드가 둘 중 하나를 조용히 고르지 않고, 막다른 답으로 닫지도 않는다.
  assert.notEqual(r.kind, 'approval');
  assert.doesNotMatch(r.reply ?? '', /지금 할 일만/);
  // **본문 없는 쓰기가 조용히 돌면 안 된다**(감사 의심 D5, 2026-08-03). 헌장 전에는 카드가
  // 이 상태를 사람 앞에 세웠다. 지금은 아무도 못 보므로 여기서 잡는다 — 빈 파일이 생기면
  // 사용자는 "저장했어요"를 듣고 빈 것을 받는다.
  const 빈쓰기 = 호출.filter((a) => a.action === 'write' && !String(a.text ?? '').trim());
  assert.equal(빈쓰기.length, 0, `본문 없는 쓰기가 실행됐다 — 빈 파일이 조용히 생긴다: ${JSON.stringify(빈쓰기)}`);
});

test('산출물 의무: 모델이 처음부터 write 를 골라도 완료 형태를 독립 판단한 뒤 승인에 오른다', async () => {
  const root = await 임시루트();
  const { ctx } = 손과기록(root);
  let 도구응답 = 0; let 판단수 = 0; let 미충족재요청 = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) { 판단수 += 1; return 'FILE'; }
      if (tc?.unmetDeliverable) 미충족재요청 += 1;
      if (!opts.tools?.length) return '정리했어요';
      도구응답 += 1;
      if (도구응답 === 1) {
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: '정리.md', text: '정리' } }] };
      }
      return { text: '다 만들었다.', toolCalls: [] };
    },
  };
  const r = await runTurn({ text: '해줘' }, ctx(model));
  // 헌장(2026-08-03) 뒤 되돌릴 수 있는 쓰기는 자동이다. **재는 계약은 그대로다** —
  // 모델의 write 선택은 후보일 뿐이고 **완료 형태를 독립으로, 정확히 한 번** 판단한다.
  assert.equal(r.kind, 'reply');
  assert.equal(판단수, 1, `완료 형태 판단이 중복되거나 빠졌다(${판단수})`);
  const 만든것 = await readFile(join(root, '정리.md'), 'utf8');
  assert.match(만든것, /정리/, '쓰기가 실제로 실행되지 않았다');
  // **관측(결함으로 승격하지 않는다):** 쓰기가 성공했는데도 미충족 재요청이 한 번 더 뜬다.
  // 헌장 전에는 쓰기가 승인에서 멈춰 이 자리에 도달하지 않았다. 완료 계약이 생성되는 시점과
  // 자동 실행된 쓰기 영수증의 순서가 어긋나는 것으로 보이나, 재현 표본이 하나이고 사용자
  // 결과(파일 생성·최종 답)는 정상이다. **라이브 관통에서 다시 본다** — 모델 왕복이 한 번
  // 늘어나는 것은 사용자가 기다리는 시간이므로 M2 라이브 회차의 관찰 항목이다.
  assert.ok(미충족재요청 <= 1, `미충족 재요청이 반복된다(${미충족재요청})`);
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

test('문맥에서 만들 파생 파일은 본문을 다시 받아쓰게 하지 않고 write 승인으로 이어진다', async () => {
  const root = await 임시루트();
  const { ctx } = 손과기록(root);
  let derivedCalls = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return 'FILE';
      if (tc?.unmetDeliverable) {
        derivedCalls += 1;
        // 헌장(2026-08-03) 뒤에는 쓰기가 실제로 돌고 턴이 이어진다 — 한 번 쓴 다음에는 말로 끝낸다.
        // (예전엔 승인 카드에서 턴이 멈춰 이 뒤가 없었다.)
        if (derivedCalls > 1) return { text: '정리본을 만들었어요.', toolCalls: [] };
        assert.deepEqual(opts.tools[0].parameters.properties.action.enum, ['write']);
        assert.ok(opts.tools[0].parameters.required.includes('source'));
        return { text: '', toolCalls: [{
          name: 'local.file',
          args: {
            action: 'write', path: '고객안내-확정.md',
            text: '# 고객 안내\n\n배송은 오후 3시에 마감됩니다.', source: '견적서.md',
          },
        }] };
      }
      if (!opts.tools?.length) return '공지문을 만들게요.';
      return { text: '공지문을 만들게요.', toolCalls: [] };
    },
  };
  const r = await runTurn({
    text: '방금 읽은 최신 내용을 공지문으로 다듬어서 고객안내-확정.md 파일로 만들어줘',
  }, ctx(model));
  assert.ok(derivedCalls >= 1, '문맥 기반 본문 생성을 위한 쓰기 선택을 요청하지 않았다');
  // 관측(§ 위 '처음부터 write' 검사와 같은 자리): 쓰기가 성공했는데도 미충족 재요청이 한 번 더 온다.
  // 사용자 결과는 정상(파일 생성·최종 답)이나 모델 왕복이 하나 는다 — 라이브 회차에서 다시 본다.
  assert.ok(derivedCalls <= 2, `미충족 재요청이 반복된다(${derivedCalls})`);
  // 헌장(2026-08-03) 뒤 되돌릴 수 있는 쓰기는 자동이다. **재는 계약은 그대로다** —
  // 본문을 사용자에게 다시 받아쓰게 하지 않고 말로만 끝내지도 않는다. 이제 그 증거는
  // 카드가 아니라 **실제로 만들어진 파생 파일**이다(더 강한 증거).
  assert.equal(r.kind, 'reply',
    `본문을 다시 받아쓰게 하거나 말로만 끝냈다(kind=${r.kind}, question=${r.question ?? ''})`);
  const 만든것 = await readFile(join(root, '고객안내-확정.md'), 'utf8');
  assert.match(만든것, /오후 3시/, '파생 파일이 실제로 만들어지지 않았다');
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

// ── 팀원 실사용 차단 루프 (2026-08-03) ─────────────────────────────────
//
// 실측: 팀원이 "지금까지 나눈 대화내용 txt 파일로 저장해서 나에게 공유해줘" 를 두 번 보냈고,
// 두 번 다 같은 문장으로 막혔다 — "앞선 미완료 작업과 지금 요청이 함께 잡혔어요.
// 지금 할 일만 한 번 더 말씀해 주세요."
//
// 이건 되묻기가 아니라 **막다른 답**이다. 사용자가 같은 말을 다시 해도 같은 자리로 돌아온다.
// 이 경계의 목적은 "지난 미완료 행동을 지금 실행하지 않는 것"이었고, 그 목적은 지난 것을
// 버리는 것으로 이미 달성된다. 사람에게 되묻는 것은 목적이 아니었다.
test('판정이 흔들려도 같은 문장으로 두 번 막지 않는다 — 막다른 답 금지', async () => {
  const root = await 임시루트();
  const { ctx } = 손과기록(root);
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.currentActionAssessment) return { text: '', toolCalls: [] };  // 구조 판정 불능
      if (tc?.workContractAssessment) return 'FILE';
      if (opts.tools?.length) return {
        text: '',
        // 지난 대화의 미완료 행동 + 이번 요청이 함께 잡힌 실제 모양
        toolCalls: [
          { name: 'local.file', args: { action: 'read', path: '견적서.md' } },
          { name: 'local.file', args: { action: 'write', path: '대화기록.txt', text: '지금까지의 대화' } },
        ],
      };
      return '정리했어요.';
    },
  };
  // 사용자 문장에 파일 **이름이 없다** — 팀원이 실제로 쓴 그대로다.
  const 말 = '지금까지 나눈 대화내용 txt 파일로 저장해서 나에게 공유해줘.';
  const 첫번째 = await runTurn({ text: 말 }, ctx(model));
  assert.doesNotMatch(첫번째.reply ?? '', /지금 할 일만 한 번 더/,
    `첫 요청이 막다른 답으로 닫혔다: ${첫번째.reply ?? 첫번째.kind}`);

  const 두번째 = await runTurn({ text: 말 }, ctx(model));
  assert.doesNotMatch(두번째.reply ?? '', /지금 할 일만 한 번 더/,
    '같은 문장을 다시 말해도 같은 자리로 돌아왔다 — 사용자가 빠져나갈 길이 없다');
});

// ── 판정 불능 폴백이 **모델의 호출 그대로**를 쓴다 (돌연변이 #293 반대시험) ────
//
// 행동 귀속 판정(`work.current_actions`)이 흔들리면 폴백이 둘이다:
//   ① `currentFileCallFromText` — 현재 발화가 action+path 를 품고 그와 맞는 모델 호출이
//      하나뿐이면 **그 호출 객체 그대로** 쓴다(모델이 문맥에서 채운 `source`·본문이 살아남는다).
//   ② 그 뒤의 텍스트 재구성 — 발화를 파싱해 `{action, path, text}` 만으로 호출을 새로 만든다.
// ①을 없애도 ②가 받아 주므로 **실행 여부·kind 로는 차이가 안 보인다.** 차이는
// **텍스트가 표현할 수 없는 인자**에서만 난다 — `source`(변환 원본 결합 근거)가 그것이다.
// 그래서 이 검사는 실행 인자의 `source` 를 본다. 스윕 #293 이 오래 안 물리던 이유가 이것이다.
test('판정이 흔들려도 모델 호출의 원본 결합 근거(source)가 살아남는다(#293)', async () => {
  const root = await 임시루트();
  const { ctx, 호출 } = 손과기록(root);
  const model = {
    async respond(tc, opts = {}) {
      // 귀속 판정을 **일부러 흔든다** — 폴백 경로로 보낸다.
      if (opts.requiredTool === 'work.current_actions') return { text: '', toolCalls: [] };
      if (tc?.workContractAssessment) return 'FILE';
      if (!opts.tools?.length) return '적었어요';
      if (tc?.unmetDeliverable) return { text: '적었어요.', toolCalls: [] };
      // 과거 미완료 삭제 + 현재 요청 쓰기가 함께 잡힌 상황.
      return { text: '', toolCalls: [
        { name: 'local.file', args: { action: 'delete', path: '견적서-최종.md' } },
        { name: 'local.file', args: { action: 'write', path: '정리본.md', text: '단가 1000원', source: '견적서.md' } },
      ] };
    },
  };
  await runTurn({ text: "정리본.md 에 '단가 1000원' 이라고 적어줘" }, ctx(model));
  const 쓰기 = 호출.filter((a) => a.action === 'write');
  assert.equal(쓰기.length, 1, `현재 발화의 쓰기 하나만 서야 한다(${쓰기.length}건)`);
  assert.equal(쓰기[0].source, '견적서.md',
    '판정이 흔들리자 모델 호출을 버리고 텍스트로 재구성했다 — 원본 결합 근거가 사라진다');
  assert.ok(!호출.some((a) => a.action === 'delete'), '과거 행동이 현재 턴에 섞였다');
});
