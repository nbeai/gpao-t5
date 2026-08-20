import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { makeGoogleDriveDesktop } from '../src/google-drive-desktop.js';

const dir = (name) => ({ name, isDirectory: () => true });
const HOME = '/fixture/home';
const CLOUD = join(HOME, 'Library', 'CloudStorage');

test('Drive 앱이 없으면 공식 설치 안내만 열고 연결됐다고 꾸미지 않는다', async () => {
  const opened = [];
  const route = makeGoogleDriveDesktop({
    userHome: HOME, appExists: async () => false,
    openExternal: async (url) => { opened.push(url); },
  });
  const truth = await route.inspect();
  assert.equal(truth.state, 'needs_connection');
  assert.equal(truth.reason, 'drive_desktop_not_installed');
  assert.equal(truth.actions[0].id, 'install_drive_desktop');
  const result = await route.perform('install_drive_desktop');
  assert.equal(result.performed, true);
  assert.deepEqual(opened, ['https://support.google.com/drive/answer/10838124']);
});

test('Drive 앱은 있지만 계정 폴더가 없으면 로그인 화면을 연다', async () => {
  let opened = 0;
  const route = makeGoogleDriveDesktop({
    userHome: HOME, appExists: async () => true,
    readDirectory: async (path) => path === CLOUD ? [] : [],
    openApplication: async () => { opened += 1; },
  });
  const truth = await route.inspect();
  assert.equal(truth.reason, 'drive_desktop_login_required');
  assert.equal(truth.actions[0].label, 'Google Drive 로그인');
  await route.perform('open_drive_desktop');
  assert.equal(opened, 1);
});

test('계정 폴더가 생겼지만 File Provider가 아직 응답하지 않으면 초기화 중으로 말한다', async () => {
  const route = makeGoogleDriveDesktop({
    userHome: HOME, appExists: async () => true,
    readDirectory: async (path) => {
      if (path === CLOUD) return [dir('GoogleDrive-user@example.test')];
      throw Object.assign(new Error('not ready'), { code: 'ETIMEDOUT' });
    },
  });
  const truth = await route.inspect();
  assert.equal(truth.state, 'needs_attention');
  assert.equal(truth.reason, 'drive_desktop_initializing');
  assert.match(truth.userSafeSummary, /준비하고 있어요/u);
});

test('내 드라이브를 실제로 열 수 있을 때만 Finder 경로를 사용 가능으로 올린다', async () => {
  const account = join(CLOUD, 'GoogleDrive-user@example.test');
  const myDriveName = '내 드라이브'.normalize('NFD');
  const myDrive = join(account, myDriveName);
  const route = makeGoogleDriveDesktop({
    userHome: HOME, appExists: async () => true,
    readDirectory: async (path) => {
      if (path === CLOUD) return [dir('GoogleDrive-user@example.test')];
      if (path === account) return [dir(myDriveName), dir('공유 드라이브'.normalize('NFD'))];
      if (path === myDrive) return [dir('업무')];
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    fileStat: async () => ({ isDirectory: () => true }),
  });
  const truth = await route.inspect();
  assert.equal(truth.state, 'ready');
  assert.equal(truth.reason, 'local_sync_available');
  assert.equal(truth.capabilities.upload, true);
  assert.deepEqual(truth.routes[0].roots, [myDrive]);
  assert.deepEqual(truth.actions, []);
});
