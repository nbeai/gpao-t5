// L2 · 모델 통제 채널 (H 감사 보강 2026-07-29) — **실행 도구가 아닌 모델의 구조화된 제출.**
//
// 왜 분리하나: memory.propose 를 실행 도구 등록부(descriptor+handler)에 두면 "실행이 아니다"
// (커널 계약)와 "실행 가능한 read 도구다"(등록부)라는 **두 진실**이 생긴다. 가로채기가 빠진
// 실행 경로가 하나라도 생기면, 예비 handler 가 저장하지 않고도 "적어뒀어요"라고 성공을
// 보고하게 된다(못 지킬 약속의 씨앗). 그래서:
//
//   · 통제 호출은 여기서만 선언한다 — selfState·connections·도구함·ToolRunner 에 존재하지 않는다.
//   · 모델에게는 modelSchemasFor() 가 실행 도구 스키마에 **덧붙여** 보여준다.
//   · 모든 모델 호출 결과는 splitModelControlCalls() 한 경계를 지나 통제 호출이 분리되고,
//     나머지만 계획·승인·실행으로 간다. callsToIntentParts 도 통제 호출을 모른다(이중 방어).
import { toolSchemasFor } from './tool-schema.js';

// 통제 호출 선언 — 실행 손이 아니므로 ToolDescriptor 가 아니라 여기 산다.
export const MODEL_CONTROL_SCHEMAS = Object.freeze([{
  // ── W2 사전 배선 · Automation 통제 3슬롯 ──────────────────────────────
  // 왜 본선이 미리 뚫는가: AC-2·AC-3·AC-4 세 작업선이 같은 배열과 같은 분리 경계를 동시에
  // 고치면 그 자리가 최대 충돌면이 된다(AC1-RECHECK §4). 슬롯을 미리 두면 작업선은 자기
  // 파일만 만진다. **소비자가 붙기 전에는 모델에게 보이지 않는다**(아래 준비된통제) —
  // 보이면 모델이 "스킬로 등록했어요" 같은 못 지킬 약속을 한다(memory.propose 와 같은 계약).
  name: 'skill.propose',
  description: '사용자가 "이걸 다음에도 이렇게 해줘"처럼 반복할 작업 방식을 맡기면 이걸로 적는다.'
    + ' 적지 않았다면 "다음부터 그렇게 할게요" 같은 약속을 하지 않는다.'
    + ' 이건 실행이 아니다 — 사용자 확인과 실제 replay 를 거쳐야 쓰인다.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '사람이 부를 이름' },
      purpose: { type: 'string', description: '이 작업이 무엇을 이루는가' },
      steps: { type: 'array', items: { type: 'string' }, description: '작업 원리와 확인 지점. 강제 대본이 아니다 — 현재 지시와 실제 환경이 늘 우선한다.' },
      inputs: { type: 'array', items: { type: 'object' }, description: '작업에 필요한 입력의 구조' },
      resultContract: { type: 'object', description: '완료 결과의 형태와 확인 조건' },
      requiredCapabilities: { type: 'array', items: { type: 'string' }, description: '실행에 필요한 실제 도구 ID' },
      authorityHints: { type: 'array', items: { type: 'string' }, description: '승인 또는 권한과 닿는 범위. 권한 자체가 아니다.' },
      replayCases: {
        type: 'array',
        description: '실제 replay 사례. positive 2, negative 1, boundary 2, authority 1을 채운다.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            kind: { type: 'string', enum: ['positive', 'negative', 'boundary', 'authority'] },
            sourceRefs: { type: 'array', items: { type: 'object' } },
            inputFacts: { type: 'array', items: { type: 'string' } },
            expectedFacts: { type: 'array', items: { type: 'string' } },
            forbiddenFacts: { type: 'array', items: { type: 'string' } },
            allowedFacts: { type: 'array', items: { type: 'string' } },
            exactFacts: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'kind', 'inputFacts', 'expectedFacts', 'forbiddenFacts'],
        },
      },
    },
    required: ['name', 'purpose', 'steps', 'resultContract', 'replayCases'],
  },
}, {
  name: 'automation.propose',
  // **되는 것을 말한다.** 예전 설명은 "실행이 아니다 — 승인 전에는 아무 일도 예약되지 않는다"
  // 로 **안 되는 것만** 있었다. 라이브에서 두 번, 모델이 이 채널을 쥐고도 *"예약 기능이 아직
  // 없어서"* 라며 사용자에게 cron 스크립트를 짜 줬다(2026-08-04 사람 사용시험). 두 번째 발화는
  // 이 설명의 예시("매일 아침")와 글자 그대로 같았다.
  // 손 설명 계약의 거울상이다 — 라벨만 주면 모델이 **지어내고**, 안 되는 것만 주면 **지운다**.
  description: '사용자가 "매일 아침", "매주 금요일에", "내일 아침 9시에" 처럼 **시점**을 정해'
    + ' 맡기면 이걸로 적는다. 한 번뿐인 일(once)도, 반복도 담는다.'
    + ' **승인하면 그 시각에 T5 가 스스로 실행한다** — 사용자가 그때 화면에 없어도 된다.'
    + ' 다만 실행이 아니라 제안이다 — 승인 전에는 아무 일도 예약되지 않는다.'
    + ' 외부로 나가는 일(전송·공개·결제)은 매 실행마다 사용자 확인이 남는다는 사실을 함께 말한다.',
  parameters: {
    type: 'object',
    properties: {
      statement: { type: 'string', description: '무엇을 언제 반복하는지 사람 말로' },
      kind: { type: 'string', enum: ['once', 'interval', 'daily', 'weekly'], description: '반복의 종류' },
      // **어느 손으로 하는 일인지 함께 말한다.** 없으면 설정 화면이 이 일을 맡을 스킬·담당을
      // 고를 수 없어 카드가 막다른 길이 된다(F-11 사슬 3번째 끊김, 실측 2026-08-04).
      tool: { type: 'string', description: '이 반복이 실제로 쓸 손(예: local.file). 지금 쓸 수 있는 손 중에서 고른다' },
    },
    required: ['statement'],
  },
}, {
  name: 'agent.propose',
  description: '사용자가 "이 폴더만 보는 분석 담당을 만들어줘" 처럼 **역할**을 맡기면 이걸로 적는다.'
    + ' 실행이 아니고 권한도 아니다 — 실행 때마다 현재 권한과 교집합으로 다시 제한된다.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '사람이 부를 이름' },
      purpose: { type: 'string', description: '이 역할이 맡는 일' },
      workspaceScope: { type: 'array', items: { type: 'string' }, description: '다룰 자리(사용자가 말한 범위)' },
    },
    required: ['name', 'purpose'],
  },
}, {
  name: 'work.state',
  description: '긴 작업에서 사용자가 확정·수정·철회한 사실과 아직 답이 필요한 질문을 구조로 제출한다.'
    + ' 실행이나 완료 처리가 아니다. 사용자 원문을 글자 그대로 지목해야 하며 T5가 원문·현재성·대체 관계를 대조한다.'
    + ' 파일 생성·전송·실행 완료는 이 채널로 제출하지 않는다. 완료는 실제 ToolReceipt와 CompletionContract만 정한다.',
  parameters: {
    type: 'object',
    properties: {
      changes: {
        type: 'array', maxItems: 6,
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['agreement_set', 'agreement_superseded', 'agreement_retracted', 'question_resolved'],
              description: 'agreement_set은 이전 현재값이 없는 최초 합의에만 쓴다. '
                + 'agreement_superseded는 현재 작업 브리프의 실제 현재값을 새 값으로 바꿀 때만 쓴다. '
                + 'agreement_retracted와 question_resolved도 브리프의 현재 대상을 targetQuote로 정확히 지목한다.',
            },
            utteranceQuote: { type: 'string', description: '이번 사용자 발화에서 글자 그대로 따온 근거' },
            targetQuote: { type: 'string', description: '수정·철회·해소 대상의 저장된 원문 또는 질문을 글자 그대로. 브리프에 그 값이 없으면 **그 값을 정했던 사용자의 과거 발화를 글자 그대로** 따온다 — 네가 요약한 문장은 대조할 원본이 없어 사건이 되지 못한다' },
          },
          required: ['type', 'utteranceQuote'],
        },
      },
      openQuestion: {
        type: 'object',
        description: '답을 바꾸는 미정이 있어 실제 답에 함께 쓴 질문. 단순 도움말 질문은 제외.',
        properties: {
          question: { type: 'string', description: '이번 답에 실제로 쓴 질문 문장 그대로' },
          changesAnswerFor: { type: 'string', description: '이 답에 따라 달라지는 결과나 결정' },
        },
        required: ['question', 'changesAnswerFor'],
      },
      continueFrom: {
        type: 'string',
        description: '다른 대화에서 이어받을 작업 목록 중 지금 이어가는 현재 합의나 미정 질문을 글자 그대로',
      },
      continueFromRef: {
        type: 'string',
        description: '다른 대화에서 이어받을 작업에 표시된 턴 한정 선택자(예: P1). 영구 작업 신분이 아니다.',
      },
      noChange: {
        type: 'boolean',
        description: '이번 턴에 새 합의·수정·철회·미정 변화가 없으면 true. 아무 사건도 만들지 않는 정상 결과다.',
      },
    },
  },
}, {
  name: 'memory.propose',
  description: '사용자가 앞으로도 지켜 달라는 선호·방식·원칙, 그리고 **기억해 달라고 명시한'
    + ' 자기 사실**(습관·상태 — kind: user_fact)을 이걸로 적는다.'
    + ' **적지 않았다면 "앞으로 기억할게" 같은 약속을 하지 않는다.**'
    + ' 사용자가 지금 말로 선언한 선호는 `evidence` 를 함께 내면 확인 카드 없이 바로 반영되고'
    + ' 사용자가 나중에 되돌릴 수 있다. 그 밖(요약한 문장·운영 원칙)은 사용자 확인을 거친다.'
    + ' 사용자의 말이 **앞으로도 지킬 것인지 이번 답에만 해당하는지**는 네가 판단해'
    + ' `evidence.appliesTo` 로 알려 준다 — T5 는 그 말을 들었을 뿐 범위를 알지 못한다.'
    + ' API 키·토큰·비밀번호·주민번호 같은 민감한 값은 적거나 기억했다고 말하지 않는다.'
    + ' 이미 기억된 것을 취소·중단하겠다는 말은 새 기억이 아니다 — `memory.withdraw` 로 지운다.',
  parameters: {
    type: 'object',
    properties: {
      // ④ 진단(2026-08-09): 씨앗 "밤마다 콜라 … 기억해 둬"에 모델이 채널을 3+1회 연속 안
      // 불렀다 — 정의역(선호·원칙)에 **사용자 사실**의 자리가 없어서다. 낱말 그물이 아니라
      // 종류를 만든다(구조). user_fact 는 자동 반영 없이 확인 카드 경로만 탄다.
      kind: { type: 'string', enum: ['preference', 'operating_principle', 'user_fact'], description: '선호(방식·취향)면 preference, T5 행동을 규율하는 규칙(반드시/절대)이면 operating_principle, 사용자가 기억해 달라고 한 자기 사실(습관·상태)이면 user_fact' },
      statement: {
        type: 'string',
        description: '기억할 내용. **`evidence.utteranceQuote` 와 글자까지 똑같이 적으면**'
          + ' 확인 카드 없이 바로 반영되고 사용자는 되돌리기만 보면 된다.'
          + ' 한 글자라도 다르게 요약·정리하면 사용자에게 확인 클릭이 생긴다.'
          + ' 사용자의 말을 다듬고 싶어도, 지금 한 선언이면 그대로 옮기는 편이 사용자에게 낫다.',
      },
      evidence: {
        type: 'object',
        description: '이번 턴 사용자 원문의 근거 — **항상 채운다.** 이게 없으면 사용자가 방금'
          + ' 분명히 말한 선호도 확인 카드를 거쳐야 해서 사용자에게 불필요한 클릭이 생긴다.',
        properties: {
          utteranceQuote: { type: 'string', description: '이번 턴 사용자 원문에서 **글자 그대로** 따온 조각. 바꿔 쓰지 않는다.' },
          speechAct: {
            type: 'string',
            enum: ['declaration', 'question', 'quotation', 'negation', 'recollection', 'unknown'],
            description: '지금 선언이면 declaration. 묻는 말·남의 말 인용·부정·과거 회상이면 그에 맞게.',
          },
          appliesTo: {
            type: 'string',
            enum: ['from_now_on', 'this_turn_only'],
            description: '이 말이 **앞으로도 지킬 것**이면 from_now_on,'
              + ' **이번 답에만** 해당하면 this_turn_only.'
              + ' "이번만"·"오늘만"·"방금 것만"처럼 한 번짜리 요청은 this_turn_only 다 —'
              + ' 그렇게 적으면 이번 답에는 그대로 반영되고 기억으로는 남지 않는다.'
              + ' 이 칸이 비면 T5 는 범위를 모르므로 사용자에게 확인을 한 번 묻게 된다.',
          },
        },
        required: ['utteranceQuote', 'speechAct', 'appliesTo'],
      },
    },
    required: ['statement', 'evidence'],
  },
}, {
  name: 'memory.cite',
  // 설명은 **사실 공급**이다. 앞 판에는 "부르지 않아도 아무 문제 없다"라고 써 뒀는데,
  // 라이브에서 모델은 그걸 "건너뛰어도 되는 것"으로 읽고 한 번도 부르지 않았다(실측 0/1).
  // 압박 문구로 바꾸지도 않는다 — 그러면 참고하지도 않은 것을 적어 통계가 통째로 거짓이 된다.
  description: 'T5 는 어떤 기억을 **보여줬는지**는 알지만, 그중 **무엇이 실제로 도움이 됐는지는**'
    + ' 알지 못한다. 그건 이번 답을 쓴 쪽만 안다.'
    + ' 위 `[반영된 기억]`·`[다른 대화에서 이어받을 수 있는 작업]` 중 이번 답에 실제로 참고한'
    + ' 항목이 있으면 그 문장을 **그대로** 적는다. 요약하거나 바꿔 쓰면 대조되지 않는다.'
    + ' 참고한 것이 하나도 없으면 이 호출을 넣지 않는다 — 그것도 T5 에게는 사실이다.'
    + ' 보여주지 않은 것은 적지 않는다.',
  parameters: {
    type: 'object',
    properties: {
      used: {
        type: 'array',
        description: '이번 턴에 보여준 `[반영된 기억]`·`[다른 대화에서 이어받을 수 있는 작업]`'
          + ' 항목의 문장을 **그대로** 적는다. 요약하거나 바꿔 쓰면 대조되지 않는다.',
        items: { type: 'string' },
      },
    },
    required: ['used'],
  },
}, {
  name: 'memory.correction',
  // 같은 이유로 고쳤다. "확신이 없으면 부르지 않는다"는 모델에게 기본값이 되어, 사용자가
  // 명백히 고치는 턴에서도 호출이 0이었다(실측). 대신 이 표식이 무엇을 하는지를 알려 준다.
  description: '사용자가 **방금 한 답을 바로잡고 있으면** 이걸 부른다.'
    + ' 새 요청이나 추가 부탁은 정정이 아니다 — 앞 답이 사용자 뜻과 달라서 고치는 경우다.'
    + ' T5 는 이 표식으로 **어떤 기억이 자꾸 어긋나는지**를 본다. 한 번으로는 아무 것도'
    + ' 바뀌지 않는다 — 같은 기억이 여러 번 걸릴 때만 사람이 들여다본다.'
    + ' 기억을 지우거나 바꾸지 않는다.'
    + ' 무엇이 어긋났는지 **지목**해야 표식이 선다 — 직전 답에 놓였던 문장 중 하나를 그대로 적는다.',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: '직전 답이 놓고 썼던 기억·이어받을 작업 문장 중 사용자 뜻과 어긋난 것'
          + ' **하나를 그대로**. 요약하거나 바꿔 쓰면 대조되지 않는다.',
      },
      reason: { type: 'string', description: '무엇이 사용자 뜻과 달랐는지 한 줄 — 표식에 남는다' },
    },
    required: ['target'],
  },
}, {
  name: 'memory.withdraw',
  // r14 실측: "방금"이 범위를 좁혀, 몇 턴 지난 기억의 철회("그 규칙은 이제 그만할래")에서
  // 모델이 withdraw 대신 propose 를 골랐다 — 철회 발화가 새 선호로 쌓여 모순이 공존했다.
  description: '사용자가 저장된 기억(방금 것이든 이전 것이든)을 취소·철회·그만하겠다고 하면'
    + ' 이걸로 지운다. 파일 되돌리기가 아니다 — 기억만 지운다. 무엇을 지울지는 저장된 문장으로'
    + ' 지목한다. 지울 대상이 분명하지 않으면 부르지 말고 사용자에게 무엇을 말하는지 물어본다.',
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', description: '지울 기억의 문장(저장된 그대로) 또는 그 일부' },
      reason: { type: 'string', description: '사용자가 왜 취소했는지 — 원장에 남는다' },
    },
    required: ['target'],
  },
}, {
  // **배열 끝에 붙인다 — 접두를 살리려고**(불변식 A · 2026-08-05).
  // 처음엔 맨 앞에 뒀는데 기억 채널 넷이 통째로 밀려 **접두가 죽었다**(옛 배치와 6/10 만 겹쳤다).
  // 내가 바로 앞 커밋에 "새 손은 끝에 붙어 접두가 산다"고 적어 놓고 그 자리에서 어겼다.
  // 검사가 아니라 내가 직접 재서 잡았다 — 손 축만 재는 검사는 통제 채널 이동을 안 본다.

  // ── **묻는 일을 모델에게 돌려준다**(S8 ④) ──────────────────────────────
  //
  // 지금은 **런타임이 스스로 묻는다** — `turn.js` 세 자리에서 `kind:'clarify'` 를 만들고
  // 문장도 커널이 쓴다. 그 사고가 파일에 그대로 적혀 있다: `"그거 정리해줘"` 에 커널이
  // 하드코딩 문장으로 되물었고, **모델은 할 수 있었다.** 커널이 프로세스 대신 말하는 자리다(§1).
  //
  // **손이 하나 늘면 모델이 더 자주 물 수 있다** — 그게 자동성 헌장을 갉는 가장 흔한 길이다
  // (오너 지시: *"안 그러면 질문 수도꼭지가 된다"*). 그래서 계약을 좁게 세운다:
  //   · **질문은 하나만**(판단 헌장 <질문> 그대로 — 배열이 아니다)
  //   · **고를 것을 함께 준다**(2~4개). 선택지 없는 질문은 사용자에게 문장 쓰기를 떠넘기는 것이다
  //   · 답이 방향을 **실제로 바꿀 때만** — 이건 문구가 아니라 헌장이 이미 규율한다
  //
  // 실행이 아니다. 이 채널이 오면 그 턴은 묻고 끝나며, **한 턴에 질문은 최대 하나**다.
  name: 'ask.user',
  description: '답이 없으면 진행 방향이 실제로 갈리는 것 하나를 사용자에게 묻는다.'
    + ' **묻지 않고 할 수 있으면 묻지 않는다** — 할 수 있는 것을 먼저 하고, 모르면 합리적으로'
    + ' 가정한 뒤 무엇을 가정했는지 밝히는 편이 낫다.'
    + ' 고를 것을 2~4개 함께 준다(그게 없으면 사용자가 문장을 다시 써야 한다).'
    + ' 이걸 부르면 그 턴은 묻고 끝난다 — 같은 턴에 다른 손을 함께 골라도 실행되지 않는다.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: '한 문장. 한 번에 답할 수 있게.' },
      options: {
        type: 'array', minItems: 2, maxItems: 4,
        description: '사용자가 고를 것. 각각 짧게.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: '고를 말' },
            why: { type: 'string', description: '이걸 고르면 무엇이 달라지는가(있으면)' },
          },
          required: ['label'],
        },
      },
    },
    required: ['question', 'options'],
  },
}]);

