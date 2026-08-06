// 한 자리가 실제로 차지한 바이트.
//
// 왜 따로 있는가: `gate.mjs` 는 불러오는 순간 게이트 전체가 도는 스크립트다. 검사가 이 함수
// 하나 쓰려고 게이트를 통째로 돌릴 수는 없다. **재는 도구는 재는 자리와 분리한다.**
import { statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **읽다 실패하면 0 으로 세지 않고 건너뛴다** — 못 읽은 것을 "없다"로 세면 정리량이 실제보다
 * 작게 보이고, 그러면 임시 폴더를 흘리는 검사가 영영 안 보인다.
 * 심볼릭 링크는 따라가지 않는다 — 남의 자리 크기를 우리 것으로 세지 않으려고.
 *
 * @param {string} 자리
 * @returns {number} 바이트. 없는 자리는 0.
 */
export function 방크기(자리) {
  let 합 = 0;
  let 남은 = [자리];
  while (남은.length) {
    const 지금 = 남은.pop();
    let st;
    try { st = statSync(지금, { throwIfNoEntry: false }); } catch { continue; }
    if (!st) continue;
    if (st.isSymbolicLink?.()) continue;
    if (st.isDirectory()) {
      try { 남은 = 남은.concat(readdirSync(지금).map((n) => join(지금, n))); } catch { /* 못 읽으면 그만 */ }
    } else {
      합 += st.size;
    }
  }
  return 합;
}
