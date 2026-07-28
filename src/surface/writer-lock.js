// L4 · 단일 writer 잠금 (설치 전 필수, 감사 2026-07-29) — **같은 데이터 디렉터리에는 서버 하나.**
//
// 고유 임시명은 임시 파일 충돌만 막는다 — 두 서버가 같은 memory.json 을 쓰면 마지막 쓰기만
// 남는다(사용자의 확인·철회가 조용히 사라진다). 그래서 라이브 부팅에서 잠금을 잡고,
// 살아 있는 다른 서버가 잡고 있으면 **정직하게 멈춘다**(반쪽으로 돌지 않는다).
//
// 소유자는 pid 가 아니라 **pid + ownerToken** 이다(감사 재현 2026-07-29: pid 만 보면 같은
// 프로세스의 두 번째 서버가 첫 잠금을 "내 죽은 잔여"로 오인해 걷고, 첫 서버의 release 가
// 두 번째 서버의 잠금까지 지웠다). 죽은 프로세스의 잠금은 pid 생존 확인으로 걷는다.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const LOCK_NAME = '.writer-lock.json';

/**
 * @param {string} dir 데이터 디렉터리
 * @returns {Promise<{release:()=>Promise<void>}>} 잠금 해제 함수(정상 종료·close·부팅 실패에서 부른다)
 * @throws 살아 있는 다른 writer 가 있으면 사람 말 메시지로 던진다.
 */
export async function acquireWriterLock(dir, { pid = process.pid, retries = 1 } = {}) {
  const file = join(dir, LOCK_NAME);
  const ownerToken = randomUUID(); // 이 획득의 신분 — 같은 pid 안의 두 잠금도 서로 남이다
  await mkdir(dir, { recursive: true });
  // **읽고-쓰기가 아니라 원자적 생성(wx)으로 잡는다.** 읽어 보고 쓰면 그 틈에 둘 다 통과한다 —
  // 실측(감사 재현): 동시 획득 2/2 성공. wx 는 파일이 없을 때만 성공하므로 정확히 하나만 이긴다.
  try {
    await writeFile(file, JSON.stringify({ pid, ownerToken, at: Date.now() }), { encoding: 'utf8', flag: 'wx' });
  } catch (e) {
    if (e?.code !== 'EEXIST') throw e;
    let prev = null;
    try { prev = JSON.parse(await readFile(file, 'utf8')); } catch { prev = null; }
    // **pid 가 나와 같아도 남의 잠금이다** — 살아 있으면 막는다(같은 프로세스의 두 번째 서버 포함).
    let alive = false;
    if (prev?.pid) { try { process.kill(prev.pid, 0); alive = true; } catch { alive = false; } }
    if (alive) {
      throw new Error(`이미 다른 T5 서버(pid ${prev.pid})가 이 데이터 자리를 쓰고 있어요. `
        + '같은 자료를 두 서버가 쓰면 나중 저장이 앞의 것을 지워요 — 그 서버를 끄고 다시 시작해 주세요.');
    }
    // 죽은/손상 잠금 — 걷고 한 번만 다시. 동시에 걷는 둘이 있어도 wx 는 하나만 이긴다.
    if (retries <= 0) throw new Error('데이터 자리 잠금을 잡지 못했어요. 잠시 후 다시 시작해 주세요.');
    await rm(file, { force: true });
    return acquireWriterLock(dir, { pid, retries: retries - 1 });
  }
  return {
    async release() {
      // **내 신분(pid+token)이 맞을 때만 지운다** — 늦은 해제가 새 소유자의 잠금을 지우지 않게.
      try {
        const cur = JSON.parse(await readFile(file, 'utf8'));
        if (cur?.pid === pid && cur?.ownerToken === ownerToken) await rm(file, { force: true });
      } catch { /* 이미 없음 */ }
    },
  };
}