const CONTROL_NAMES = new Set(MODEL_CONTROL_SCHEMAS.map((s) => s.name));
const MEMORY_KINDS = new Set(['preference', 'operating_principle', 'user_fact']);
const APPLIES_TO = new Set(['from_now_on', 'this_turn_only']);
const SPEECH_ACTS = new Set(['declaration', 'question', 'quotation', 'negation', 'recollection', 'unknown']);

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 한 턴의 모든 모델 호출이 낸 work.state를 순서대로 합친다. 충돌·상한은 부분 수용하지 않는다. */
export function mergeWorkStateProposals(proposals = []) {
  const changes = [];
  let openQuestion;
  let continueFrom;
  let continueFromRef;
  for (const proposal of proposals.filter(Boolean)) {
    for (const change of proposal.changes ?? []) {
      if (!changes.some((existing) => sameValue(existing, change))) changes.push(change);
      if (changes.length > 6) return null;
    }
    if (proposal.openQuestion) {
      if (openQuestion && !sameValue(openQuestion, proposal.openQuestion)) return null;
      openQuestion = proposal.openQuestion;
    }
    if (proposal.continueFrom) {
      if (continueFrom && continueFrom !== proposal.continueFrom) return null;
      continueFrom = proposal.continueFrom;
    }
    if (proposal.continueFromRef) {
      if (continueFromRef && continueFromRef !== proposal.continueFromRef) return null;
      continueFromRef = proposal.continueFromRef;
    }
  }
  if (!changes.length && !openQuestion && !continueFrom && !continueFromRef) return null;
  return {
    changes,
    ...(openQuestion ? { openQuestion } : {}),
    ...(continueFrom ? { continueFrom } : {}),
    ...(continueFromRef ? { continueFromRef } : {}),
  };
}

