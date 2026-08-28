import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_HELPER = fileURLToPath(new URL('../scripts/command-explainer-child.mjs', import.meta.url));
const MAX_COMMAND_CHARS = 128 * 1024;
const MAX_RESPONSE_CHARS = 512 * 1024;

function unavailable(reason = 'command_explainer_unavailable') {
  return Object.assign(new Error(reason), { code: 'T5_COMMAND_EXPLAINER_UNAVAILABLE' });
}

export class IsolatedCommandExplainer {
  constructor({ helperPath = DEFAULT_HELPER, spawnProcess = spawn, makeId = randomUUID,
    timeoutMs = 2_000 } = {}) {
    if (!helperPath || typeof spawnProcess !== 'function' || typeof makeId !== 'function'
      || !Number.isInteger(timeoutMs) || timeoutMs < 100) throw new TypeError('isolated explainer options invalid');
    this.helperPath = helperPath; this.spawnProcess = spawnProcess; this.makeId = makeId;
    this.timeoutMs = timeoutMs; this.child = null; this.pending = new Map(); this.buffer = '';
  }

  failAll(error) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }

  start() {
    if (this.child && this.child.exitCode == null && this.child.signalCode == null) return this.child;
    const child = this.spawnProcess(process.execPath, [this.helperPath, '--persistent'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child; this.buffer = '';
    child.stdout?.setEncoding?.('utf8'); child.stderr?.resume?.();
    child.stdout?.on?.('data', (chunk) => {
      this.buffer += String(chunk);
      if (this.buffer.length > MAX_RESPONSE_CHARS) {
        this.failAll(unavailable('command_explainer_response_too_large'));
        child.kill?.('SIGKILL'); return;
      }
      for (;;) {
        const newline = this.buffer.indexOf('\n'); if (newline < 0) break;
        const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
        let response;
        try { response = JSON.parse(line); } catch { response = null; }
        const entry = response?.id && this.pending.get(response.id);
        if (!entry || !response || !Object.hasOwn(response, 'ok')) {
          this.failAll(unavailable('command_explainer_response_invalid')); child.kill?.('SIGKILL'); return;
        }
        this.pending.delete(response.id); clearTimeout(entry.timer);
        if (response.ok !== true || !response.result || response.result.source !== entry.command) {
          entry.reject(unavailable(response?.error ?? 'command_explainer_response_mismatch'));
        } else entry.resolve(response.result);
      }
    });
    const ended = () => {
      if (this.child === child) this.child = null;
      this.failAll(unavailable('command_explainer_process_exited'));
    };
    child.once?.('error', ended); child.once?.('exit', ended);
    return child;
  }

  explain(commandValue) {
    const command = String(commandValue ?? '');
    if (!command || command.length > MAX_COMMAND_CHARS) return Promise.reject(
      unavailable('command_explainer_command_invalid'));
    const child = this.start(); const id = this.makeId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(unavailable('command_explainer_timeout'));
        child.kill?.('SIGKILL');
      }, this.timeoutMs); timer.unref?.();
      this.pending.set(id, { command, resolve, reject, timer });
      child.stdin?.write?.(`${JSON.stringify({ id, command })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer); this.pending.delete(id); reject(unavailable('command_explainer_write_failed'));
      });
    });
  }

  async close() {
    const child = this.child; this.child = null;
    this.failAll(unavailable('command_explainer_closed'));
    if (!child || child.exitCode != null || child.signalCode != null) return;
    child.stdin?.end?.();
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill?.('SIGKILL'); resolve(); }, 500); timer.unref?.();
      child.once?.('close', () => { clearTimeout(timer); resolve(); });
    });
  }
}
