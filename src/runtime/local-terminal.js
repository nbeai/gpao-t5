// L3 · 터미널 도구 (P6-T2) — 실행기(terminal-run.js)를 T5 의 손으로 붙인다.
//
// 승인 흐름이 다른 도구와 다른 점: **등급을 실행 전에 알 수 없다.**
// `local.file` 은 action 만 보면 읽기인지 삭제인지 알지만, 명령은 돌려 봐야 안다.
// 그래서 계획 단계에서 **probe** 를 먼저 돌린다 — 쓰기·네트워크·비밀읽기가 막힌 상태라
// 승인 없이 돌려도 아무 영향이 없다(그래서 이게 안전하다). 그 결과가 등급을 정한다:
//   · probe 성공  → 아무것도 안 바꿨다는 증명. 그대로 답한다(A0).
//   · probe 막힘  → 바꾸려 했다는 뜻. 승인 카드로 간다(A2). 승인 뒤 granted 로 다시 돌린다.
import { runCommand, executionBlock, 막음자국있나, 쓰려던자리들, 한구획인가, 명령이지목한자리인가, 실행중에이름이정해졌나 } from './terminal-run.js';
import { sandboxAvailable } from './sandbox.js';
import { protectionFor } from './local-protection.js';
import { lifecycleRisk, lifecycleMessage } from './lifecycle-guard.js';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { isAbsolute, resolve, sep, join } from 'node:path';
import { alive } from './local-process.js';

/**
 * 빈 칸은 **없는 칸이다.** 모델은 안 쓰는 인자도 `''` 로 채워 보내므로 `??` 로 받으면
 * 빈 문자열이 진짜 값 행세를 한다. 실측: `cwd: ''` 가 통과해서 기본 자리(홈) 대신
 * 서버를 띄운 자리에서 돌았고, `find ..` 가 옆 프로젝트의 dist 수백 줄을 긁어와
 * 모델이 답을 못 냈다(같은 실수를 local.scope 에서도 했다 — `??` 마다 빈 값을 의심할 것).
 */
const blank = (v) => {
  const t = typeof v === 'string' ? v.trim() : v;
  return t === '' || t == null ? undefined : t;
};

/**
 * probe 가 "권한에 막혔다"고 말하는가.
 * **이건 안전 판정이 아니라 말투 판정이다.** 안전은 이미 커널이 보장했다(막혔으니 아무 일도 안 났다).
 * 여기서 하는 일은 "승인을 물을까, 그냥 실패를 알릴까"를 고르는 것뿐이라, 틀려도 최악은
 * `npm test` 실패에 승인을 묻거나(불편) 안 묻고 결과를 보여주는 것(안전)이다.
 */
/**
 * **「막혔다」와 「바꾸려 했다」는 다른 사실이다** (라이브 실측 2026-08-15 · §7-y).
 *
 * `changes` 는 두 칸짜리 통로(true/false)인데 사실은 셋이다 — 바꾼다·안 바꾼다·**모른다**.
 * 예전엔 `changes: looksBlocked(r)` 라서 **모른다가 자동으로 「바꾼다」로 굴러떨어졌고**,
 * 그래서 아무것도 안 바꾸는 `find … | head` 가 *"내용을 남기거나 덮어쓰는 일이라"* 는 카드로
 * 갔다(같은 발화 2/2 재현 · 사용자는 답을 못 받았다).
 *
 * 갈래마다 특례를 뚫지 않는다 — 그러면 명령 모양이 늘 때마다 거짓말이 하나씩 는다.
 * `executionBlock` 이 이미 아는 `why` 를 **안 버리고** 한 규칙으로 읽는다:
 * 아래 다섯만 **변경 시도의 증거**이고, 나머지 막힘은 「모른다」다(→ 미상 → 언제나 카드).
 */
const 변경시도증거 = new Set([
  'listen',    // 포트를 여는 것 = 바깥에서 닿게 만드는 상태 변경
  'network',   // 밖으로 나가려 했다 (읽기성인지는 reach 재시험이 따로 가른다)
  'privilege', // 컴퓨터 설정을 바꾸려다 OS 권한에 막혔다
  'signal',    // 돌고 있는 프로그램을 끄려 했다
  'write',     // 막힌 이름이 **쓰려던 자리**(리다이렉트 대상)였다 — 추측이 아니라 증거다
]);

function looksBlocked(r) {
  const block = executionBlock(r);
  return block?.kind === 'sandbox' || block?.kind === 'permission';
}

