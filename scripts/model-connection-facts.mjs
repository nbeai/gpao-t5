// 자격 파일에서 **키가 아닌 사실만** 내주는 문 하나 (2026-08-14).
//
// ── 왜 이 파일인가 ──────────────────────────────────────────────────────────
// 규칙은 이미 문장으로 있었다(`scripts/agent-start.mjs` · `design/NEXT-SESSION.md`):
// *"자격 파일은 아예 열지 마라 — `model-connection.json` 에는 API 키 원문이 있다."*
// 그런데 **집행자가 0이었다.** 그리고 사람은 계속 그 값(공급자·모델 id·상류 주소)이 필요하다.
// 필요를 안 없애고 문장으로만 막으면 언젠가 또 열린다 — **막는 것과 길을 주는 것은 한 세트다.**
//
// ── 2026-08-12 에 밟은 것 ───────────────────────────────────────────────────
// 가림막을 짰는데 **부모 키 이름으로 걸렀다.** 이름이 예상과 다른 자리에 있던 `key` 값이
// 그대로 나갔고 오너 키 회전이 필요했다. 그래서 이 파일의 방식은 반대다:
//   · **빼는 목록이 아니라 넣는 목록**(화이트리스트). 어떤 이름이 새로 오든 기본은 「안 나감」이다
//   · 가림은 **이름이 아니라 값 자리**로 한다 — 내보낼 값을 하나씩 골라 새 객체에 담는다
//   · 담고 나서 **다시 검사한다**(`샌것찾기`). 화이트리스트 밖 문자열이 출력에 섞였으면
//     그 자리는 출력하지 않고 던진다. 가리기가 불완전할 수 있고, 그때 반쯤 가린 것을
//     내보내면 지금보다 나쁘다 — **모르면 안 내보내는 쪽**이다
//
// ── 절대 안 내주는 것 ───────────────────────────────────────────────────────
// 키·토큰·비밀 원문은 물론이고 **부분 문자열·길이·해시도 안 낸다.** 길이와 접두는 키를 좁힌다.
// `credentialFp`(키의 sha256 조각)·`instanceId` 도 그래서 화이트리스트에 없다.
// 자격에 대해 내는 것은 **있다/없다** 한 비트뿐이다.
//
// 쓰는 법:
//   node scripts/model-connection-facts.mjs            사람이 읽는 줄
//   node scripts/model-connection-facts.mjs --json     기계가 읽는 JSON
//   GPAO_T5_MODEL_CONNECTION_FILE=… node scripts/model-connection-facts.mjs   다른 자리를 본다
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 제품이 쓰는 자리와 같은 규칙(`src/surface/model-connection.js` 의 `defaultConnectionDir`). */
export function 자격파일자리(env = process.env, home = homedir()) {
  if (env.GPAO_T5_MODEL_CONNECTION_FILE) return env.GPAO_T5_MODEL_CONNECTION_FILE;
  const dir = env.GPAO_T5_DATA_DIR ?? join(home, '.local', 'state', 'gpao-t5', 'sessions');
  return join(dir, 'model-connection.json');
}

/**
 * **넣는 목록.** 여기 없는 이름은 무슨 이름이든 안 나간다.
 * 값 타입도 고정한다 — 이름이 맞아도 객체가 들어 있으면(중첩 자격) 안 낸다.
 */
const 내보낼필드 = Object.freeze([
  ['kind', 'string'], ['provider', 'string'], ['modelId', 'string'],
  ['id', 'string'], ['label', 'string'], ['verified', 'boolean'],
]);

/** 상류 주소 — 사용자정보·질의·조각을 떼고 스킴·호스트·경로만. 자격이 URL 에 실려도 안 나가게. */
export function 상류만(값) {
  if (typeof 값 !== 'string' || !값) return null;
  try {
    const u = new URL(값);
    // u.host 에는 `user:pass@` 가 안 들어간다(u.href 와 다르다). search·hash 도 버린다.
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return null; // 못 읽는 주소는 **원문을 대신 내보내지 않는다**
  }
}

/**
 * 저장본(파싱된 객체) → 키가 아닌 사실만. 입력을 바꾸지 않는다.
 * @param {*} 저장본
 */
export function 자격사실(저장본) {
  if (!저장본 || typeof 저장본 !== 'object') return { 연결수: 0, 기본연결: null, 연결: [] };
  const 목록 = Array.isArray(저장본.connections) ? 저장본.connections : [];
  const activeId = typeof 저장본.activeId === 'string' ? 저장본.activeId : null;
  const 바인딩 = 저장본.roleBindings && typeof 저장본.roleBindings === 'object' ? 저장본.roleBindings : {};
  const 연결 = 목록.map((c) => {
    const 낸것 = {};
    for (const [이름, 타입] of 내보낼필드) {
      if (c && typeof c[이름] === 타입) 낸것[이름] = c[이름];
    }
    낸것.상류 = 상류만(c?.baseUrl);
    // **있다/없다 한 비트만.** 길이·접두·해시는 키를 좁힌다.
    낸것.자격있음 = Boolean(c?.key || c?.credential?.access || c?.credential?.refresh);
    낸것.기본 = 낸것.id != null && 낸것.id === activeId;
    낸것.역할 = Object.entries(바인딩).filter(([, id]) => id === 낸것.id).map(([r]) => r).sort();
    return 낸것;
  });
  // activeId 를 그대로 싣지 않는다 — **내가 이미 낸 값과 맞을 때만** 낸다(새 문자열을 안 만든다).
  const 기본연결 = 연결.find((c) => c.기본)?.id ?? null;
  return { 연결수: 연결.length, 기본연결, 연결 };
}

