import { createHash, randomBytes } from 'node:crypto';

const DISPOSITIONS = new Set(['answered', 'unresolved', 'deferred', 'superseded']);

function productionHandle({ runId }) {
  const token = createHash('sha256').update(String(runId)).update('\0')
    .update(randomBytes(32)).digest('hex').slice(0, 32);
  return `busy_${token}`;
}

export function makeInputSettlementScope({ store, runId, excludedInputIds = [],
  makeHandle = productionHandle } = {}) {
  if (!store || !runId) throw new TypeError('input settlement scope identity is required');
  const byHandle = new Map();
  const byInputId = new Map();
  const excluded = new Set(excludedInputIds.map(String));
  let sequence = 0;

  function register(input) {
    if (!input?.inputId) throw new TypeError('projected input identity is required');
    const existing = byInputId.get(input.inputId);
    if (existing) return existing.handle;
    if (sequence >= 32) throw new Error('busy input settlement scope exceeded');
    sequence += 1;
    const handle = String(makeHandle({ runId, sequence }));
    if (!/^busy_[A-Za-z0-9_-]{8,80}$/u.test(handle) || byHandle.has(handle)) {
      throw new Error('invalid or duplicate busy input settlement handle');
    }
    const record = { handle, inputId: String(input.inputId) };
    byHandle.set(record.handle, record); byInputId.set(record.inputId, record);
    return record.handle;
  }

  function handles() { return [...byHandle.keys()]; }

  async function evaluate(settlements, { workId, revision } = {}) {
    const submitted = Array.isArray(settlements) ? settlements.slice(0, 32) : [];
    const blockers = []; const accepted = []; const seen = new Set();
    if (Array.isArray(settlements) && settlements.length > 32) {
      blockers.push('admitted_input_identity_mismatch');
    }
    for (const item of submitted) {
      const handle = String(item?.handle ?? '');
      if (!handle || seen.has(handle)) { blockers.push('admitted_input_identity_mismatch'); continue; }
      seen.add(handle);
      const owned = byHandle.get(handle);
      if (!owned || !DISPOSITIONS.has(item?.disposition)) {
        blockers.push('admitted_input_identity_mismatch'); continue;
      }
      const state = await store.read();
      const input = state.inputs.find((candidate) => candidate.inputId === owned.inputId);
      if (!input || input.state !== 'executing' || input.executionRunId !== runId
        || input.workId !== workId || input.revision !== revision) {
        blockers.push('admitted_input_identity_mismatch'); continue;
      }
      accepted.push({ handle, inputId: input.inputId, workId: input.workId,
        revision: input.revision, disposition: item.disposition });
    }
    const state = await store.read();
    const executing = state.inputs.filter((input) => input.state === 'executing'
      && input.executionRunId === runId && !excluded.has(input.inputId));
    for (const input of executing) {
      const registered = byInputId.get(input.inputId);
      const exact = registered && accepted.find((item) => item.inputId === input.inputId);
      if (!exact) blockers.push(registered ? 'admitted_input_unaddressed'
        : 'admitted_input_identity_mismatch');
    }
    for (const handle of handles()) {
      if (!seen.has(handle)) blockers.push('admitted_input_unaddressed');
    }
    return { settlements: accepted, blockers: [...new Set(blockers)].toSorted() };
  }

  return { register, handles, evaluate };
}

export const inputSettlementDispositions = [...DISPOSITIONS];
