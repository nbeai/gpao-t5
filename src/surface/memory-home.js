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

/**
 * 집의 기억 파일을 읽는다.
 * @returns {Promise<Map<string,string>|null>} 표식 → 문장. **파일이 없으면 `null`**
 *   (빈 Map 을 돌려주면 "전부 지웠다"로 읽힌다 — 첫 실행에 기억이 통째로 날아간다).
 */
export async function 기억파일읽기(집, 저장소 = '') {
  let 글;
  try { 글 = await readFile(join(집, 파일이름), 'utf8'); } catch { return null; }
  // **짝이 안 맞으면 진실이 아니다.** 남의 설치가 쓴 파일로 이쪽 기억을 지우지 않는다.
  const m = 글.match(new RegExp(`${표식앞.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\s>]*)\\s*-->`));
  if ((m?.[1] ?? '') !== String(저장소)) return null;
  const out = new Map();
  for (const m of 글.matchAll(/^\s*-\s*(.*?)\s*<!--\s*t5:([^\s>]+)\s*-->\s*$/gm)) {
    out.set(m[2], m[1].trim());
  }
  return out;
}

/**
 * 사용자가 **지운** 기억의 신분.
 * @param {{candidateId?:string}[]} 지금 기억하고 있는 것
 * @param {Map<string,string>|null} 파일에서 읽은 것 (`null` 이면 파일이 없다 = 아무것도 안 지웠다)
 */
export function 지워진기억(지금 = [], 파일 = null) {
  if (!(파일 instanceof Map)) return [];
  return 지금.map((m) => m?.candidateId).filter((id) => id && !파일.has(id));
}
