// **비밀은 안 내보내되, 나머지는 준다.**
//
// 라이브(2026-08-05) `지금 화면에 뭐 떠 있어?` 에 이 문장이 나갔다:
//   *"민감한 값은 답과 기록에 다시 싣지 않았어요. 값 자체를 제외하고 요청을 이어가 주세요."*
// **사용자는 화면 정보를 하나도 못 받았다.** 정보 대신 안내가 나간 자리다(§0).
//
// 원인(재현 100%): 창 26개 중 2개가 걸렸는데 **둘 다 우리 문서 파일명**이다 —
// `GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md`.
// `LONG_MACHINE_TOKEN` 이 **긴 토막에 대·소문자·숫자가 다 있으면** 비밀로 본다.
// 그래서 **T5 자신의 문서를 열어 둔 채 화면을 보면 답이 사라진다.**
//
// ── 두 갈래 중 어느 쪽인가 ──────────────────────────────────────────────
//   ✗ 패턴을 좁힌다   문구 목록 늘리기의 사촌이다. 이미 두 번 뚫린 길이고,
//                    좁히는 순간 진짜 비밀이 새는 쪽으로 기운다.
//   ✓ **범위를 좁힌다**  걸린 토막만 가리고 나머지는 준다. **비밀은 여전히 안 나간다.**
//
// 오늘 웹·화면에서 여러 번 세운 계약과 같다 — **하나가 막혔다고 전부를 버리지 않는다.**
//
// ── 안전 쪽 실패(fail-safe)를 함께 세운다 ──────────────────────────────
// 가리고 나서 **다시 검사해서** 여전히 걸리면 통째로 버린다. 가리기가 불완전할 수 있고,
// 그때 반쯤 가린 것을 내보내면 지금보다 나쁘다. **모르면 안 내보내는 쪽**이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsSensitiveValue, maskSensitiveValues } from '../src/kernel/l0-evidence/sensitive-text.js';

// ── 진짜 비밀은 사라진다 ─────────────────────────────────────────────────
test('카드번호는 사라지고 나머지 문장은 남는다', () => {
  const 원문 = '주문 확인했어요. 카드 4111 1111 1111 1111 로 결제되었고 배송은 내일이에요.';
  const 가린것 = maskSensitiveValues(원문);
  assert.ok(!가린것.includes('4111 1111 1111 1111'), '**카드번호가 그대로 나갔다**');
  assert.ok(가린것.includes('배송은 내일이에요'), '비밀이 아닌 부분까지 버렸다 — 그게 지금 결함이다');
  assert.equal(containsSensitiveValue(가린것), false, '가리고도 여전히 걸린다');
});

test('API 키는 사라지고 나머지는 남는다', () => {
  const 원문 = '설정 파일을 읽었어요. api_key=sk-proj-abcdefgh12345678 이 들어 있고 포트는 4173이에요.';
  const 가린것 = maskSensitiveValues(원문);
  assert.ok(!가린것.includes('sk-proj-abcdefgh12345678'), '**키가 그대로 나갔다**');
  assert.ok(가린것.includes('포트는 4173'), '나머지까지 버렸다');
  assert.equal(containsSensitiveValue(가린것), false);
});

test('주민등록번호도 사라진다', () => {
  const 가린것 = maskSensitiveValues('신청서에 900101-1234567 이 적혀 있어요.');
  assert.ok(!가린것.includes('900101-1234567'));
  assert.equal(containsSensitiveValue(가린것), false);
});

// ── 비밀이 아닌 것은 살아남는다 — 이게 F-32 가 겨눈 자리다 ─────────────────
test('우리 문서 파일명은 살아남는다 — 화면 답이 통째로 사라지던 자리', () => {
  const 원문 = '지금 화면에 텍스트 편집기로 GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md 가 열려 있어요.';
  const 가린것 = maskSensitiveValues(원문);
  assert.equal(containsSensitiveValue(가린것), false, '가려도 여전히 걸리면 통째로 버려진다');
  assert.ok(가린것.includes('텍스트 편집기'), '**화면 정보가 통째로 사라졌다** — §0 위반이 그대로다');
  assert.ok(가린것.includes('열려 있어요'), '문장이 끊겼다');
});

test('평범한 문장은 한 글자도 안 바뀐다 — 없는 벽을 만들지 않는다', () => {
  const 원문 = '지금 Google Chrome 창 26개가 떠 있어요. 앞에 있는 건 유튜브 탭이에요.';
  assert.equal(maskSensitiveValues(원문), 원문);
});

test('빈 값·없는 값에도 안 터진다', () => {
  assert.equal(maskSensitiveValues(''), '');
  assert.equal(maskSensitiveValues(undefined), '');
  assert.equal(maskSensitiveValues(null), '');
});

// ── 손이 실제로 그 길을 쓰는가 ───────────────────────────────────────────
test('답에 비밀이 섞이면 그 값만 가리고 내보낸다 — 통째로 안 버린다', async () => {
  const { redactSensitiveOutput } = await import('../src/surface/server.js');
  const r = redactSensitiveOutput({ reply: '결제는 카드 4111 1111 1111 1111 로 됐고 배송은 내일이에요.' });
  assert.ok(!r.reply.includes('4111 1111 1111 1111'), '**비밀이 그대로 나갔다**');
  assert.ok(r.reply.includes('배송은 내일이에요'), '나머지까지 버렸다 — 사용자는 아무것도 못 받는다');
  assert.equal(r.sensitiveOutputRedacted, true, '가렸다는 사실은 남겨야 한다');
});

test('화면 답은 그대로 나간다 — 파일명 때문에 통째로 안 버린다', async () => {
  const { redactSensitiveOutput } = await import('../src/surface/server.js');
  const 원문 = '지금 텍스트 편집기에 GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md 가 열려 있어요.';
  const r = redactSensitiveOutput({ reply: 원문 });
  assert.ok(r.reply.includes('텍스트 편집기'), '**화면 정보가 사라졌다** — 라이브에서 난 그 자리다');
  assert.ok(r.reply.includes('열려 있어요'));
});

// ── 안전 쪽 실패 ─────────────────────────────────────────────────────────
test('가리고도 여전히 걸리면 통째로 버린다 — 반쯤 가린 것을 내보내지 않는다', async () => {
  const { redactSensitiveOutput } = await import('../src/surface/server.js');
  // 입력은 **실제로 걸리는 것**이어야 그 길로 들어간다(처음엔 안 걸리는 문자열을 줘서
  // 분기 자체를 안 밟았다 — 재는 자리를 잘못 잡은 것이다).
  // 그리고 가리기가 **실패한 척** 한다: 가린 뒤에도 여전히 걸리는 값을 돌려준다.
  const r = redactSensitiveOutput(
    { reply: '카드 4111 1111 1111 1111 로 결제했어요.' },
    { 가리기: () => 'password=stillsecret123' },
  );
  assert.match(r.reply, /민감한 값은/, '가리기가 실패했는데 그대로 내보냈다');
});