/**
 * 모델에게 보여줄 전체 스키마 = 실행 가능한 손 + 통제 채널. 모든 모델 호출 자리가 이걸 쓴다.
 * 손이 하나도 없는 호출에는 통제 채널도 얹지 않는다 — 도구 없는 호출은 스트리밍 단발로 돌고
 * (model-provider: 도구를 준 턴은 단발) 도구 호출 자체를 처리하지 않는 경로라, 통제 스키마만
 * 얹으면 조각 스트림이 꺼지고 제안은 어차피 소비되지 않는다.
 */
// 소비자가 실제로 붙은 통제 채널만 모델에게 보인다. 선언은 배열 하나(두 진실 금지)이고,
// **노출은 소비 배선이 끝난 뒤 본선이 연다** — 선언과 노출을 같은 순간에 묶으면, 아직 아무도
// 받지 않는 제안을 모델이 하고 사용자에게는 된 것처럼 들린다.
const 준비된통제 = new Set(['ask.user', 'memory.propose', 'memory.cite', 'memory.correction', 'memory.withdraw']);

export function modelSchemasFor(selfState, enabledControls = []) {
  const hands = toolSchemasFor(selfState);
  // 제한 위임의 자식은 부모 요청을 실행하는 손이지, 장기 기억·성장 정책의 저자가 아니다.
  // null 은 그 경계를 아는 호출자만 쓰는 명시적 통제 채널 차단이다. 기본 대화는 기존 채널을 유지한다.
  if (enabledControls === null) return hands;
  // 런타임 소비자가 실제로 설치된 채널만 턴 단위로 더 연다. 호출자가 이름을 넘기는 것만으로는
  // 충분하지 않다 — 선언된 통제 채널과의 교집합이어야 하며, 기본값은 기존 기억 채널뿐이다.
  const enabled = new Set([...준비된통제, ...(enabledControls ?? [])]);
  const controls = MODEL_CONTROL_SCHEMAS.filter((sch) => enabled.has(sch.name));
  // ── **손에 매이는 것은 실행 제안뿐이다**(원인 ① 후반 · 라이브 실측 2026-08-10) ──────
  //
  // 예전엔 `hands.length ? [...hands, ...controls] : hands` 였다 — 연결된 손이 하나도 없으면
  // **상태·기억 채널까지 통째로 사라졌다.** S1(고객 문의 운영안)은 손이 필요 없는 대화 작업이라
  // 정확히 그 자리였고, 정산 게이트를 고친 뒤에도 `work.state` 스키마가 없어 `reviewOpened:false` —
  // **원장이 시작될 수 없었다**(12턴 · 2회차 · WorkEvent 0).
  //
  // 원래 계약(S7 ⑦)이 지키려던 것은 *"손이 없는데 실행 제안 채널만 실리지 않는다"* 이고,
  // 그건 `skill.propose`·`automation.propose`·`agent.propose` 의 성질이다 — 셋 다 나중에
  // **실행되는 것**을 제안하므로 손이 없으면 못 지킬 약속이 된다. `work.state`·기억·`ask.user`
  // 는 실행이 아니라 **상태와 이해**를 다루므로 손과 다른 축이다. 축을 하나로 묶어 두면
  // 손 없는 대화 작업에서 OS 는 아무것도 확정하지 못한다.
  const 실행제안 = new Set(['skill.propose', 'automation.propose', 'agent.propose']);
  return [...hands, ...controls.filter((sch) => hands.length || !실행제안.has(sch.name))];
}

