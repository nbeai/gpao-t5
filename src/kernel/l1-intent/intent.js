// L1 · 말귀 / Input Kernel — 입력을 IntentPacket 으로 해석한다(§2).
// 슬라이스-1 은 결정적(deterministic) 1차 분류를 한다: answerMode·권한경계·확인필요.
// 이 1차 분류는 일반 신호(범주)로만 판단하며, 밀도화 단계에서 모델 분류가 이를 정교화한다.
// 특정 대화 하나에 맞춘 규칙을 넣지 않는다(절대원칙 4: 누더기 금지).
import { TIER } from '../contracts.js';
import { parseFileRequest } from './file-parse.js';

// 외부효과·도구가 필요한 일반 동사 범주(예시 전용이 아니라 범주 신호).
const ACTION_SIGNALS = /보내|발송|전송|올려|게시|삭제|지워|결제|구매|정리|이동|옮겨|조사|검색|수집|가져와|불러와|분석|만들|작성|바꿔|편집|되돌려|복구|취소해/;
// **사실을 묻는 것도 일이다**(2026-08-07 · 노드 R · 판 ⑤⑬ 0/3).
//
// 위 축은 *"무엇을 해달라고 했나"* 만 본다. 그래서 *"이번 달 얼마 벌었지?"* ·
// *"통장이 자꾸 비어"* 가 `fast_chat`(가벼운 대화)으로 분류됐고, 계획 단계에서 손 후보가
// **0개**가 됐다. 모델이 안 뻗은 게 아니라 **길이 안 열렸다.**
//
// 사장님이 자기 매출을 묻는 것은 잡담이 아니다. 그 답은 T5 의 상식이 아니라 **이 컴퓨터
// 안**에 있고, 그건 손을 뻗어야 나온다. 낱말을 더하지 않고(절대원칙 4) **축을 하나 세운다** —
// 두 조각이 함께 있어야 문다: **내 자료**(장부·돈·일정처럼 이 컴퓨터에 있는 것)와
// **묻는 말**. 한쪽만으로는 안 문다.
//
// **시간과 물음표는 축이 아니다**(밟음): *"오늘 날씨 어때?"* 는 `오늘`+`?` 로 걸리는데
// 그 답은 이 컴퓨터에 없다. 기간은 자료를 좁히는 말이지 자료가 아니다.
// 그래서 자료 쪽은 **무엇에 대한 것인가**로만 세운다 — 돈·장부·일정·내 물건.
const 내자료_SIGNALS = /통장|계좌|매출|수입|정산|장부|월급|급여|잔고|재고|예약|일정|영수증|거래처|매입|지출|벌었|벌어|썼|입금|출금/;
const 내것_SIGNALS = /내 |내가|우리 |제 |저희 /;
const 묻는말_SIGNALS = /얼마|몇|언제|어디|누가|어떻게|어땠|어떤|뭐|무엇|있나|없나|됐|비어|모자라|남았|\?/;
// 자료어가 있으면 그것만으로 충분하고(내 돈 이야기다), 소유어뿐이면 자료어가 있어야 한다.
const FACT_SIGNALS = (t) => 묻는말_SIGNALS.test(t)
  && (내자료_SIGNALS.test(t) || (내것_SIGNALS.test(t) && /파일|폴더|메모|자료|기록/.test(t)));
// 강한 권한(A3) 범주.
const A3_SIGNALS = /삭제|지워|결제|구매|공개.?게시|권한|내보내/;
// 짧은 승인(A2) 범주: 외부 전송·쓰기.
const A2_SIGNALS = /보내|발송|전송|올려|게시|메일|슬랙|텔레그램/;
// 지시대상이 불명확한 대명사(확인 필요 후보).
const VAGUE_REF = /^(그거|이거|저거|그것|이것|그거요|그것 좀)/;

/**
 * @param {string} currentRequest  사용자 원문(보존)
 * @param {Object} [opts]
 * @param {import('../contracts.js').SelfStateSnapshot} [opts.selfState]
 * @returns {import('../contracts.js').IntentPacket}
 */
