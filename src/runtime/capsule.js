// L3 · **캡슐** (S4) — 모델이 쓴 짧은 스크립트가 T5 의 손을 RPC 로 부른다.
//
// 정본: `design/T5-MODEL-SOVEREIGNTY-DEVELOPMENT-PLAN-2026-08-04-ko.md` §S4
// 계획: `design/S4-CAPSULE-PLAN-ko.md`
//
// ── 무엇을 위한 물건인가 (계약을 다시 본 뒤) ────────────────────────────────
// 정본의 원래 동기는 "437개가 한 턴에 돈다"였다. **그건 이미 된다** — S1 재실행에서 모델이
// `bulk_move` 조건으로 274~426개를 한 턴에 처리했다(2026-08-04). 그러니 그걸 S4 의 성공
// 조건으로 쓰면 이미 참인 것을 다시 증명하는 일이 된다.
//
// 캡슐이 아직 사는 이유는 하나로 좁혀진다: **읽기 결과가 다음 조건이 되는 일.**
// "각 CSV 를 읽어 합계가 100만 넘는 것만 옮겨" 는 `match` 로 표현되지 않는다. 지금은 파일
// 100개 본문이 전부 모델 입력을 지나야 하고(문이 있어도 양 자체는 안 준다), 조건을 못 쓰는
// 반복은 호출당 왕복 하나다.
//
// ── 왜 이렇게 좁은가 (Hermes 대조) ──────────────────────────────────────────
// Hermes `execute_code` 는 자식 프로세스 + RPC 뿐이고 **OS 커널 격리가 없다**
// (`sandbox-exec`·`bwrap`·`nsjail`·`setrlimit` 전수 grep 0, 2026-08-04). 게다가 허용 도구에
// **`terminal` 이 있다** — 스크립트가 셸을 부를 수 있으니 그 안에서 하는 일은 에이전트의
// 승인 경계를 지나지 않는다. 정본이 지목한 "헌장 우회" 사고가 여기서 구조적으로 난다.
//
// T5 는 반대로 간다. **캡슐은 파일시스템을 아예 못 만진다.**
//   · 새 격리 수단을 도입하지 않는다 — T5 에는 이미 `sandbox-exec`(SBPL) 커널 경계가 있다.
//     쓰기·네트워크·시그널·AppleEvent·비밀 읽기가 전부 커널에서 닫힌다. 런타임 의존성 0 유지.
//   · 모든 효과는 **RPC 로 T5 의 손을 지난다.** 그래서 기존 Authority·ToolReceipt·원장·
//     되돌리기가 그대로 선다 — 캡슐을 위한 두 번째 안전 체계를 만들지 않는다.
//   · 좁아서 **증명할 수 있다**(§S4 여섯 성질 반대시험).
//
// ── RPC 를 왜 파일로 하나 ───────────────────────────────────────────────────
// 네트워크가 커널에서 막혀 UDS 를 쓸 수 없다. Hermes 도 원격 백엔드에서 같은 이유로 파일
// RPC 를 쓴다(원리 흡수). scratch 자리는 이번 실행에만 있고 끝나면 지워진다.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, readdir, realpath, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxProfile, sandboxAvailable } from './sandbox.js';
import { wireToolName } from './model-provider.js';
import { redactEnv } from './terminal-run.js';

/**
 * 캡슐 상한 — **잠정 동결값**. Hermes(300s·50호출·50KB) 와 OpenClaw code-mode 를 대조해 정했다.
 *
 *   시간 60s   턴 벽시계 예산이 180s 다(§S3). 캡슐 하나가 그 3분의 1을 넘으면 사용자가 기다린다.
 *   호출 200   파일 이동은 호출당 수 ms. 되돌릴 수 있는 것 뒷단(200, §S3)과 같은 값으로 맞춘다.
 *   출력 16KB  결과는 요약이지 덤프가 아니다 — 모델 입력 상한 1,200자 실측과 같은 사고.
 *
 * 실측 회차 뒤에 다시 정한다. 값을 코드에 못 박지 않고 인자로 덮을 수 있게 둔다.
 */
export function 캡슐상한(덮기 = {}) {
  return { 시간ms: 60_000, 호출: 200, 출력바이트: 16_000, ...덮기 };
}

