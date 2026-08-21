import { spawn } from 'node:child_process';

const CHROME_REMOTE_DEBUGGING = 'chrome://inspect/#remote-debugging';

function defaultOpenPage(url) {
  const program = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'darwin' ? ['-a', 'Google Chrome', url]
    : process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(program, args, { stdio: 'ignore', detached: true, windowsHide: true });
  child.unref();
  return { opened: true };
}

export function makeUserBrowserConnection({ runtime, openPage = defaultOpenPage } = {}) {
  if (!runtime?.connect || !runtime?.status || !runtime?.close) {
    throw new TypeError('user browser runtime is required');
  }
  let preparing = null;
  let lastFailure = null;

  return {
    id: 'user-browser', label: '내 브라우저', category: 'browser',
    async inspect() {
      const status = runtime.status();
      const connected = status.connected === true;
      return {
        state: connected ? 'connected' : preparing ? 'connecting' : 'needs_connection',
        reason: connected ? 'verified_user_browser_session'
          : preparing ? 'user_browser_permission_in_progress'
            : lastFailure ?? 'user_browser_not_connected',
        userSafeSummary: connected
          ? '평소 쓰는 Chrome에 연결되어 로그인된 웹사이트를 함께 볼 수 있어요.'
          : preparing ? 'Chrome에서 연결 허용을 기다리고 있어요.'
            : '평소 쓰는 Chrome을 연결하면 로그인된 웹사이트를 함께 볼 수 있어요.',
        capabilities: { login: connected, read: connected, act: connected },
        routes: [{
          kind: 'existing_user_browser', label: '내 Chrome',
          state: connected ? 'connected' : preparing ? 'connecting' : 'needs_connection',
          canStart: !connected && !preparing,
        }],
        actions: connected ? [{
          id: 'disconnect', kind: 'disconnect', label: 'Chrome 연결 해제',
          endpoint: '/connections/user-browser/disconnect',
        }] : preparing ? [] : [{
          id: 'connect-user-chrome', kind: 'user_action', label: '내 Chrome 연결',
          endpoint: '/connections/user-browser/action',
        }],
      };
    },
    async performAction(actionId) {
      if (actionId !== 'connect-user-chrome') throw new Error('unknown user browser action');
      if (runtime.status().connected) return { performed: false, userSafeSummary: '이미 내 Chrome에 연결되어 있어요.' };
      openPage(CHROME_REMOTE_DEBUGGING);
      if (!preparing) {
        preparing = new Promise((resolve) => setTimeout(resolve, 800))
          .then(() => runtime.connect())
          .then(() => { lastFailure = null; })
          .catch(() => { lastFailure = 'user_browser_connection_failed'; })
          .finally(() => { preparing = null; });
      }
      return {
        performed: true,
        userSafeSummary: 'Chrome 연결 화면을 열었어요. 원격 디버깅을 켜고 표시되는 연결 요청을 허용해 주세요. 비밀번호나 로그인 정보는 T5에 전달되지 않아요.',
      };
    },
    async disconnect() {
      await runtime.close(); preparing = null;
      return { disconnected: true, userSafeSummary: '내 Chrome 연결을 해제했어요. Chrome의 로그인은 그대로예요.' };
    },
    async close() { await runtime.close(); },
  };
}
