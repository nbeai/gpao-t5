const COPY = Object.freeze({
  automation_completed: Object.freeze({ title: 'T5 작업이 끝났어요', body: 'T5를 열어 결과를 확인해 주세요.' }),
  automation_needs_attention: Object.freeze({ title: 'T5 확인이 필요해요', body: 'T5를 열어 현재 상태를 확인해 주세요.' }),
});

export function projectLocalNotification(kind) {
  const projected = COPY[kind];
  if (!projected) throw new TypeError('local notification kind is invalid');
  return { kind, title: projected.title, body: projected.body,
    sensitivePayloadFields: 0, opensExactWork: true };
}

export function makeLocalNotificationService({ deliver = null } = {}) {
  return { async notify(kind) {
    const notification = projectLocalNotification(kind);
    if (typeof deliver !== 'function') return { delivered: false, reason: 'platform_adapter_unavailable', notification };
    await deliver(notification); return { delivered: true, notification };
  } };
}

export function makeMacOSNotificationAdapter({ spawnProcess } = {}) {
  if (typeof spawnProcess !== 'function') throw new TypeError('macOS notification spawn adapter is required');
  return async (notification) => new Promise((resolve, reject) => {
    const copy = projectLocalNotification(notification?.kind);
    const script = `display notification "${copy.body}" with title "${copy.title}"`;
    const child = spawnProcess('/usr/bin/osascript', ['-e', script], { stdio: 'ignore', windowsHide: true });
    child.once('error', reject); child.once('close', (code) => code === 0 ? resolve() : reject(
      Object.assign(new Error('local notification delivery failed'), { code: 'T5_NOTIFICATION_FAILED' })));
  });
}
