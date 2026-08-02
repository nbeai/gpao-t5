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
  // 답이 흐르기 시작하면 채울 공백이 없다. 그때도 남겨두면 확인 사실과 답이 나란히 서서
  // 같은 말을 두 번 하는 화면이 된다 — 실제 라이브 회차에서 관측된 모습이다.
  assert.match(
    html.slice(html.indexOf("addEventListener('answer_delta'"), html.indexOf("const completed =")),
    /steps\?\.remove\(\)/,
    '답변 조각이 시작돼도 중간 결과가 남으면 같은 사실이 화면에 두 벌로 선다',
  );
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

