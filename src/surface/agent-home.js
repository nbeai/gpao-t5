// L4 · **에이전트의 집** — 사용자가 열어 고치는 파일들이 사는 자리.
//
// 원리 ⑥(OpenClaw 워크스페이스 문서): *"The workspace is the agent's home… treat it as memory."*
// 집과 **설정·상태**(자격·세션·열쇠·원장)는 다른 자리다. 설정은 `~/.local/state/gpao-t5/` 에
// 남고, 집은 사용자가 파인더로 열고 백업하고 고치는 **작업 폴더**다.
//
// ── 왜 필요했나 ────────────────────────────────────────────────────────────
// T5 가 어떻게 행동할지는 전부 `judgmentCharter()` 에 박혀 있었고 **사용자는 한 글자도 못 고쳤다.**
// 비교군 넷(OpenClaw·Hermes·Claude Code·Codex)은 전부 이걸 파일로 준다.
// "이 컴퓨터에서 나는 이렇게 일해 줬으면 좋겠다"를 적을 자리가 없으면, 사용자는 매번 말로 반복한다.
//
// ── 이름은 복제하지 않는다 ────────────────────────────────────────────────
// `AGENTS.md` 를 그대로 쓸 이유가 없다(계획 §5 비목표 — 필요한 건 **역할과 수명**이다).
// 한국 사용자가 자기 컴퓨터에서 열어 고치는 파일이므로 우리말 이름을 쓴다.
//
// ── 수명 ──────────────────────────────────────────────────────────────────
//   `지침.md`   운영 지침 — **매 세션**(안정 구역). 사용자가 고치면 다음 턴부터 반영된다.
//   `사용자.md` 사용자가 누구이고 어떻게 불러야 하는가 — **매 세션**(안정 구역).
// 매 세션 실리므로 **예산이 있다.** 예산 없는 상시 주입은 대화 이력을 밀어낸다(불변식 B).
// 기억·스킬처럼 "안 싣고 필요할 때 꺼내 보는 것"은 여기 없다 — 그건 S5 의 자리다.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * 파일 하나의 상한. **실측으로 정한다** — T5 의 시스템 프롬프트가 지금 5,000자 안팎이므로
 * 지침 하나가 그만큼을 또 차지하면 대화가 밀린다. OpenClaw 는 20,000/60,000 을 쓰지만
 * 그건 그쪽 프롬프트 규모의 값이다 — **흡수할 것은 숫자가 아니라 "예산을 건다"는 원리다.**
 */
export const HOME_DOC_MAX = 4000;
/** 집 문서 전체의 상한. */
export const HOME_TOTAL_MAX = 6000;

/** 집이 어디인가. 설정·상태 디렉터리와 **겹치지 않는다.** */
export function agentHomeDir(env = process.env) {
  const 직접 = typeof env?.GPAO_T5_AGENT_HOME === 'string' ? env.GPAO_T5_AGENT_HOME.trim() : '';
  if (직접) return 직접;
  const home = env?.HOME || homedir();
  // 작업 루트가 곧 집이다 — 이미 파일 손의 첫째 뿌리이고 사용자에게 "작업 폴더"로 불린다.
  return join(home, 'GPAO-T5');
}

const 씨앗 = {
  '지침.md': `# 이렇게 일해 줘

> 이 파일은 **네가 고치는 곳**이다. 여기 적은 것은 다음 대화부터 T5 가 그대로 따른다.
> 지우고 네 방식대로 다시 적어도 된다.

## 일하는 방식

- 되는 일은 묻지 말고 먼저 해라. 결과를 보고 내가 고치면 된다.
- 못 하게 됐으면 왜 못 했는지와 다음 길을 같이 말해라.

## 말투

- (예: 존댓말로 / 편하게 반말로 / 짧게)

## 이 컴퓨터에서 주의할 것

- (예: 다운로드 폴더는 내가 직접 정리한다 / 회사 폴더는 건드리지 마라)
`,
  '사용자.md': `# 나에 대해

> 이 파일도 **네가 고치는 곳**이다. 적어 두면 T5 가 매번 묻지 않는다.

## 어떻게 부를까

- (예: 이름 / 호칭)

## 무슨 일을 하나

- (예: 하는 일, 자주 다루는 자료)

## 자주 시키는 일

- (예: 매주 정산 정리, 회의록 요약)
`,
};

/** 처음이면 씨앗을 놓는다. **이미 있으면 절대 덮지 않는다** — 집은 사용자의 것이다. */
export async function seedAgentHome(dir) {
  try { await mkdir(dir, { recursive: true }); } catch { return false; }
  let 놓음 = false;
  for (const [이름, 내용] of Object.entries(씨앗)) {
    const file = join(dir, 이름);
    try { await access(file); continue; } catch { /* 없으면 놓는다 */ }
    try { await writeFile(file, 내용, 'utf8'); 놓음 = true; } catch { /* 못 써도 죽지 않는다 */ }
  }
  return 놓음;
}

/** 조용히 자르지 않는다 — 얼마나 뺐는지 말한다(§S3 정직한 절단). */
function 줄이기(text, max) {
  const t = String(text ?? '');
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n\n…(${t.length - max}자를 줄였다 — 이 파일이 너무 길다. 짧게 고치면 전부 실린다)`;
}

/**
 * 집 문서를 읽는다. 없으면 **없는 것으로 둔다**(빈 파일을 지어내지 않는다).
 * @returns {Promise<{지침?:string, 사용자?:string}>}
 */
export async function readHomeDocs(dir) {
  const out = {};
  let 남은예산 = HOME_TOTAL_MAX;
  for (const 이름 of Object.keys(씨앗)) {
    if (남은예산 <= 0) break;
    let 원문;
    try { 원문 = await readFile(join(dir, 이름), 'utf8'); } catch { continue; }
    if (!원문.trim()) continue;
    const 실을것 = 줄이기(원문, Math.min(HOME_DOC_MAX, 남은예산));
    out[이름.replace(/\.md$/, '')] = 실을것;
    남은예산 -= 실을것.length;
  }
  return out;
}
