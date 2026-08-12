// L4 · **기억이 집에 산다** (S5a) — 사용자가 자기 기억을 열어 보고 고치고 지운다.
//
// 원리 ⑥: 집은 기억처럼 다룬다(*"treat it as memory"*). 비교군은 기억이 **그냥 파일**이라
// "보기 · 고치기 · 지우기"가 공짜로 된다. T5 는 `memory.json` 안에 있어서 셋 다 못 했다 —
// 암호화돼 있어서가 아니라(평문이다) **볼 자리가 없어서**다.
//
// ── 이 파일의 경계 ────────────────────────────────────────────────────────
// 원장(`memory-ledger.json` + HMAC 지문)은 **건드리지 않는다.** 철회의 복원 불가능성을 지키는
// 자리이고 내용과 이미 분리돼 있다. 여기는 **내용**만 다루고, 철회는 기존 원장 경로를 그대로 탄다.
//
// ── 왜 표식(id)을 숨겨 두나 ──────────────────────────────────────────────
// 사용자는 문장을 **고칠** 수도 있다("부모님이 오시면 1~3일" → "부모님 오시면 이삼일").
// 문장으로 대조하면 다듬은 것을 지운 것으로 읽는다. 신분은 표식이 들고, 문장은 사용자의 것이다.
// 표식은 HTML 주석이라 마크다운으로 볼 때 눈에 안 띈다.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const 파일이름 = '기억.md';
const 시작 = '<!-- t5:기억:시작 — 이 구역은 T5 가 다시 만든다 -->';
// **어느 설치의 기억인가.** 집은 홈에 하나인데 기억 저장소는 데이터 자리마다 다르다
// (검사·격리 하네스는 임시 폴더를 쓴다). 짝이 안 맞는 파일을 진실로 읽으면 **남의 파일이
// 이쪽 기억을 철회시킨다** — 실제로 회귀 29건이 그렇게 깨졌다(2026-08-05).
// 표식이 다르면 지운 것으로 읽지 않고 파일을 새로 만든다.
const 표식앞 = '<!-- t5:저장소:';
const 끝 = '<!-- t5:기억:끝 -->';

const 머리말 = `# T5 가 너에 대해 기억하는 것

> **줄을 지우면 T5 가 그걸 잊는다.** 문장을 고치면 고친 대로 기억한다.
> 아래 표시 구역은 T5 가 다시 만든다 — 그 **밖에** 쓴 메모는 그대로 남는다.`;

/** 사용자가 지우기 쉽게 한 줄 하나에 기억 하나. 표식은 주석으로 숨긴다. */
function 본문(기억들) {
  if (!기억들.length) return '- (아직 기억한 것이 없어요)';
  return 기억들
    .map((m) => `- ${String(m.statement ?? '').replace(/\n/g, ' ').trim()} <!-- t5:${m.candidateId} -->`)
    .join('\n');
}

/** 파생 구역만 갈아 끼운다. 사용자가 쓴 구역은 그대로 둔다(CAPABILITIES.md 와 같은 규율). */
function 끼우기(기존, 안쪽) {
  const block = `${시작}\n\n${안쪽}\n\n${끝}`;
  if (!기존) return `${머리말}\n\n${block}\n`;
  const b = 기존.indexOf(시작);
  const e = 기존.indexOf(끝);
  if (b < 0 || e < 0 || e < b) return `${기존.trimEnd()}\n\n${block}\n`;
  return 기존.slice(0, b) + block + 기존.slice(e + 끝.length);
}

/** 지금 기억하는 것을 집에 쓴다. */
export async function 기억파일쓰기(집, 기억들 = [], 저장소 = '') {
  try { await mkdir(집, { recursive: true }); } catch { return false; }
  const file = join(집, 파일이름);
  let 기존 = null;
  try { 기존 = await readFile(file, 'utf8'); } catch { /* 없으면 새로 만든다 */ }
  const 안쪽 = `${표식앞}${저장소} -->\n\n${본문(기억들)}`;
  try { await writeFile(file, 끼우기(기존, 안쪽), 'utf8'); return true; }
  catch { return false; }
}

/** 표시 구역 안쪽만 잘라 낸다. 그 **밖**에 쓴 메모는 기억이 아니다(머리말의 약속). */
function 구역안(글) {
  const b = 글.indexOf(시작);
  const e = 글.indexOf(끝);
  if (b < 0 || e < 0 || e < b) return '';
  return 글.slice(b + 시작.length, e);
}

