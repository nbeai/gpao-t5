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
    },
    required: ['name', 'purpose'],
  },
}, {
  name: 'automation.propose',
  description: '사용자가 "매주 금요일에", "매일 아침" 처럼 **시점**을 정해 반복을 맡기면 이걸로 적는다.'
    + ' 실행이 아니다 — 승인 전에는 아무 일도 예약되지 않는다.'
    + ' 외부로 나가는 일(전송·공개·결제)은 매 실행마다 사용자 확인이 남는다는 사실을 함께 말한다.',
  parameters: {
    type: 'object',
    properties: {
      statement: { type: 'string', description: '무엇을 언제 반복하는지 사람 말로' },
      kind: { type: 'string', enum: ['once', 'interval', 'daily', 'weekly'], description: '반복의 종류' },
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
  name: 'memory.propose',
  description: '사용자가 앞으로도 지켜 달라는 선호·방식·원칙을 말하면 이걸로 적는다.'
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
      kind: { type: 'string', enum: ['preference', 'operating_principle'], description: '선호(방식·취향)면 preference, T5 행동을 규율하는 규칙(반드시/절대)이면 operating_principle' },
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
}]);

const CONTROL_NAMES = new Set(MODEL_CONTROL_SCHEMAS.map((s) => s.name));
const MEMORY_KINDS = new Set(['preference', 'operating_principle']);
const APPLIES_TO = new Set(['from_now_on', 'this_turn_only']);
const SPEECH_ACTS = new Set(['declaration', 'question', 'quotation', 'negation', 'recollection', 'unknown']);

/**
 * 모델에게 보여줄 전체 스키마 = 실행 가능한 손 + 통제 채널. 모든 모델 호출 자리가 이걸 쓴다.
 * 손이 하나도 없는 호출에는 통제 채널도 얹지 않는다 — 도구 없는 호출은 스트리밍 단발로 돌고
 * (model-provider: 도구를 준 턴은 단발) 도구 호출 자체를 처리하지 않는 경로라, 통제 스키마만
 * 얹으면 조각 스트림이 꺼지고 제안은 어차피 소비되지 않는다.
 */
// 소비자가 실제로 붙은 통제 채널만 모델에게 보인다. 선언은 배열 하나(두 진실 금지)이고,
// **노출은 소비 배선이 끝난 뒤 본선이 연다** — 선언과 노출을 같은 순간에 묶으면, 아직 아무도
// 받지 않는 제안을 모델이 하고 사용자에게는 된 것처럼 들린다.
const 준비된통제 = new Set(['memory.propose', 'memory.cite', 'memory.correction', 'memory.withdraw']);

export function modelSchemasFor(selfState, enabledControls = []) {
  const hands = toolSchemasFor(selfState);
  // 런타임 소비자가 실제로 설치된 채널만 턴 단위로 더 연다. 호출자가 이름을 넘기는 것만으로는
  // 충분하지 않다 — 선언된 통제 채널과의 교집합이어야 하며, 기본값은 기존 기억 채널뿐이다.
  const enabled = new Set([...준비된통제, ...(enabledControls ?? [])]);
  const controls = MODEL_CONTROL_SCHEMAS.filter((sch) => enabled.has(sch.name));
  return hands.length ? [...hands, ...controls] : hands;
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
  let skillProposal = null;
  let automationProposal = null;
  let agentProposal = null;
  let memorySuggestion = null;
  let memoryWithdrawal = null;
  // S5-2: 모델의 **주장**이다. 여기서는 받아 적기만 하고, 보인 것과의 대조는 커널이 한다.
  let memoryCitation = null;
  // S5-3: 정정 여부는 **모델이 알려준다.** Runtime 에 낱말 규칙을 두지 않는다.
  let memoryCorrection = null;
  for (const c of toolCalls) {
    if (!CONTROL_NAMES.has(c?.name)) { rest.push(c); continue; }
    if (c.name === 'skill.propose') { skillProposal = c.args ?? null; continue; }
    if (c.name === 'automation.propose') { automationProposal = c.args ?? null; continue; }
    if (c.name === 'agent.propose') { agentProposal = c.args ?? null; continue; }
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
  return { memorySuggestion, memoryWithdrawal, memoryCitation, memoryCorrection, skillProposal, automationProposal, agentProposal, rest };
}
