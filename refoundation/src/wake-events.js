function installWakeEvents() {
  const pageRuntimeInstanceId = document.querySelector('meta[name="t5-runtime-instance"]')?.content ?? null;
  let stream = null;
  let connectionNoticeTimer = null;
  let reconnectTimer = null;
  let runtimeChangeSent = false;
  let stopped = false;

  const parse = (event) => {
    try { return JSON.parse(event.data); } catch { return null; }
  };

  const handleRuntimeReady = (payload) => {
    clearTimeout(connectionNoticeTimer);
    dispatchEvent(new CustomEvent('t5:runtime-connection', { detail: { connected: true } }));
    if (runtimeChangeSent || !pageRuntimeInstanceId || !payload?.runtimeInstanceId
      || payload.runtimeInstanceId === pageRuntimeInstanceId) return;
    runtimeChangeSent = true;
    dispatchEvent(new CustomEvent('t5:runtime-changed', { detail: payload }));
  };

  const scheduleReconnectProbe = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      try {
        const response = await fetch('/health', { cache: 'no-store' });
        if (!response.ok) throw new Error('not ready');
        const health = await response.json();
        handleRuntimeReady(health);
        if (!stopped) connect();
      } catch {
        scheduleReconnectProbe();
      }
    }, 900);
  };

  const attachPayloadEvent = (source, type, validate, clientType) => {
    source.addEventListener(type, (event) => {
      const payload = parse(event);
      if (!validate(payload)) return;
      dispatchEvent(new CustomEvent(clientType, { detail: payload }));
    });
  };

  function connect() {
    if (stopped) return;
    stream?.close();
    stream = new EventSource('/events/stream');
    stream.addEventListener('runtime_ready', (event) => handleRuntimeReady(parse(event)));
    stream.addEventListener('open', () => clearTimeout(connectionNoticeTimer));
    stream.addEventListener('error', () => {
      stream?.close();
      clearTimeout(connectionNoticeTimer);
      connectionNoticeTimer = setTimeout(() => {
        dispatchEvent(new CustomEvent('t5:runtime-connection', { detail: { connected: false } }));
      }, 1800);
      scheduleReconnectProbe();
    });
    stream.addEventListener('managed_process_wake', (event) => {
      const payload = parse(event);
      if (!payload?.reply) return;
      let tray = document.getElementById('t5-wake-tray');
      if (!tray) {
        tray = document.createElement('div');
        tray.id = 't5-wake-tray';
        tray.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:10000;display:grid;gap:8px;max-width:360px';
        document.body.append(tray);
      }
      const notice = document.createElement('button');
      notice.type = 'button';
      notice.style.cssText = 'text-align:left;border:1px solid rgba(127,127,127,.3);border-radius:14px;padding:12px 14px;background:var(--panel,#fff);color:inherit;box-shadow:0 8px 30px rgba(0,0,0,.16);cursor:pointer;white-space:pre-wrap';
      notice.textContent = payload.reply;
      notice.title = '완료된 대화 보기';
      notice.addEventListener('click', () => location.reload());
      tray.append(notice);
    });
    attachPayloadEvent(stream, 'messenger_progress',
      (payload) => !!payload?.sessionId && !!payload?.text, 't5:messenger-progress');
    attachPayloadEvent(stream, 'session_activity',
      (payload) => !!payload?.sessionId && !!payload?.runId, 't5:session-activity');
    attachPayloadEvent(stream, 'work_reality',
      (payload) => !!payload?.sessionId && Number.isSafeInteger(payload?.version), 't5:work-reality');
  }

  connect();
  addEventListener('beforeunload', () => {
    stopped = true;
    clearTimeout(connectionNoticeTimer);
    clearTimeout(reconnectTimer);
    stream?.close();
  }, { once: true });
}

if (typeof document !== 'undefined') installWakeEvents();
