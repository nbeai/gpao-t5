// L1 · Model Prompt Profile (P2-5a) — **정체성은 하나, 운영 보정만 모델별로 얇게.**
//
// 오너 지시(2026-07-27): 모델마다 다른 인격을 붙이는 게 아니다. T5 의 정체성과 판단 헌장은
// 그대로 두고, provider·모델 계열이 실제로 다르게 구는 지점만 **얇은 보정**으로 얹는다.
//   구조: `T5 기본 헌장 + provider/model 운영 보정 + 현재 연결·도구 사실`
//
// 참조 흡수(§24.1 — 원리만): OpenClaw 는 provider 플러그인이 프롬프트를 **대체하지 않고**
// 이름 붙은 몇 개 절(interaction_style / tool_call_style / execution_bias)만 갈아 끼우고,
// 고정 접두는 캐시 경계 위에 둔다. Hermes 는 stable 층에 model-family operational guidance 를 둔다.
// 우리는 그 원리를 T5 계약(도구는 런타임이 집행, 승인 경계 불변) 위에서 다시 만든다.
//
// 규칙:
//   · 보정은 **운영**만 — 정체성·안전 경계·승인 규칙은 절대 건드리지 않는다.
//   · 짧게. 한 계열당 몇 줄. 길어지면 그건 헌장에 있어야 할 내용이다.
//   · 와이어 제약(system 역할 미지원 등)은 프롬프트가 아니라 provider spec 이 처리한다.

/** 모델 id → 계열. provider id 를 알면 그걸 먼저 쓴다(같은 계열이 여러 provider 로 온다). */
export function modelFamily({ providerId, modelId } = {}) {
  const id = String(modelId ?? '').toLowerCase();
  if (providerId === 'chatgpt_oauth' || providerId === 'openai_oauth') return 'openai';
  if (providerId === 'anthropic' || /^claude/.test(id)) return 'anthropic';
  if (providerId === 'gemini' || /^gemini/.test(id)) return 'gemini';
  if (providerId === 'beai' || /^beai/.test(id)) return 'beai';
  if (providerId === 'openai' || /^(gpt|o\d)/.test(id)) return 'openai';
  if (providerId === 'openai_compatible') return 'local';
  return 'unknown';
}

// 계열별 운영 보정. **왜 이 줄이 있는지**를 주석으로 남긴다 — 근거 없는 보정은 누더기가 된다.
const PROFILES = {
  // 실측(2026-07-27, gpt-5.5): 사실을 주고 헌장에 "유추 가능하면 묻지 말라"고 써도 되물었다.
  // OpenClaw 의 gpt-5 오버레이도 같은 자리에 "합리적 가정으로 막힘을 풀고 짧게 밝혀라"를 둔다.
  openai: [
    '막히면 되묻기보다 합리적 가정으로 진행하고, 무엇을 가정했는지 한 줄로 밝힌다.',
    '되돌릴 수 있고 분명한 일은 바로 한다. 되돌리기 어렵거나 밖으로 나가는 일만 먼저 확인한다.',
    '최신·변동 사실이 필요하면 묻지 말고 먼저 찾는다.',
  ],
  // 긴 맥락에서 앞부분을 다시 요약하며 답을 늘리는 경향 → 지금 바뀐 것만.
  anthropic: [
    '이미 합의된 맥락을 다시 요약하지 않는다. 지금 바뀐 것과 지금 판단을 움직이는 것만 쓴다.',
    '도구가 필요하면 설명보다 먼저 쓴다.',
  ],
  // system_instruction 이 분리돼 있어 사실이 약하게 붙는다 → 사실 우선순위를 명시.
  gemini: [
    '위 [환경]·[지금] 사실이 네 일반 지식보다 우선한다.',
    '형식보다 내용을 먼저 맞춘다.',
  ],
  // 자사 beai: system 역할 미지원은 와이어에서 처리한다(여기서 문장으로 때우지 않는다).
  beai: [],
  // 작은 로컬 모델: 지침이 길면 오히려 흔들린다 → 도구 규칙만 짧고 분명하게.
  local: [
    '도구가 필요하면 한 번에 하나씩 쓴다. 결과를 본 뒤 다음을 정한다.',
    '모르면 지어내지 말고 모른다고 한다.',
  ],
  unknown: [],
};

/**
 * 이 모델에 얹을 운영 보정. 없으면 빈 문자열(보정 없이도 T5 는 온전히 동작한다).
 * @param {{providerId?:string, modelId?:string}} p
 */
export function modelPromptProfile(p = {}) {
  const lines = PROFILES[modelFamily(p)] ?? [];
  return lines.length ? `<이 모델에서 특히>\n${lines.join('\n')}\n</이 모델에서 특히>` : '';
}
