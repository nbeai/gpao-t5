// L4 · **파일 스킬** — 능력을 손(계약 객체)이 아니라 **문서 한 장**으로 늘린다.
//
// 왜 또 하나의 길인가: T5 의 스킬은 검증된 계약 객체다(`skill-store.js` · replayCases 필수).
// 그건 **T5 가 대신 실행을 약속하는 것**이라 그만큼 물어야 맞다. 그런데 오늘 라이브에서 진 것은
// 약속의 무게가 아니라 **하는 법을 몰라서**였다:
//   · "네이버 검색 결과" → 모델이 주소를 지어냈다(`www.naver.com/search.naver` — 호스트가 틀렸다)
//   · "엑셀 만들어줘"   → 몇 시간 논의 끝에 "생성 부품 0건". 실측으로는 셸에서 그냥 만들어진다
// 둘 다 **손이 없어서가 아니다.** `local.terminal` 은 이미 굵고 승인도 안 문다.
//
// 비교군 축(OpenClaw `skills/*/SKILL.md`, 번들 53장): 능력을 도구로 안 늘린다.
// 머리말(name·description·requires.bins) + 본문(셸로 하는 법) — **파일 한 장**이다.
// 프롬프트에는 **이름·설명·경로만** 싣고 본문은 모델이 필요할 때 읽는다
// (OpenClaw `docs/concepts/system-prompt.md` 의 그 방식). 그래야 53장이 프롬프트를 안 먹는다.
//
// 계약(좁게 잡는다 — 이 길은 승인·replay 상태기계를 **타지 않는다**):
//   · 파일 스킬은 **아무것도 실행하지 않는다.** 읽을거리다. 실행은 기존 손이 하고 경계도 그대로다.
//   · 그래서 기존 스킬 계약을 대체하지 않는다 — 옆에 난 다른 길이다.
//   · `requires.bins` 가 이 컴퓨터에 없으면 **목록에 안 올린다.** 못 하는 법을 가르치면
//     모델이 그걸 능력으로 읽고 못 지킬 약속을 한다(손 선언과 같은 계약).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { agentHomeDir } from './agent-home.js';

/** 설명 한 줄의 상한. 산문이 되면 그 자체가 결함이다(오너 2026-08-11). */
export const SKILL_DESC_MAX = 120;

/** 함께 딸려오는 스킬(제품 자산). `files: ["src"]` 안에 있어 설치본에도 그대로 간다. */
export function bundledSkillsDir() {
  return fileURLToPath(new URL('../skills/', import.meta.url));
}

/** 사용자가 자기 집에 놓는 스킬. 집 문서(`지침.md`)와 같은 자리 계열이다. */
export function userSkillsDir(env = process.env) {
  return join(agentHomeDir(env), 'skills');
}

/**
 * SKILL.md 머리말을 읽는다. YAML 전부가 아니라 **우리가 쓰는 세 칸만** 본다 —
 * 파서를 키우면 그게 또 하나의 계약이 된다.
 * @returns {{name:string, description:string, bins:string[]}|null}
 */
export function parseSkillDoc(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ''));
  if (!m) return null;
  const head = m[1];
  const 한줄 = (key) => {
    const r = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm').exec(head);
    return r ? r[1].trim().replace(/^["']|["']$/g, '') : '';
  };
  const name = 한줄('name');
  if (!name) return null;
  // bins 는 인라인 배열(`bins: [zip, file]`)과 목록(`- zip`) 둘 다 받는다.
  const bins = [];
  const inline = /^\s*bins\s*:\s*\[([^\]]*)\]/m.exec(head);
  if (inline) bins.push(...inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean));
  else {
    const 목록 = /^\s*bins\s*:\s*\r?\n((?:\s*-\s*.+\r?\n?)+)/m.exec(head);
    if (목록) bins.push(...목록[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean));
  }
  return { name, description: 한줄('description').slice(0, SKILL_DESC_MAX), bins };
}

