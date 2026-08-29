import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

import { admitExecProgramContract } from './exec-program-contract.js';
import { executePythonProgramQualification, observePythonInterpreter } from './ephemeral-program-python.js';
import { executeSnapshotShellQualification } from './ephemeral-program-shell.js';
import { cleanupWorkspaceSnapshotRoot, createWorkspaceSnapshot, removeWorkspaceSnapshot,
  snapshotProgramBindings, verifyWorkspaceSnapshotSources } from './ephemeral-program-snapshot.js';
import { inspectDelimitedText } from './text-document-observer.js';

const REQUIREMENTS = Object.freeze({ filesystem: true, network: false, childProcess: false, packages: false });
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function inside(candidate, root) { const value = relative(root, candidate); return value === ''
  || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value)); }

function kindFor(path) {
  const extension = extname(path).toLowerCase();
  return extension === '.csv' ? 'text/csv' : extension === '.json' ? 'application/json' : 'text/plain';
}

function observeOutput(kind, bytes) {
  if (bytes.length > 262_144) return { state: 'invalid', reason: 'output_limit' };
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, ''); }
  catch { return { state: 'invalid', reason: 'output_not_utf8' }; }
  if (kind === 'application/json') { try { JSON.parse(text); return { state: 'valid', text }; }
    catch { return { state: 'invalid', reason: 'invalid_json' }; } }
  if (kind === 'text/csv') { const table = inspectDelimitedText(text);
    return table.malformedQuotedField || table.irregularRows
      ? { state: 'invalid', reason: 'invalid_csv' }
      : { state: 'valid', text, rows: table.rowCount, columns: table.columnCount }; }
  return { state: 'valid', text };
}

async function operationFor(target, content) {
  let exists = false;
  try { const identity = await lstat(target); if (!identity.isFile() || identity.isSymbolicLink()) {
    throw new Error('declared output target is not a regular file'); } exists = true; }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  return { type: exists ? 'modify' : 'create', path: target, to: null, content };
}