/**
 * 집의 기억 파일을 읽는다.
 *
 * **사람이 손으로 쓴 줄도 읽는다**(2026-08-05). 예전엔 T5 가 붙인 표식이 있는 줄만 봤다 —
 * 그래서 머리말이 *"문장을 고치면 고친 대로 기억한다"* 고 약속해 놓고 **지우기만 됐다.**
 * 지침.md 가 "다음 대화부터 따른다"고 하고 안 따랐던 것과 같은 병이다(두 번째 거짓 약속).
 *
 * @returns {Promise<{표식있는것:Map<string,string>, 사람이쓴것:string[]}|null>}
 *   **파일이 없거나 짝이 안 맞으면 `null`** — 빈 값을 돌려주면 "전부 지웠다"로 읽혀
 *   첫 실행에 기억이 통째로 날아간다.
 */
export async function 기억파일읽기(집, 저장소 = '') {
  let 글;
  try { 글 = await readFile(join(집, 파일이름), 'utf8'); } catch { return null; }
  // **짝이 안 맞으면 진실이 아니다.** 남의 설치가 쓴 파일로 이쪽 기억을 지우지 않는다.
  const m = 글.match(new RegExp(`${표식앞.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\s>]*)\\s*-->`));
  if ((m?.[1] ?? '') !== String(저장소)) return null;
  const 안쪽 = 구역안(글);
  const 표식있는것 = new Map();
  const 사람이쓴것 = [];
  for (const 줄 of 안쪽.split('\n')) {
    const 표식 = 줄.match(/^\s*-\s*(.*?)\s*<!--\s*t5:([^\s>]+)\s*-->\s*$/);
    if (표식) { 표식있는것.set(표식[2], 표식[1].trim()); continue; }
    const 맨줄 = 줄.match(/^\s*-\s*(.+?)\s*$/);
    // 씨앗 문구는 사람이 쓴 기억이 아니다 — T5 가 넣어 둔 빈자리 표시다.
    if (맨줄 && 맨줄[1] !== '(아직 기억한 것이 없어요)') 사람이쓴것.push(맨줄[1]);
  }
  return { 표식있는것, 사람이쓴것 };
}

/**
 * 사용자가 **지운** 기억의 신분.
 * @param {{candidateId?:string}[]} 지금 기억하고 있는 것
 * @param {{표식있는것:Map<string,string>}|null} 파일에서 읽은 것 (`null` = 파일 없음 = 아무것도 안 지웠다)
 */
export function 지워진기억(지금 = [], 파일 = null) {
  const 표 = 파일?.표식있는것;
  if (!(표 instanceof Map)) return [];
  return 지금.map((m) => m?.candidateId).filter((id) => id && !표.has(id));
}

/**
 * **집 파일이 곧 기억이다** — 파일과 지금 기억을 대조해 무엇이 달라졌는지 낸다.
 *
 * 파일은 사용자의 것이고, 사용자가 자기 파일에 쓴 것보다 분명한 확인은 없다.
 * 그래서 여기서 나온 것은 **승인 의식을 다시 거치지 않는다**(`userConfirmed: true`) —
 * 거기서 또 물으면 기억은 영영 안 산다(오너 설치 실측 2026-08-05: 승격 0개).
 *
 * 판정만 낸다. 저장·원장은 호출자가 한다(이 파일은 내용만 다룬다는 경계 그대로).
 * @param {{candidateId?:string, statement?:string}[]} 지금
 * @param {{표식있는것:Map<string,string>, 사람이쓴것:string[]}|null} 파일
 * @returns {{더할것:object[], 고칠것:{candidateId:string,statement:string}[], 지울것:string[]}}
 */
export function 집파일반영(지금 = [], 파일 = null) {
  const 빈것 = { 더할것: [], 고칠것: [], 지울것: [] };
  if (!파일 || !(파일.표식있는것 instanceof Map)) return 빈것;   // 못 읽은 것은 "아무것도 안 바뀜"이다
  const 고칠것 = [];
  for (const m of 지금) {
    const 파일문장 = 파일.표식있는것.get(m?.candidateId);
    if (파일문장 == null) continue;
    if (파일문장 && 파일문장 !== String(m.statement ?? '').trim()) {
      고칠것.push({ candidateId: m.candidateId, statement: 파일문장 });
    }
  }
  const 이미있는문장 = new Set(지금.map((m) => String(m?.statement ?? '').trim()));
  const 더할것 = (파일.사람이쓴것 ?? [])
    .filter((s) => s && !이미있는문장.has(s))
    .map((statement) => ({
      // 신분은 문장에서 파생하지 않는다 — 고치면 다른 기억이 되어 버린다. 새로 발급한다.
      candidateId: `home-${createHash('sha256').update(statement).digest('hex').slice(0, 12)}`,
      kind: 'preference',
      statement,
      // 사용자가 자기 파일에 직접 썼다 — 그것이 확인이다.
      userConfirmed: true,
      admitted: true,
      source: 'home_file',
    }));
  return { 더할것, 고칠것, 지울것: 지워진기억(지금, 파일) };
}
