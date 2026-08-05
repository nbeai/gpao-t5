// L3 · **화면 슬롯의 첫 드라이버 — 네이티브 백엔드** (CU A)
//
// **코어 밖이다.** 이 파일이 없어도 T5 는 그대로 돌고, `desktop` 슬롯은 빈 채로 정직하게
// *"볼 수 없다"* 를 말한다. 그게 §4 발자국 사다리에서 이 능력이 **6칸(코어 도구)을 안 쓴다**는
// 뜻이고, S8 이 노린 자리다 — 검색기 넷이 그랬듯 화면 백엔드도 등록으로 붙는다.
//
// ── 왜 실행본을 부르나 ───────────────────────────────────────────────────
// 백엔드는 Swift 라이브러리다. 정본 §3.1 은 *"CLI 를 shell 로 부르지 말고 라이브러리로
// 링크한다"* 고 했고 그 이유는 agent·provider·MCP·clipboard 가 빌드 그래프에서 빠지게
// 하려는 것이다. **여기서 부르는 것은 그 CLI 가 아니라 우리가 링크해서 만든 실행본**이고,
// 인자를 안 받는다(고정 호출). 그 경계는 그대로 지켜진다.
//
// 나중에 앱 안의 브리지로 옮겨도 **이 파일만 바뀐다** — 슬롯 계약이 경계라서 그렇다.
import { execFile } from 'node:child_process';

const 기본시간 = 10_000;

/**
 * @param {{binPath:string, timeoutMs?:number, execFileImpl?:Function}} deps
 *   `binPath` 는 배선하는 쪽이 준다. **여기에 기본 경로를 박지 않는다** —
 *   박으면 없는 컴퓨터에서 "있는데 실패"로 보이고, 그건 없는 능력을 있다고 말하는 것이다.
 */
export function makeDesktopNativeDriver(deps = {}) {
  const 실행 = deps.execFileImpl ?? execFile;
  const 시간 = deps.timeoutMs ?? 기본시간;
  const 부르기 = (인자 = []) => new Promise((resolve, reject) => {
    실행(deps.binPath, 인자, { timeout: 시간, maxBuffer: 8 << 20 }, (err, stdout) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(String(stdout))); } catch (e) { reject(e); }
    });
  });

  // 한 번 부르면 상태와 관찰이 함께 온다 — 두 번 부르면 **그 사이에 화면이 바뀐다.**
  // 권한은 있다고 했는데 목록은 다른 순간의 것이 되는 자리라, 같은 호출의 것을 나눠 쓴다.
  // 요소까지 볼지는 **부르는 쪽이 정한다.** 늘 읽으면 창 목록만 필요한 턴에도 AX 트리를
  // 통째로 훑는다(실측 384개) — 비용이 목적을 안 돕는 자리다.
  let 최근 = null;
  const 한번 = async (요소까지 = false) => { 최근 = await 부르기(요소까지 ? ['elements'] : []); return 최근; };

  return {
    id: 'peekaboo',
    label: '화면 관찰(네이티브)',
    needs: [],
    async status() {
      const v = await 한번();
      // **판정하지 않는다.** 백엔드가 낸 것을 그대로 옮긴다 — 가르는 것은 손의 일이다.
      return {
        platform: v.platform, osVersion: v.osVersion, backend: v.backend,
        permissions: v.permissions ?? {}, capabilities: v.capabilities ?? [],
        ...(v.frontmost ? { frontmost: v.frontmost } : {}),
      };
    },
    async observe(args = {}) {
      const 요소까지 = args?.scope === 'window';
      // 앞서 상태를 볼 때 요소를 안 읽었으면 다시 읽는다 — 묵은 값으로 요소를 지어내지 않는다.
      const v = (최근 && !(요소까지 && !최근.elements)) ? 최근 : await 한번(요소까지);
      최근 = null; // 다음 관찰은 다시 실물을 본다(묵은 값을 현재로 주장하지 않는다)
      return {
        ...(v.frontmost ? { frontmost: v.frontmost } : {}),
        windows: v.windows ?? [],
        ...(v.elements ? { elements: v.elements } : {}),
        ...(v.windowsError ? { windowsError: v.windowsError } : {}),
        ...(v.elementsError ? { elementsError: v.elementsError } : {}),
      };
    },
  };
}
