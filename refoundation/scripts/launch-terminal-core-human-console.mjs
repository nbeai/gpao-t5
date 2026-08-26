#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { copyFile, chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeModelConnectionService } from '../src/model-connection-service.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';
import { findExecutable, makeGitHubCliRegistration } from '../src/github-cli-broker.js';
import { makeTerminalCredentialBroker } from '../src/terminal-credential-broker.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { makeConsoleServer } from '../src/console-server.js';
import {
  materializeTerminalPerformanceCase, TERMINAL_PERFORMANCE_CASES,
} from '../src/terminal-performance.js';

if (!process.argv.includes('--human-controlled')) {
  throw new Error('This console never submits model work automatically. Start it explicitly with --human-controlled.');
}
const option = (name) => {
  const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined;
};
const sourceConnection = resolve(option('--connection-file')
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const root = await mkdtemp(join(tmpdir(), 't5-terminal-core-human-'));
const stateDir = join(root, 'state'); const workspace = join(root, 'workspace');
await Promise.all([mkdir(stateDir, { mode: 0o700 }), mkdir(workspace, { mode: 0o700 })]);
const connectionFile = join(stateDir, 'model-connection.json');
await copyFile(sourceConnection, connectionFile); await chmod(connectionFile, 0o600);

const scale = TERMINAL_PERFORMANCE_CASES.find((item) => item.id === 'scale-aggregate');
await materializeTerminalPerformanceCase(scale, join(workspace, '01-bulk'));
await Promise.all(['02-managed', '03-tty', '04-large'].map((name) => mkdir(join(workspace, name))));
await writeFile(join(workspace, '02-managed', 'server.mjs'), [
  "import { createServer } from 'node:http';",
  "const server=createServer((request,response)=>{response.writeHead(200,{'content-type':'text/plain'});response.end(request.url==='/health'?'HEALTHY-4821\\n':'NOT-FOUND\\n');});",
  "server.listen(0,'127.0.0.1',()=>process.stdout.write(`READY ${server.address().port}\\n`));",
  "const stop=()=>server.close(()=>process.exit(0)); process.on('SIGTERM',stop); process.on('SIGINT',stop);",
].join('\n'), { mode: 0o600 });
await writeFile(join(workspace, '03-tty', 'prompt.mjs'), [
  "if(!process.stdin.isTTY||!process.stdout.isTTY){process.stderr.write('TTY_REQUIRED\\n');process.exit(73);}",
  "process.stdout.write('거래 확인 코드를 입력하세요: '); process.stdin.setEncoding('utf8');",
  "process.stdin.once('data',(value)=>{const code=value.trim();process.stdout.write(code==='은하-4821'?'TTY_ACCEPTED 은하-4821\\n':`TTY_REJECTED ${code}\\n`);process.exit(code==='은하-4821'?0:74);});",
].join('\n'), { mode: 0o600 });
await writeFile(join(workspace, '04-large', 'output.mjs'),
  "process.stdout.write(`BEGIN\\n${'앞'.repeat(40000)}\\n정확한-중간-표식: 파랑새-7391\\n${'뒤'.repeat(40000)}\\nEND\\n`);\n",
  { mode: 0o600 });

const computer = discoverComputerEnvironment({ userHome: homedir() });
const terminalEnvironment = await resolveTerminalShellEnvironment({ computer, home: homedir() });
const githubCli = await findExecutable('gh', terminalEnvironment.PATH ?? '');
const platformSecretStore = makePlatformSecretStore({ platform: computer.platform });
const access = makeConsoleModelAccess({ connectionFile, stateDir, secretStore: platformSecretStore });
const server = makeConsoleServer({
  stateDir, workspace, computerEnvironment: computer, terminalEnvironment,
  modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
  modelConnections: makeModelConnectionService({ file: connectionFile, secretStore: platformSecretStore }),
  terminalPlatformAdapter: await makeTerminalPlatformAdapter({
    platform: computer.platform,
    protectedReadRoots: [join(stateDir, 'connections'), join(homedir(), 'Library', 'Keychains')],
    protectedExecutableNames: githubCli ? ['gh'] : [],
  }),
  terminalCredentialBroker: makeTerminalCredentialBroker({
    registrations: githubCli ? [makeGitHubCliRegistration(githubCli)] : [],
  }),
  onError: (error) => console.error('[terminal-human-console]', error?.message ?? error),
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject); server.listen(Number(option('--port') ?? 0), '127.0.0.1', resolveListen);
});
const url = `http://127.0.0.1:${server.address().port}`;
console.log(JSON.stringify({
  url, root, workspace,
  prompts: [
    '[TCORE-H01] 01-bulk 아래 장부에서 BLUE 항목의 개수와 AMOUNT 합계를 실제 내용으로 계산해줘. 파일 이름 전체는 늘어놓지 마.',
    '[TCORE-H02] 02-managed/server.mjs를 계속 실행되는 작업으로 시작해. READY 포트를 확인하고 /health가 HEALTHY-4821인지 검사한 뒤 서버를 종료해.',
    '[TCORE-H03] 03-tty/prompt.mjs를 실행하고 요청하는 확인 코드 은하-4821을 입력해. 실제 승인 결과까지 알려줘.',
    '[TCORE-H04] 04-large/output.mjs를 한 번만 실행하고, 잘린 출력의 중간까지 확인해서 정확한-중간-표식 값을 알려줘.',
    '[TCORE-H05 optional] 내 GitHub 인증 상태만 확인해. 토큰 값은 보거나 보여주지 마.',
  ],
}, null, 2));
if (!process.argv.includes('--no-open') && process.platform === 'darwin') {
  spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
}
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true;
  server.closeWakeStreams(); server.closeModelConnections();
  await server.managedProcesses.stopAll('human_console_shutdown').catch(() => {});
  await new Promise((resolveClose) => server.close(resolveClose));
  process.exit(0);
};
process.once('SIGINT', stop); process.once('SIGTERM', stop);
