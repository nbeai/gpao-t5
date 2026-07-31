// 제품 서버의 노출 경계 — **고르지 않은 노출은 없다.**
//
// 그동안 서버는 주소 없이 붙었다(`listen(port)`). 그건 같은 망의 다른 기기가 이 사람의 기억·
// 대화·연결을 그대로 볼 수 있다는 뜻이다. 아무도 그걸 고른 적이 없다 — 기본값이 그랬을 뿐이다.
//
// 이 파일이 재는 것은 **그 하나**다. 원격 접속을 만드는 것이 아니라, 고르지 않은 노출을
// 없애는 것. 그래서 비루프백 주소는 지금 열리지 않고, 사람 말로 왜인지 말하며 멈춘다.
// 인증 없이 여는 길을 남겨 두면 그게 곧 기본값이 되고, 없앤 것이 되돌아온다.
//
// 그리고 **지금 쓰는 사람에게는 아무 것도 달라지지 않아야 한다** — 이것도 여기서 잰다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLiveServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

// 자격 저장소가 비어 있으므로 바깥으로 나가지 않는다 — 검사는 네트워크에 매달리지 않는다.
async function 띄우기(env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-bind-'));
  return startLiveServer({
    port: 0, processEnv: env, sessionStore: new SessionStore(dir),
    startScheduler: false, startReceivers: false, restoreConnections: false,
  });
}

test('기본 기동은 127.0.0.1 에만 붙는다', async () => {
  const server = await 띄우기();
  try {
    // 주소를 안 주면 `::`(모든 인터페이스)가 된다 — 이 단언은 그때 그대로 깨진다.
    assert.equal(server.address().address, '127.0.0.1', '주소를 명시해 루프백에만 붙는다');
  } finally { await new Promise((r) => server.close(r)); }
});

test('비루프백 기동은 거부된다 — 사람 말로, 무엇이 안 되는지', async () => {
  let 떴다 = null;
  try {
    떴다 = await 띄우기({ GPAO_T5_BIND: '0.0.0.0' });
  } catch (e) {
    assert.match(e.message, /원격 접속/, '무엇이 막혔는지 사람 말로 말한다');
    assert.match(e.message, /127\.0\.0\.1/, '그럼 지금 어떻게 쓰는지도 말한다');
    return;
  }
  // **뜬 것은 반드시 닫는다.** 안 닫으면 이 검사는 실패가 아니라 영원히 매달리고,
  // 그러면 무엇이 잘못됐는지 아무도 못 본다. 매달리는 검사는 없는 검사보다 나쁘다.
  await new Promise((r) => 떴다.close(r));
  assert.fail('고르지 않은 LAN 노출이 조용히 열렸다');
});

test('기존 로컬 흐름은 그대로다 — 토큰도 질문도 없다', async () => {
  const server = await 띄우기();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const h = await fetch(`${base}/health`);
    assert.equal(h.status, 200, '/health 는 설치 검증이 물어보는 자리 — 그대로 열려 있다');
    assert.equal((await h.json()).ok, true);

    assert.equal((await fetch(`${base}/sessions`)).status, 200, '목록 API 그대로');
    const 화면 = await fetch(`${base}/`);
    assert.equal(화면.status, 200, '화면 그대로');
    assert.match(화면.headers.get('content-type') ?? '', /text\/html/);
  } finally { await new Promise((r) => server.close(r)); }
});
