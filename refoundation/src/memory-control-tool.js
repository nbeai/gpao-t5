import { exportMemoryBundle } from './memory-export.js';

export function makeMemoryControlTool({ ledger, coordinator, currentRecordRefs, now } = {}) {
  if (!ledger || !coordinator || typeof currentRecordRefs !== 'function') {
    throw new TypeError('memory control requires ledger, coordinator, and current RecordRefs');
  }
  const clock = now ?? (() => new Date().toISOString());
  return {
    name: 'memory_control',
    searchTerms: ['memory restore', 'memory export', '기억 복원', '기억 내보내기'],
    description: 'Restore one exact recently forgotten memory from a T5 forget pointer, or export user-controlled memory as portable JSON. Use only exact requestId and memoryId supplied by T5; never guess or broaden a target.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['restore', 'export'] },
        requestId: { type: ['string', 'null'] },
        memoryId: { type: ['string', 'null'] },
      },
      required: ['action', 'requestId', 'memoryId'],
    },
    async execute({ action, requestId, memoryId }) {
      if (action === 'restore') {
        if (!requestId || !memoryId) throw new TypeError('restore requires exact requestId and memoryId');
        return coordinator.restore({
          requestId: String(requestId), memoryId: String(memoryId),
          recordRefs: await currentRecordRefs(),
        });
      }
      if (action === 'export') {
        return { state: 'exported', bundle: exportMemoryBundle({
          state: await ledger.read(), exportedAt: clock(),
        }) };
      }
      throw new Error(`Unknown memory control action: ${action}`);
    },
  };
}
