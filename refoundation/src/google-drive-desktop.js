import { spawn } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const INSTALL_URL = 'https://support.google.com/drive/answer/10838124';

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function open(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: 'ignore', detached: false });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve(true) : reject(new Error('open failed')));
  });
}

async function boundedRead(directory, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      readdir(directory, { withFileTypes: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('directory read timed out'), {
          code: 'ETIMEDOUT',
        })), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

function isMyDrive(name) {
  const normalized = String(name).normalize('NFC').toLocaleLowerCase('en-US');
  return normalized === '내 드라이브' || normalized === 'my drive';
}

export function makeGoogleDriveDesktop({
  userHome, platform = process.platform,
  appExists = exists,
  readDirectory = boundedRead,
  fileStat = stat,
  openExternal = (url) => open('/usr/bin/open', [url]),
  openApplication = () => open('/usr/bin/open', ['-a', 'Google Drive']),
  readTimeoutMs = 2_000,
} = {}) {
  if (!userHome) throw new TypeError('Google Drive desktop route requires userHome');
  const supported = platform === 'darwin';
  const appPath = '/Applications/Google Drive.app';
  const cloudRoot = join(userHome, 'Library', 'CloudStorage');

  async function inspect() {
    if (!supported) return {
      state: 'unavailable', reason: 'drive_desktop_platform_not_supported',
      userSafeSummary: '이 운영체제에서는 Google Drive 데스크톱 연결을 아직 안내하지 못해요.',
      capabilities: {}, routes: [], actions: [],
    };
    const installed = await appExists(appPath);
    if (!installed) return {
      state: 'needs_connection', reason: 'drive_desktop_not_installed',
      userSafeSummary: 'Google Drive 앱을 설치하면 Finder에서 Drive 파일을 함께 사용할 수 있어요.',
      capabilities: {},
      routes: [{ kind: 'local_sync', label: 'Finder의 Google Drive', state: 'needs_connection', canStart: true }],
      actions: [{
        id: 'install_drive_desktop', label: 'Google Drive 설치하기', kind: 'user_action',
        endpoint: '/connections/google-workspace/action',
      }],
    };
    let accounts = [];
    try {
      accounts = (await readDirectory(cloudRoot, readTimeoutMs))
        .filter((entry) => entry.isDirectory?.() && /^GoogleDrive-/u.test(entry.name));
    } catch (error) {
      if (!['ENOENT', 'ETIMEDOUT'].includes(error?.code)) throw error;
    }
    if (!accounts.length) return {
      state: 'needs_connection', reason: 'drive_desktop_login_required',
      userSafeSummary: 'Google Drive 앱에서 사용할 계정으로 로그인해 주세요.',
      capabilities: {},
      routes: [{ kind: 'local_sync', label: 'Finder의 Google Drive', state: 'needs_connection', canStart: true }],
      actions: [{
        id: 'open_drive_desktop', label: 'Google Drive 로그인', kind: 'user_action',
        endpoint: '/connections/google-workspace/action',
      }],
    };
    const readyPaths = [];
    let initializing = false;
    for (const account of accounts) {
      const accountPath = join(cloudRoot, account.name);
      try {
        const entries = await readDirectory(accountPath, readTimeoutMs);
        const drive = entries.find((entry) => entry.isDirectory?.() && isMyDrive(entry.name));
        if (!drive) { initializing = true; continue; }
        const path = join(accountPath, drive.name);
        if ((await fileStat(path)).isDirectory()) {
          await readDirectory(path, readTimeoutMs);
          readyPaths.push(path);
        }
      } catch (error) {
        if (['ENOENT', 'ETIMEDOUT'].includes(error?.code)) initializing = true;
        else throw error;
      }
    }
    if (!readyPaths.length) return {
      state: 'needs_attention', reason: initializing ? 'drive_desktop_initializing' : 'drive_desktop_not_ready',
      userSafeSummary: initializing
        ? 'Google Drive가 Finder에 파일을 준비하고 있어요. 잠시 뒤 다시 확인해 주세요.'
        : 'Google Drive 앱을 열어 연결 상태를 확인해 주세요.',
      capabilities: {},
      routes: [{ kind: 'local_sync', label: 'Finder의 Google Drive', state: 'needs_attention', canStart: true }],
      actions: [{
        id: 'open_drive_desktop', label: 'Google Drive 열기', kind: 'user_action',
        endpoint: '/connections/google-workspace/action',
      }],
    };
    return {
      state: 'ready', reason: 'local_sync_available',
      userSafeSummary: 'Finder에 연결된 Google Drive의 일반 파일을 찾고 읽고 저장할 수 있어요.',
      capabilities: { search: true, read: true, create: true, update: true, download: true, upload: true },
      routes: [{
        kind: 'local_sync', label: 'Finder의 Google Drive', state: 'ready', canStart: false,
        roots: readyPaths,
      }],
      actions: [],
    };
  }

  return {
    inspect,
    async perform(actionId) {
      if (actionId === 'install_drive_desktop') {
        await openExternal(INSTALL_URL);
        return {
          performed: true, actionId,
          userSafeSummary: 'Google 공식 설치 안내를 열었어요. 설치가 끝나면 다시 확인해 주세요.',
        };
      }
      if (actionId === 'open_drive_desktop') {
        await openApplication();
        return {
          performed: true, actionId,
          userSafeSummary: 'Google Drive 앱을 열었어요. 로그인이나 초기화를 마친 뒤 다시 확인해 주세요.',
        };
      }
      throw Object.assign(new Error('지원하지 않는 Google Drive 연결 행동이에요.'), {
        status: 400, reason: 'unknown_drive_desktop_action',
      });
    },
  };
}
