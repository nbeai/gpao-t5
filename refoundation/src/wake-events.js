function installWakeEvents() {
  const stream = new EventSource('/events/stream');
  stream.addEventListener('managed_process_wake', (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
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
  addEventListener('beforeunload', () => stream.close(), { once: true });
}

if (typeof document !== 'undefined') installWakeEvents();