export function makeSnapshotProgramAdapter({ workspace: workspaceValue, snapshotRoot, scratchRoot,
  sessionId, workId, revision, runId = null, processRegistry, workspacePatchTool,
  attachmentStore = null,
  executionPath = process.env.PATH ?? '/usr/bin:/bin', pythonPath = '/usr/bin/python3',
  protectedReadRoots = [], createSnapshot = createWorkspaceSnapshot,
  executePython = executePythonProgramQualification, removeSnapshot = removeWorkspaceSnapshot,
  executeShell = executeSnapshotShellQualification,
  verifySources = verifyWorkspaceSnapshotSources, onPublicationSettled = null,
  onOutputHandoffCommitted = null } = {}) {
  if (!workspaceValue || !snapshotRoot || !scratchRoot || !sessionId || !workId
    || !Number.isSafeInteger(revision) || !processRegistry || !workspacePatchTool?.execute) {
    throw new TypeError('snapshot program adapter dependencies are incomplete');
  }
  if ((attachmentStore == null) !== (runId == null)) {
    throw new TypeError('snapshot output handoff requires AttachmentStore and Run identity together');
  }
  const workspacePromise = realpath(resolve(workspaceValue));
  const recovery = (async () => {
    const cleaned = await cleanupWorkspaceSnapshotRoot(snapshotRoot);
    if (!attachmentStore) return cleaned;
    const workspace = await workspacePromise;
    const pending = await attachmentStore.preparedProducedOutputBatches({
      sessionId, producerRunId: runId,
    });
    const handoffs = [];
    for (const batch of pending) {
      const handoff = batch.state === 'committed' ? batch
        : await attachmentStore.reconcileProducedOutputBatch({ sessionId, workspace, runId,
          toolCallId: batch.toolCallId, batchId: batch.batchId });
      const artifactBatch = handoff.state === 'committed'
        ? await attachmentStore.registerProducedOutputBatch({ sessionId, workspace,
          runId, batchId: batch.batchId }) : null;
      handoffs.push({ ...handoff, ...(artifactBatch ? { artifactBatch } : {}) });
    }
    return { ...cleaned, handoffs };
  })();
  let interpreterPromise = null;
  const interpreter = () => (interpreterPromise ??= observePythonInterpreter({ path: pythonPath }));
  const resolvedExecutable = async (value) => {
    if (isAbsolute(value)) return realpath(resolve(value));
    if (String(value).includes('/') || String(value).includes('\\')) return null;
    for (const directory of String(executionPath).split(':').filter(Boolean)) {
      try { return await realpath(resolve(directory, value)); } catch { /* continue */ }
    }
    return null;
  };
  const failed = (reason, extra = {}) => ({ handled: true, result: {
    state: 'protected_program_failed', exitCode: 77, reason, fallbackToExec: false,
    duplicateExecution: false, verificationMissing: true, ...extra,
  } });

  return { recovery,
    async execute({ args, commandExplanation, cwd = null, signal = null, toolCallId = null } = {}) {
      if (args?.effect?.kind !== 'local_change' || !Array.isArray(args.effect.targets)
        || !args.effect.targets.length || commandExplanation?.ok !== true
        || commandExplanation.hasParseError || !commandExplanation.steps?.length) return null;
      const observedInterpreter = await interpreter();
      const pythonSteps = [];
      for (const step of commandExplanation.steps) {
        if (await resolvedExecutable(step.executable) === observedInterpreter.path) pythonSteps.push(step);
      }
      if (!pythonSteps.length) return null;
      const workspace = await workspacePromise;
      let canonicalCwd; try { canonicalCwd = await realpath(resolve(cwd)); } catch { return null; }
      if (canonicalCwd !== workspace) return null;
      let source = null; let sourceSha256 = sha256(commandExplanation.source); let simplePython = false;
      const owner = commandExplanation.steps.length === 1 && !commandExplanation.operators?.length
        && commandExplanation.steps[0].context === 'top-level' ? commandExplanation.steps[0] : null;
      if (owner && await resolvedExecutable(owner.executable) === observedInterpreter.path
        && Array.isArray(commandExplanation.heredocs) && commandExplanation.heredocs.length === 1
        && commandExplanation.heredocs[0].commandId === owner.id
        && commandExplanation.heredocs[0].literal === true) {
        const first = commandExplanation.heredocs[0];
        source = String(commandExplanation.source).slice(first.startIndex, first.endIndex);
        sourceSha256 = first.sha256; simplePython = true;
      } else if (owner && await resolvedExecutable(owner.executable) === observedInterpreter.path) {
        const argv = owner.argv ?? []; const codeIndex = argv.indexOf('-c');
        if (codeIndex === 1 && argv.length === 3 && typeof argv[2] === 'string' && argv[2].trim()) {
          source = argv[2]; sourceSha256 = sha256(source); simplePython = true;
        }
      }
      await recovery;
      if (signal?.aborted) return failed('cancelled_before_snapshot');
      const targets = [];
      for (const value of args.effect.targets) {
        const absolute = resolve(workspace, String(value));
        if (!inside(absolute, workspace)) return failed('declared_output_outside_workspace');
        const relativePath = relative(workspace, absolute).replaceAll('\\', '/');
        if (!relativePath) return failed('workspace_root_is_not_an_output');
        targets.push({ absolute, relativePath, kind: kindFor(relativePath), category: 'publishable' });
      }
      if (new Set(targets.map((item) => item.absolute)).size !== targets.length) {
        return failed('declared_output_duplicated');
      }
      let snapshot;
      try { ({ snapshot } = await createSnapshot({ workspace, snapshotRoot,
        excludeTopLevelNames: ['.git'] })); }
      catch { return failed('snapshot_generation_failed'); }
      const cleanup = async () => removeSnapshot(snapshot).catch(() => ({ removed: false }));
      try {
        let executed;
        if (simplePython) {
          const bound = snapshotProgramBindings(snapshot, { sessionId, workId,
            excludeRelativePaths: targets.map((item) => item.relativePath) });
          const contract = admitExecProgramContract({ workId, revision, temporary: true,
            sourceLanguage: 'python', source, inputs: bound.bindings,
            outputs: targets.map(({ relativePath, kind, category }) => ({ relativePath, kind, category })),
            requirements: REQUIREMENTS, interpreter: observedInterpreter.path });
          executed = await executePython({ contract, interpreter: observedInterpreter,
            sourceReader: bound.sourceReader, processRegistry, scratchRoot, protectedReadRoots,
            maxOutputBytes: 262_144, signal, directories: snapshot.directories });
        } else {
          executed = await executeShell({ command: commandExplanation.source, snapshot,
            outputs: targets.map(({ relativePath, kind, category }) => ({ relativePath, kind, category })),
            processRegistry, ownerId: workId, scratchRoot, protectedReadRoots,
            executionPath, signal, maxOutputBytes: 262_144 });
        }
        if (!executed.execution) { const cleaned = await cleanup();
          return failed(executed.receipt.reason, { publication: 'not_started', cleanup: cleaned }); }
        const sourceCoverage = await verifySources(snapshot);
        if (sourceCoverage.verified !== true) { const cleaned = await cleanup();
          return failed('source_universe_changed', { publication: 'not_started', cleanup: cleaned }); }
        const observed = [];
        for (const output of executed.execution.outputs) { const format = observeOutput(output.kind, output.bytes);
          if (format.state !== 'valid') { const cleaned = await cleanup();
            return failed(format.reason, { publication: 'not_started', cleanup: cleaned }); }
          observed.push({ output, format }); }
        if (signal?.aborted) { const cleaned = await cleanup();
          return failed('cancelled_before_publication', { publication: 'not_started', cleanup: cleaned }); }
        let outputBatch = null;
        if (attachmentStore) {
          if (!String(toolCallId ?? '').trim()) { const cleaned = await cleanup();
            return failed('output_handoff_tool_identity_missing', { publication: 'not_started', cleanup: cleaned }); }
          outputBatch = await attachmentStore.prepareProducedOutputBatch({ sessionId,
            workspace, runId, toolCallId, outputs: observed.map((item) => {
              const target = targets.find((candidate) => candidate.relativePath === item.output.relativePath);
              return { filePath: target.absolute, expectedSha256: item.output.sha256,
                expectedBytes: item.output.size };
            }) });
        }
        const operations = [];
        for (const item of observed) { const target = targets.find((candidate) => (
          candidate.relativePath === item.output.relativePath
        )); operations.push(await operationFor(target.absolute, item.format.text)); }
        const preview = await workspacePatchTool.execute({ action: 'preview', planHandle: null,
          undoHandle: null, operations });
        const publication = await workspacePatchTool.execute({ action: 'apply', planHandle: preview.planHandle,
          undoHandle: null, operations: [] });
        if (publication.state !== 'published_verified') { const cleaned = await cleanup();
          const handoff = outputBatch ? await attachmentStore.reconcileProducedOutputBatch({ sessionId,
            workspace, runId, toolCallId, batchId: outputBatch.batchId }) : null;
          return failed('publication_not_verified', { publication, handoff, cleanup: cleaned }); }
        let committedHandoff = null;
        if (outputBatch) {
          await attachmentStore.markProducedOutputBatchPublicationVerified({ sessionId, runId, toolCallId,
            batchId: outputBatch.batchId, publication });
        }
        if (typeof onPublicationSettled === 'function') await onPublicationSettled({ snapshot, publication,
          outputBatch });
        if (outputBatch) committedHandoff = await attachmentStore.commitProducedOutputBatch({ sessionId,
          workspace, runId, toolCallId, batchId: outputBatch.batchId });
        if (committedHandoff && typeof onOutputHandoffCommitted === 'function') {
          await onOutputHandoffCommitted({ snapshot, publication, outputBatch, committedHandoff });
        }
        const artifactBatch = committedHandoff ? await attachmentStore.registerProducedOutputBatch({
          sessionId, workspace, runId, batchId: outputBatch.batchId }) : null;
        const cleaned = await cleanup();
        return { handled: true, result: { state: cleaned.removed
          ? 'published_verified_cleaned' : 'published_verified_cleanup_unknown', exitCode: 0,
        fallbackToExec: false, duplicateExecution: false, sourceLanguage: 'python', translated: false,
        actualExecutions: 1, sourceSha256, executionBackend: simplePython ? 'python_exact' : 'snapshot_shell_exact',
        sourceUniverse: { coverage: 'complete', immutableGeneration: true,
          filesAndDigestsVerified: true, fileCount: snapshot.files.length,
          manifestSha256: snapshot.manifestSha256,
          ...(snapshot.excludedTopLevelNames?.length ? {
            excludedTopLevelNames: [...snapshot.excludedTopLevelNames],
          } : {}) },
        actualReadSet: { state: 'unknown' }, outputCoverage: { independentlyVerified: true,
          outputCount: observed.length }, outputs: observed.map((item) => ({
          relativePath: item.output.relativePath, kind: item.output.kind, bytes: item.output.size,
          sha256: item.output.sha256, rows: item.format.rows ?? null,
          columns: item.format.columns ?? null, preview: item.format.text.slice(0, 8_000) })),
        publication: { state: publication.state, undoHandle: publication.undoHandle },
        ...(committedHandoff ? { outputHandoff: { state: artifactBatch?.state ?? committedHandoff.state,
          outputCount: committedHandoff.outputs.length }, artifacts: artifactBatch?.artifacts ?? [],
        deactivatedTools: artifactBatch?.state === 'artifacts_registered' ? ['attachment'] : [] } : {}),
        cleanup: { state: cleaned.removed ? 'cleaned' : 'unknown' },
        confinement: { workspaceOutsideRead: 0, originalWrites: 0,
          userTargetWritesBeforePublication: 0, network: 0,
          childProcess: simplePython ? 0 : 'managed_process_group' } } };
      } catch (error) {
        if (error?.simulateCrash === true) throw error;
        const cleaned = await cleanup(); return failed('protected_program_internal_failure',
          { publication: 'not_started_or_unknown', cleanup: cleaned });
      }
    } };
}
