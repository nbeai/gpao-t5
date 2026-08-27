import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  resolveWindowsProductEnvironment, windowsCanonicalRoots,
} from '../src/windows-product-environment.js';

const sha = (value) => createHash('sha256').update(value).digest('hex');

test('Windows 제품 상태는 LOCALAPPDATA에 있고 설치 upgrade와 분리된다', () => {
  const roots = windowsCanonicalRoots({ env: {
    LOCALAPPDATA: 'C:\\Users\\person\\AppData\\Local', USERPROFILE: 'C:\\Users\\person',
  } });
  assert.equal(roots.stateDir, 'C:\\Users\\person\\AppData\\Local\\GPAO-T5\\state\\refoundation-console');
  assert.equal(roots.connectionFile, 'C:\\Users\\person\\AppData\\Local\\GPAO-T5\\state\\sessions\\model-connection.json');
  assert.equal(roots.credentialDirectory, 'C:\\Users\\person\\AppData\\Local\\GPAO-T5\\credentials');
  assert.doesNotMatch(JSON.stringify(roots), /Program Files|\.local/u);
});

test('Windows packaged host는 manifest arch와 exact digest를 확인한 뒤 명시 경로로만 열린다', async () => {
  const root = 'C:\\Program Files\\GPAO-T5';
  const bodies = new Map([
    [`${root}\\bin\\node.exe`, Buffer.from('node')],
    [`${root}\\bin\\t5-windows-job-host.exe`, Buffer.from('host')],
    [`${root}\\bin\\GPAO-T5.exe`, Buffer.from('launcher')],
    [`${root}\\app\\refoundation\\scripts\\start-console.mjs`, Buffer.from('entry')],
    [`${root}\\bin\\t5-windows-file-activity.exe`, Buffer.from('file')],
    [`${root}\\bin\\t5-windows-coarse-app-activity.exe`, Buffer.from('app')],
    [`${root}\\bin\\t5-windows-folder-picker.exe`, Buffer.from('picker')],
  ]);
  const roleEntries = [
    ['node_runtime', 'bin/node.exe', 'node'],
    ['job_credential_host', 'bin/t5-windows-job-host.exe', 'host'],
    ['launcher', 'bin/GPAO-T5.exe', 'launcher'],
    ['console_entry', 'app/refoundation/scripts/start-console.mjs', 'entry'],
    ['file_activity_helper', 'bin/t5-windows-file-activity.exe', 'file'],
    ['app_activity_helper', 'bin/t5-windows-coarse-app-activity.exe', 'app'],
    ['folder_picker_helper', 'bin/t5-windows-folder-picker.exe', 'picker'],
  ];
  const files = roleEntries.map(([,path,body])=>({path,sha256:sha(body)}));
  const roles=Object.fromEntries(roleEntries.map(([role,path])=>[role,path]));
  const manifest = JSON.stringify({ schema: 't5.windows-product-payload.v1', architecture: 'x64', files, roles });
  const read = async (path) => path.endsWith('windows-product-manifest.json') ? manifest : bodies.get(path);
  const found = await resolveWindowsProductEnvironment({
    architecture: 'x64', productRoot: root,
    env: { LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local', USERPROFILE: 'C:\\Users\\p' },
    read, canAccess: async (path) => { if (!bodies.has(path)) throw new Error('missing'); },
  });
  assert.equal(found.jobCredentialHost, `${root}\\bin\\t5-windows-job-host.exe`);
  assert.equal(found.stateDir, 'C:\\Users\\p\\AppData\\Local\\GPAO-T5\\state\\refoundation-console');
  assert.equal(process.env.T5_WINDOWS_JOB_HOST === found.jobCredentialHost, false);
});

test('Windows packaged host는 missing, wrong arch, digest 변경, root escape를 fail closed한다', async () => {
  const base = { architecture: 'arm64', productRoot: 'C:\\T5',
    env: { LOCALAPPDATA: 'C:\\Local', USERPROFILE: 'C:\\Users\\p' }, canAccess: async () => {} };
  for (const manifest of [
    { schema: 't5.windows-product-payload.v1', architecture: 'x64', files: [], roles: {} },
    { schema: 't5.windows-product-payload.v1', architecture: 'arm64', files: [
      { path: '../node.exe', sha256: 'a'.repeat(64) },
    ], roles: { node_runtime: '../node.exe' } },
    { schema: 't5.windows-product-payload.v1', architecture: 'arm64', files: [
      { path: 'bin/node.exe', sha256: 'a'.repeat(64) },
    ], roles: { node_runtime: 'bin/node.exe' } },
  ]) {
    await assert.rejects(resolveWindowsProductEnvironment({ ...base,
      read: async (path) => path.endsWith('manifest.json') ? JSON.stringify(manifest) : Buffer.from('changed'),
    }), /manifest|identity|unavailable/u);
  }
});
