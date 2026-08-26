#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { makeExecTool } from '../src/exec-tool.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';
import { TerminalOutputStore } from '../src/terminal-output-store.js';

const outIndex = process.argv.indexOf('--out'); const output = outIndex >= 0 ? resolve(process.argv[outIndex + 1]) : null;
const room = await mkdtemp(join(tmpdir(), 't5-s3t2-output-'));
try {
  const store = new TerminalOutputStore(join(room, 'outputs'));
  const tool = makeExecTool({ workspace: room, ownerId: 'session-a', originRunId: 'run-a',
    outputLimit: 256, processRegistry: new ManagedProcessRegistry({ outputLimit: 256 }), terminalOutputStore: store });
  const started = process.hrtime.bigint();
  const result = await tool.execute({ command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
    "process.stdout.write('HEAD-'+'x'.repeat(40000)+'-EXACT-MIDDLE-'+ 'y'.repeat(40000)+'-TAIL')",
  )}`, cwd: null, effect: { kind: 'observe', summary: 'output recall qualification', targets: [],
    reversible: true, backupAvailable: false, recipientNew: false, approvalToken: null } });
  const wallNs = Number(process.hrtime.bigint() - started); const handle = result.outputRecall.handle;
  const recalled = await store.read({ handle, sessionId: 'session-a', stream: 'stdout', offset: 39980, limit: 100 });
  let foreignRejected = false;
  try { await store.read({ handle, sessionId: 'session-b', stream: 'stdout', offset: 0, limit: 10 }); }
  catch { foreignRejected = true; }
  const restarted = new TerminalOutputStore(join(room, 'outputs'));
  const restartRead = await restarted.read({ handle, sessionId: 'session-a', stream: 'stdout', offset: 39980, limit: 100 });
  const mode = (await stat(join(room, 'outputs', 'objects', handle, 'stdout'))).mode & 0o777;
  const evidence = { schema: 't5.s3t2.output-recall-qualification.v1', recordedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    status: 'exact_recall_complete_retention_open', truncated: result.truncated,
    omittedChars: result.omittedChars, handlePresent: Boolean(handle), activatedOnDemand: result.activatedTools?.includes('terminal_output'),
    commandExecutions: 1, exactMiddleRecovered: recalled.text.includes('EXACT-MIDDLE'),
    restartRecovered: restartRead.text.includes('EXACT-MIDDLE'), foreignSessionRejected: foreignRejected,
    fileMode: mode.toString(8), foregroundWallNs: wallNs, modelContextFullOutputInjected: false,
    remaining: ['retention and disk rotation policy', 'generic personal secret output classification', 'find action'],
    nextCandidate: 'output_retention_then_terminal_session_driver',
    pass: result.truncated && Boolean(handle) && recalled.text.includes('EXACT-MIDDLE')
      && restartRead.text.includes('EXACT-MIDDLE') && foreignRejected && mode === 0o600 };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (output) { await writeFile(output, serialized, { mode: 0o600 }); } else process.stdout.write(serialized);
} finally { await rm(room, { recursive: true, force: true }); }
