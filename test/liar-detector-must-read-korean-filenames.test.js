// **한글 파일 이름을 우리 거짓말 탐지기가 못 읽어서 정직한 답을 버렸다** (콘솔 라이브 2026-08-12).
//
// 밟은 회차 — *"내 컴퓨터에 PDF 파일 있어? 찾아서 어디 있는지 알려줘."* 를 네 번 돌려
// **2/4 가** 답 대신 손 요약을 그대로 배송했다. 빨간 회차의 원장:
//
//   `exitNetDiagnostic.재거짓` = *"답이 부른 파일 이름이 이 턴과 앞 턴의 원장에 없다:
//    **2분기.pdf**. 원장에는 그 이름으로 다룬 것도, 그 이름의 성공한 쓰기 영수증도 없다."*
//
// 그런데 원장에는 있었다. `local.locate` 가 `/Users/jyp/Downloads/내 운명은 26년 2분기.pdf`
// 를 후보로 냈고 모델은 그걸 그대로 인용했다. 실측:
//
//   그냥 `원장.includes('2분기.pdf')`      → **false**
//   양쪽 NFC 로 맞추고 `includes`          → true
//   양쪽 NFD 로 맞추고 `includes`          → true
//
// macOS 는 파일 이름을 **분해형(NFD)** 으로 저장하고 `readdir` 이 그대로 준다. 모델이 돌려준
// 글은 **조합형(NFC)** 이다. 같은 이름인데 코드가 달라서 `includes` 가 못 만난다 —
// **한글 이름이 든 답은 전부 이 문에서 거짓으로 몰린다.**
//
// 피해가 두 겹이다: ① 맞는 답이 버려지고 ② 그 자리를 커널의 대체문(손 요약)이 채워서
// 사용자는 기계 말투를 받는다. 원장 헌장(*"실제로 일어난 결과만 확정한다"*)의 정반대다 —
// 실제로 일어난 것을 안 일어났다고 판정했다.
//
// 이 저장소가 같은 매듭을 이미 두 번 풀었다(`local-locate.js` 볼륨 이름 · 형식 세기의
// 걸음/색인 대조). **세 번째 얼굴이다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 절대재검증 } from '../src/kernel/l2-plan/exit-verification.js';

/** 라이브와 같은 모양 — 손이 분해형(NFD)으로 준 이름을, 모델이 조합형(NFC)으로 인용한다. */
const 실제이름 = '/Users/jyp/Downloads/내 운명은 26년 2분기.pdf';
const 영수증 = (경로) => [{
  actualCall: { tool: 'local.locate', args: { what: 'PDF 파일' } },
  failureState: 'none',
  result: { candidates: [{ path: 경로, kind: 'file' }] },
}];
const 재다 = (reply, 경로) => 절대재검증({
  reply, receipts: 영수증(경로), 원장글: JSON.stringify(영수증(경로)),
});

test('① 손이 NFD 로 준 이름을 모델이 NFC 로 인용해도 거짓이 아니다 — 밟은 그 자리', () => {
  const r = 재다(`찾았어요. \`${실제이름.normalize('NFC')}\` 에 있어요.`, 실제이름.normalize('NFD'));
  assert.equal(r.재거짓, false,
    `**정직한 답을 거짓으로 몰았다** — 한글 이름이 든 답이 전부 여기서 죽는다: ${r.사실}`);
});

test('② 반대 방향도 같다 — 손이 NFC, 답이 NFD', () => {
  const r = 재다(`\`${실제이름.normalize('NFD')}\` 예요.`, 실제이름.normalize('NFC'));
  assert.equal(r.재거짓, false, `반대 방향에서 샌다: ${r.사실}`);
});

test('③ 진짜 지어낸 이름은 그대로 잡힌다 — 그물이 헐거워지지 않았다', () => {
  const r = 재다('정리해서 `없는파일_지어냄.xlsx` 에 저장했어요.', 실제이름.normalize('NFD'));
  assert.equal(r.재거짓, true, '**지어낸 실물이 통과했다** — 이 그물이 하는 일이 사라졌다');
  assert.match(String(r.사실), /없는파일_지어냄\.xlsx/);
});

test('④ 표기만 같고 실재하지 않는 이름도 잡힌다 — 정규화가 면죄부가 아니다', () => {
  const r = 재다('`내 운명은 26년 3분기.pdf` 도 있어요.', 실제이름.normalize('NFD'));
  assert.equal(r.재거짓, true, `한 글자 다른 지어낸 이름이 통과했다: ${r.사실}`);
});
