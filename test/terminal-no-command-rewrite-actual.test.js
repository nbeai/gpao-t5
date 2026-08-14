import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { sandboxAvailable } from '../src/runtime/sandbox.js';

test('actual macOS: terminal never rewrites a direct output command into a staging write',
  { skip: !sandboxAvailable() && 'sandbox unavailable' }, async () => {
    const root = await mkdtemp(join(tmpdir(), 't5-terminal-no-rewrite-'));
    const work = join(root, 'work');
    await mkdir(work);
    const target = join(work, 'report.tsv');
    const state = join(root, 'state');
    const tool = makeLocalTerminalTool({ cwd: work, workspaceRoot: work, dataDir: state });
    const command = "printf 'safe\\n' > report.tsv";
    const planned = await tool.probe(command, { cwd: work });

    assert.equal(planned.writeEffect?.reversible, true);
    const executed = await tool.handler({
      command, cwd: work, granted: true,
      probeResult: planned.probe, writeEffect: planned.writeEffect,
    });

    assert.equal(executed.rerouted, true);
    assert.equal(executed.result?.writeEffect?.requiresStructuredCommit, true);
    await assert.rejects(access(target), /ENOENT/);
    await assert.rejects(access(join(state, '.terminal-stage')), /ENOENT/);
  });
