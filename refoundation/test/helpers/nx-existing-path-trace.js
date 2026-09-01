import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function jsonFiles(root) {
  const output = [];
  async function walk(directory) {
    let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith('.json')) output.push(path);
    }
  }
  await walk(root); return output.sort();
}

function toolName(definition) {
  return definition?.name ?? definition?.function?.name ?? null;
}

function receiptSummary(receipt = {}) {
  const name = receipt.actualCall?.name ?? receipt.requestedCall?.name ?? null;
  const action = receipt.actualCall?.args?.action ?? receipt.requestedCall?.args?.action ?? null;
  const result = receipt.result ?? {};
  return {
    name, action, outcome: receipt.outcome ?? null,
    ...(name === 'tool_search' ? { activatedTools: result.activatedTools ?? [] } : {}),
    ...(name === 'file_reality' && action === 'search' ? {
      candidateNames: (result.candidates ?? []).map((item) => item.displayName),
      candidateCount: (result.candidates ?? []).length,
      coverage: result.coverage ? { filenameScope: result.coverage.filenameScope,
        contentScope: result.coverage.contentScope, visualScope: result.coverage.visualScope,
        truncated: result.coverage.truncated } : null,
    } : {}),
    ...(name === 'file_reality' && action === 'inspect' ? {
      inspectedNames: (result.files ?? (result.file ? [result.file] : [])).map((item) => item.displayName),
      observedCount: result.coverage?.observed ?? (result.file ? 1 : null),
      complete: result.coverage?.complete ?? (result.file ? true : null),
      contentTruncated: (result.files ?? (result.file ? [result.file] : []))
        .some((item) => item.contentTruncated === true),
    } : {}),
    ...(name === 'file_reality' && action === 'bind_sources' ? {
      manifestState: result.state ?? null,
      sourceCount: Array.isArray(result.sources) ? result.sources.length
        : Array.isArray(receipt.actualCall?.args?.sourceUses) ? receipt.actualCall.args.sourceUses.length : null,
      unresolvedCount: Array.isArray(result.unknowns) ? result.unknowns.length
        : Array.isArray(receipt.actualCall?.args?.unknowns) ? receipt.actualCall.args.unknowns.length : null,
      integralState: result.integralMethod?.state ?? null,
      integralReason: result.integralMethod?.reason ?? null,
    } : {}),
    ...(name === 'integral_method' ? { integralState: result.state ?? null,
      sourceCoverage: result.sourceCoverage ?? null,
      outcomeCount: result.outcomeCount ?? null,
      excludedFindingCount: result.excludedFindingCount ?? null } : {}),
  };
}

export async function summarizeExistingPathTrace({ run, stateDir, sessionId, userRequest,
  purposePassed } = {}) {
  const receipts = (run?.events ?? []).filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload?.receipt).filter(Boolean).map(receiptSummary);
  const promptFiles = await jsonFiles(join(stateDir, 'diagnostics', sessionId)); const promptCalls = [];
  for (const file of promptFiles.filter((path) => path.includes('/prompt/'))) {
    let record; try { record = JSON.parse(await readFile(file, 'utf8')); } catch { continue; }
    const body = record.body ?? {}; const serialized = JSON.stringify(body);
    promptCalls.push({
      requestPresent: serialized.includes(String(userRequest ?? '')),
      toolNames: (body.tools ?? []).map(toolName).filter(Boolean),
      requestBytes: Buffer.byteLength(serialized, 'utf8'),
    });
  }
  const sourceEntered = receipts.some((item) => item.name === 'file_reality'
    && ['search', 'inspect'].includes(item.action) && item.outcome === 'succeeded');
  const sourceBound = receipts.some((item) => item.name === 'file_reality'
    && item.action === 'bind_sources' && item.outcome === 'succeeded');
  const integralEntered = receipts.some((item) => item.name === 'integral_method');
  return {
    promptCalls,
    receipts,
    boundary: { sourceEntered, sourceBound, integralEntered,
      failureStage: purposePassed ? 'passed' : !sourceEntered ? 'before_source_entry'
        : !sourceBound ? 'after_source_entry_before_bind'
          : !integralEntered ? 'after_bind_before_integral' : 'integral_or_human_closure' },
  };
}
