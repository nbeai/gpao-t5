// L3 · ModelClient — 모델 provider 경계. OS 는 사실·경계를 주고 판단·문장은 모델이 만든다.
// 슬라이스-1 은 결정적 스텁으로 커널 흐름을 검증한다. 실제 provider 어댑터는 밀도화 단계에서
// 같은 인터페이스로 갈아끼운다(자격 신호는 SelfState.classifyModelAuth 로 흐른다).

/**
 * @typedef {Object} ModelClient
 * @property {(taskContext: import('../kernel/contracts.js').TaskContextPacket) => Promise<string>} respond
 */

/**
 * 결정적 스텁. Date/random 사용 금지(결정적 빌드 원칙). 입력 사실만으로 답을 만든다.
 * 과잉 통제 없이 자연스러운 한국어 한두 마디로 응답하되, 원장 사실을 왜곡하지 않는다.
 * @implements {ModelClient}
 */
export class StubModelClient {
  /** @param {import('../kernel/contracts.js').TaskContextPacket} tc */
  async respond(tc) {
    const req = tc.currentRequest.trim();
    if (tc.answerMode === 'fast_chat') {
      return `말씀하신 "${req}" 이해했어요. 편하게 이어서 말해 주세요.`;
    }
    // complex_work: 실행 사실(evidenceFacts)이 있으면 그 사실에 근거해 답한다.
    const facts = tc.evidenceFacts ?? [];
    if (facts.length) {
      const ok = facts.filter((f) => f.failureState === 'none').map((f) => f.summary);
      const bad = facts.filter((f) => f.failureState !== 'none').map((f) => f.summary);
      const parts = [];
      if (ok.length) parts.push(`확인한 것: ${ok.join('; ')}`);
      if (bad.length) parts.push(`아직 확인 못 한 것: ${bad.join('; ')}`);
      return parts.join('\n') || `"${req}" 처리했어요.`;
    }
    const need = tc.authorityFacts.needsApproval ?? [];
    if (need.length) {
      return `"${req}" — 실행 전에 승인이 필요한 부분(${need.join(', ')})이 있어요.`;
    }
    return `"${req}" 진행할게요.`;
  }
}
