const FAILED_STATES = new Set([
  'approval_required', 'authority_invalid', 'not_executed', 'failed', 'cancelled',
  'repeated_call_stopped', 'deferred_tool_not_active', 'user_control_required',
]);

export function makeAutomationOutcomeTool() {
  return {
    name: 'automation_outcome',
    capabilityGroup: 'automation_outcome',
    description: 'Required final receipt for a scheduled T5 Run. Call this only after doing the scheduled work. Declare achieved only when the user objective is actually complete and cite the exact successful toolCallIds that prove it. If any requested effect, delivery, result URL, or verification remains missing, declare not_achieved and state what remains. This receipt controls scheduler truth; a normal model answer does not mark the automation successful.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        status: { type: 'string', enum: ['achieved', 'not_achieved'] },
        summary: { type: 'string', minLength: 1, maxLength: 1_000 },
        remaining: { type: ['string', 'null'], maxLength: 1_000 },
        evidenceToolCallIds: {
          type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 200 },
        },
        resultUrls: {
          type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 2_000 },
        },
      },
      required: ['status', 'summary', 'remaining', 'evidenceToolCallIds', 'resultUrls'],
    },
    async execute(args = {}) {
      return {
        state: 'declared', status: args.status, summary: String(args.summary),
        remaining: args.remaining == null ? null : String(args.remaining),
        evidenceToolCallIds: [...new Set(args.evidenceToolCallIds.map(String))],
        resultUrls: [...new Set(args.resultUrls.map(String))],
      };
    },
  };
}

function effectKind(receipt) { return receipt?.requestedCall?.args?.effect?.kind ?? null; }

export function assessAutomationOutcome({ receipts = [], requirements = {} } = {}) {
  const outcomeIndex = receipts.findLastIndex((receipt) => (
    receipt.actualCall?.name === 'automation_outcome' && receipt.outcome === 'succeeded'
  ));
  if (outcomeIndex < 0) return {
    achieved: false, reason: 'automation_outcome_missing', summary: '예약 목적 달성 영수증이 없습니다.',
  };
  const declaration = receipts[outcomeIndex].result ?? {};
  if (declaration.status !== 'achieved') return {
    achieved: false, reason: 'objective_not_achieved',
    summary: declaration.summary ?? '예약 목적을 완료하지 못했습니다.',
    remaining: declaration.remaining ?? null,
  };
  const evidenceIds = new Set(declaration.evidenceToolCallIds ?? []);
  const evidence = receipts.slice(0, outcomeIndex).filter((receipt) => evidenceIds.has(receipt.toolCallId));
  if (evidence.length !== evidenceIds.size || evidence.some((receipt) => (
    !receipt.actualCall || receipt.outcome !== 'succeeded' || FAILED_STATES.has(receipt.result?.state)
  ))) return {
    achieved: false, reason: 'automation_evidence_invalid', summary: '예약 목적의 실행 근거가 유효하지 않습니다.',
  };
  const requiredTools = [...new Set(requirements.requiredTools ?? [])];
  const usedTools = new Set(evidence.map((receipt) => receipt.actualCall?.name));
  const missingTools = requiredTools.filter((name) => !usedTools.has(name));
  if (missingTools.length) return {
    achieved: false, reason: 'automation_required_tool_missing',
    summary: `필요한 실행 근거가 없습니다: ${missingTools.join(', ')}`,
  };
  if (requirements.requiredEffect
    && !evidence.some((receipt) => effectKind(receipt) === requirements.requiredEffect)) return {
    achieved: false, reason: 'automation_required_effect_missing',
    summary: '요청한 외부 효과의 실행 근거가 없습니다.',
  };
  const resultUrls = declaration.resultUrls ?? [];
  if (requirements.requireResultUrl === true) {
    const observed = evidence.map((receipt) => JSON.stringify(receipt.result ?? {})).join('\n');
    if (!resultUrls.length || !resultUrls.some((url) => observed.includes(url))) return {
      achieved: false, reason: 'automation_result_url_unverified',
      summary: '완료 결과 URL을 실제 실행 영수증에서 확인하지 못했습니다.',
    };
  }
  return {
    achieved: true, reason: null, summary: declaration.summary,
    resultUrls, evidenceToolCallIds: [...evidenceIds],
  };
}
