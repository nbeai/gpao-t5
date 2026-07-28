// L4 · 단일 writer 잠금 (설치 전 필수, 감사 2026-07-29) — **같은 데이터 디렉터리에는 서버 하나.**
//
// 고유 임시명은 임시 파일 충돌만 막는다 — 두 서버가 같은 memory.json 을 쓰면 마지막 쓰기만
// 남는다(사용자의 확인·철회가 조용히 사라진다). 그래서 라이브 부팅에서 잠금을 잡고,
// 살아 있는 다른 서버가 잡고 있으면 **정직하게 멈춘다**(반쪽으로 돌지 않는다).
//
// 죽은 프로세스의 잠금(강제 종료 등)은 pid 생존 확인으로 걷는다 — 스스로 복구된다.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const LOCK_NAME = '.writer-lock.json';

/**
 * @param {string} dir 데이터 디렉터리
 * @returns {Promise<{release:()=>Promise<void>}>} 잠금 해제 함수(정상 종료 경로에서 부른다)
 * @throws 살아 있는 다른 writer 가 있으면 사람 말 메시지로 던진다.
 */
export async function acquireWriterLock(dir, { pid = process.pid } = {}) {
  const file = join(dir, LOCK_NAME);
  let prev = null;
  try { prev = JSON.parse(await readFile(file, 'utf8')); } catch { /* 없거나 손상 → 새로 잡는다 */ }
  if (prev?.pid && prev.pid !== pid) {
    let alive = false;
    try { process.kill(prev.pid, 0); alive = true; } catch { alive = false; }
    if (alive) {
      throw new Error(`이미 다른 T5 서버(pid ${prev.pid})가 이 데이터 자리를 쓰고 있어요. `
        + '같은 자료를 두 서버가 쓰면 나중 저장이 앞의 것을 지워요 — 그 서버를 끄고 다시 시작해 주세요.');
    }
  }
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify({ pid, at: Date.now() }), 'utf8');
  return {
    async release() {
      try {
        const cur = JSON.parse(await readFile(file, 'utf8'));
        if (cur?.pid === pid) await rm(file, { force: true });
      } catch { /* 이미 없음 */ }
    },
  };
}
