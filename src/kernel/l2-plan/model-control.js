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
  description: '사용자가 앞으로도 지켜 달라는 선호·방식·원칙을 말하면 이걸로 후보를 적는다.'
    + ' **후보를 적지 않았다면 "앞으로 기억할게" 같은 약속을 하지 않는다.**'
    + ' 한 번 요청("이번만")은 적지 않는다.'
    + ' `intent` 는 이번 발화가 **어떤 말인지**다 — 이걸 정확히 고르는 것이 이 호출의 핵심이다.'
    + ' `declared` 만 사용자가 확인 없이 바로 반영되고, 나머지는 반영되지 않는다.',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['preference', 'operating_principle'], description: '선호(방식·취향)면 preference, T5 행동을 규율하는 규칙(반드시/절대)이면 operating_principle' },
      statement: { type: 'string', description: '기억할 내용 — 사용자의 뜻을 보존한 한 문장(사람 말)' },
      // **의도는 OS 가 문자열로 알아낼 수 없다**(감사 TG5-CX-01 두 판 실패):
      // `「…가 좋아」라고 내가 말한 적 있어?` 는 사용자 발화이고 문장도 같지만 **묻는 말**이다.
      // 정규식·문자열 일치로는 선언과 질문·인용·부정·철회를 구분할 수 없다. 말귀는 모델이 한다 —
      // 그래서 그 판단을 **칸으로 요구**한다. 빈 칸을 두면 모델이 그 빈칸을 지어낸다.
      intent: {
        type: 'string',
        enum: ['declared', 'asked', 'quoted', 'negated', 'withdrawn'],
        description: '사용자가 지금 이것을 **선언**했으면 declared.'
          + ' 물었으면 asked(예: "…라고 내가 말한 적 있어?"), 남의 말·과거 말을 인용했으면 quoted,'
          + ' 아니라고 했으면 negated, 전에 한 말을 거뒀으면 withdrawn.',
      },
    },
    required: ['statement', 'intent'],
  },
}]);

const CONTROL_NAMES = new Set(MODEL_CONTROL_SCHEMAS.map((s) => s.name));
const MEMORY_KINDS = new Set(['preference', 'operating_principle']);
/** 발화 의도 — 선언만 무마찰 반영 대상이다. 나머지는 장기 영향 0(§12 · 감사 TG5-CX-01). */
const INTENTS = new Set(['declared', 'asked', 'quoted', 'negated', 'withdrawn']);

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
 * @returns {{memorySuggestion:{kind:string,statement:string}|null, rest:Array}}
 */
export function splitModelControlCalls(toolCalls = []) {
  const rest = [];
  let memorySuggestion = null;
  for (const c of toolCalls) {
    if (!CONTROL_NAMES.has(c?.name)) { rest.push(c); continue; }
    if (c.name === 'memory.propose') {
      const statement = String(c?.args?.statement ?? '').trim().slice(0, 300);
      const kind = MEMORY_KINDS.has(c?.args?.kind) ? c.args.kind : 'preference';
      // **출처와 의도를 함께 남긴다**(감사 TG5-CX-01). 출처는 "누가 냈나", 의도는 "어떤 말인가"다.
      // 둘 중 하나만 있으면 판정이 대용물로 흐른다 — 출처만 보면 질문이 선언이 되고,
      // 의도만 보면 모델 추측이 사용자 선언이 된다.
      // 의도를 안 밝히면 `unknown` 이고, 모르는 것은 선언으로 치지 않는다.
      const intent = INTENTS.has(c?.args?.intent) ? c.args.intent : 'unknown';
      if (statement) memorySuggestion = { kind, statement, source: 'model_proposal', intent };
    }
  }
  return { memorySuggestion, rest };
}
