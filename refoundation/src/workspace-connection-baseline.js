import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

async function directory(path) {
  try { return (await stat(path)).isDirectory(); }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

export async function googleSyncAvailable(userHome, platform) {
  const direct = [join(userHome, 'Google Drive')];
  if (platform === 'darwin') {
    const cloudStorage = join(userHome, 'Library', 'CloudStorage');
    try {
      const entries = await readdir(cloudStorage, { withFileTypes: true });
      if (entries.some((entry) => entry.isDirectory() && /^GoogleDrive-/iu.test(entry.name))) return true;
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  for (const path of direct) if (await directory(path)) return true;
  return false;
}

function browserRoute(browserAvailable, startUrl) {
  return browserAvailable
    ? [{ kind: 'browser', label: '내 브라우저', state: 'ready', canStart: true, startUrl }] : [];
}

export function workspaceConnectionBaselineInspectors({
  userHome, platform = process.platform, browserAvailable = false,
  includeGoogle = true, includeNotion = true,
} = {}) {
  if (!userHome) throw new TypeError('workspace connection baseline requires userHome');
  return [
    ...(includeGoogle ? [{
      id: 'google-workspace', label: 'Google Workspace', category: 'workspace',
      async inspect() {
        const localSync = await googleSyncAvailable(userHome, platform);
        return {
          state: localSync ? 'ready' : browserAvailable ? 'needs_connection' : 'unavailable',
          reason: localSync ? 'local_sync_available'
            : browserAvailable ? 'official_connector_not_installed' : 'no_available_route',
          userSafeSummary: localSync
            ? '컴퓨터에 동기화된 Google Drive 일반 파일을 찾고 읽을 수 있어요. 전용 연결은 아직 없어요.'
            : browserAvailable
              ? '전용 연결은 아직 없고, 필요할 때 연결한 내 브라우저에서 로그인할 수 있어요.'
              : '전용 연결과 사용할 수 있는 로그인 경로가 아직 없어요.',
          capabilities: {
            search: localSync, read: localSync, create: false,
            update: false, download: localSync, upload: false,
          },
          routes: [
            { kind: 'official', label: 'Google 전용 연결', state: 'unavailable', canStart: false },
            ...browserRoute(browserAvailable, 'https://drive.google.com/'),
            ...(localSync ? [{
              kind: 'local_sync', label: 'Google Drive 동기화 폴더', state: 'ready', canStart: false,
            }] : []),
          ],
        };
      },
    }] : []),
    ...(includeNotion ? [{
      id: 'notion', label: 'Notion', category: 'workspace',
      async inspect() {
        return {
          state: browserAvailable ? 'needs_connection' : 'unavailable',
          reason: browserAvailable ? 'remote_mcp_not_connected' : 'no_available_route',
          userSafeSummary: browserAvailable
            ? '원격 연결은 아직 없고, 필요할 때 연결한 내 브라우저에서 로그인할 수 있어요.'
            : '원격 연결과 사용할 수 있는 로그인 경로가 아직 없어요.',
          capabilities: {
            search: false, read: false, create: false,
            update: false, download: false, upload: false,
          },
          routes: [
            { kind: 'remote_mcp', label: 'Notion 원격 연결', state: 'unavailable', canStart: false },
            ...browserRoute(browserAvailable, 'https://www.notion.so/'),
          ],
        };
      },
    }] : []),
  ];
}
