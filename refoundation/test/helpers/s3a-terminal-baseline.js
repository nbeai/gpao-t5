import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { makeExecTool, makeProcessControlTool, makeProcessStartTool } from '../../src/exec-tool.js';
import { ManagedProcessRegistry } from '../../src/managed-process.js';
import { makePtyStartTool } from '../../src/pty-tool.js';
import { makeS3aPerformanceObserver } from './s3a-performance-observer.js';

const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
const effect = Object.freeze({
  kind: 'observe', summary: '격리 Terminal 기준선 관측', targets: [],
  reversible: true, backupAvailable: false, recipientNew: false, approvalToken: null,
});

function schemaFacts(tools) {
  const serialized = JSON.stringify(tools.map(({ name, description, parameters }) => ({
    name, description, parameters,
  })));
  const exec = tools.find((tool) => tool.name === 'exec');
  return {
    toolCount: tools.length,
    toolNames: tools.map((tool) => tool.name),
    schemaBytes: Buffer.byteLength(serialized, 'utf8'),
    execRequiredTopLevel: exec?.parameters?.required ?? [],
    effectRequiredFields: exec?.parameters?.properties?.effect?.required ?? [],
  };
}

async function terminalResult(tool, command) {
  return tool.execute({ command, cwd: null, effect: structuredClone(effect) });
}

export async function createTerminalBaselineFixture(root) {
  const home = join(root, 'home');
  const normal = join(home, 'Documents', 'brief.txt');
  const privateKey = join(home, '.ssh', 'id_fixture');
  const cliCredential = join(home, '.config', 'fixture-cli', 'auth.json');
  await Promise.all([
    mkdir(join(home, 'Documents'), { recursive: true, mode: 0o700 }),
    mkdir(join(home, '.ssh'), { recursive: true, mode: 0o700 }),
    mkdir(join(home, '.config', 'fixture-cli'), { recursive: true, mode: 0o700 }),
  ]);
  await Promise.all([
    writeFile(normal, 'NORMAL-BRIEF-42\n', { mode: 0o600 }),
    writeFile(privateKey, 'FIXTURE-PRIVATE-KEY-DO-NOT-EXPOSE\n', { mode: 0o600 }),
    writeFile(cliCredential, '{"token":"FIXTURE-CLI-TOKEN-DO-NOT-EXPOSE"}\n', { mode: 0o600 }),
  ]);
  return { root, home, normal, privateKey, cliCredential };
}

export async function measureTerminalBaseline(fixture, { observerMode = 'O2_full_shadow' } = {}) {
  const common = { workingDirectory: fixture.home, workspace: fixture.home,
    ownerId: 's3a-terminal-fixture', outputLimit: 256, yieldMs: 20 };
  const processRegistry = new ManagedProcessRegistry({ outputLimit: 256 });
  const exec = makeExecTool({ ...common, processRegistry });
  const start = makeProcessStartTool({ ...common, processRegistry });
  const ptyStart = makePtyStartTool({ ...common, processRegistry });
  const control = makeProcessControlTool({ processRegistry, ownerId: common.ownerId });
  const terminal = { tools: [exec, start, ptyStart, control] };
  const observer = makeS3aPerformanceObserver({ mode: observerMode, maxSpans: 16 });
  let environment;
  let output;
  let started;
  let final;
  const processOutput = [];

  await observer.measure('tool_execution', async () => {
    environment = await terminalResult(exec, [
      `printf 'HOME=%s\\n' "$HOME"`,
      `cat ${JSON.stringify(fixture.normal)}`,
      `cat ${JSON.stringify(fixture.privateKey)}`,
      `cat ${JSON.stringify(fixture.cliCredential)}`,
    ].join('; '));
  }, { attempt: 1, itemCount: 3 });

  await observer.measure('tool_execution', async () => {
    output = await terminalResult(exec, `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
      "process.stdout.write('BEGIN-' + 'x'.repeat(4096) + '-END')",
    )}`);
  }, { attempt: 1, bytesOut: 4106 });

  await observer.measure('tool_execution', async () => {
    started = await start.execute({
      command: "printf 'FIRST\\n'; sleep 0.08; printf 'SECOND\\n'", cwd: null,
      effect: structuredClone(effect),
    });
    final = started;
    processOutput.push(started.stdout ?? '', started.stderr ?? '');
    for (let attempt = 0; attempt < 8 && ['running', 'stop_requested'].includes(final.state); attempt += 1) {
      final = await control.execute({
        action: 'poll', processId: started.processId, cursor: final.cursor,
        input: null, end: null, waitMs: 1000, cols: null, rows: null,
      });
      processOutput.push(final.stdout ?? '', final.stderr ?? '');
    }
  }, { attempt: 1 });

  const environmentText = `${environment.stdout ?? ''}\n${environment.stderr ?? ''}`;
  const processText = processOutput.join('');
  const schemas = schemaFacts(terminal.tools);
  return {
    schema: 't5.s3a.terminal-baseline.v1',
    productChanged: false,
    fixture: {
      homeMatchesWorkingRoot: environmentText.includes(`HOME=${fixture.home}`),
      loginShellEscapedConfiguredHome: !environmentText.includes(`HOME=${fixture.home}`),
      normalReadable: environmentText.includes('NORMAL-BRIEF-42'),
      privateKeyReadable: environmentText.includes('FIXTURE-PRIVATE-KEY-DO-NOT-EXPOSE'),
      cliCredentialReadable: environmentText.includes('FIXTURE-CLI-TOKEN-DO-NOT-EXPOSE'),
      environmentOutputDigest: digest(environmentText),
    },
    toolSurface: schemas,
    foregroundOutput: {
      truncated: output.truncated === true,
      omittedChars: output.omittedChars ?? 0,
      preservesHead: String(output.stdout ?? '').startsWith('BEGIN-'),
      preservesTail: String(output.stdout ?? '').endsWith('-END'),
      exactRecallHandlePresent: Boolean(output.outputHandle ?? output.recallHandle ?? output.chunkId),
    },
    processContinuity: {
      startedWithHandle: Boolean(started.processId),
      initialState: started.state,
      terminalState: final.state,
      exitCode: final.processExitCode ?? final.exitCode ?? null,
      firstObserved: processText.includes('FIRST'),
      secondObserved: processText.includes('SECOND'),
      duplicateSecondCount: processText.split('SECOND').length - 1,
    },
    observer: observer.snapshot(),
  };
}
