import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConnectionCredentialCoordinator } from '../src/connection-credential-coordinator.js';
import { ConnectionStateStore, connectionStateKey } from '../src/connection-state-store.js';

function fileSecrets(directory) {
  const path = (name) => join(directory, `${name}.json`);
  return { async get(name) { try { return JSON.parse(await readFile(path(name), 'utf8')); }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error; } },
  async set(name, value) { const temporary = `${path(name)}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path(name)); },
  async clear(name) { await unlink(path(name)).catch((error) => { if (error?.code !== 'ENOENT') throw error; }); } };
}

function runChild(source, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = []; const err = []; child.stdout.on('data', (chunk) => out.push(chunk)); child.stderr.on('data', (chunk) => err.push(chunk));
    child.once('error', reject); child.once('close', (code) => code === 0
      ? resolve(Buffer.concat(out).toString('utf8'))
      : reject(new Error(Buffer.concat(err).toString('utf8') || `child ${code}`)));
  });
}

function runChildCode(source, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    const err = []; child.stderr.on('data', (chunk) => err.push(chunk)); child.once('error', reject);
    child.once('close', (code) => resolve({ code, stderr: Buffer.concat(err).toString('utf8') }));
  });
}

test('실제 두 Node process의 같은 만료 generation도 provider refresh POST를 한 번만 만든다', async (t) => {
  const room = await mkdtemp(join(tmpdir(), 't5-multiprocess-refresh-')); t.after(() => rm(room, { recursive: true, force: true }));
  const secretDir = join(room, 'secrets'); await mkdir(secretDir); const stateFile = join(room, 'connections.sqlite');
  const state = new ConnectionStateStore(stateFile); const secrets = fileSecrets(secretDir); let ids = 0;
  const coordinator = new ConnectionCredentialCoordinator({ stateStore: state, secretStore: secrets,
    makeId: () => `seed-${++ids}` });
  const key = connectionStateKey({ t5UserId: 'local-owner', connectionSlotId: 'shared', service: 'shared',
    endpoint: 'https://mcp.example.test/mcp', oauthClientId: 'client' });
  const lease = state.acquireLease({ connectionKey: key, ownerId: 'seed' });
  await coordinator.commit({ connectionKey: key, expectedGeneration: 0, lease,
    issuer: 'https://identity.example.test', identity: { accountId: 'account' }, scopes: ['read'], capabilities: { read: true },
    credential: { metadata: { issuer: 'https://identity.example.test', token_endpoint: 'https://token.example.test/token' },
      client: { client_id: 'client' }, verifiedAt: 1, identity: { accountId: 'account' }, capabilities: { read: true },
      tools: ['read'], tokens: { accessToken: 'OLD', refreshToken: 'ROTATING', expiresAt: 1, scopes: ['read'] } } });
  state.releaseLease(lease); state.close();

  let posts = 0; const provider = createServer((_request, response) => {
    posts += 1; setTimeout(() => { response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ access_token: 'NEW', refresh_token: 'ROTATED', expires_in: 3600, scope: 'read' })); }, 50);
  });
  await new Promise((resolve, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => provider.close(resolve)));

  const moduleRoot = new URL('../src/', import.meta.url).href;
  const source = `
    import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    import { randomUUID } from 'node:crypto';
    import { ConnectionStateStore } from ${JSON.stringify(`${moduleRoot}connection-state-store.js`)};
    import { ConnectionCredentialCoordinator } from ${JSON.stringify(`${moduleRoot}connection-credential-coordinator.js`)};
    import { makeRemoteMcpConnection } from ${JSON.stringify(`${moduleRoot}remote-mcp-connection.js`)};
    const path = (name) => join(process.env.SECRET_DIR, name + '.json');
    const secrets = { async get(name) { try { return JSON.parse(await readFile(path(name), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
      async set(name, value) { const temp = path(name) + '.' + process.pid + '.tmp'; await writeFile(temp, JSON.stringify(value)); await rename(temp, path(name)); },
      async clear(name) { await unlink(path(name)).catch((e) => { if (e.code !== 'ENOENT') throw e; }); } };
    const state = new ConnectionStateStore(process.env.STATE_FILE);
    const coordinator = new ConnectionCredentialCoordinator({ stateStore: state, secretStore: secrets, makeId: randomUUID });
    const connection = makeRemoteMcpConnection({ id: 'shared', label: 'Shared', serverUrl: 'https://mcp.example.test/mcp',
      secretStore: secrets, stateStore: state, credentialCoordinator: coordinator, connectionSlotId: 'shared',
      oauthClient: { client_id: 'client' }, now: () => 10_000_000,
      fetchImpl: (_url, init) => fetch(process.env.PROVIDER_URL, init),
      runtimeFactory: ({ credential }) => ({ async listTools() { await credential(); return [{ name: 'read', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }]; },
        async callTool() { return { content: [] }; }, async close() {}, invalidate() {} }) });
    const tool = await connection.makeTool({ authorizeEffect: async () => ({ allowed: true }) });
    await tool.execute({ action: 'list_tools', toolName: null, argumentsJson: null, effect: null });
    await connection.close(); state.close(); process.stdout.write('ok');
  `;
  const providerUrl = `http://127.0.0.1:${provider.address().port}/token`;
  const outputs = await Promise.all([1, 2].map(() => runChild(source, {
    STATE_FILE: stateFile, SECRET_DIR: secretDir, PROVIDER_URL: providerUrl,
  })));
  assert.deepEqual(outputs, ['ok', 'ok']); assert.equal(posts, 1);
});

test('candidate secret write 직후 process kill도 prepare row로 발견해 restart에서 제거한다', async (t) => {
  const room = await mkdtemp(join(tmpdir(), 't5-prepare-crash-')); t.after(() => rm(room, { recursive: true, force: true }));
  const secretDir = join(room, 'secrets'); await mkdir(secretDir); const stateFile = join(room, 'connections.sqlite');
  const moduleRoot = new URL('../src/', import.meta.url).href;
  const source = `
    import { readFile, rename, unlink, writeFile } from 'node:fs/promises'; import { join } from 'node:path';
    import { ConnectionStateStore, connectionStateKey } from ${JSON.stringify(`${moduleRoot}connection-state-store.js`)};
    import { ConnectionCredentialCoordinator } from ${JSON.stringify(`${moduleRoot}connection-credential-coordinator.js`)};
    const path = (name) => join(process.env.SECRET_DIR, name + '.json');
    const secrets = { async get(name) { try { return JSON.parse(await readFile(path(name), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
      async set(name, value) { const temp = path(name) + '.tmp'; await writeFile(temp, JSON.stringify(value)); await rename(temp, path(name)); process.exit(23); },
      async clear(name) { await unlink(path(name)).catch((e) => { if (e.code !== 'ENOENT') throw e; }); } };
    const state = new ConnectionStateStore(process.env.STATE_FILE); const coordinator = new ConnectionCredentialCoordinator({
      stateStore: state, secretStore: secrets, makeId: () => 'unused' });
    const key = connectionStateKey({ t5UserId: 'local-owner', connectionSlotId: 'crash', service: 'crash',
      endpoint: 'https://mcp.example.test/mcp', oauthClientId: 'client' });
    const lease = state.acquireLease({ connectionKey: key, ownerId: 'crashing-child', leaseMs: 1000 });
    await coordinator.commit({ connectionKey: key, expectedGeneration: 0, lease,
      credential: { tokens: { accessToken: 'VALID', refreshToken: 'VALID-REFRESH' } },
      issuer: 'https://identity.example.test', identity: { accountId: 'account' }, scopes: ['read'], capabilities: { read: true } });
  `;
  const killed = await runChildCode(source, { STATE_FILE: stateFile, SECRET_DIR: secretDir });
  assert.equal(killed.code, 23);
  await new Promise((resolve) => setTimeout(resolve, 1_050));
  const state = new ConnectionStateStore(stateFile); const secrets = fileSecrets(secretDir);
  const coordinator = new ConnectionCredentialCoordinator({ stateStore: state, secretStore: secrets, makeId: () => 'unused' });
  const key = connectionStateKey({ t5UserId: 'local-owner', connectionSlotId: 'crash', service: 'crash',
    endpoint: 'https://mcp.example.test/mcp', oauthClientId: 'client' });
  const lease = state.acquireLease({ connectionKey: key, ownerId: 'restart', leaseMs: 5_000 });
  state.reconcileCredentialPrepares({ connectionKey: key, lease }); state.releaseLease(lease);
  await coordinator.drainCleanup(key);
  assert.equal(state.database.prepare('SELECT count(*) AS n FROM connection_credential_prepares').get().n, 0);
  assert.equal(state.database.prepare('SELECT count(*) AS n FROM connection_secret_cleanup').get().n, 0);
  assert.equal((await secrets.get(`conn-${key.slice(0, 32)}-g1`)), null); state.close();
});
