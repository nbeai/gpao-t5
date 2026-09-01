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

export function makeNaverIdentityBroker({ profileHandle = 'default', mailConnection = null,
  now = () => new Date() } = {}) {
  let handle = profileHandle == null ? null : safeHandle(profileHandle);
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
    id: 'naver', label: '네이버', category: 'workspace',
    async inspect() {
      const mail = await mailConnection?.inspect?.().catch(() => null);
      if (mail?.state === 'ready' && state.services.mailProtocol !== 'ready') {
        update({ services: { mailProtocol: 'ready' }, lastObservedAt: now().toISOString() });
      } else if (mail?.state === 'needs_connection' && state.services.mailProtocol === 'ready') {
        update({ services: { mailProtocol: 'needs_reauth' }, lastObservedAt: now().toISOString() });
      }
      const snapshot = publicSnapshot(state); const ready = snapshot.state === 'authenticated';
      const mailProtocolReady = snapshot.services.mailProtocol === 'ready';
      const mailWebReady = snapshot.services.mailWeb === 'ready';
      const blogWebReady = snapshot.services.blogWeb === 'ready';
      const browserReady = mailWebReady && blogWebReady;
      const summary = mailProtocolReady && browserReady
        ? '네이버 메일 공식 연결과 같은 T5 네이버 로그인으로 메일·블로그를 사용할 준비가 되어 있어요.'
        : mailProtocolReady ? '네이버 메일 공식 연결을 사용할 준비가 되어 있어요. 블로그 로그인은 아직 확인하지 않았어요.'
          : browserReady ? '같은 T5 네이버 로그인으로 메일 웹과 블로그를 사용할 준비가 되어 있어요. 메일 공식 연결은 아직 필요해요.'
            : snapshot.state === 'expired' ? '네이버 로그인이 만료되어 다시 로그인이 필요해요.'
              : snapshot.state === 'user_control' ? 'T5 브라우저에서 네이버 로그인을 진행하고 있어요.'
                : 'T5 브라우저 로그인과 네이버 메일 공식 연결 상태를 확인해 주세요.';
      return { state: ready ? 'ready' : snapshot.state === 'user_control' ? 'needs_attention' : 'needs_connection',
        reason: ready ? 'same_managed_naver_identity_ready'
          : snapshot.state === 'expired' ? 'naver_login_expired'
            : snapshot.state === 'user_control' ? 'naver_user_login_in_progress' : 'naver_login_observation_required',
        userSafeSummary: summary,
        capabilities: { mail_web: snapshot.services.mailWeb === 'ready',
          blog_web: snapshot.services.blogWeb === 'ready',
          mail_protocol: snapshot.services.mailProtocol === 'ready' },
        ...(mail?.identity ? { identity: mail.identity } : {}),
        ...(mail?.credentialRequest ? { credentialRequest: mail.credentialRequest } : {}),
        routes: [...(mail?.routes ?? []), { kind: 'browser', label: 'T5 네이버 브라우저',
          state: browserReady ? 'ready' : 'needs_connection', canStart: !browserReady,
        startUrl: 'https://mail.naver.com/' }],
        actions: mail?.actions ?? [], naverIdentity: snapshot };
    },
    async connectCredentials(input) {
      if (!mailConnection?.connectCredentials) throw new Error('Naver Mail protocol connection is unavailable');
      const connected = await mailConnection.connectCredentials(input);
      update({ services: { mailProtocol: 'ready' }, lastObservedAt: now().toISOString() });
      return connected;
    },
    async makeTool(context) { return mailConnection?.makeTool?.(context) ?? null; },
    async disconnect() {
      if (!mailConnection?.disconnect) throw new Error('Naver Mail protocol connection is unavailable');
      const disconnected = await mailConnection.disconnect();
      update({ services: { mailProtocol: 'setup_required' }, lastObservedAt: now().toISOString() });
      return disconnected;
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
      if (requestedHost === 'blog.naver.com' || requestedHost === 'm.blog.naver.com'
        || host === 'blog.naver.com' || host === 'm.blog.naver.com') {
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