/** 캡슐이 부를 수 있는 손 — **통제 채널은 절대 안 준다**(self-grant 차단, 성질 ⑥). */
const 통제채널 = new Set([
  'work.state', 'work.deliverable', 'work.current_actions',
  'memory.propose', 'memory.withdraw', 'memory.cite', 'memory.correct',
  'skill.propose', 'automation.propose', 'agent.propose', 'agent.delegate',
]);

/** 캡슐 안에서 도는 손잡이. **여기 있는 것이 표면의 전부다** — 셸도 fs 도 없다. */
const 캡슐머리 = `
'use strict';
const fs = require('node:fs');
const 요청자리 = process.env.T5_CAPSULE_REQ;
const 응답자리 = process.env.T5_CAPSULE_RES;
let 일련 = 0;
const t5 = {
  async call(tool, args) {
    일련 += 1;
    const id = String(일련);
    fs.writeFileSync(요청자리 + '/' + id + '.json', JSON.stringify({ id, tool, args: args ?? {} }));
    const 끝 = Date.now() + 60000;
    while (Date.now() < 끝) {
      try { return JSON.parse(fs.readFileSync(응답자리 + '/' + id + '.json', 'utf8')); }
      catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); }
    }
    return { ok: false, error: '응답 없음' };
  },
};
(async () => {
`;
const 캡슐꼬리 = `
})().catch((e) => { console.error(String(e && e.message ? e.message : e)); process.exitCode = 1; });
`;

/**
 * 캡슐 한 번 실행.
 *
 * @param {Object} p
 * @param {string} p.코드            모델이 쓴 스크립트(본문만 — 머리·꼬리는 여기서 붙인다)
 * @param {Object} p.tools           ToolRunner
 * @param {Object} p.selfState
 * @param {string} p.cwd             작업 폴더(손이 쓰는 자리 — 캡슐은 여기도 직접 못 만진다)
 * @param {string[]} [p.허용손]      RPC 로 열 손. 안 주면 아무 것도 못 부른다(모르면 막는다)
 * @param {Object} [p.상한]
 * @param {Function} [p.샌드박스가능] 주입용(검사)
 */
