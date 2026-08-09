import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCandidate, isInfluenceEligible, admittedContext, makeCandidate, promote, runReplay,
  isGoalRelevant,
} from '../src/kernel/l1-intent/context-mesh.js';

// 후보 감지: preference / operating_principle / 없음(자동 승격 아님).
test('detectCandidate: 선호와 운영원리를 kind로 분리, 일반 발화는 null', () => {
  assert.equal(detectCandidate('안녕 오늘 뭐하지')?.kind ?? null, null);
  assert.equal(detectCandidate('보고서는 항상 글로 받는 게 좋아').kind, 'preference');
  assert.equal(detectCandidate('외부에 보낼 땐 무조건 나한테 확인받아').kind, 'operating_principle');
});

// 핵심 안전 불변식: operating_principle 은 replayPassed && userConfirmed 전에는 영향 자격 없음.
test('operating_principle은 replay+승인 전에는 영향 자격 없음', () => {
  const e = makeCandidate('c1', 'operating_principle', '외부 전송 전 확인');
  assert.equal(isInfluenceEligible(e), false);                                  // 후보
  assert.equal(isInfluenceEligible({ ...e, userConfirmed: true }), false);      // 승인만 — replay 없음
  assert.equal(isInfluenceEligible({ ...e, replayPassed: true }), false);       // replay만 — 승인 없음
  assert.equal(isInfluenceEligible({ ...e, replayPassed: true, userConfirmed: true }), true);
});

test('preference는 userConfirmed 전에는 영향 자격 없음', () => {
  const e = makeCandidate('c2', 'preference', '보고서는 글로');
  assert.equal(isInfluenceEligible(e), false);
  assert.equal(isInfluenceEligible({ ...e, userConfirmed: true }), true);
});

// admittedContext: 승격·영향가능·관련된 것만 좁게. 미승격 후보·replay 전 원리는 절대 입장 금지.
test('admittedContext는 승격·영향가능·관련된 것만 좁게 입장한다', () => {
  const promotedPref = { ...makeCandidate('c3', 'preference', '보고서는 글로 받기'), userConfirmed: true };
  const confirmedButNoReplay = { ...makeCandidate('c4', 'operating_principle', '외부 전송 전 확인'), userConfirmed: true };
  const candidate = makeCandidate('c5', 'preference', '커피 좋아함');
  const memory = { promoted: [promotedPref, confirmedButNoReplay], candidates: [candidate] };

  // "보고서" 요청 → 관련된 승격 선호만 입장.
  assert.deepEqual(admittedContext(memory, '보고서 정리해줘'), ['보고서는 글로 받기']);
  // replay 안 된 운영원리는 관련돼도 입장 금지(행동 영향 0).
  // **원칙의 부재로 잰다** — 선호는 이제 발화와 무관하게 실리므로 배열이 비지 않는다(F-18).
  assert.ok(!admittedContext(memory, '외부 전송 관련').includes('외부 전송 전 확인'),
    'replay 안 된 운영원리가 입장했다 — 행동 영향 0 계약이 무너진다');
  // ── **사용자에 대한 사실은 발화로 거르지 않는다**(F-18 · 2026-08-05) ──────────
  // 오너 설치 실측: 승격된 기억 **0개**, 집 파일 비어 있음 — 기억이 모델에게 **한 번도** 간 적이
  // 없었다. 그 위에 낱말 겹침 필터가 얹혀 `"내가 뭘 마시는지 알아?"` 에 `"홍차를 마신다"` 가
  // 안 실렸다. **분류기가 사실 공급 여부를 정하고 있었다**(계획서가 F-18 로 적어 둔 그것).
  // 선호는 사용자에 대한 사실이라 무엇을 물었느냐로 참·거짓이 되지 않는다. 개수만 묶는다.
  // (검증 사례가 있는 **원칙**은 그대로 사례로 범위가 정해진다 — 아래 단언들이 그걸 지킨다.)
  assert.deepEqual(admittedContext(memory, '날씨 어때'), ['보고서는 글로 받기'],
    '선호는 발화와 무관하게 실린다 — 승격/replay 경계는 위 두 단언이 그대로 지킨다');
});

