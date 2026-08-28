#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createReadStream, writeSync } from 'node:fs';

if (process.platform !== 'darwin') throw new Error('macOS parent-death host requires darwin');
const [program, ...args] = process.argv.slice(2);
if (!program) throw new Error('managed program is required');

const target = spawn(program, args, {
  cwd: process.cwd(), env: process.env, detached: false, stdio: ['pipe', 'pipe', 'pipe'],
});
process.stdin.pipe(target.stdin);
target.stdout.on('data', (chunk) => { process.stdout.write(chunk); });
target.stderr.on('data', (chunk) => { process.stderr.write(chunk); });

const control = createReadStream(null, { fd: 3, autoClose: false });
control.resume();
let terminating = false; let killTimer = null;
function terminateGroup() {
  if (terminating || hostFinished) return;
  terminating = true;
  try { process.kill(-process.pid, 'SIGTERM'); }
  catch (error) { if (error?.code !== 'ESRCH') throw error; }
  killTimer = setTimeout(() => {
    try { process.kill(-process.pid, 'SIGKILL'); }
    catch (error) { if (error?.code !== 'ESRCH') process.exitCode = 1; }
  }, 1000);
}
process.on('SIGTERM', terminateGroup);
process.on('SIGINT', terminateGroup);
control.once('end', terminateGroup);
control.once('error', terminateGroup);

target.once('error', (error) => {
  process.stderr.write(`managed launch failed: ${error?.code ?? 'unknown'}\n`);
});
let targetExit = null; let endedStreams = 0; let hostFinished = false;
function finishHost() {
  if (hostFinished || !targetExit || endedStreams < 2) return;
  hostFinished = true;
  if (killTimer) clearTimeout(killTimer);
  try { writeSync(3, 'complete\n'); } catch { /* Runtime may already be gone */ }
  control.destroy();
  if (targetExit.signal) {
    process.removeListener('SIGTERM', terminateGroup); process.removeListener('SIGINT', terminateGroup);
    process.kill(process.pid, targetExit.signal);
  } else process.exit(targetExit.code ?? 1);
}
target.stdout.once('end', () => { endedStreams += 1; finishHost(); });
target.stderr.once('end', () => { endedStreams += 1; finishHost(); });
target.once('exit', (code, signal) => {
  targetExit = { code, signal };
  process.stdin.unpipe(target.stdin); target.stdin.destroy(); process.stdin.pause();
  finishHost();
});