/**
 * **이 쓰기는 기존 것을 하나도 안 건드리는가** — (나) 수리(2026-08-16 · 오너 승인)의 판별.
 *
 * 헌장 ②가 묻는 것은 「백업 없는 덮어쓰기·파괴인가」다(`authority.js:222`). 빈 자리에 새 이름
 * 하나 만드는 것은 그 질문의 정의역 밖인데, 터미널이 `reversible: false` 를 **통째로** 선언해
 * 새 압축본 하나에도 파괴와 같은 카드가 떴다 — 비교군은 같은 부탁을 개입 0 으로 끝냈다(§7-af).
 *
 * 판별은 **밟은 기계 사실 셋의 교집합**이고, 하나라도 못 밟으면 false(카드 유지 · fail-closed):
 *   ① 명령이 **한 구획**이다 — 여럿이면 probe 는 첫 실패까지만 증명한다(`&&` 는 뒤를 안 돌린다).
 *      `cd X &&` 이동 뒤의 자리는 기준이 어긋나 stat 이 거짓을 본다(울타리 ①-b)
 *   ② 이름이 실행 전에 확정돼 있다 — `$( )` 이름은 대조 자체가 불능이다(§7-ak)
 *   ③ 쓰려다 막힌 자리 **전부**가: 명령이 스스로 지목했고 · probe 가 돈 자리(cwd) **안**이고 ·
 *      디스크에 **없다**. 「없는 자리 = 안전」이 아니므로 cwd 밖(시스템 자리)은 지목돼도 제외(울타리 ②)
 *
 * 라이브 분포에서 이 판별이 여는 것은 **6중 1**이다(손 관리자 실측) — `cd ..` 부류는 ①에
 * 걸려 카드로 남는다. 조준을 부풀리지 않는다: 이 판별은 「제자리 새 이름 생성」만 연다.
 */
