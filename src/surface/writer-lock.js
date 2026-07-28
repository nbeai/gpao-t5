// L4 · 단일 writer 잠금 (설치 전 필수, 감사 2026-07-29) — **같은 데이터 디렉터리에는 서버 하나.**
//
// 고유 임시명은 임시 파일 충돌만 막는다 — 두 서버가 같은 memory.json 을 쓰면 마지막 쓰기만
// 남는다(사용자의 확인·철회가 조용히 사라진다). 그래서 라이브 부팅에서 잠금을 잡고,
// 살아 있는 다른 서버가 잡고 있으면 **정직하게 멈춘다**(반쪽으로 돌지 않는다).
//
// 세 번의 감사 재현이 이 파일의 규칙을 만들었다(2026-07-29):
// ① 소유자는 pid 가 아니라 **pid + ownerToken** — pid 만 보면 같은 프로세스의 두 번째 서버가
//    첫 잠금을 "내 죽은 잔여"로 오인해 걷었다.
// ② 죽음의 증거는 **ESRCH 뿐** — pid 1 은 EPERM(신호 권한 없음)을 주지만 살아 있다.
//    모든 예외를 죽음으로 읽자 살아 있는 잠금을 걷고 둘이 함께 잡았다(3/20).
// ③ 회수는 **고정 게이트로 직렬화** — rm 도, rename+내용비교도 경로 기준이라 "죽은 것만
//    가져간다"는 보장이 없다(늦은 회수자가 새 소유자의 살아 있는 잠금을 옮긴 빈자리에서
//    또 다른 획득이 성공 — 3자 경쟁 500회 중 1회 재현). 이제 회수자는 게이트를 원자적으로
//    잡은 뒤 **게이트 아래에서 재판정 → 죽은 잠금 제거 → 새 wx 획득**까지 마친다.
//    게이트 없이 읽은 판정은 회수에 쓰지 않는다.
//
// 게이트가 직렬화하는 것은 "주 잠금의 빈자리를 만드는 일"이다. 게이트를 안 거치는 wx 는
// 빈자리를 만들지 않으므로(있으면 EEXIST) 안전하다 — 게이트 소유자의 wx 가 지나가던 wx 에
// 질 수는 있는데, 그때 게이트 소유자는 새 내용을 재판정하고 살아 있으면 정직하게 진다.
import { readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const LOCK_NAME = '.writer-lock.json';
const GATE_NAME = '.writer-lock.reclaim';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 죽음의 증거는 ESRCH 뿐이다. 소유자를 특정할 수 없는 항목(손상)도 회수 대상으로 본다. */
function isDead(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return false; }
  catch (err) { return err?.code === 'ESRCH'; }
}

/** ENOENT → undefined(없음) · 파싱 실패 → null(손상) · 그 외 → 객체 */
async function readJson(file) {
  let raw;
  try { raw = await readFile(file, 'utf8'); } catch { return undefined; }
  try { return JSON.parse(raw); } catch { return null; }
}

function 살아있다는거절(pid) {
  return new Error(`이미 다른 T5 서버(pid ${pid})가 이 데이터 자리를 쓰고 있어요. `
    + '같은 자료를 두 서버가 쓰면 나중 저장이 앞의 것을 지워요 — 그 서버를 끄고 다시 시작해 주세요.');
}

/**
 * 죽은 게이트 청소 — 회수자가 게이트를 잡은 채 죽은 극히 짧은 창(재판정~해제는 몇 ms)의 잔여.
 * 목적지 이름을 **판정한 죽은 내용에서 유도**하므로 같은 잔여를 본 청소자들은 같은 곳을 겨눈다 —
 * rename 은 한 명만 성공하고 나머지는 ENOENT 로 물러난다. 집어 온 것이 다른 것(그 사이 생긴
 * 살아 있는 게이트)이면 되돌리고 이번 판을 포기한다.
 */
async function reapDeadGate(gate, seen) {
  const tok = seen?.ownerToken ?? 'corrupt';
  try {
    const again = await readJson(gate);
    if (again === undefined) return;
    if ((again?.ownerToken ?? 'corrupt') !== tok || !isDead(again?.pid)) return; // 사정이 바뀜 — 청소 포기
    const dest = `${gate}.dead-${tok}`;
    await rename(gate, dest);
    const got = await readJson(dest);
    if (got && (got.ownerToken ?? 'corrupt') !== tok) {
      // 살아 있는 새 게이트를 집어 왔다 — 되돌린다(빈자리에만: wx). 실패해도 잔여는 dest 에 남는다.
      try { await writeFile(gate, JSON.stringify(got), { encoding: 'utf8', flag: 'wx' }); } catch { /* 이미 새 게이트 */ }
    }
    await rm(dest, { force: true });
  } catch { /* ENOENT 등 — 다른 청소자가 이미 걷었다 */ }
}

