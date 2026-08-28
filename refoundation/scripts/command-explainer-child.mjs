#!/usr/bin/env node
import { explainShellCommand } from '../src/command-explainer.js';

let command = '';
for await (const chunk of process.stdin) {
  command += String(chunk);
  if (command.length > 128 * 1024) throw new Error('command is too large');
}
process.stdout.write(JSON.stringify(await explainShellCommand(command)));