/**
 * 모델 호출 결과의 **단일 분리 경계.** 통제 호출을 골라내고 실행 후보만 남긴다.
 * 문장이 비었거나 종류가 틀리면 조용히 버린다 — 잘못된 제안이 후보가 되는 것보다
 * 안 되는 쪽이 안전하다(후보조차 사용자 확인 대상이므로).
 * @param {Array<{name:string, args?:object}>} [toolCalls]
 * @returns {{memorySuggestion:object|null, memoryWithdrawal:object|null,
 *   memoryCitation:{used:string[]}|null, memoryCorrection:object|null, rest:Array}}
 */
export function splitModelControlCalls(toolCalls = []) {
  const rest = [];
  // W2 사전 배선: 세 슬롯의 반환 자리. 지금은 걷어내기만 하고(실행 경로로 안 샌다) 소비는
  // 각 작업선이 자기 파일에서 붙인다 — 이 파일을 다시 열지 않게 하는 것이 사전 배선의 목적이다.
  let askUser = null;
  let skillProposal = null;
  let automationProposal = null;
  let agentProposal = null;
  const workStateProposals = [];
  let workStateSeen = false;
  let workStateNoChange = false;
  let memorySuggestion = null;
  let memoryWithdrawal = null;
  // S5-2: 모델의 **주장**이다. 여기서는 받아 적기만 하고, 보인 것과의 대조는 커널이 한다.
  let memoryCitation = null;
  // S5-3: 정정 여부는 **모델이 알려준다.** Runtime 에 낱말 규칙을 두지 않는다.
  let memoryCorrection = null;
  for (const c of toolCalls) {
    if (!CONTROL_NAMES.has(c?.name)) { rest.push(c); continue; }
    if (c.name === 'ask.user') {
      // **못 쓸 질문은 조용히 버린다.** 빈 문장이나 선택지 하나는 고르는 게 아니라 떠넘기는 것이고,
      // 그대로 내보내면 사용자가 문장을 다시 써야 한다 — 물어서 마찰만 늘린 턴이 된다.
      const 문장 = String(c.args?.question ?? '').trim();
      const 고를것 = (Array.isArray(c.args?.options) ? c.args.options : [])
        .map((o) => ({ label: String(o?.label ?? '').trim(), ...(o?.why ? { why: String(o.why) } : {}) }))
        .filter((o) => o.label)
        .slice(0, 4);
      if (문장 && 고를것.length >= 2) askUser = { question: 문장, options: 고를것 };
      continue;
    }
    if (c.name === 'skill.propose') { skillProposal = c.args ?? null; continue; }
    if (c.name === 'automation.propose') { automationProposal = c.args ?? null; continue; }
    if (c.name === 'agent.propose') { agentProposal = c.args ?? null; continue; }
    if (c.name === 'work.state') {
      workStateSeen = true;
      const allowed = new Set(['agreement_set', 'agreement_superseded', 'agreement_retracted', 'question_resolved']);
      const changes = Array.isArray(c?.args?.changes) ? c.args.changes.flatMap((entry) => {
        const type = allowed.has(entry?.type) ? entry.type : null;
        const utteranceQuote = String(entry?.utteranceQuote ?? '').trim().slice(0, 300);
        const targetQuote = String(entry?.targetQuote ?? '').trim().slice(0, 300);
        if (!type || !utteranceQuote) return [];
        return [{ type, utteranceQuote, ...(targetQuote ? { targetQuote } : {}) }];
      }) : [];
      const question = String(c?.args?.openQuestion?.question ?? '').trim().slice(0, 300);
      const changesAnswerFor = String(c?.args?.openQuestion?.changesAnswerFor ?? '').trim().slice(0, 300);
      const openQuestion = question && changesAnswerFor ? { question, changesAnswerFor } : null;
      const continueFrom = String(c?.args?.continueFrom ?? '').trim().slice(0, 300);
      const continueFromRef = String(c?.args?.continueFromRef ?? '').trim().slice(0, 32);
      if (c?.args?.noChange === true && !changes.length && !openQuestion && !continueFrom && !continueFromRef) {
        workStateNoChange = true;
        continue;
      }
      if (changes.length || openQuestion || continueFrom || continueFromRef) {
        workStateProposals.push({
          changes,
          ...(openQuestion ? { openQuestion } : {}),
          ...(continueFrom ? { continueFrom } : {}),
          ...(continueFromRef ? { continueFromRef } : {}),
        });
      }
      continue;
    }
    if (c.name === 'memory.propose') {
      const statement = String(c?.args?.statement ?? '').trim().slice(0, 300);
      const kind = MEMORY_KINDS.has(c?.args?.kind) ? c.args.kind : 'preference';
      // evidence 는 자동 반영 판정의 재료다. 여기서 판정하지 않고 **그대로 전달**한다 —
      // 판정 자리를 하나(서버의 자동 반영 게이트)로 두어야 두 진실이 생기지 않는다.
      const quote = String(c?.args?.evidence?.utteranceQuote ?? '').trim();
      const act = SPEECH_ACTS.has(c?.args?.evidence?.speechAct) ? c.args.evidence.speechAct : 'unknown';
      // 범위는 모델이 말한 것만 싣는다 — 모르는 값은 **비워 둔다.** 여기서 기본값을 채우면
      // Runtime 이 범위를 추측하는 것이 되고, 그게 "이번만"이 영구 선호가 된 구멍이었다.
      const 범위 = APPLIES_TO.has(c?.args?.evidence?.appliesTo) ? c.args.evidence.appliesTo : null;
      if (statement) {
        memorySuggestion = { kind, statement };
        if (quote) {
          memorySuggestion.evidence = { utteranceQuote: quote, speechAct: act };
          if (범위) memorySuggestion.evidence.appliesTo = 범위;
        }
      }
    }
    if (c.name === 'memory.cite') {
      const used = Array.isArray(c?.args?.used)
        ? c.args.used.map((x) => String(x ?? '').trim().slice(0, 300)).filter(Boolean)
        : [];
      if (used.length) memoryCitation = { used };
    }
    if (c.name === 'memory.correction') {
      const target = String(c?.args?.target ?? '').trim().slice(0, 300);
      const reason = String(c?.args?.reason ?? '').trim().slice(0, 200);
      memoryCorrection = { ...(target ? { target } : {}), ...(reason ? { reason } : {}) };
    }
    if (c.name === 'memory.withdraw') {
      const target = String(c?.args?.target ?? '').trim().slice(0, 300);
      const reason = String(c?.args?.reason ?? '').trim().slice(0, 200);
      if (target) memoryWithdrawal = { target, ...(reason ? { reason } : {}) };
    }
  }
  const workStateProposal = mergeWorkStateProposals(workStateProposals);
  return {
    memorySuggestion, memoryWithdrawal, memoryCitation, memoryCorrection,
    askUser,
    skillProposal, automationProposal, agentProposal,
    workStateProposal, workStateSeen, workStateNoChange,
    workStateCandidateCount: workStateProposals.length,
    rest,
  };
}