// promote: 게이트를 코드로 강제.
test('promote 게이트: 승인 없으면 needs_user_confirm, 원리는 replay 없으면 needs_replay', () => {
  const pref = makeCandidate('c6', 'preference', 'x');
  assert.equal(promote(pref, {}).ok, false);
  assert.equal(promote(pref, {}).reason, 'needs_user_confirm');
  assert.equal(promote(pref, { userConfirmed: true }).ok, true);

  const prin = makeCandidate('c7', 'operating_principle', 'y');
  assert.equal(promote(prin, { userConfirmed: true }).reason, 'needs_replay');
  const ok = promote(prin, { userConfirmed: true, replayPassed: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.entry.replayPassed, true);
});

test('runReplay(S4): 실행 증거가 결합된 suite 보고서로만 통과한다', () => {
  const prin = makeCandidate('c8', 'operating_principle', '외부 전송 전 확인');
  // 예전 계약은 "명시적 모순이 없으면 통과"였다 — 그건 replay 가 아니라 문자열 검사였다.
  assert.equal(runReplay(prin, []), false, '보고서 없음은 통과가 아니다(표본 없음)');
  assert.equal(runReplay(prin, [], { pass: false }), false, 'suite 미통과는 통과가 아니다');
  assert.equal(runReplay(prin, [], { pass: true }), true, 'suite 통과만 통과다');
  assert.equal(runReplay(makeCandidate('c9', 'preference', 'z'), ['안 z']), true, '선호는 replay 불요');
});

// ── 목표 입장 판정(isGoalRelevant) — 부탁 형태의 겹침은 관련이 아니다 ──────────────
//
// 30턴 실측(2026-08-09 · 분리시험 팔A): 상태 요약형 질문에 옛 목표가 실려 "방금 바뀐 것"
// 시야가 좁혀졌다(3중 1만 답함 · 주입 끄면 3/3). 겹친 낱말은 서술어("말해줘") 하나였다.
// 가르는 사실은 낱말 목록이 아니라 자리다 — 마지막 낱말(부탁 형태)이 같으면 그건 빼고
// **목표의 대상**만으로 관련을 잰다.
test('반대시험(12턴형): 부탁 형태("…말해줘")만 겹친 상태 요약형 질문에 옛 목표가 안 실린다', () => {
  const 옛목표 = '지금까지 확정된 것, 후보인 것, 아직 안 정한 것을 구분해서 짧게 말해줘.';
  const 상태질문 = '방금 바뀐 것만, 옛 값과 현재 값을 나눠서 말해줘.';
  // 수리를 걷으면(낱말 겹침 그대로면) "말해줘" 하나로 true 가 되어 이 단언이 빨강이 된다.
  assert.equal(isGoalRelevant(옛목표, 상태질문), false,
    '겹친 것이 부탁 형태뿐이면 목표의 대상이 발화에 없다 — 입장 금지');
});

test('목표의 대상을 부른 발화에는 여전히 실린다 — 작업 이어가기가 죽지 않는다(관통 조건)', () => {
  // ① 마지막 낱말까지 같아도 대상("경쟁사")을 불렀으면 입장한다.
  assert.equal(isGoalRelevant('경쟁사 뉴스 조사해줘', '경쟁사 것도 마저 조사해줘'), true);
  // ② 마지막 낱말이 다르면 기존 판정 그대로다 — 경계의 정밀화이지 새 판정 축이 아니다.
  assert.equal(isGoalRelevant('경쟁사 뉴스 조사', '경쟁사 관련 더 알려줘'), true);
  assert.equal(isGoalRelevant('경쟁사 뉴스 조사', '조사 결과 더 자세히 말해줘'), true);
  // ③ 무관한 발화에는 원래대로 안 실린다.
  assert.equal(isGoalRelevant('경쟁사 뉴스 조사', '오늘 날씨 어때'), false);
});

// ── 수리 v2 반대시험 다섯 가족(PM 반례 실증 2026-08-09) ─────────────────────────
//
// 수리 v1(7322dad · "마지막 낱말이 같으면 부탁 형태로 보고 뺀다")은 12턴형 병은 잡았지만
// PM 이 실물 함수 실행으로 일반화 부족을 확정했다(반례 3건). 수리 전 v1 기계 사실:
//   오판 2건 — "내용"·"정리" 같은 일반어 겹침이 관련으로 섰다(마지막 낱말이 다르면 서술어
//              "정리해서"까지 겹침 증거로 세는 구멍).
//   누락 3건 — "그것도 알려줘"·"이번 주 것도 알려줘" 같은 생략 후속이 안 실렸다(대상
//              낱말이 발화에 없으면 무조건 탈락 — 생략이 바로 그 모양인데).
// 아래 다섯 가족이 그 경계 전체를 세운다. 수리 전 빨강 6단언 확인(2026-08-09, 이 커밋 메모).

test('가족① 종결어미 변형 — 판정이 부탁 형태(말해줘/알려줘/보여줘…)에 좌우되지 않는다', () => {
  // 같은 대상(지난주 정산)이면 종결어미가 달라도 실린다.
  assert.equal(isGoalRelevant('지난주 정산을 정리해서 알려줘', '지난주 정산 내용 보여줘'), true);
  assert.equal(isGoalRelevant('회의록 요약해서 보여줘', '회의록 마저 정리해줘'), true);
  // 대상이 다르면 종결어미·서술어("정리해서")가 겹쳐도 안 실린다. (수리 전 빨강 — v1 오판)
  assert.equal(isGoalRelevant('지금까지 내용을 정리해서 말해줘', '방금 바뀐 내용을 정리해줘'), false,
    '겹친 것이 일반어 "내용"과 서술어뿐 — 다른 대상에 옛 목표를 실으면 시야가 좁혀진다');
});

test('가족② 생략 후속 — 지시·후속 표지로 이어 부른 발화에는 실려야 한다(수리 전 빨강 3건)', () => {
  // PM 반례 그대로: 대상을 생략하고 "그것"으로 이어 불렀다.
  assert.equal(isGoalRelevant('경쟁사 뉴스 조사해서 알려줘', '그것도 알려줘'), true,
    '생략 후속이 안 실리면 모델이 "그것"을 풀 근거를 잃는다');
  assert.equal(isGoalRelevant('지난주 정산을 정리해서 알려줘', '이번 주 것도 알려줘'), true,
    '"~것도"는 의존명사+보조사 — 앞 일을 가리키는 문법 사실이다');
  assert.equal(isGoalRelevant('경쟁사 뉴스 조사해서 알려줘', '그거 더 자세히 말해줘'), true);
});

test('가족③ 일반어 겹침 — 낱말("내용"·"정리")만 겹친 발화에는 안 실려야 한다(수리 전 빨강 2건)', () => {
  // 같은 명사(내용)라도 수식이 갈리면(행사↔계약서) 다른 대상이다.
  assert.equal(isGoalRelevant('행사 내용 정리해서 알려줘', '계약서 내용 검토해줘'), false);
  // 겹친 것이 서술어(정리해서·말해줘)뿐이면 대상 증거가 0이다.
  assert.equal(isGoalRelevant('보고서 정리해서 말해줘', '사진 정리해서 말해줘'), false);
  // 12턴형 원문 쌍(위 반대시험과 같은 자리) — 유지.
  assert.equal(isGoalRelevant(
    '지금까지 확정된 것, 후보인 것, 아직 안 정한 것을 구분해서 짧게 말해줘.',
    '방금 바뀐 것만, 옛 값과 현재 값을 나눠서 말해줘.',
  ), false);
});

test('가족④ 실제 대상 후속 — 목표의 대상을 부른 발화에는 실려야 한다', () => {
  assert.equal(isGoalRelevant('경쟁사 뉴스 조사해서 알려줘', '경쟁사 것도 마저'), true);
  assert.equal(isGoalRelevant('지난주 정산을 정리해서 알려줘', '정산 마저 부탁해'), true);
});

test('가족⑤ 완전한 화제 전환 — 안 실려야 한다', () => {
  assert.equal(isGoalRelevant('경쟁사 뉴스 조사해서 알려줘', '오늘 점심 뭐 먹을까'), false);
  assert.equal(isGoalRelevant('지난주 정산을 정리해서 알려줘', '다음 주 휴가 일정 잡아줘'), false);
});