export function interpret(currentRequest, opts = {}) {
  const text = String(currentRequest ?? '');
  const trimmed = text.trim();

  const looksActionable = ACTION_SIGNALS.test(trimmed);
  // 사실을 묻는 것도 손이 필요한 일이다 — 위 주석 참조.
  const asksAboutMyWorld = FACT_SIGNALS(trimmed);
  // 사실을 물은 것도 일이다 — `fast_chat` 은 손을 안 쓰는 자리라 여기서 갈리면
  // 아래 손 후보가 붙어도 그 뒤 경로가 잡담으로 흐른다.
  const answerMode = (looksActionable || asksAboutMyWorld) ? 'complex_work' : 'fast_chat';

  // 권한 경계 1차 추정(확정은 ActionPlan/Authority).
  let authorityBoundary = TIER.A0;
  if (A3_SIGNALS.test(trimmed)) authorityBoundary = TIER.A3;
  else if (A2_SIGNALS.test(trimmed)) authorityBoundary = TIER.A2;

  // 확인 필요: 짧고 지시대상이 대명사뿐인데 행동을 요구 → 실행 전 멈추고 묻는다(절대원칙 5).
  // 도구 후보는 한 번만 뽑는다(두 번 부르면 두 진실이 생긴다).
  const tools = (looksActionable || asksAboutMyWorld) ? inferTools(trimmed, opts.selfState, asksAboutMyWorld) : undefined;

  const isShort = trimmed.length <= 12;
  const needsClarification = looksActionable && isShort && VAGUE_REF.test(trimmed);

  return {
    currentRequest: text, // 원문 그대로, 요약·왜곡 금지
    desiredOutcome: needsClarification ? '불명확(확인 필요)' : trimmed,
    authorityBoundary,
    answerMode,
    needsClarification,
    neededTools: tools,
    // Phase 0-1: 파일 작업 종류를 여기서 정해 계획이 **작업별 권한**을 판정하게 한다.
    // 도구 단위로 kind 를 고정하면 같은 도구의 삭제가 organize 로 새어 승인을 건너뛴다(실사용에서 확인).
    fileOp: tools?.includes('local.file') ? parseFileRequest(trimmed) : undefined,
  };
}

/**
 * 필요한 도구 후보(범주 신호). 실행 가능 판정은 SelfState 가 한다.
 * **이 환경에 아예 없는 도구는 후보로 올리지 않는다** — 올리면 "연결이 필요해요 / [연결 화면 열기]"
 * 라는 죽은 버튼이 뜬다(연결할 대상이 존재하지 않으므로 거짓 안내다). 연결이 안 된 것과 아예 없는
 * 것은 다르다: 전자는 안내해야 하고 후자는 능력이 없다고 말해야 한다.
 * @param {string} t
 * @param {import('../contracts.js').SelfStateSnapshot} [selfState]
 */
function inferTools(t, selfState, asksAboutMyWorld = false) {
  const known = selfState?.connectedTools;
  const exists = (id) => !known || known.some((x) => x.id === id);
  const tools = [];
  if (/메일|이메일/.test(t)) tools.push('mail.send');
  if (/슬랙|slack/i.test(t)) tools.push('slack.post');
  // 파일 도구는 **파일·폴더가 명시될 때만**. "정리해줘" 같은 일반어로 부르면 엉뚱한 도구가 돈다
  // (실사용: "AI 뉴스 조사해서 정리해줘"에 파일 도구가 돌아 원장에 "그 폴더는 비어 있어요"가 남았다).
  // 대상 없는 "취소해"는 자동화·기억·승인 등 무엇이든 가리킬 수 있다. 파일 말이 함께
  // 있을 때만 file-parse가 undo로 해석하고, 명시적인 "되돌려/복구"는 기존 파일 약속을 지킨다.
  if (/파일|폴더|\.md|\.txt|\.csv|메모|되돌려|복구|저장해 ?줘/.test(t)) tools.push('local.file');
  if (/조사|검색|수집|가져와|불러와|뉴스|환율/.test(t)) tools.push('web.collect');
  // **찾는 손**. 사실을 물었으면 파일 이름을 모르는 것이 정상이고, 그래서 먼저 찾아야 한다.
  // 이게 없으면 모델은 *"어느 파일인지 알려 주세요"* 로 되묻는 수밖에 없다(판 ⑤⑬).
  if (asksAboutMyWorld && !tools.includes('local.locate')) tools.push('local.locate');
  const present = tools.filter(exists);
  return present.length ? present : undefined;
}
