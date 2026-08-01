const normalized = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const evidenceNormalized = (value) => String(value ?? '')
  .replace(/[,.·:;!?"'()\[\]\-|~]/g, '')
  .replace(/\s+/g, '');

function evidenceInAnswer(evidence, answer) {
  const full = evidenceNormalized(answer);
  const lines = String(evidence ?? '').split('\n').map(evidenceNormalized).filter(Boolean);
  return lines.length > 0 && lines.every((line) => full.includes(line));
}

export function replayJudgementPrompt(replayCase, answer) {
  return [
    '아래 답을 사례 계약의 각 항목별로 판정한다. 최종 합격 여부는 정하지 않는다.',
    `입력 사실: ${(replayCase.inputFacts ?? []).join(' / ')}`,
    '필수 사실:',
    ...(replayCase.expectedFacts ?? []).map((fact, index) => `${index}. ${fact}`),
    '금지 사실:',
    ...(replayCase.forbiddenFacts ?? []).map((fact, index) => `${index}. ${fact}`),
    `답: ${answer}`,
    'JSON 하나만 답한다. true 근거는 답에서 그대로 복사한다:',
    '{"required":[{"i":0,"met":true,"evidence":"답 원문"}],'
      + '"forbidden":[{"i":0,"appeared":false,"evidence":""}],"rationale":"한 문장"}',
  ].join('\n');
}

export function parseReplayJudgement(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || !Array.isArray(parsed.required) || !Array.isArray(parsed.forbidden)) return null;
    return {
      required: parsed.required,
      forbidden: parsed.forbidden,
      rationale: normalized(parsed.rationale).slice(0, 300),
    };
  } catch {
    return null;
  }
}

/** The model reports item facts; the OS computes the verdict from stored answer evidence. */
export function computeReplayVerdict(replayCase, answer, judgement) {
  const reasons = [];
  const text = normalized(answer);
  for (const fact of replayCase.exactFacts ?? []) {
    if (!text.includes(normalized(fact))) reasons.push(`exact fact missing: ${String(fact).slice(0, 40)}`);
  }
  if (!judgement) return null;

  const required = new Map(judgement.required.map((item) => [Number(item?.i), item]));
  for (let index = 0; index < (replayCase.expectedFacts ?? []).length; index += 1) {
    const item = required.get(index);
    if (!item || typeof item.met !== 'boolean') return null;
    if (item.met && !evidenceInAnswer(item.evidence, answer)) return null;
    if (!item.met) reasons.push(`required fact missing: ${String(replayCase.expectedFacts[index]).slice(0, 40)}`);
  }

  const forbidden = new Map(judgement.forbidden.map((item) => [Number(item?.i), item]));
  for (let index = 0; index < (replayCase.forbiddenFacts ?? []).length; index += 1) {
    const item = forbidden.get(index);
    if (!item || typeof item.appeared !== 'boolean') return null;
    if (item.appeared) {
      if (!evidenceInAnswer(item.evidence, answer)) return null;
      reasons.push(`forbidden fact appeared: ${String(replayCase.forbiddenFacts[index]).slice(0, 40)}`);
    }
  }

  return {
    pass: reasons.length === 0,
    rationale: (reasons.join(' · ') || judgement.rationale || 'contract satisfied').slice(0, 300),
    items: { required: judgement.required, forbidden: judgement.forbidden },
  };
}
