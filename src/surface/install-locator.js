// 이 설치본이 **어디에 떠 있는지**와 **누구인지**를 파일 하나로 남긴다 (P-DIST-1 §3).
//
// 왜 필요한가: 기본 자리(4173)를 다른 프로그램이 쓰고 있으면 T5 는 빈 자리로 옮긴다. 그러면
// "T5 는 4173 에 있다"는 가정이 전부 깨진다 — 두 번째 실행은 이미 떠 있는 T5 를 못 찾아 서버를
// 하나 더 띄우고, 사용자는 기억이 둘로 갈라진 것을 나중에야 겪는다. 그래서 **실제로 잡은 자리**를
// 적어 두고, 다음 실행·Dock 아이콘·로그인 자동시작이 모두 이 파일을 보고 같은 T5 로 간다.
//
// 여기에는 판단이 없다. 읽고 쓰는 것뿐이다 — 무엇을 할지는 부르는 쪽이 정한다.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/** 다른 저장소들과 **같은 규칙**으로 자리를 고른다 — 격리(GPAO_T5_DATA_DIR)가 여기에도 그대로 든다. */
export function 데이터자리(processEnv = process.env) {
  return processEnv.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

const 신분파일 = (dir) => join(dir, 'install.json');
const 자리표파일 = (dir) => join(dir, 'locator.json');

async function 읽기(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

/** 남의 눈에 안 띄게 쓴다. 토큰이 들어 있으므로 0600 이다(같은 계정 안에서는 못 막지만, 계정 밖으로는 안 샌다). */
async function 쓰기(path, 값) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(값, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/**
 * 이 설치본의 신분. 없으면 이때 한 번 만든다.
 * - `installId` 는 **비밀이 아니다.** "이게 그 설치본이 맞나"를 확인하는 데만 쓴다(/health 에 실린다).
 * - `token` 은 비밀이다. 화면이 아닌 프로그램이 API 를 부를 때 이게 있어야 한다. 절대 응답에 싣지 않는다.
 */
export async function 설치신분(dir) {
  const 있던것 = await 읽기(신분파일(dir));
  if (있던것?.installId && 있던것?.token) return { installId: 있던것.installId, token: 있던것.token };
  // 반쯤 깨진 파일이면 새로 만든다 — 반쯤 맞는 신분을 신분으로 쓰지 않는다.
  const 새것 = { installId: randomUUID(), token: randomUUID().replace(/-/g, '') };
  await 쓰기(신분파일(dir), 새것);
  return 새것;
}

/** 지금 실제로 잡은 자리를 적는다. 실패해도 서버를 죽이지 않는다 — 자리표가 없다고 T5 가 못 뜰 이유는 없다. */
export async function 자리표쓰기(dir, { port, installId, pid = process.pid }) {
  try { await 쓰기(자리표파일(dir), { installId, port, pid }); return true; }
  catch { return false; }
}

/** 마지막으로 알려진 자리. 없으면 null — **없는 것을 있는 척하지 않는다**(살아 있는지는 부르는 쪽이 확인한다). */
export async function 자리표읽기(dir) {
  const v = await 읽기(자리표파일(dir));
  return Number.isInteger(v?.port) && v.port > 0 ? v : null;
}