async function releaseGate(gate, pid, ownerToken) {
  // 게이트도 내 신분(pid+token)이 맞을 때만 지운다.
  try {
    const cur = await readJson(gate);
    if (cur?.pid === pid && cur?.ownerToken === ownerToken) await rm(gate, { force: true });
  } catch { /* 이미 없음 */ }
}

/**
 * @param {string} dir 데이터 디렉터리
 * @param {object} [opts]
 * @param {number} [opts.pid]
 * @param {(point:string)=>Promise<void>} [opts._pause] 시험 전용 — 지연 interleaving 을 결정적으로 고정한다.
 * @returns {Promise<{release:()=>Promise<void>}>} 잠금 해제 함수(정상 종료·close·부팅 실패에서 부른다)
 * @throws 살아 있는 다른 writer 가 있으면 사람 말 메시지로 던진다.
 */
export async function acquireWriterLock(dir, { pid = process.pid, _pause } = {}) {
  const file = join(dir, LOCK_NAME);
  const gate = join(dir, GATE_NAME);
  const ownerToken = randomUUID(); // 이 획득의 신분 — 같은 pid 안의 두 잠금도 서로 남이다
  const pause = _pause ?? (async () => {});
  await mkdir(dir, { recursive: true });

  const 내잠금 = () => JSON.stringify({ pid, ownerToken, at: Date.now() });
  const handle = {
    async release() {
      // **내 신분(pid+token)이 맞을 때만 지운다** — 늦은 해제가 새 소유자의 잠금을 지우지 않게.
      try {
        const cur = await readJson(file);
        if (cur?.pid === pid && cur?.ownerToken === ownerToken) await rm(file, { force: true });
      } catch { /* 이미 없음 */ }
    },
  };

  const MAX_ATTEMPTS = 80; // 게이트 대기(15ms 간격) 포함 — 약 1.2s 안에 답이 나온다
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // ① **주 잠금을 만지기 전에 게이트부터 본다** — 회수가 진행 중이면 기다린다.
    const g = await readJson(gate);
    if (g !== undefined) {
      if (!isDead(g?.pid)) { await sleep(15); continue; } // 살아 있는 회수자 — 곧 끝난다
      await reapDeadGate(gate, g);
      continue;
    }
    await pause('gate-clear');

    // ② 원자적 생성(wx) — 읽고-쓰기가 아니라 생성 자체가 경합 판정이다.
    try {
      await writeFile(file, 내잠금(), { encoding: 'utf8', flag: 'wx' });
      return handle;
    } catch (e) { if (e?.code !== 'EEXIST') throw e; }

    // ③ 있는 잠금 판정 — **pid 가 나와 같아도 남의 잠금이다.**
    const prev = await readJson(file);
    if (prev === undefined) continue; // 그 사이 해제됨 — 처음부터
    if (prev !== null && !isDead(prev.pid)) throw 살아있다는거절(prev.pid);
    await pause('judged-dead');

    // ④ 죽은/손상 잠금 — **게이트를 잡은 한 명만 회수한다.**
    try {
      await writeFile(gate, 내잠금(), { encoding: 'utf8', flag: 'wx' });
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      await sleep(10); continue; // 다른 회수자가 진행 중 — 그 결과를 다시 판정한다
    }
    try {
      await pause('gate-held');
      // 게이트 아래에서 **재판정** — 게이트 없이 읽은 prev 는 여기서 쓰지 않는다(그 사이 새
      // 소유자가 생겼을 수 있다). 살아 있으면 정직하게 진다.
      const cur = await readJson(file);
      if (cur !== undefined && cur !== null && !isDead(cur.pid)) throw 살아있다는거절(cur.pid);
      if (cur !== undefined) await rm(file, { force: true }); // 빈자리는 게이트 소유자만 만든다
      await pause('slot-empty');
      try {
        await writeFile(file, 내잠금(), { encoding: 'utf8', flag: 'wx' });
        return handle;
      } catch (e) {
        if (e?.code !== 'EEXIST') throw e;
        // 지나가던 wx 가 빈자리를 먼저 채웠다 — 그가 살아 있으면 정직하게 진다.
        const now = await readJson(file);
        if (now !== undefined && now !== null && !isDead(now.pid)) throw 살아있다는거절(now.pid);
        continue; // 극단: 그새 또 죽음 — 처음부터 다시 판정한다
      }
    } finally {
      await releaseGate(gate, pid, ownerToken);
    }
  }
  throw new Error('데이터 자리 잠금을 잡지 못했어요. 잠시 후 다시 시작해 주세요.');
}
