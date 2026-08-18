#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const separator = process.argv.indexOf('--');
const argv = separator >= 0 ? process.argv.slice(separator + 1) : process.argv.slice(2);
if (!argv.length) {
  console.error('사용: npm run refoundation:isolated -- <command> [args...]');
  process.exit(2);
}

const room = await mkdtemp(join(tmpdir(), 't5-refoundation-'));
const home = join(room, 'home');
const data = join(room, 'data');
const workspace = join(room, 'workspace');
await Promise.all([home, data, workspace].map((path) => mkdir(path, { recursive: true })));

const credentialName = /(TOKEN|KEY|SECRET|PASSWORD|PASSCODE|CREDENTIAL|COOKIE|AUTH|SESSION|ACCOUNT)/i;
const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => (
  !credentialName.test(name)
  && !name.startsWith('GPAO_T5_')
  && !name.startsWith('T5_REFOUNDATION_')
)));
const env = {
  ...inherited,
  HOME: home,
  T5_REFOUNDATION_HOME: home,
  T5_REFOUNDATION_DATA_DIR: data,
  T5_REFOUNDATION_WORKSPACE: workspace,
  T5_REFOUNDATION_ISOLATED: '1',
};

console.log(`T5 격리 실행 — room ${room}`);
const child = spawn(argv[0], argv.slice(1), {
  cwd: resolve('.'), env, stdio: 'inherit', shell: false,
});

const forward = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.once('SIGINT', forward);
process.once('SIGTERM', forward);

const code = await new Promise((done) => {
  child.once('error', (error) => {
    console.error(`격리 명령 시작 실패: ${error.message}`);
    done(127);
  });
  child.once('exit', (exitCode, signal) => {
    if (signal) console.error(`격리 명령 종료 신호: ${signal}`);
    done(exitCode ?? 1);
  });
});
process.removeListener('SIGINT', forward);
process.removeListener('SIGTERM', forward);

if (process.env.T5_REFOUNDATION_KEEP_ISOLATED === '1') {
  console.log(`격리 방 보존: ${room}`);
} else {
  await rm(room, { recursive: true, force: true });
}
process.exit(code);
