// 조각 A 반대시험 재측정용 **자기 크롬**. 오너 크롬에 안 붙는다(S5 선례):
//   · 내 프로필(mkdtemp)  · `--remote-debugging-port=0` 후 **크롬이 적어 준 포트**를 읽는다
//   · 지우는 것은 내가 만든 경로 하나뿐(공유 자리 와일드카드 금지)
// 의존성 0 — Node 24 전역 WebSocket 으로 CDP 를 직접 말한다(src/runtime/browser.js 와 같은 방식).
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function 크롬띄우기({ url, width = 1280, height = 860, headless = true } = {}) {
  const 프로필 = await mkdtemp(join(tmpdir(), 'a-remeasure-chrome-'));
  const args = [
    ...(headless ? ['--headless=new'] : []),
    `--user-data-dir=${프로필}`,
    '--remote-debugging-port=0',
    `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    url,
  ];
  const proc = spawn(CHROME, args, { stdio: 'ignore' });

  let 포트 = null;
  for (let i = 0; i < 100 && 포트 == null; i += 1) {
    await sleep(100);
    try { 포트 = Number((await readFile(join(프로필, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch {}
  }
  if (!포트) { proc.kill(); await rm(프로필, { recursive: true, force: true }); throw new Error('크롬이 포트를 안 적었다'); }

  // 대상 찾기 — 우리가 연 그 페이지
  let 대상 = null;
  for (let i = 0; i < 60 && !대상; i += 1) {
    await sleep(100);
    try {
      const list = await (await fetch(`http://127.0.0.1:${포트}/json/list`)).json();
      대상 = list.find((t) => t.type === 'page' && t.url.startsWith(url.slice(0, 25)));
    } catch {}
  }
  if (!대상) { proc.kill(); await rm(프로필, { recursive: true, force: true }); throw new Error('대상 페이지를 못 찾았다'); }

  const ws = new WebSocket(대상.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const 대기 = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const p = 대기.get(m.id);
    if (p) { 대기.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const 번호 = ++id; 대기.set(번호, { resolve, reject });
    ws.send(JSON.stringify({ id: 번호, method, params }));
  });

  /** 페이지에서 식을 돌린다. Promise 면 기다린다. 값은 그대로 돌려받는다. */
  const 돌리기 = async (expression, timeoutMs = 60000) => {
    const r = await Promise.race([
      send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
      sleep(timeoutMs).then(() => { throw new Error(`페이지 식이 ${timeoutMs}ms 안에 안 끝났다`); }),
    ]);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? '페이지에서 예외');
    return r.result?.value;
  };

  /**
   * 페이지가 **다 서기 전에** 재면 안 된다. 첫 회차에서 밟았다: 계측식을 일찍 넣었더니
   * 그 뒤 진짜 항해가 커밋되며 "Execution context was destroyed" 로 회차가 통째로 죽었다.
   * 그리고 그 전에 잰 값(`actbar: false`)은 **제품이 아니라 타이밍**이 낸 거짓 음성이었다.
   */
  const 준비대기 = async (조건 = 'true', 회 = 60) => {
    for (let i = 0; i < 회; i += 1) {
      try {
        const ok = await 돌리기(`(() => document.readyState === 'complete' && (${조건}))()`, 5000);
        if (ok) return true;
      } catch { /* 항해 중이면 문맥이 죽는다 — 다시 묻는다 */ }
      await sleep(250);
    }
    throw new Error('페이지가 안 선다');
  };

  const 닫기 = async () => {
    const 소켓종료 = new Promise((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) resolve();
      else {
        ws.addEventListener('close', resolve, { once: true });
        ws.addEventListener('error', resolve, { once: true });
      }
    });
    // CDP 대상부터 닫아야 클라이언트 WebSocket의 close handshake가 끝난다. 소켓을 먼저
    // 닫고 곧바로 Chrome을 죽이면 Node의 WebSocket 종료 타이머가 대본을 붙잡는다.
    try { await fetch(`http://127.0.0.1:${포트}/json/close/${encodeURIComponent(대상.id)}`); } catch {}
    await Promise.race([소켓종료, sleep(1000)]);
    try { ws.close(); } catch {}
    await Promise.race([소켓종료, sleep(1000)]);
    const 끝남 = () => new Promise((resolve) => {
      if (proc.exitCode != null || proc.signalCode != null) resolve();
      else proc.once('exit', resolve);
    });
    const 종료 = 끝남();
    proc.kill();
    await Promise.race([종료, sleep(2000)]);
    if (proc.exitCode == null && proc.signalCode == null) {
      proc.kill('SIGKILL');
      await Promise.race([끝남(), sleep(1000)]);
    }
    await Promise.race([소켓종료, sleep(1000)]);
    await rm(프로필, { recursive: true, force: true });  // **내가 만든 경로만** 지운다
  };

  return { 포트, 돌리기, send, 준비대기, 닫기, 프로필 };
}
