#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { explainShellCommand } from '../src/command-explainer.js';

const MAX_COMMAND_CHARS = 128 * 1024;
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(value);

async function oneShot() {
  let command = '';
  for await (const chunk of process.stdin) {
    command += String(chunk);
    if (command.length > MAX_COMMAND_CHARS) throw new Error('command is too large');
  }
  process.stdout.write(JSON.stringify(await explainShellCommand(command)));
}

async function persistent() {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    let request;
    try { request = JSON.parse(line); } catch { request = null; }
    if (!request || Object.keys(request).sort().join(',') !== 'command,id'
      || !validId(request.id) || typeof request.command !== 'string'
      || !request.command || request.command.length > MAX_COMMAND_CHARS) {
      process.stdout.write(`${JSON.stringify({ id: validId(request?.id) ? request.id : null,
        ok: false, error: 'invalid_explanation_request' })}\n`);
      continue;
    }
    try {
      const result = await explainShellCommand(request.command);
      process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result,
        rss: process.memoryUsage().rss })}\n`);
    } catch {
      process.stdout.write(`${JSON.stringify({ id: request.id, ok: false,
        error: 'command_explanation_failed' })}\n`);
    }
  }
}

if (process.argv.includes('--persistent')) await persistent();
else await oneShot();
