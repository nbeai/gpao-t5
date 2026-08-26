#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  createTerminalBaselineFixture, measureTerminalBaseline,
} from '../test/helpers/s3a-terminal-baseline.js';

const outIndex = process.argv.indexOf('--out');
const output = outIndex >= 0 ? resolve(process.argv[outIndex + 1]) : null;
const room = await mkdtemp(join(tmpdir(), 't5-s3a-terminal-evidence-'));
try {
  const fixture = await createTerminalBaselineFixture(room);
  const measured = await measureTerminalBaseline(fixture);
  const evidence = {
    ...measured,
    recordedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    status: 'baseline_gap_observed_optimization_not_started',
    comparisonSources: [
      { system: 'Codex', commit: 'a26f1806a4f4b8cfec2ea1be129963815a61e58c',
        adoptedPrinciple: 'unified exec identity, serialized interaction per process, output omission metadata' },
      { system: 'OpenClaw', commit: '0482cbf1c06cc82e2dffcc44c6dadfd9a701d5c7',
        adoptedPrinciple: 'trusted shell snapshot separated from command execution, scoped process registry, unread output delta' },
      { system: 'Hermes', commit: '4ba2608524fed4c94bb5b535fc26d7d483e333db',
        adoptedPrinciple: 'terminal/process split, foreground/background redaction, process provenance' },
      { system: 'OpenHands', commit: 'f48eca6ab9149b3aa532e86842c85da43e370108',
        adoptedPrinciple: 'action-observation identity and paged bash output' },
    ],
    nextCandidate: 'login_shell_snapshot_and_secret_safe_environment_countertests',
    forbiddenConclusions: [
      'real_home_unavailable', 'terminal_session_driver_approved', 'sandbox_first_approved',
      'effect_schema_removal_approved', 'provider_native_shell_approved',
    ],
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (output) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serialized, { mode: 0o600 });
  } else process.stdout.write(serialized);
} finally { await rm(room, { recursive: true, force: true }); }
