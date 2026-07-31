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
  name: 'memory.propose',
  description: '사용자가 앞으로도 지켜 달라는 선호·방식·원칙을 말하면 이걸로 적는다.'
    + ' **적지 않았다면 "앞으로 기억할게" 같은 약속을 하지 않는다.**'
    + ' 사용자가 지금 말로 선언한 선호는 `evidence` 를 함께 내면 확인 카드 없이 바로 반영되고'
    + ' 사용자가 나중에 되돌릴 수 있다. 그 밖(요약한 문장·운영 원칙)은 사용자 확인을 거친다.'
    + ' 한 번 요청("이번만")은 적지 않는다.'
    + ' API 키·토큰·비밀번호·주민번호 같은 민감한 값은 적거나 기억했다고 말하지 않는다.',
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
        },
        required: ['utteranceQuote', 'speechAct'],
      },
    },
    required: ['statement', 'evidence'],
  },
}, {
  name: 'memory.cite',
  description: '이번 답에 **실제로 참고한** 반영된 기억·이어받을 작업이 있으면 그 문장을 그대로 적는다.'
    + ' 참고하지 않았으면 부르지 않는다 — 안 부르는 것이 정상이고, 부르지 않아도 아무 문제 없다.'
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
  description: '사용자가 **방금 내가 한 답을 고치고 있으면** 이걸 부른다.'
    + ' 새 요청이나 추가 부탁은 정정이 아니다 — 앞 답이 사용자 뜻과 달라서 바로잡는 경우만이다.'
    + ' 부르지 않아도 아무 문제 없다. 확신이 없으면 부르지 않는다.'
    + ' 이건 기억을 지우거나 바꾸지 않는다 — 나중에 사람이 들여다볼 표식만 남는다.',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: '무엇이 사용자 뜻과 달랐는지 한 줄 — 표식에 남는다' },
    },
  },
}, {
  name: 'memory.withdraw',
  description: '사용자가 방금 기억한 것을 취소·철회해 달라고 하면 이걸로 지운다.'
    + ' 파일 되돌리기가 아니다 — 기억만 지운다. 무엇을 지울지는 저장된 문장으로 지목한다.'
    + ' 지울 대상이 분명하지 않으면 부르지 말고 사용자에게 무엇을 말하는지 물어본다.',
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
const SPEECH_ACTS = new Set(['declaration', 'question', 'quotation', 'negation', 'recollection', 'unknown']);

/**
 * 모델에게 보여줄 전체 스키마 = 실행 가능한 손 + 통제 채널. 모든 모델 호출 자리가 이걸 쓴다.
 * 손이 하나도 없는 호출에는 통제 채널도 얹지 않는다 — 도구 없는 호출은 스트리밍 단발로 돌고
 * (model-provider: 도구를 준 턴은 단발) 도구 호출 자체를 처리하지 않는 경로라, 통제 스키마만
 * 얹으면 조각 스트림이 꺼지고 제안은 어차피 소비되지 않는다.
 */
export function modelSchemasFor(selfState) {
  const hands = toolSchemasFor(selfState);
  return hands.length ? [...hands, ...MODEL_CONTROL_SCHEMAS] : hands;
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
  let memorySuggestion = null;
  let memoryWithdrawal = null;
  // S5-2: 모델의 **주장**이다. 여기서는 받아 적기만 하고, 보인 것과의 대조는 커널이 한다.
  let memoryCitation = null;
  // S5-3: 정정 여부는 **모델이 알려준다.** Runtime 에 낱말 규칙을 두지 않는다.
  let memoryCorrection = null;
  for (const c of toolCalls) {
    if (!CONTROL_NAMES.has(c?.name)) { rest.push(c); continue; }
    if (c.name === 'memory.propose') {
      const statement = String(c?.args?.statement ?? '').trim().slice(0, 300);
      const kind = MEMORY_KINDS.has(c?.args?.kind) ? c.args.kind : 'preference';
      // evidence 는 자동 반영 판정의 재료다. 여기서 판정하지 않고 **그대로 전달**한다 —
      // 판정 자리를 하나(서버의 자동 반영 게이트)로 두어야 두 진실이 생기지 않는다.
      const quote = String(c?.args?.evidence?.utteranceQuote ?? '').trim();
      const act = SPEECH_ACTS.has(c?.args?.evidence?.speechAct) ? c.args.evidence.speechAct : 'unknown';
      if (statement) {
        memorySuggestion = { kind, statement };
        if (quote) memorySuggestion.evidence = { utteranceQuote: quote, speechAct: act };
      }
    }
    if (c.name === 'memory.cite') {
      const used = Array.isArray(c?.args?.used)
        ? c.args.used.map((x) => String(x ?? '').trim().slice(0, 300)).filter(Boolean)
        : [];
      if (used.length) memoryCitation = { used };
    }
    if (c.name === 'memory.correction') {
      const reason = String(c?.args?.reason ?? '').trim().slice(0, 200);
      memoryCorrection = { ...(reason ? { reason } : {}) };
    }
    if (c.name === 'memory.withdraw') {
      const target = String(c?.args?.target ?? '').trim().slice(0, 300);
      const reason = String(c?.args?.reason ?? '').trim().slice(0, 200);
      if (target) memoryWithdrawal = { target, ...(reason ? { reason } : {}) };
    }
  }
  return { memorySuggestion, memoryWithdrawal, memoryCitation, memoryCorrection, rest };
}