function 창조만인가(r, command, cwd) {
  if (!한구획인가(command) || 실행중에이름이정해졌나(command)) return false;
  const 기준 = typeof cwd === 'string' && cwd ? cwd : null;
  if (!기준) return false;                       // 기준 자리를 모르면 stat 은 거짓을 본다
  const 자리들 = 쓰려던자리들(r);
  if (!자리들.length) return false;
  return 자리들.every((이름) => {
    if (!명령이지목한자리인가(이름, command)) return false;
    const 절대 = isAbsolute(이름) ? 이름 : resolve(기준, 이름.replace(/^\.\//, ''));
    if (!(절대 + sep).startsWith(기준.endsWith(sep) ? 기준 : 기준 + sep)) return false;
    return !existsSync(절대);
  });
}

/**
 * **네트워크만 열면 되는지 알아맞히지 않는다 — 열어 보고 안다.**
 *
 * 첫 판은 `executionBlock(r).why === 'network'` 로 골랐다. 실물에서 안 먹었다(밟음 2026-08-06):
 *   `ping -c1 8.8.8.8`  probe → `ping: sendto: Operation not permitted` → **`why:'write'` 로 잡힘**
 *                        reach → **통과**
 * 샌드박스가 네트워크를 막을 때 나오는 말은 `ENOTFOUND` 가 아니라 그냥 `Operation not permitted`
 * 다. 문구 목록으로 네트워크를 가르려던 것이고, 그건 이 파일이 처음부터 버린 방식이다
 * (`sandbox.js` 첫 문단 — 목록은 항상 뚫린다).
 *
 * 그래서 probe 와 같은 구조를 한 번 더 쓴다: **네트워크만 열고 다시 돌려 본다.**
 *   reach 에서 통과 → 막던 것은 네트워크뿐이었다는 **증명**. 이 컴퓨터는 안 바뀌었다(쓰기·비밀은 닫힘)
 *   reach 에서도 막힘 → 진짜 변경 시도. 그대로 승인으로 간다
 *
 * **두 자리만 뺀다** — 둘 다 "돌려 봐도 모르는" 자리라 구조가 성립하지 않는다:
 *   `listen`          포트를 여는 것은 나가서 읽는 게 아니라 **바깥에서 닿게 만드는 상태 변경**이다.
 *                     안 빼고 열었더니 서버 띄우기가 승인 없이 돌았다(회귀가 잡았다).
 *   `unreadable_exit` 실패를 삼키는 명령은 exit code 가 정보가 아니다. 모르면 승인 쪽이다.
 */
const 열어봐도소용없는것 = new Set(['listen', 'unreadable_exit']);

function 네트워크만열어볼까(r) {
  const block = executionBlock(r);
  if (!block) return false;
  if (block.kind !== 'sandbox' && block.kind !== 'permission') return false;
  return !열어봐도소용없는것.has(block.why);
}

/**
 * **읽기성 네트워크는 묻지 않는다** (오너 결정 2026-08-06 · 터미널 유보 해제).
 *
 * 계획서 v3.1 §20·§22 가 *"임의 명령 실행은 계속 유보"* 라고 적어 뒀는데 **코드에 그런 유보는
 * 없었다** — 셸은 통째로 열려 있고 명령 목록도 없다. 라이브로 갈라 보니 실제 마찰은 한 자리였다:
 *
 *   되돌릴 수 있는 쓰기   카드 없음 · 그냥 실행됨
 *   읽기성 네트워크        **카드가 떴다** — `curl` 조회 · `git pull` · `npm ls` · `gh pr list`
 *
 * 이 컴퓨터를 하나도 안 바꾸는 일인데 물었다. 자동성 헌장의 넷 어디에도 안 걸린다.
 * 그리고 **웹 손은 이미 임의 주소로 자동 GET 을 한다** — 같은 일을 터미널에서만 물었다.
 * 능력 문제가 아니라 두 손이 다른 선을 쓰고 있었다.
 *
 * 고칠 재료는 이미 다 있었다. `sandbox.js` 의 `reach`(쓰기✗ · 네트워크✓ · 비밀✗)를
 * 커넥터 CLI 손만 쓰고 터미널 본체는 안 썼다. 둘을 잇는다.
 *
 * **명령 목록을 만들지 않는다**(sandbox.js 첫 문단 — 목록은 항상 뚫린다). 판정은 그대로
 * *돌려 보고 안다*: 네트워크에만 막혔으면 네트워크만 열고 한 번 더 돌린다. 거기서도 막히면
 * 그건 진짜 변경 시도이므로 승인으로 간다.
 */
async function 재보기(run, command, { cwd, timeoutMs }) {
  const 첫판 = await run(String(command ?? ''), { mode: 'probe', cwd, timeoutMs });
  if (!네트워크만열어볼까(첫판)) return 첫판;
  const 둘째판 = await run(String(command ?? ''), { mode: 'reach', cwd, timeoutMs });
  // **reach 에서도 막혔으면 첫판을 그대로 쓴다.** 승인 카드에 실릴 이유는 probe 가 말한 것이
  // 정확하다 — reach 는 네트워크를 연 뒤의 두 번째 벽이라 사용자에게는 덜 정확한 설명이 된다.
  return looksBlocked(둘째판) ? 첫판 : 둘째판;
}

/** 명령이 지금 이 자리에서 무엇을 하려 하는지 사용자 말로. 승인 카드에 실린다. */
export function describeCommand(command, probe) {
  const block = executionBlock(probe);
  if (!block || (block.kind !== 'sandbox' && block.kind !== 'permission')) return `\`${command}\` 실행`;
  return `\`${command}\` — ${block.userWhy}`;
}

// ── 터미널 산출물 관측(§7-bq) — 상한 재귀 이름 집합과 그 diff ────────────────────
//
// 상한을 넘으면 **전부-포기**(null) 다 — 부분 목록은 「이게 전부」라는 거짓 완전 주장이 된다
// (H09 계보: 빈/잘린 측정을 긍정 증거로 세우지 않는다). 못 재면 안 적는다(fail-closed).
const 관측상한 = 2000;

/** cwd 아래 상대경로 이름 집합(재귀). 상한 초과·읽기 실패 자리는 건너뛰되 셈에는 넣는다. */
async function 이름집합(뿌리) {
  const 모음 = new Set();
  const 걷기 = async (자리, 앞) => {
    let 항목들;
    try { 항목들 = await readdir(자리, { withFileTypes: true }); } catch { return true; }
    for (const e of 항목들) {
      if (모음.size >= 관측상한) return false;
      const 상대 = 앞 ? `${앞}/${e.name}` : e.name;
      모음.add(상대);
      if (e.isDirectory() && !(await 걷기(join(자리, e.name), 상대))) return false;
    }
    return true;
  };
  return (await 걷기(뿌리, '')) ? 모음 : null;
}

/**
 * 실행 구간에 새로 생긴 것들(상대경로). **새 폴더는 그 폴더 한 줄로 접고 안 내려간다** —
 * `bulk_copy` 의 `to`(폴더)가 한 줄인 것과 같은 자리 계약이다(알갱이 선택이지 배치 결정 아님).
 * npm install 류의 대량 부산물이 이 접기로 한 줄(node_modules)이 된다.
 * 뜻은 「실행 구간에 새로 생겼다」까지다 — 이 명령이 만들었다고 단정하지 않는다.
 */
async function 새로생긴것들(뿌리, 전) {
  if (!전) return null;
  const 모음 = [];
  let 본수 = 0;
  const 걷기 = async (자리, 앞) => {
    let 항목들;
    try { 항목들 = await readdir(자리, { withFileTypes: true }); } catch { return true; }
    for (const e of 항목들) {
      if (++본수 > 관측상한) return false;
      const 상대 = 앞 ? `${앞}/${e.name}` : e.name;
      if (!전.has(상대)) { 모음.push(상대); continue; }          // 새 항목 — 폴더면 접는다
      if (e.isDirectory() && !(await 걷기(join(자리, e.name), 상대))) return false;
    }
    return true;
  };
  return (await 걷기(뿌리, '')) ? 모음.sort() : null;
}

export function makeLocalTerminalTool(deps = {}) {
  const run = deps.run ?? runCommand;
  // 기본 자리는 **사용자의 홈**이다. process.cwd() 는 서버를 띄운 자리라 사용자와 무관하고,
  // 거기가 빈 작업 폴더면 모델이 아무리 찾아도 안 나와서 결국 "경로를 알려줘"로 떠넘긴다(실측).
  // 쓰기는 커널이 막으므로 넓게 둘러보는 것 자체는 안전하다 — 좁혀야 할 이유가 없다.
  const cwdOf = () => deps.cwd ?? homedir();
  // 샌드박스 유무는 **주입 가능해야 한다** — 아니면 이 판정의 검사가 macOS 에서 영영
  // 건너뛰고(수리했는데 안 도는 검사), 정작 무는 자리는 리눅스다.
  const 샌드박스있나 = deps.sandboxAvailable ?? sandboxAvailable;

  /**
   * 계획 단계에서 부른다(실행 아님). 등급을 정할 사실을 만든다.
   * @returns {Promise<{command:string, cwd:string, probe:object, changes:boolean}>}
   */
  async function probe(command, opts = {}) {
    const risk = lifecycleRisk(command, { dataDir: deps.dataDir });
    if (risk) return { command, cwd: blank(opts.cwd) ?? cwdOf(), lifecycle: risk, changes: true };
    const cwd = blank(opts.cwd) ?? cwdOf();
    // ── **샌드박스가 없으면 탐침은 아무것도 증명하지 못한다** (상태 지도 §12-S2 · 2026-08-12) ──
    //
    // `runCommand` 는 `sandboxAvailable()` 이 false 면 모드와 무관하게 생 `/bin/zsh` 로 간다
    // (terminal-run.js:43). 그러면 쓰기·네트워크·시그널이 **아무것도 안 막힌 채 실제로 실행**되고,
    // 막힌 자국이 없으니 `looksBlocked` 가 false → `changes:false` → `read` → **자동**이 된다.
    // 즉 **샌드박스의 부재가 안전의 증거로 읽혔다.** 그 판을 여기서 끊는다.
    //
    // 오픈북(오픈클로 `docs/tools/exec.md:98-100`): *"sandboxing is off by default …
    // explicit host=sandbox **fails closed** instead of silently running on the gateway host …
    // Enable sandboxing or use host=gateway **with approvals**."*
    //   → 축 둘: ① 조용히 맨몸으로 돌지 않는다 ② 맨몸 경로는 **승인을 탄다**.
    // 우리 판으로 옮기면: 명령을 못 돌게 막지는 않되(리눅스에서 터미널이 통째로 죽는다),
    // **탐침이 「안 바꾼다」를 주장하지 못하게** 한다. 판정은 `unknown_kind` 로 떨어지고
    // 미상은 언제나 카드다(fail-closed) — 헌장의 「모르면 조여지는 쪽」 그대로다.
    //
    // 캡슐(capsule.js:105)은 같은 조건에서 아예 열기를 거부한다. 두 손이 같은 전제에 다른
    // 답을 내던 것도 여기서 정렬된다 — 터미널은 돌되 자동 자격을 못 얻는다.
    if (!샌드박스있나()) {
      return {
        command, cwd,
        샌드박스없음: true,
        // `changes` 를 참으로 세우지 않는다 — 그건 "바꾼다"는 **주장**이고 우리는 모른다.
        // 칸을 아예 안 만들면 `toolActionKind` 가 `unknown_kind`(카드)로 간다(action-plan.js:203).
        probe: { 못잼: 'sandbox_unavailable' },
      };
    }
    const r = await 재보기(run, command, { cwd, timeoutMs: opts.timeoutMs });
    // ── **「막혔다」와 「바꾸려 했다」는 다른 사실이다** (라이브 실측 2026-08-15 · §7-w) ──
    //
    // 오너: *"로그 폴더에 최근 에러 있는지 봐줘"* → 모델이 고른 명령은 아무것도 안 바꾸는
    // 읽기였는데(`find … 2>/dev/null | head`), 승인 카드가 **"내용을 남기거나 덮어쓰는
    // 일이라"**고 말했고 사용자는 답을 못 받았다. 같은 발화 2/2 재현.
    //
    // 방아쇠는 `Permission denied` 가 아니라 명령 안의 `2>/dev/null` 이다 — `실패를삼킴` 이
    // 물어 `unreadable_exit` 가 된다. 그 갈래가 말하는 것은 **"exit code 가 정보가 아니다"**,
    // 즉 **판정 불능**이지 "바꾼다"가 아니다. 도구 문장은 이미 정직했는데(`userWhy`),
    // 여기서 `looksBlocked` 로 뭉뚱그려 **모름을 주장으로 승격**했다.
    //
    // 위 :141(샌드박스 없음)이 이미 같은 판단을 했다 — *"`changes` 를 참으로 세우지 않는다"*.
    // 같은 규칙을 여기에도 균일하게 편다(특례 아님). 판정은 `unknown_kind` 로 떨어지고
    // **미상은 언제나 카드다** — 승인은 오히려 조여진다(미상에는 자동 탈출구가 없다).
    // 명령을 **명시로** 넘긴다 — `실패를삼킴` 은 구문 사실이라 명령 문자열이 있어야 물 수 있는데,
    // 실행기가 결과에 그 칸을 담아 줄지는 실행기 사정이다. 그 우연에 판정을 매달지 않는다.
    const 막힘 = executionBlock({ ...r, command: r?.command ?? command });
    const 막혔나 = 막힘?.kind === 'sandbox' || 막힘?.kind === 'permission';
    // ── **exit 0 도 주장이 아니다** (선빨강 2026-08-16 · `find … -delete`) ──────────
    //
    // `find` 는 `-delete` 가 **전부 막혀도 exit 0** 으로 끝난다. 그러면 `executionBlock` 이
    // 위에서 `if (r.exitCode === 0) return undefined` 로 빠져 나가고, 이 줄이 곧바로
    // **「안 바꾼다」를 주장**한다 — stderr 에 `unlink(./b.md): Operation not permitted` 가
    // 두 줄이나 있는데도. 그래서 지우는 명령이 카드 없이 지나가고, 아무것도 안 지워졌는데
    // 사용자는 **지웠다고 듣는다**(F-118 가족 · 거짓 보고).
    //
    // **새 규칙이 아니다.** 바로 위 :141(샌드박스 없음)과 아래 `판정불능` 이 이미 같은 말을
    // 하고 있고, 그 반대 방향은 이 저장소가 **이미 얼려 두었다** —
    // `test/read-denial-is-not-a-write-attempt.test.js:43`:
    //   *"「안 바꾼다」도 주장이다 — 자동으로 흘리지 않는다"*
    // 그 규칙이 **exit 0 갈래에만 안 닿아 있었다.** 실측이 그 비대칭을 그대로 보여 준다:
    //   읽기 거부 · exit≠0 → **카드**(얼린 계약)   읽기 거부 · exit 0 → 무카드
    //   쓰기 거부 · exit 0 → 무카드  ← 같은 자국인데 exit 하나로 대접이 갈렸다
    // 그래서 특례를 **더하는** 것이 아니라 **없앤다**. 자국이 있으면 모른다고 말한다.
    //
    // ⚠️ 자국을 **아예 안 남기고** 삼키는 명령은 여전히 `실패를삼킴`(구문 사실)에 기댄다.
    //    거기까지는 이 수리가 못 간다 — 그 한계를 적고 간다.
    if (!막혔나) {
      if (막음자국있나(r)) return { command, cwd, probe: r, 판정불능: 'unreadable_exit' };
      return { command, cwd, probe: r, changes: false };   // 자국도 없다 = 안 바꾼다
    }
    if (변경시도증거.has(막힘.why)) {
      return {
        command, cwd, probe: r, changes: true,
        ...(막힘.why === 'write' && 창조만인가(r, command, r?.cwd ?? cwd) ? { 창조만한다: true } : {}),
      };
    }
    return { command, cwd, probe: r, 판정불능: 막힘.why };
  }

  return {
    probe,
    /** 방금 돌린 명령이 다음 턴의 대상이다 — "아까 그 오류", "다시 돌려봐"가 여기서 이어진다. */
    subjectOf(rec) {
      const command = rec?.result?.command ?? rec?.actualCall?.args?.command;
      if (!command) return null;
      const code = rec.result?.exitCode;
      return {
        key: `cmd:${command}`, kind: 'command', label: String(command),
        detail: rec.result?.cwd, exitCode: code,
        failed: typeof code === 'number' && code !== 0,
      };
    },
    /** 승인 카드에 실릴 사실 — 명령 원문과 자리. 도구가 만든다(커널에 if 를 늘리지 않는다). */
    previewOf(args = {}) {
      const command = String(args.command ?? '').trim();
      if (!command) return undefined;
      const block = executionBlock(args.probeResult);
      return {
        impact: `${command}`,
        scope: `${blank(args.cwd) ?? cwdOf()} 에서`,
        duration: '이번 한 번',
        // P0-c: 승인 전에 **무엇이 이미 확인됐는지.** 카드와 영수증이 같은 사실을 말해야 한다 —
        // probe 결과를 받은 카드는 그 명령이 이미 한 번(변경 차단 상태로) 돌았다는 뜻이다.
        ...(args.probeResult ? { checked: '바꾸는 걸 막아 둔 채 한 번 시험해 봤어요 — 지금까지 바뀐 건 없어요.' } : {}),
        cancel: (block?.kind === 'sandbox' || block?.kind === 'permission') ? `${block.userWhy} — 실제로 하면 되돌리기 어려울 수 있어요`
          : '실행한 뒤에는 되돌리기 어려울 수 있어요',
      };
    },
    async handler(args = {}) {
      const command = String(args.command ?? '').trim();
      if (!command) {
        return { blocked: true, userSafeSummary: '무엇을 실행할지 알려주세요.',
          nextSafeAction: '하려는 일을 말씀해 주시면 제가 명령을 만들어 볼게요.' };
      }
      // 자기보존은 커널 경계와 **별도**다 — 샌드박스는 파일 쓰기를 막지 시그널을 못 막는다.
      // T5 가 자기를 끄면 껐다는 말을 할 주체가 사라진다(승인 카드도 원장도 못 남긴다).
      //
      // **두 종류를 가른다.** 자기보존(자기 프로세스·자기 기억)은 승인해도 하지 않는다.
      // 그런데 `approvable` 한 것 — 남의 프로그램을 끄는 일 — 은 사용자가 시킨 일이고,
      // 승인하면 **실제로 해야 한다.** 둘을 섞으면 승인을 눌러도 아무 일이 안 난다
      // (실측 2026-07-28: 승인 카드가 두 번 뜨고 대상은 끝내 안 꺼졌다).
      const risk = lifecycleRisk(command, { dataDir: deps.dataDir });
      if (risk && !(risk.approvable && args.granted)) {
        return { blocked: true, lifecycleBlocked: true, ...lifecycleMessage(risk) };
      }

      const cwd = blank(args.cwd) ?? cwdOf();
      // 작업 자리 자체가 보호 영역이면 아예 시작하지 않는다(커널도 막지만 여기서 사람 말로 먼저 답한다).
      const prot = protectionFor(cwd);
      if (prot?.kind === 'secret') {
        return { blocked: true, scopeState: 'protected',
          userSafeSummary: `그 자리에서는 실행하지 않아요 — ${prot.why}.`,
          nextSafeAction: '작업 폴더를 알려주시면 거기서 할게요.' };
      }

      // 이미 계획 단계에서 probe 를 했고 승인을 받았으면 granted 로 실제 실행한다.
      const mode = args.granted ? 'granted' : 'probe';
      // ── 터미널 산출물의 자리 관측(§7-bq · 오너 승인 2026-08-16) ──────────────────
      //
      // 실행이 디스크에 만든 것의 **경로**가 원장에 안 남아, 모델이 자기 산출물의 자리를
      // 다음 판단에서 못 받았다(§7-bp ④ R3 실물 — 실행이 만든 것의 자리를 원장이 모른다).
      // granted 로 실제 도는 실행에만 건다 — probe/reach 는 쓰기가 닫혀 있어(기계 칸
      // `sandboxed`·`probeChangedNothing`) 안 돈 것의 창조물을 관측하면 그 줄이 거짓이 된다.
      //
      // 실행 전/후 cwd 의 이름 집합을 재귀로 훑어 diff 한다. 명령 이름 목록이 아니라 구조
      // 사실이다(sandbox.js 첫 문단 — 목록은 항상 뚫린다). 칸의 뜻은 「실행 구간에 새로
      // 생겼다」까지다 — 인과를 단정하지 않는다(커널은 손이 가져온 것을 적는다).
      const 관측 = mode === 'granted' ? await 이름집합(cwd) : null;
      // 계획 단계에서 돌린 결과가 오면 **그대로 쓴다.** 같은 명령을 두 번 돌리면 `date`·`ls` 처럼
      // 답이 달라지는 것에서 승인 카드에 보인 것과 실제 결과가 갈라진다.
      const r = mode === 'granted'
        ? await run(command, { mode, cwd, timeoutMs: args.timeoutMs })
        : (args.probeResult ?? await 재보기(run, command, { cwd, timeoutMs: args.timeoutMs }));
      // **실제로 어느 모드가 답을 냈는가.** `reach` 로 돈 명령은 진짜로 실행된 것이다
      // (네트워크가 실제로 나갔다) — 그걸 "확인만 했어요"라고 말하면 원장이 거짓이 된다.
      // 실행기가 결과에 `mode` 를 실어 주므로 지어내지 않고 그 사실을 읽는다.
      const 실제모드 = r?.mode ?? mode;
      const 실제로돌았나 = 실제모드 === 'granted' || 실제모드 === 'reach';

      if (mode === 'probe' && looksBlocked(r)) {
        // **여기서 실행하지 않는다.** 승인은 커널의 일이고, 도구는 사실만 돌려준다.
        const block = executionBlock(r);
        return {
          blocked: true, needsGrant: true,
          result: {
            command, cwd,
            // **막힌 이유를 사실로 남긴다.** 이게 없으면 모델이 "테스트가 실패했다"고 단정한다
            // (실측: npm test 가 EPERM listen 으로 죽었는데 코드 문제인 줄 알았다).
            blockedBy: block?.kind, blockReason: block?.why,
            probe: { exitCode: r.exitCode, stderr: r.stderr },
            // P0-c(QA90 감사 2026-08-02): 등급을 매기려면 **먼저 돌려 봐야 한다**(sandbox.js 의
            // 설계 — 위험을 알아맞히지 않고 커널에게 물어본다). 그래서 카드가 뜨는 시점에는
            // 이미 한 번 실행된 뒤다. 실행 자체는 계약대로지만 그 사실이 사용자에게도 원장에도
            // 없었다 — "아직 실제로 하진 않았어요" 한 줄이 전부였고, 사용자는 아무 일도 없었다고
            // 읽는다. 능력은 그대로 두고(오너 결정 2026-08-02) **사실을 기계 칸으로 남긴다.**
            // 무엇을 말할지는 모델이 정한다(§24) — 여기서 문구를 처방하지 않는다.
            probeRan: true,
            probeChangedNothing: true,   // 커널이 막아서 증명된 것: 이 컴퓨터는 안 바뀌었다
          },
          // ── **실패의 기계 원문을 그 칸에 넣는다**(기본 ③ · 2026-08-14) ──────────────
          //
          // `실패원문칸`(task-context.js §5-3 a)은 헤르메스의 「실패 원문 2,000자」 축을
          // 이미 흡수해 놓았다. 그런데 그 칸이 읽는 것은 `diagnosticTrace` 하나인데
          // **이 갈래가 그 칸을 안 세웠다** — 그래서 축은 흡수됐는데 터미널에서만 안 돌았고,
          // 모델은 막힌 호출에서 `{확인안됨:true}` 만 받았다(실측 원문: 상태 토큰 한 줄이 전부).
          //
          // 여기 담는 것은 **판정이 아니라 우리가 돌려 보고 받은 사실**이다: 어떤 코드로
          // 끝났고, 셸이 뭐라고 했고, 무엇이 막았는가. 사람말 요약(`describeCommand`)은
          // 그대로 두 손 위에 남는다 — 사용자면과 진단면을 섞지 않는 계약(§7)은 그대로다.
          // 이 칸은 **모델 입력에만 산다**(turn.js 결과 조립이 저장 봉투에서 걷는다).
          diagnosticTrace: {
            blockedBy: block?.kind, blockReason: block?.why,
            exitCode: r?.exitCode, stderr: r?.stderr, stdout: r?.stdout,
            probeChangedNothing: true,
          },
          // `describeCommand` 가 이미 "확인만 받으면 바로 실행해요 — 미리 시험해 봤고 아직
          // 아무것도 안 바뀌었어요"를 말한다. 여기서 같은 말을 다시 붙이면 한 문장이 두 번
          // 말하는 답이 되고, 그 중복이 "정말 아무 것도 안 됐구나"로 읽힌다(실측).
          userSafeSummary: describeCommand(command, r),
          nextSafeAction: '이대로 진행할까요?',
        };
      }

      const 끝난이유 = executionBlock(r);
      // **끈 것은 그 PID 로 확인한다.** 실측(오너 라이브 2026-07-29): 대상이 실제로 죽었는데
      // T5 가 `pgrep -af '<이름>'` 으로 확인하려다 **그 명령을 실행하는 셸 자신**을 후보로 잡아
      // "바로 다시 살아났어요"라고 보고하고 부모·launchd 까지 조사하겠다고 했다.
      //   실제 상태 종료 · 원장 해석 생존 · 사용자 보고 재실행 · 다음 제안 더 강한 조사
      // A~H 공통 계약(실행 결과·원장·답변이 같은 사실을 본다) 위반이라 여기서 사실을 못 박는다.
      //
      // 이름 패턴이 아니라 **승인받은 명령에 적힌 정확한 PID**를 본다. 판정하지 않고 사실만
      // 낸다 — 무엇을 말할지는 모델이 정한다(§24). 능력을 줄이지 않는다: 터미널은 그대로다.
      const 끈PID = 실제모드 === 'granted' && /\b(kill|pkill|killall)\b/.test(command)
        ? [...new Set((command.match(/\b\d{2,}\b/g) ?? []).map(Number))].filter((n) => n > 0)
        : [];
      const 종료확인 = 끈PID.length
        ? 끈PID.map((pid) => ({ pid, stillRunning: alive(pid) }))
        : undefined;
      // ── **못 한 이유를 말했으면 이어갈 자리도 준다**(라이브 실측 2026-08-13) ──────────
      //
      // 없는 작업 폴더 때문에 아무것도 안 돌았을 때, 영수증에는 못 돈 사실만 있고 `다음수단` 은
      // 비어 있었다. 그런데 **이 손은 자기가 아는 자리를 갖고 있다**(`cwdOf()`) — 답을 쥔 채로
      // 안 준 것이다. 모델은 같은 잘못된 자리로 세 번 더 갔고 과업이 통째로 실패했다.
      //
      // **강제가 아니라 유도다.** "이 자리를 써라"가 아니라 *이 손이 아는 자리는 여기다* 라는
      // 사실 하나를 눈에 띄게 놓는다. 어디서 다시 할지는 모델이 고른다(§24) — 커널이 대신
      // 고르면 모델은 그만큼 판단을 안 한다.
      const 기본자리 = cwdOf();
      const 다음수단 = 끝난이유?.why === 'cwd_missing' && 기본자리 !== cwd
        ? [{ 방법: 'run', cwd: 기본자리, 왜: `이 손이 아는 자리 — 방금 쓴 ${cwd} 는 이 컴퓨터에 없다` }]
        : undefined;
      // §7-bq — 실행 구간에 새로 생긴 것의 자리(사실 공급). granted 로 실제 돈 실행에서만
      // 잰다(위 관측이 그때만 선다). 못 쟀으면(null) 아무 주장도 안 싣는다.
      const 생긴것 = 관측 && 실제모드 === 'granted' ? await 새로생긴것들(cwd, 관측) : null;
      return {
        result: {
          command, cwd, exitCode: r.exitCode, durationMs: r.durationMs,
          // 끈 대상의 **지금 상태**. 이름 검색 결과가 아니라 PID 로 직접 확인한 사실이다.
          ...(종료확인 ? { terminated: 종료확인 } : {}),
          stdout: r.stdout, stderr: r.stderr,
          // 코드 실패 / 실행 환경 / 샌드박스 차단을 구분해 남긴다(섞으면 사용자가 잘못 판단한다).
          ...(끝난이유 ? { failedBy: 끝난이유.kind, failReason: 끝난이유.why } : {}),
          // 결과 안에 싣는다 — 성공 갈래의 영수증은 손의 바깥 칸을 안 옮기고 `result` 만
          // 옮긴다(tool-runner). 여기 두어야 모델 입력(compactResult)까지 실제로 닿는다.
          ...(다음수단 ? { 다음수단 } : {}),
          // 실행 구간에 새로 생긴 것들(상대경로 · cwd 기준) — 커널이 산출물 자리로 잇는다(§7-bq).
          ...(생긴것?.length ? { 새로생긴것들: 생긴것 } : {}),
          ...(r.truncated ? { truncated: true, omittedChars: r.omittedChars } : {}),
          ...(r.stopped ? { stopped: r.stopped } : {}),
          applied: 실제로돌았나,
          // ── F-118 · 성공한 probe 관측이 원장에서 「추정」으로 분류됐다 ─────────────────
          //
          // A0 계약(파일 머리)은 "probe 성공 = 아무것도 안 바꿨다는 증명. 그대로 답한다"인데,
          // applied:false 만 실으니 확인된사실(ledger.js)이 떨어져 그 관측이
          // "호출 없이 모델 지식으로만 답한 경우"(estimated)로 갔다 — 제품이 그 결과로
          // 답하면서 원장은 그 근거를 추정이라 적는, 한 제품 두 진실.
          //
          // applied 의 뜻(변경이 실렸나)은 그대로다 — 뒤집으면 2026-08-03(실패 삼킨 쓰기가
          // confirmed) 재개봉. 대신 막힌 갈래(:237)가 이미 쓰는 칸을 성공 갈래에도 싣는다.
          // 발동 조건은 mode 라벨이 아니라 **실행기가 증명한 sandboxed** 다(terminal-run.js) —
          // 샌드박스 없는 호스트에선 probe 라벨로도 생 zsh 가 돌아서, 라벨로 걸면
          // 실제로 바꾼 명령이 「변경 없이 확인」으로 선다(손 관리자·감시자 동시 지적).
          ...(실제모드 === 'probe' && r?.sandboxed === true ? { probeChangedNothing: true } : {}),
        },
        // 못 한 것을 한 척하지 않는다 — exit code 를 그대로 말한다.
        // 끈 대상이 있으면 **그 사실을 먼저** 말한다(이름 검색으로 다시 헷갈리지 않게).
        userSafeSummary: 종료확인?.length && r.exitCode === 0
          ? (종료확인.every((x) => !x.stillRunning)
            ? `껐어요 — ${종료확인.map((x) => x.pid).join(', ')} 는 지금 없어요.`
            : `일부는 아직 돌고 있어요 — 남은 것: ${종료확인.filter((x) => x.stillRunning).map((x) => x.pid).join(', ')}.`)
          : r.stopped === 'timeout'
          ? `시간이 다 돼서 멈췄어요(${Math.round((args.timeoutMs ?? 120000) / 1000)}초).`
          // **확인한 것을 했다고 말하지 않는다**(오너 지적 2026-08-03 · 메모리·맥락의 뿌리).
          // `probe` 는 쓰기가 막힌 채 도는 **확인**이다. 그런데 exit 0 이면 여기서 그대로
          // "실행했어요"라고 말했다 — 명령이 `2>/dev/null || true` 로 실패를 삼키면 exit 0 이
          // 나오므로, 아무것도 안 바뀐 채 원장에 `실행했어요 · failureState:none` 이 남았다
          // (헤르메스 대조 실측: 디스크는 그대로였고 모델은 그 거짓 기록 위에서 판단했다).
          // **원장이 거짓이면 셀프후드도 말귀도 그 위에 못 선다.** `applied` 라는 기계 사실이
          // 이미 result 에 있었는데 문장이 그것을 안 봤다.
          // `reach` 로 돈 것은 **실제로 실행된 것**이다(네트워크가 나갔다). 다만 이 컴퓨터는
          // 하나도 안 바뀌었다 — 쓰기·비밀·시그널은 reach 에서도 닫혀 있다. 둘 다 사실이므로
          // 둘 다 말한다. 어느 쪽을 강조할지는 모델이 정한다(§24).
          : r.exitCode === 0 ? (실제모드 === 'granted' ? '실행했어요.'
            : 실제모드 === 'reach' ? '실행했어요 — 바깥에서 읽어 온 것이고 이 컴퓨터는 바뀐 게 없어요.'
              : '확인만 했어요 — 아직 아무것도 바꾸지 않았어요.')
            // **샌드박스가 막은 것을 "실패"라고 말하지 않는다.** 코드 문제가 아니다.
            : (끝난이유?.kind === 'sandbox' || 끝난이유?.kind === 'permission') ? `${끝난이유.userWhy} — 코드 문제가 아니에요.`
              : 끝난이유?.kind === 'env' ? `${끝난이유.userWhy}`
                : `실행했는데 오류로 끝났어요(코드 ${r.exitCode}).`,
      };
    },
  };
}
