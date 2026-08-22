import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { consoleCookieHeader, makeLocalConsoleGuard } from '../src/local-console-guard.js';
import { makeConsoleServer } from '../src/console-server.js';

function request(headers = {}) { return { headers }; }

test('local console guard rejects missing identity, foreign origins, and rebinding hosts', () => {
  const guard = makeLocalConsoleGuard({ token: 'test-secret', port: () => 4174 });
  assert.equal(guard.inspect(request({ host: '127.0.0.1:4174' }), '/sessions')?.reason, 'token');
  assert.equal(guard.inspect(request({
    host: '127.0.0.1:4174', origin: 'https://evil.example', cookie: 't5_console=test-secret',
  }), '/sessions')?.reason, 'origin');
  assert.equal(guard.inspect(request({
    host: 'evil.example:4174', cookie: 't5_console=test-secret',
  }), '/sessions')?.reason, 'host');
  assert.equal(guard.inspect(request({
    host: 'localhost:9999', cookie: 't5_console=test-secret',
  }), '/sessions')?.reason, 'host_port');
});

test('local console guard allows bootstrap and exact same-site identity only', () => {
  const guard = makeLocalConsoleGuard({ token: 'test-secret', port: () => 4174 });
  assert.equal(guard.inspect(request({ host: '127.0.0.1:4174' }), '/'), null);
  assert.equal(guard.inspect(request({ host: 'localhost:4174' }), '/health'), null);
  assert.equal(guard.inspect(request({
    host: '127.0.0.1:4174', origin: 'http://127.0.0.1:4174', cookie: 't5_console=test-secret',
  }), '/sessions'), null);
  assert.match(consoleCookieHeader('test-secret'), /HttpOnly; SameSite=Strict/u);
});

test('local console guard cannot be enabled without an install identity', () => {
  assert.throws(() => makeLocalConsoleGuard({ token: '', port: () => 4174 }), /token is required/u);
});

test('protected console routes are unreachable before route dispatch', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-local-console-guard-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const server = makeConsoleServer({
    stateDir, workspace, localConsoleToken: 'route-secret',
    modelFactory: () => ({ async respond() { return { text: 'unused', toolCalls: [] }; } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const rebinding = await fetch(`${base}/sessions`, { headers: { host: `evil.example:${port}` } });
    assert.equal(rebinding.status, 403);

    const crossSite = await fetch(`${base}/sessions`, {
      method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'text/plain' },
      body: '{}',
    });
    assert.equal(crossSite.status, 403);

    const bootstrap = await fetch(`${base}/`);
    assert.equal(bootstrap.status, 200);
    const cookie = bootstrap.headers.get('set-cookie').split(';', 1)[0];
    const created = await fetch(`${base}/sessions`, { method: 'POST', headers: { cookie } });
    assert.equal(created.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