export async function 캡슐실행({
  코드, tools, selfState, cwd, 허용손 = [], 상한: 상한덮기 = {}, env, 샌드박스가능 = sandboxAvailable,
}) {
  const 상한 = 캡슐상한(상한덮기);
  // **커널 격리가 없으면 열지 않는다.** 없는 능력을 있는 척하지 않는다 —
  // 프로세스 경계만으로 "샌드박스"라 부르는 것이 비교군의 실제 구멍이었다.
  if (!샌드박스가능()) {
    return { ok: false, 멈춘이유: '이 컴퓨터에서는 커널 격리(샌드박스)를 쓸 수 없어 캡슐을 열지 않았어요.', 영수증: [] };
  }

  const 뿌리 = await mkdtemp(join(tmpdir(), 'gpao-t5-capsule-'));
  const scratch = await realpath(await mkdir(join(뿌리, 'scratch')).then(() => join(뿌리, 'scratch')));
  const 요청 = join(scratch, 'req');
  const 응답 = join(scratch, 'res');
  await mkdir(요청, { recursive: true });
  await mkdir(응답, { recursive: true });
  const 본문 = join(scratch, 'main.js');
  await writeFile(본문, 캡슐머리 + String(코드 ?? '') + 캡슐꼬리, 'utf8');

  const 프로파일 = join(뿌리, 'p.sb');
  // **캡슐 프로파일** = probe(쓰기 0·네트워크 0·시그널 0·AppleEvent 0·비밀 0) + **프로세스 생성 0**.
  // scratch 만 쓰기가 열린다 — RPC 파일이 거기 있다. 사용자 자리는 캡슐에게 안 열린다.
  await writeFile(프로파일, sandboxProfile('capsule', { scratch, runtime: process.execPath }), 'utf8');

  const 영수증 = [];
  let 멈춘이유;
  let out = ''; let err = '';
  const 열린손 = new Set(허용손.filter((id) => !통제채널.has(id)));

  const child = spawn('/usr/bin/sandbox-exec',
    ['-f', 프로파일, process.execPath, 본문], {
      cwd: scratch,
      env: {
        ...redactEnv(env ?? process.env),
        GPAO_T5_IN_TOOL: '1',
        T5_CAPSULE_REQ: 요청, T5_CAPSULE_RES: 응답,
        TMPDIR: scratch, TMP: scratch, TEMP: scratch,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  child.stdout.on('data', (d) => { if (out.length < 상한.출력바이트) out += d; });
  child.stderr.on('data', (d) => { if (err.length < 상한.출력바이트) err += d; });

  // ── RPC 펌프 — **여기가 유일한 문이다** ────────────────────────────────────
  // 요청 파일이 오면 기존 실행 경로(`tools.run`)로 그대로 보낸다. 캡슐을 위한 두 번째
  // 실행 경로를 만들지 않는다 — 그러면 승인·영수증·되돌리기가 두 벌이 되고 언젠가 갈린다.
  let 살아있나 = true;
  const 처리한것 = new Set();
  const 펌프 = (async () => {
    while (살아있나) {
      let 목록 = [];
      try { 목록 = await readdir(요청); } catch { /* 아직 없다 */ }
      for (const f of 목록.sort()) {
        if (처리한것.has(f)) continue;
        처리한것.add(f);
        let 요청값;
        try { 요청값 = JSON.parse(await readFile(join(요청, f), 'utf8')); } catch { continue; }
        const 답 = await 한번부르기(요청값);
        await writeFile(join(응답, `${요청값.id}.json`), JSON.stringify(답), 'utf8').catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  })();

  async function 한번부르기({ tool: 부른이름, args }) {
    // **와이어 이름도 받는다.** 모델은 도구를 `local_file` 로 본다(점이 안 되는 provider 때문에
    // `wireToolName` 이 바꾼다) — 그래서 스크립트에도 그 이름을 쓴다. 캡슐만 `local.file` 을
    // 요구하면 모델이 매번 헛손질하고, 실측(2026-08-04 라이브)에서 정확히 그랬다:
    // 다섯 번 재시도했고 매번 호출 0이었다. **이름이 두 벌인 것은 우리 사정이지 모델 잘못이 아니다.**
    const tool = 열린손.has(부른이름)
      ? 부른이름
      : ([...열린손].find((id) => wireToolName(id) === 부른이름) ?? 부른이름);
    if (통제채널.has(tool) || [...통제채널].some((id) => wireToolName(id) === 부른이름)) {
      // 성질 ⑥ — 캡슐이 자기 권한·기억·자동화를 건드리지 못한다. 와이어 이름으로도 막는다.
      return { ok: false, error: '그 채널은 캡슐에서 부를 수 없어요(권한·기억·자동화는 캡슐 밖의 일이에요).' };
    }
    if (!열린손.has(tool)) {
      return { ok: false, error: `허용하지 않은 손이에요: ${tool}` };
    }
    if (영수증.length >= 상한.호출) {
      멈춘이유 = 멈춘이유 ?? `한 캡슐에서 부를 수 있는 손을 다 썼어요(${상한.호출}번).`;
      return { ok: false, error: '이 캡슐의 호출 한도를 다 썼어요.' };
    }
    const rec = await tools.run(tool, args ?? {}, selfState, { currentRequest: '캡슐 실행' });
    영수증.push(rec);
    const 됐나 = (rec?.failureState ?? 'none') === 'none';
    return {
      ok: 됐나,
      summary: rec?.userSafeSummary,
      ...(됐나 ? { result: rec?.result } : { error: rec?.userSafeSummary, next: rec?.nextSafeAction }),
    };
  }

  const 시계 = setTimeout(() => {
    멈춘이유 = `시간이 다 돼서 멈췄어요(${Math.round(상한.시간ms / 1000)}초).`;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 1000).unref();
  }, 상한.시간ms);

  const exitCode = await new Promise((res) => {
    child.on('error', (e) => { 멈춘이유 = 멈춘이유 ?? `캡슐을 시작하지 못했어요: ${e.message}`; res(-1); });
    child.on('close', (c) => res(c ?? -1));
  });
  clearTimeout(시계);
  살아있나 = false;
  await 펌프.catch(() => {});
  await rm(뿌리, { recursive: true, force: true });

  return {
    ok: exitCode === 0 && !멈춘이유,
    exitCode,
    stdout: out.slice(0, 상한.출력바이트),
    stderr: err.slice(0, 상한.출력바이트),
    영수증,
    ...(멈춘이유 ? { 멈춘이유 } : {}),
  };
}

/**
 * 캡슐을 **T5 의 손**으로 세운다. 격리만 있고 모델이 못 쓰면 의미가 없다.
 *
 * `toolKind: 'organize'` · `reversible: true` — 캡슐 자체는 아무것도 안 바꾼다.
 * 실제 변경은 전부 RPC 로 부른 손이 하고, **그 손의 등급이 그대로 선다**(헌장 상속).
 *
 * @param {{cwd:string, 허용손?:string[], 상한?:object}} 설정
 */
export function makeCapsuleTool(설정 = {}) {
  return {
    toolKind: 'organize',
    reversible: true,
    /** 캡슐은 자기 자신이 승인 대상이 아니다 — 안에서 부른 손이 각자 판정을 탄다. */
    async approvalEligibility() { return { allowed: true }; },
    async handler(args = {}, 문맥 = {}) {
      const 결과 = await 캡슐실행({
        코드: String(args.code ?? ''),
        tools: 문맥.tools ?? 설정.tools,
        selfState: 문맥.selfState ?? 설정.selfState,
        cwd: 설정.cwd ?? 문맥.cwd ?? process.cwd(),
        허용손: 설정.허용손 ?? ['local.file'],
        상한: 설정.상한 ?? {},
      });
      if (!결과.ok) {
        return {
          blocked: true,
          userSafeSummary: 결과.멈춘이유
            ?? `스크립트가 오류로 끝났어요.${결과.stderr?.trim() ? ` ${결과.stderr.trim().slice(0, 300)}` : ''}`,
          nextSafeAction: '조건을 좁혀 다시 해볼까요?',
          diagnosticTrace: { exitCode: 결과.exitCode, stderr: 결과.stderr?.slice(0, 500) },
        };
      }
      const 실행수 = (결과.영수증 ?? []).length;
      // 실제로 **바꾼** 호출이 몇 번인가. 읽기만 한 것과 구분한다 — 섞으면 "처리했어요"가
      // 아무것도 안 바꾼 실행에도 붙는다.
      const 바뀐것 = (결과.영수증 ?? []).filter((r) => (r?.failureState ?? 'none') === 'none'
        && !['read', 'list', 'versions'].includes(r?.actualCall?.args?.action)).length;
      return {
        result: {
          // **결과만 온다.** 중간에 읽은 본문은 여기 없다 — 그게 캡슐이 사는 이유다.
          output: 결과.stdout,
          calls: 실행수,
          // 캡슐 안에서 무엇을 했는지 **사실로** 남긴다(요약이지 덤프가 아니다).
          did: (결과.영수증 ?? []).map((r) => r.userSafeSummary).filter(Boolean).slice(0, 20),
          // 원장용 사실. 모델 입력에는 위 `did` 요약만 가고 이건 안 간다(덤프 금지).
          innerReceipts: 결과.영수증,
        },
        // **바뀐 게 없으면 없다고 말한다**(정직한 0 — S3 와 같은 계약). 실측(2026-08-04
        // 라이브): 스크립트가 응답 모양을 잘못 읽어 빈 배열을 받고 아무것도 안 옮겼는데
        // 요약은 "1번 처리했어요"였고, 모델은 그 위에서 "옮겼다"고 답했다. 거짓 완료다.
        userSafeSummary: 실행수 === 0
          // **왜 아무 일도 안 났는지 말한다.** 실측(2026-08-04 라이브): 스크립트가 조용히
          // 끝나 호출 0·출력 0 이었는데 모델은 이유를 못 받아 "옮겼다"고 답했다.
          // 도구가 이유를 안 주면 모델은 이유를 지어낸다 — 파일 손에서 이미 겪은 병이다.
          ? `스크립트를 돌렸는데 손은 한 번도 쓰지 않았어요.${결과.stderr?.trim() ? ` 스크립트가 낸 오류: ${결과.stderr.trim().slice(0, 300)}` : ''}`
            + `${!결과.stderr?.trim() && !결과.stdout?.trim() ? ' (출력도 없어요 — 함수를 정의만 하고 부르지 않았거나 조건이 하나도 안 맞았을 수 있어요.)' : ''}`
          : 바뀐것 === 0
            ? `스크립트로 ${실행수}번 불렀는데 읽기만 했고 바뀐 것은 없어요.`
            : `스크립트로 ${실행수}번 처리했어요(그중 ${바뀐것}번이 실제로 바꿨어요).`,
      };
    },
  };
}
