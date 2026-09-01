const WEB_STATES = new Set(['unknown', 'ready', 'login_required']);
const PROTOCOL_STATES = new Set(['unknown', 'setup_required', 'ready', 'needs_reauth']);

function safeHandle(value) {
  const handle = String(value ?? '').trim();
  if (!handle || handle.length > 120 || /[\\/]|[\u0000-\u001f\u007f]/u.test(handle)) {
    throw new TypeError('managed Naver profile handle is invalid');
  }
  return handle;
}
function urlOf(value) {
  try {
    const url = new URL(String(value ?? ''));
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch { return null; }
}
function isBlogHost(host) { return host === 'blog.naver.com' || host.endsWith('.blog.naver.com'); }
function publicSnapshot(state) {
  return Object.freeze({ schema: 't5.naver-identity.v1', profileHandle: state.profileHandle,
    state: state.state, services: Object.freeze({ ...state.services }),
    profileGeneration: state.profileGeneration, lastObservedAt: state.lastObservedAt,
    browserProcess: state.browserProcess, currentHandoff: state.currentHandoff });
}
function overall(state, previouslyAuthenticated = false) {
  const web = [state.services.mailWeb, state.services.blogWeb];
  if (state.currentHandoff === 'active') return 'user_control';
  if (state.services.mailProtocol === 'ready' || web.every((item) => item === 'ready')) return 'authenticated';
  if (web.some((item) => item === 'login_required')) return previouslyAuthenticated ? 'expired' : 'login_required';
  return 'unknown';
}

export function makeNaverIdentityBroker({ profileHandle = 'default', now = () => new Date() } = {}) {
  let handle = profileHandle == null ? null : safeHandle(profileHandle);
  let browserLogin = null;
  let state = { profileHandle: handle, state: 'unknown', services: {
    mailWeb: 'unknown', blogWeb: 'unknown', mailProtocol: 'unknown',
  }, profileGeneration: 1, lastObservedAt: null, browserProcess: 'absent', currentHandoff: null };
  function update(patch) {
    const authenticated = state.state === 'authenticated';
    const next = { ...state, ...patch, services: { ...state.services, ...(patch.services ?? {}) } };
    if (!WEB_STATES.has(next.services.mailWeb) || !WEB_STATES.has(next.services.blogWeb)
      || !PROTOCOL_STATES.has(next.services.mailProtocol)) throw new TypeError('Naver service state is invalid');
    next.state = overall(next, authenticated); state = next; return publicSnapshot(state);
  }
  const connection = {
    id: 'naver', label: '네이버', category: 'workspace', recheckWhileWaiting: true,
    async inspect() {
      const snapshot = publicSnapshot(state); const ready = snapshot.state === 'authenticated';
      const mailWebReady = snapshot.services.mailWeb === 'ready';
      const blogWebReady = snapshot.services.blogWeb === 'ready';
      const browserReady = mailWebReady && blogWebReady;
      const summary = browserReady
        ? '네이버 로그인으로 메일을 찾고 읽고 답장을 준비하며, 블로그 글을 작성·저장·예약·발행할 수 있어요.'
        : snapshot.state === 'expired' ? '네이버 로그인이 만료됐어요. 다시 로그인하면 메일과 블로그를 이어서 사용할 수 있어요.'
          : snapshot.state === 'user_control' ? '열린 T5 브라우저에서 네이버 로그인을 마친 뒤 연결 화면에서 완료를 확인해 주세요.'
            : '네이버에 한 번 로그인하면 메일을 찾고 읽고 답장을 준비하며, 블로그 글을 작성·저장·예약·발행할 수 있어요.';
      return { state: ready ? 'ready' : snapshot.state === 'user_control' ? 'needs_attention' : 'needs_connection',
        reason: ready ? 'same_managed_naver_identity_ready'
          : snapshot.state === 'expired' ? 'naver_login_expired'
            : snapshot.state === 'user_control' ? 'naver_user_login_in_progress' : 'naver_login_observation_required',
        userSafeSummary: summary,
        capabilities: { mail_web: snapshot.services.mailWeb === 'ready',
          blog_web: snapshot.services.blogWeb === 'ready',
          mail_protocol: snapshot.services.mailProtocol === 'ready' },
        routes: [{ kind: 'browser', label: 'T5 네이버 브라우저',
          state: browserReady ? 'ready' : 'needs_connection', canStart: !browserReady,
        startUrl: 'https://nid.naver.com/nidlogin.login' }],
        actions: browserReady ? [] : [{ id: snapshot.currentHandoff === 'active' ? 'check-login' : 'login',
          label: snapshot.currentHandoff === 'active' ? '로그인 완료 확인' : '네이버 로그인',
          kind: 'user_action', endpoint: '/connections/naver/action' }], naverIdentity: snapshot };
    },
    async performAction(actionId, context = {}) {
      if (actionId === 'login') {
        if (!context.browserLogin?.begin || !context.browserLogin?.check || !context.browserLogin?.probe) {
          throw new Error('Naver login Browser is unavailable');
        }
        browserLogin = context.browserLogin;
        const probe = await browserLogin.probe(['https://mail.naver.com/', 'https://blog.naver.com/']);
        for (const observation of probe.observations ?? []) connection.observeBrowserResult(observation);
        const observed = publicSnapshot(state);
        if (observed.services.mailWeb === 'ready' && observed.services.blogWeb === 'ready') {
          browserLogin = null;
          return { performed: true, connectionReady: true, refreshConnections: true,
            userSafeSummary: '기존 네이버 로그인으로 메일과 블로그 연결을 확인했어요.' };
        }
        const started = await browserLogin.begin('https://nid.naver.com/nidlogin.login');
        connection.observeBrowserResult({ args: { action: 'login_start', url: 'https://nid.naver.com/nidlogin.login' }, result: started });
        return { performed: true, refreshConnections: true,
          userSafeSummary: 'T5 브라우저를 열었어요. 네이버 로그인을 직접 마친 뒤 로그인 완료 확인을 눌러 주세요.' };
      }
      if (actionId !== 'check-login' || !browserLogin) throw new Error('Naver login handoff is unavailable');
      const checked = await browserLogin.check(['https://mail.naver.com/', 'https://blog.naver.com/']);
      if (checked.state !== 'handoff_complete_candidate') return { performed: false, refreshConnections: true,
        userSafeSummary: checked.state === 'user_control_cancelled'
          ? '로그인 창이 닫혔어요. 필요하면 네이버 로그인을 다시 시작해 주세요.'
          : '아직 로그인이 끝나지 않았어요. 열린 T5 브라우저에서 마쳐 주세요.' };
      for (const observation of checked.observations ?? []) connection.observeBrowserResult(observation);
      browserLogin = null;
      const snapshot = publicSnapshot(state); const complete = snapshot.services.mailWeb === 'ready'
        && snapshot.services.blogWeb === 'ready';
      return { performed: complete, connectionReady: complete, refreshConnections: true,
        userSafeSummary: complete ? '네이버 메일과 블로그 연결을 확인했어요.'
          : '로그인은 확인했지만 메일과 블로그 중 일부를 다시 확인해야 해요.' };
    },
    observeBrowserResult({ args = {}, result = {} } = {}) {
      if (result?.profile?.id) {
        const observedHandle = safeHandle(result.profile.id);
        if (handle == null) { handle = observedHandle; state = { ...state, profileHandle: handle }; }
        else if (observedHandle !== handle) {
          throw new Error('foreign managed Browser profile cannot update Naver identity');
        }
      }
      const requested = urlOf(args.url); const observed = urlOf(result?.tab?.url
        ?? result?.after?.refScope?.url ?? result?.loginBoundary?.url);
      const requestedHost = requested?.hostname.toLowerCase() ?? '';
      const host = observed?.hostname.toLowerCase() ?? '';
      const text = String(result?.observation?.text ?? result?.after?.text ?? '');
      const services = {};
      if (args.action === 'login_start' && requestedHost.endsWith('naver.com')) {
        return update({ browserProcess: 'running', currentHandoff: 'active',
          lastObservedAt: now().toISOString() });
      }
      const loginRequired = result?.state === 'login_required' || Boolean(result?.loginBoundary)
        || host === 'nid.naver.com';
      if (requestedHost === 'mail.naver.com' || host === 'mail.naver.com') {
        services.mailWeb = loginRequired ? 'login_required'
          : result?.state === 'observed' ? 'ready' : state.services.mailWeb;
      }
      if (isBlogHost(requestedHost) || isBlogHost(host)) {
        services.blogWeb = loginRequired || (/NAVER\s*로그인/u.test(text) && !/로그아웃/u.test(text))
          ? 'login_required' : result?.state === 'observed' && /로그아웃/u.test(text) && /글쓰기/u.test(text)
            ? 'ready' : state.services.blogWeb;
      }
      return Object.keys(services).length ? update({ services, browserProcess: 'running',
        currentHandoff: null, lastObservedAt: now().toISOString() }) : publicSnapshot(state);
    },
    observeMailProtocol(next) {
      if (!PROTOCOL_STATES.has(next)) throw new TypeError('Naver mail protocol state is invalid');
      return update({ services: { mailProtocol: next }, lastObservedAt: now().toISOString() });
    },
    resetProfile() {
      state = { ...state, state: 'unknown', profileGeneration: state.profileGeneration + 1,
        lastObservedAt: now().toISOString(), browserProcess: 'absent', currentHandoff: null,
        services: { mailWeb: 'unknown', blogWeb: 'unknown', mailProtocol: state.services.mailProtocol } };
      return publicSnapshot(state);
    },
    async close() {},
  };
  return connection;
}
