import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fallbackReplyFrom } from '../src/kernel/turn.js';

const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');

test('성공 영수증이 있으면 설명 실패를 사용자 재요청으로 바꾸지 않는다', () => {
  const reply = fallbackReplyFrom([{
    failureState: 'none',
    userSafeSummary: '정산_요약.txt를 만들었어요.',
  }]);
  assert.match(reply, /정산_요약/);
  assert.doesNotMatch(reply, /다시.*말씀/);
});

test('기본 스마트 승인은 카드에 모드 설명을 반복하지 않는다', () => {
  assert.doesNotMatch(html, /smart:\s*['"]스마트['"]/, '기본 상태를 매 승인마다 설명한다');
});

test('승인 카드는 별도 봇 말풍선 없이 현재 행동 하나로 말한다', () => {
  const branch = html.slice(html.indexOf("if (r.kind === 'approval')"), html.indexOf("const box = turnBox();", html.indexOf("if (r.kind === 'approval')") + 30));
  assert.doesNotMatch(branch, /r\.reply/, '승인 카드 앞에 같은 내용을 답 말풍선으로 반복한다');
});

test('모델 답이 있으면 복구 문장을 답 뒤에 자동으로 덧붙이지 않는다', () => {
  assert.match(html, /r\.reply\?\.trim\(\)\s*\?\s*r\.reply\s*:\s*\(r\.nextSafeAction/);
});

test('일반 merge 후속은 조용히 합치고 실제 interrupt만 상태로 알린다', () => {
  assert.match(html, /r\.followUp\?\.decision\s*===\s*['"]interrupt['"]/);
});

// ── P90-2(2026-08-02 실측) · 내부 통제 이름이 스트리밍 조각을 타고 새지 않는다 ──
//
// 라이브 24개 답 중 3개(12.5%)가 이렇게 시작했다:
//   `memory.cite: [현재 합의] 앞으로 답변은 항상 표로 정리해줘.`
// 사용자에게 내부 통제 채널 이름이 그대로 나갔다.
//
// 차단 장치(`userFacingModelText`)는 최종 답에 붙어 있고 정규식도 맞다. 뚫린 자리는
// **스트리밍 조각**이다: 모델이 접두어를 조각으로 흘리면 `pv.shown` 에 오염된 채 쌓이고,
// 정제된 최종 답은 그 조각으로 시작하지 않으므로 `미리보기정렬` 이 둘을 이어 붙이거나
// 조각 쪽을 그대로 돌려준다. 화면에 이미 나간 것을 되돌릴 수는 없으니 **조각이 쌓이는
// 자리에서 같은 경계를 지나야 한다.**
//
// 계약: 사용자에게 나가는 텍스트는 조각이든 최종이든 **같은 사용자면 경계**를 지난다.
// (문구 규칙을 새로 만들지 않는다 — 이미 있는 INTERNAL_CONTROL_PREFIX 하나를 공유한다.)
test('P90-2: 통제 접두어는 스트리밍 조각에서도 사용자에게 나가지 않는다', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { demoEnv, demoTools } = await import('../src/surface/demo-context.js');
  const 조각 = [];
  // 실측 그대로 — 모델이 통제 접두어를 조각으로 흘리고 최종 텍스트에도 담는다.
  const 새는모델 = {
    async respond(_tc, opts = {}) {
      const 전문 = 'memory.cite: [현재 합의] 앞으로 답변은 항상 표로 정리해줘.\n\n3월 매출은 820만원이에요.';
      if (opts.onDelta) {
        for (const piece of ['memory.cite: [현재 합의] ', '앞으로 답변은 항상 표로 정리해줘.\n\n', '3월 매출은 820만원이에요.']) {
          await opts.onDelta(piece);
        }
      }
      return 전문;
    },
  };
  const r = await runTurn({ text: '3월 매출 알려줘' }, {
    env: demoEnv(), tools: demoTools(), model: 새는모델,
    onAnswerDelta: (t) => { 조각.push(t); },
  });

  assert.doesNotMatch(String(r.reply ?? ''), /memory\.(cite|propose|correction|withdraw)\s*:/i,
    `최종 답에 내부 통제 이름이 남았다: ${String(r.reply ?? '').slice(0, 80)}`);
  assert.doesNotMatch(조각.join(''), /memory\.(cite|propose|correction|withdraw)\s*:/i,
    `화면에 흘러간 조각에 내부 통제 이름이 있었다: ${조각.join('').slice(0, 80)}`);
  assert.match(String(r.reply ?? ''), /820만원/, '내용은 그대로 남아야 한다');
});

// ── 스트리밍이 없는 경로에도 같은 경계가 선다 ────────────────────────────────
//
// 위 검사는 `onAnswerDelta` 를 준다. 그러면 조각이 정제되어 쌓이고 정렬이 그 누적을
// 돌려주므로, **최종 답 쪽 경계를 뜯어내도 통과한다**(HRT-ST-002 추출 중 변이로 확인).
// 그런데 채널·CLI 처럼 스트리밍이 없는 경로에서는 정렬이 모델 원문을 그대로 통과시킨다.
// 같은 사실은 같은 경계를 지나야 한다 — 표면마다 다른 현실을 보게 하지 않는다.
test('스트리밍 없는 경로에서도 통제 접두어가 최종 답에 남지 않는다', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { demoEnv, demoTools } = await import('../src/surface/demo-context.js');
  const 새는모델 = {
    async respond() { return 'memory.cite: [현재 합의] 3월 매출은 820만원이에요.'; },
  };
  const r = await runTurn({ text: '3월 매출 알려줘' }, {
    env: demoEnv(), tools: demoTools(), model: 새는모델,   // onAnswerDelta 없음 — 스트리밍 안 함
  });
  assert.doesNotMatch(String(r.reply ?? ''), /memory\.(cite|propose|correction|withdraw)\s*:/i,
    `스트리밍이 없으면 내부 통제 이름이 그대로 나간다: ${String(r.reply ?? '').slice(0, 80)}`);
  assert.match(String(r.reply ?? ''), /820만원/, '내용은 그대로 남아야 한다');
});

// ── P90-2 후속 · 확인된 중간 결과가 화면에 닿는다 ──────────────────────────
//
// 커널이 `partial_result` 를 내보내도 화면이 안 그리면 사용자에겐 없는 것이다.
// 그리고 계획서 §4 는 `first_grounded_content` 를 "receipt 신분 또는 검증된 중간 결과가
// **화면에 렌더된** 시점" 으로 정의한다 — 그 보고가 이 사건에서도 서야 지표가 성립한다.
test('P90-2: 화면이 확인된 중간 결과를 그리고 첫 유용한 내용으로 보고한다', () => {
  assert.match(html, /addEventListener\('partial_result'/,
    '커널이 내보내는 확인된 중간 결과를 화면이 듣지 않는다');
  // 진행 문구 자리(trace)를 덮어쓰는 것이 아니라 **쌓이는 자리**여야 한다 —
  // 덮어쓰면 앞 걸음의 사실이 사라져 기다림이 다시 비어 보인다.
  assert.doesNotMatch(
    html.slice(html.indexOf("addEventListener('partial_result'"), html.indexOf("addEventListener('answer_delta'")),
    /trace\.textContent\s*=/,
    '중간 결과를 진행 문구 자리에 덮어쓰면 앞 걸음의 사실이 사라진다',
  );
  assert.match(html, /markGrounded\(\)/, '첫 유용한 내용 보고가 두 경로에서 같은 자리를 쓰지 않는다');
  assert.match(html, /steps\?\.remove\(\)/,
    '완료 뒤에도 중간 결과가 남으면 지속된 최종 답과 두 벌이 된다');
  // 2026-08-13 오너 라이브: 검증 전 답을 먼저 보이면 answer_reset 때 서로 다른 답이 교대하고
  // 사라졌다 다시 나온다. 이제 그 답은 내부에만 모으므로 확인된 걸음을 접을 이유도 없다.
  const 답시작 = html.slice(html.indexOf("addEventListener('answer_delta'"), html.indexOf("const completed ="));
  assert.doesNotMatch(답시작, /steps\?\.remove\(\)/,
    '지우면 답이 끝난 뒤 되짚을 자리가 없다 — 자리는 내주되 지우지는 않는다(조각 D)');
  assert.doesNotMatch(답시작, /걸음접기\(\)/,
    '화면에 안 보이는 답 때문에 확인된 걸음을 접으면 사용자는 진행이 사라졌다고 본다');
  assert.match(답시작, /data-unverified-answer/, '원장 검증 전 답은 화면에 보이면 안 된다');
  const 접기 = html.slice(html.indexOf('const 걸음접기 ='), html.indexOf('const 걸음접기 =') + 900);
  assert.match(접기, /걸음몸\.classList\.remove\('open'\)/,
    '접는 순간 안쪽이 닫혀 있어야 「두 벌이 아니다」가 성립한다');
  assert.match(html, /\.msg\.steps\.folded \.steps-body \{ display:none; \}/,
    '클래스만 붙고 실제로 안 감추면 아무것도 안 접힌 것이다');
  // 답과 같은 조로 그리면 사용자는 그것을 답으로 읽는다. 진행 중 사실은 조용해야 한다.
  assert.match(html, /\.msg\.steps\s*\{[^}]*color:var\(--muted\)/,
    '확인된 중간 결과가 최종 답과 같은 조로 그려지면 답으로 오인된다');
});

// ── 임시 진행 표면은 **스트림이 끝나면** 걷힌다 — 완료만이 끝이 아니다 ────────
//
// 철거를 `complete` 한 곳에만 걸면 스트림이 끊긴 턴에서 임시 표면이 화면에 눌러앉는다.
// 사용자는 "연결에 문제가 있었어요" 아래에 확인 사실과 검증 안 된 미리보기 답이 나란히
// 남은 화면을 본다. 인수인계서가 보존을 요구한 네 종료 경로 중 오류 경로다.
test('임시 진행 표면은 완료·오류 어느 쪽으로 끝나도 걷힌다', () => {
  const 정리 = html.match(/const 임시표면정리 = \(\) => \{[^}]*\};/);
  assert.ok(정리, '임시 표면 철거가 한 자리에 모여 있지 않다 — 종료 경로마다 빠뜨리게 된다');
  assert.match(정리[0], /preview\?\.remove\(\)/, '미리보기가 철거 대상에서 빠졌다');
  assert.match(정리[0], /steps\?\.remove\(\)/, '확인된 중간 결과가 철거 대상에서 빠졌다');

  const 완료줄 = html.split('\n').find((l) => l.includes("addEventListener('complete'"));
  const 오류줄 = html.split('\n').find((l) => l.includes('es.onerror'));
  assert.match(완료줄 ?? '', /임시표면정리\(\)/, '완료 경로가 공용 철거를 쓰지 않는다');
  assert.match(오류줄 ?? '', /임시표면정리\(\)/,
    '오류로 끝나면 임시 표면이 화면에 눌러앉는다 — 검증 안 된 미리보기가 답처럼 남는다');
});

// ── HRT-RF-004 · 현재 대화 제목의 조용한 구분선 ──────────────────────────────
//
// 활성 행의 신분(aria-current)은 이미 정확하다. 문제는 **시각 표지가 배경 명도 차이에만**
// 기대고 있다는 것이다 — 밝은 테마나 제목이 많을 때 지금 어느 대화에 말하고 있는지
// 다시 훑게 된다(HumanRealTest 관측). 글자·배지를 만들지 않고 가장자리 선으로만 보조한다.
//
// 금지선(registry HRT-RF-004): "현재" 텍스트·배지 추가 금지, 행 전체 두꺼운 테두리 카드 금지,
// 행 높이·제목 말줄임 폭 변경 금지, aria-current 를 지우고 색으로만 상태 전달 금지.
test('HRT-RF-004: 현재 대화 행은 레이아웃을 차지하지 않는 가장자리 선으로 구분된다', () => {
  const 선 = html.match(/\.sess\.active::before\s*\{[^}]*\}/);
  assert.ok(선, '현재 대화 행에 가장자리 표지가 없다 — 배경 명도에만 기댄다');
  // 흐름에서 자리를 차지하면 행 높이·제목 말줄임 폭이 달라진다. 그건 금지선이다.
  assert.match(선[0], /position:absolute/,
    '표지가 흐름에 자리를 차지하면 행 높이와 제목 말줄임 폭이 달라진다');
  assert.match(선[0], /inset-inline-start/,
    '시작 가장자리는 논리 속성으로 잡는다(글쓰기 방향을 하드코딩하지 않는다)');
  assert.match(html, /\.sess\s*\{[^}]*position:relative/,
    '표지의 기준 상자가 행이 아니면 엉뚱한 자리에 뜬다');
  // 선은 **보조**다. 신분은 여전히 aria-current 다.
  assert.match(html, /setAttribute\('aria-current'/,
    'aria-current 를 지우고 색으로만 상태를 전달하면 보조기기에서 현재 대화를 알 수 없다');
  // 글자·배지로 닫지 않는다.
  assert.doesNotMatch(선[0], /content:\s*['"][^'"]+['"]/,
    '표지에 글자를 넣으면 "현재" 배지가 된다 — 금지선');
});

// 실측(2026-08-03, 팀원 실사용): 전달된 답 **마지막 줄**에 통제 표식이 그대로 나갔다 —
//   memory.cite: "현재 목표: 설정에 있는 텔레그램 메신저 연결이 작동을 안해서 …"
// 접두어만 보고 있어서 답 끝에 붙은 것은 걸리지 않았다. 통제 표식은 OS 와 모델 사이의
// 말이지 사람에게 하는 말이 아니다 — 어디에 붙든 사람 눈에는 닿지 않아야 한다.
test('통제 표식은 답 끝에 붙어도 사람 눈에 닿지 않는다', async () => {
  const { userFacingModelText } = await import('../src/kernel/turn-surface.js');
  const 답 = [
    '좋아요. 지금 상태는 이렇게 정리할게요.',
    '',
    '- 봇 정보 확인됨',
    '- chat_id 확인됨',
    '',
    'memory.cite: "현재 목표: 텔레그램 메신저 연결이 작동을 안 해서 요청하는 건데"',
  ].join('\n');
  const 보이는것 = userFacingModelText(답);
  assert.doesNotMatch(보이는것, /memory\.cite/, '내부 표식이 사용자 답에 남았다');
  assert.match(보이는것, /봇 정보 확인됨/, '표식을 지우다가 사람 문장까지 지웠다');
  assert.doesNotMatch(보이는것, /\n{3,}/, '지운 자리에 빈 줄이 쌓였다');
  // 접두어 형태는 기존 계약 그대로 — **표식만 떼고 뒤 문장은 사람에게 간다.**
  // 답 전체가 표식으로 시작하는 경우라 그 뒤는 사용자에게 할 말이기 때문이다.
  assert.equal(userFacingModelText('memory.propose: 기억해둘게요'), '기억해둘게요');
});
