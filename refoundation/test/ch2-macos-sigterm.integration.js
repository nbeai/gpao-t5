import assert from 'node:assert/strict';
import { execFile as rawExecFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFile = promisify(rawExecFile);

test('CH2 macOS 장기 helper는 SIGTERM pause에서 마지막 foreground 구간을 잃지 않는다', {
  skip: process.platform !== 'darwin', timeout: 15_000,
}, async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-ch2-sigterm-')); const helper = join(room, 'helper');
  try {
    await execFile('xcrun', ['clang', '-fobjc-arc', '-O2', '-framework', 'AppKit', '-framework', 'CoreGraphics',
      new URL('../native/macos-coarse-app-activity.m', import.meta.url).pathname, '-o', helper]);
    const child = spawn(helper, ['--seconds', '86400', '--interval', '0.1', '--afk-seconds', '300'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', (chunk) => { output += chunk; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('helper ready timeout')), 3_000);
      const inspect = () => { if (!output.includes('"kind":"ready"')) return;
        clearTimeout(timer); child.stdout.off('data', inspect); resolve(); };
      child.stdout.on('data', inspect); child.once('error', reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 250)); child.kill('SIGTERM');
    const code = await new Promise((resolve) => child.once('close', resolve));
    assert.equal(code, 0); const lines = output.trim().split('\n').map(JSON.parse);
    assert.equal(lines[0].kind, 'ready'); assert.equal(lines[1].kind, 'segment');
    assert.ok(lines[1].durationMs >= 0); assert.ok(lines[1].appLabel); assert.ok(lines[1].appId);
    assert.deepEqual(Object.keys(lines[1]).sort(),
      ['afk', 'appId', 'appLabel', 'durationMs', 'endedAt', 'kind', 'segmentId', 'startedAt'].sort());
  } finally { await rm(room, { recursive: true, force: true }); }
});