/** 그 명령이 이 컴퓨터에 있나. 없으면 그 스킬은 목록에 안 올린다(없는 법을 가르치지 않는다). */
export function hasBin(bin, env = process.env) {
  const b = String(bin ?? '').trim();
  if (!b) return false;
  if (b.includes('/')) return existsSync(b);
  const path = String(env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin');
  return path.split(':').some((d) => d && existsSync(join(d, b)));
}

/** 한 폴더 안의 `<이름>/SKILL.md` 자리들. 없는 폴더는 없는 것으로 둔다(지어내지 않는다). */
function 스킬파일들(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = join(dir, e.name, 'SKILL.md');
    let st;
    try { st = statSync(file); } catch { continue; }
    out.push({ file, mtimeMs: st.mtimeMs, size: st.size });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * 모델에게 보일 자리. **홈 아래면 `~/` 로 적는다** — 프롬프트에 계정 이름(`/Users/<누구>`)을
 * 실을 이유가 없고, `~/` 는 파일 손(`resolveInScope`)과 셸이 둘 다 아는 표기다(두 진실 아님).
 */
export function 집상대(file, env = process.env) {
  const home = env.GPAO_T5_HOME ?? env.HOME ?? homedir();
  const h = String(home).replace(/\/+$/, '');
  return h && file.startsWith(`${h}/`) ? `~/${file.slice(h.length + 1)}` : file;
}

// 파일이 안 변했으면 다시 안 읽는다. 매 턴 도는 자리라 **읽기는 바뀐 것만** 한다.
const 캐시 = new Map();

/**
 * 지금 이 컴퓨터에 있는 파일 스킬 목록. **파일이 있으면 쓰인다** — 등록도 승인도 없다.
 * 같은 이름이면 사용자 집이 이긴다(제품이 사용자 것을 덮지 않는다).
 * @returns {Array<{name:string, description:string, path:string}>}
 */
export function skillIndex(env = process.env) {
  // **지문은 계약을 재는 자이지 환경을 재는 자가 아니다**(S1 preflight 가 `GPAO_T5_NO_AUTO_SCREEN_BIN`
  // 에 쓰는 그 규율 그대로). 스킬 경로는 설치마다 다른 절대 경로라, 동결 지문을 재는 자리에서는
  // 끈다. 제품에서는 켜져 있다 — 이 스위치를 켜는 곳은 계측기뿐이다.
  if (env.GPAO_T5_NO_FILE_SKILLS) return [];
  const dirs = [bundledSkillsDir(), userSkillsDir(env)];
  const byName = new Map();
  for (const dir of dirs) {
    for (const { file, mtimeMs, size } of 스킬파일들(dir)) {
      const 표 = `${mtimeMs}:${size}`;
      let 것 = 캐시.get(file);
      if (!것 || 것.표 !== 표) {
        let head = null;
        try { head = parseSkillDoc(readFileSync(file, 'utf8')); } catch { head = null; }
        것 = { 표, head };
        캐시.set(file, 것);
      }
      if (!것.head) continue;
      if (것.head.bins.length && !것.head.bins.every((b) => hasBin(b, env))) continue;
      byName.set(것.head.name, {
        name: 것.head.name, description: 것.head.description, path: file, 보임: 집상대(file, env),
      });
    }
  }
  return [...byName.values()];
}

/**
 * 프롬프트에 실을 한 덩어리. **이름·설명·경로만** — 본문은 모델이 필요할 때 읽는다.
 * 여기에 본문을 실으면 스킬이 늘수록 프롬프트가 먹히고, 그건 능력이 아니라 비용이다.
 */
export function skillPromptSection(index = []) {
  if (!index.length) return null;
  const 줄 = index.map((s) => `${s.name} — ${s.description || '(설명 없음)'} · ${s.보임 ?? s.path}`);
  return `[이 컴퓨터에서 하는 법이 적힌 문서 — 해당하는 일이면 본문을 먼저 읽는다(local.file read 또는 터미널 cat)]\n${줄.join('\n')}`;
}
