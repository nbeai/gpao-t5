import { createHash } from 'node:crypto';
import { makeRemoteMcpTool } from './remote-mcp-tool.js';

function parseObject(value, label) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 64 * 1024) throw new TypeError(`${label} must be bounded JSON`);
  let parsed; try { parsed = JSON.parse(value); } catch { throw new TypeError(`${label} is invalid JSON`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError(`${label} must contain an object`);
  return parsed;
}
function textOf(result) { return (result?.content ?? []).filter((block) => block?.type === 'text').map((block) => String(block.text ?? '')).join('\n'); }
function pageIdFrom(value) {
  if (!value || typeof value !== 'object') return null;
  for (const key of ['page_id', 'pageId', 'id']) if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  for (const child of Object.values(value)) { const found = pageIdFrom(child); if (found) return found; }
  return null;
}
function canonicalPageId(value) { return String(value ?? '').trim().replaceAll('-', '').toLocaleLowerCase(); }
function reversibleInsert(toolName, writeArgs) {
  return toolName === 'notion-update-page' && writeArgs?.command === 'insert_content';
}
function acknowledgedPageId(result) {
  for (const block of result?.content ?? []) {
    if (block?.type !== 'text') continue;
    try { const found = pageIdFrom(JSON.parse(String(block.text ?? ''))); if (found) return found; } catch { /* no identity */ }
  }
  return null;
}
function verificationReceipt(result, { pageId, expectedText, toolName }) {
  const observed = textOf(result); const expectedFound = result?.state === 'called' && observed.includes(expectedText);
  return { toolName, pageId, expectedFound, observedDigest: createHash('sha256').update(observed).digest('hex'), observedChars: observed.length };
}

/** Notion-specific user language and verified write boundary over Remote MCP. */
export function makeNotionTool({ runtime, authorizeEffect } = {}) {
  const base = makeRemoteMcpTool({
    id: 'notion', label: 'Notion', runtime, authorizeEffect,
    limitations: 'Notion MCP does not currently upload files; do not claim file upload support.',
  });
  const parameters = structuredClone(base.parameters);
  parameters.properties.action.enum.push('verified_write');
  Object.assign(parameters.properties, {
    verificationToolName: { type: ['string', 'null'], maxLength: 128 },
    targetResourceId: { type: ['string', 'null'], maxLength: 256 },
    expectedText: { type: ['string', 'null'], maxLength: 4_000 },
  });
  parameters.required.push('verificationToolName', 'targetResourceId', 'expectedText');
  async function verifyReadTool(name) {
    const tool = (await runtime.listTools()).find((candidate) => candidate.name === name);
    if (!tool || tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint === true) throw new Error('Notion verification requires an observed read-only tool');
  }
  async function observedTool(name) {
    return (await runtime.listTools()).find((candidate) => candidate.name === String(name ?? '')) ?? null;
  }
  async function readBack({ toolName, pageId, expectedText }) {
    await verifyReadTool(toolName);
    const result = await base.execute({ action: 'call', toolName, argumentsJson: JSON.stringify({ id: pageId }), effect: {
      kind: 'observe', summary: 'Notion 쓰기 결과 재확인', targets: ['notion'], reversible: true,
      backupAvailable: true, recipientNew: false, approvalToken: null,
    } });
    return { result, receipt: verificationReceipt(result, { pageId, expectedText, toolName }) };
  }
  return {
    ...base,
    description: `${base.description} For create or update, use verified_write so T5 reopens the exact page and only then proposes completion.`,
    parameters,
    async preflight(args = {}, context = {}) {
      if (args.action !== 'verified_write') {
        if (args.action === 'call') {
          const tool = await observedTool(args.toolName);
          if (tool?.annotations?.destructiveHint === true && args.effect?.kind !== 'destructive') {
            return base.preflight(args, context);
          }
          if (tool && (tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint === true)) {
            return { allowed: false, outcome: 'not_executed', result: {
              state: 'notion_verified_write_required', retrySafe: false,
            } };
          }
        }
        return base.preflight(args, context);
      }
      const writeArgs = parseObject(args.argumentsJson, 'Notion write argumentsJson');
      if (!String(args.verificationToolName ?? '').trim()) throw new TypeError('Notion verification tool is required');
      if (!String(args.expectedText ?? '').trim()) throw new TypeError('Notion expected text is required');
      await verifyReadTool(String(args.verificationToolName));
      if (reversibleInsert(String(args.toolName), writeArgs)) {
        if (args.effect?.kind !== 'external_change') return {
          allowed: false, outcome: 'not_executed', result: { state: 'external_change_required' },
        };
        return typeof authorizeEffect === 'function' ? authorizeEffect(args, context) : {
          allowed: false, outcome: 'not_executed', result: { state: 'authority_unavailable' },
        };
      }
      return base.preflight({ action: 'call', toolName: args.toolName, argumentsJson: args.argumentsJson, effect: args.effect }, context);
    },
    async execute(args = {}) {
      if (args.action !== 'verified_write') return base.execute(args);
      const writeArgs = parseObject(args.argumentsJson, 'Notion write argumentsJson');
      const write = await base.execute({ action: 'call', toolName: args.toolName, argumentsJson: args.argumentsJson, effect: args.effect });
      const declaredPageId = String(args.targetResourceId ?? '').trim() || pageIdFrom(writeArgs);
      const acknowledgedId = acknowledgedPageId(write); const pageId = acknowledgedId ?? declaredPageId;
      if (acknowledgedId && declaredPageId
        && canonicalPageId(acknowledgedId) !== canonicalPageId(declaredPageId)) return {
        state: 'notion_write_identity_mismatch', exitCode: 1, verificationMissing: true,
        writeAcknowledgement: { toolName: args.toolName, pageId: acknowledgedId }, declaredPageId,
      };
      if (!pageId) return { state: write.effectUnknown ? 'remote_effect_unknown' : 'notion_write_page_identity_missing',
        exitCode: 1, effectUnknown: write.effectUnknown === true, retrySafe: false, verificationMissing: true };
      if (write.state !== 'called' && write.effectUnknown !== true) return { ...write, verificationMissing: true, retrySafe: false };
      const verification = await readBack({ toolName: String(args.verificationToolName), pageId, expectedText: String(args.expectedText) });
      if (!verification.receipt.expectedFound) return {
        state: write.effectUnknown ? 'remote_effect_unknown' : 'notion_write_unverified', exitCode: 1,
        effectUnknown: write.effectUnknown === true, retrySafe: false, verificationMissing: true,
        writeAcknowledgement: { toolName: args.toolName, pageId, acknowledged: write.state === 'called' }, verification: verification.receipt,
      };
      return {
        state: write.effectUnknown ? 'notion_write_verified_after_unknown' : 'notion_write_verified',
        writeAcknowledgement: { toolName: args.toolName, pageId, acknowledged: write.state === 'called' },
        verification: verification.receipt, effectUnknown: false, retrySafe: false,
      };
    },
  };
}