/** 객체의 모든 문자열 잎을 경로와 함께 훑는다. */
function 잎훑기(값, 경로, 손) {
  if (typeof 값 === 'string') { 손(경로, 값); return; }
  if (!값 || typeof 값 !== 'object') return;
  for (const [k, v] of Object.entries(값)) 잎훑기(v, [...경로, k], 손);
}

/**
 * 이 **경로**의 값은 내보내도 되는가. 「출력에 들어 있으니 허용」이 아니라
 * 「저장본의 이 자리에서 온 값이니 허용」이다 — 앞의 것은 되짚기를 무력화한다(첫 판에 밟음).
 */
function 허용경로(경로) {
  if (경로.length === 1 && 경로[0] === 'activeId') return true;
  if (경로.length === 2 && 경로[0] === 'roleBindings') return true;
  if (경로.length === 3 && 경로[0] === 'connections') {
    const 이름 = 경로[2];
    return 이름 === 'baseUrl' || 내보낼필드.some(([f]) => f === 이름);
  }
  return false;
}

/**
 * **되짚어 보는 자.** 화이트리스트를 통과했다고 믿지 않고, 저장본에서 **내보내기로 한 자리가
 * 아닌 곳**의 문자열이 출력 어딘가에 섞여 있는지 다시 본다.
 * 2026-08-12 사고(부모 키 이름으로 걸러 값이 샘)를 이름이 아니라 **자리와 값으로** 잡는다.
 * @returns {string[]} 샌 자리의 **경로만**(값은 절대 안 담는다)
 */
export function 샌것찾기(저장본, 낸것) {
  const 낸글자 = JSON.stringify(낸것 ?? null);
  const 샌자리 = [];
  잎훑기(저장본, [], (경로, 값) => {
    if (값.length < 8) return;      // 너무 짧으면 비밀을 좁히지 못한다(그리고 오탐만 는다)
    if (허용경로(경로)) return;
    if (낸글자.includes(값)) 샌자리.push(경로.join('.'));
  });
  return 샌자리;
}

/**
 * 자격 파일에서 사실만 읽는다. **원문·키는 반환값에 절대 안 담는다.**
 * 파일이 없으면 없다고 말한다(지어내지 않는다).
 */
export async function 자격사실읽기({ 자리 = 자격파일자리(), 읽기 = readFile } = {}) {
  let 원문;
  try {
    원문 = await 읽기(자리, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') {
      return { 자리, 있음: false, 사실: null, 사유: '파일이 없다 — 이 자리에는 저장된 모델 연결이 없다' };
    }
    return { 자리, 있음: null, 사실: null, 사유: `읽지 못했다(${e?.code ?? 'unknown'})` };
  }
  let 저장본;
  try {
    저장본 = JSON.parse(원문);
  } catch {
    // ⚠️ 파싱 오류 메시지에는 **입력 조각이 실려 나온다**(Node 20+ 의 `... is not valid JSON`).
    //    그대로 찍으면 키가 세션 기록에 남는다 — 사고 그 자체다. 메시지를 버린다.
    return { 자리, 있음: true, 사실: null, 사유: '파일은 있는데 JSON 이 아니다(내용은 싣지 않는다)' };
  }
  const 사실 = 자격사실(저장본);
  const 샜다 = 샌것찾기(저장본, 사실);
  if (샜다.length) {
    throw new Error(`통로가 샜다 — 화이트리스트 밖 값이 출력에 섞였다: ${샜다.join(', ')}`);
  }
  return { 자리, 있음: true, 사실, 사유: null };
}

function 줄로(결과) {
  const 줄 = [`자격 파일: ${결과.자리}`];
  if (!결과.사실) { 줄.push(`  ${결과.사유}`); return 줄.join('\n'); }
  const { 연결수, 기본연결, 연결 } = 결과.사실;
  줄.push(`  연결 ${연결수}개 · 기본 ${기본연결 ?? '(없음)'}`);
  for (const c of 연결) {
    줄.push(`  ${c.기본 ? '▶' : '·'} ${c.provider ?? '(공급자 미상)'} / ${c.modelId ?? '(모델 미상)'}`
      + `  상류 ${c.상류 ?? '(기본)'}  자격 ${c.자격있음 ? '있음' : '없음'}`
      + `${c.verified === false ? '  ⚠ 미검증' : ''}${c.역할.length ? `  역할 ${c.역할.join(',')}` : ''}`);
  }
  줄.push('  (키·토큰은 이 통로로 나오지 않는다 — 길이·접두·해시도 안 낸다)');
  return 줄.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const 결과 = await 자격사실읽기();
  console.log(process.argv.includes('--json') ? JSON.stringify(결과, null, 2) : 줄로(결과));
  process.exitCode = 결과.있음 ? 0 : 1;
}
