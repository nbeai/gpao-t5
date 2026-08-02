// L3 · 터미널 도구 (P6-T2) — 실행기(terminal-run.js)를 T5 의 손으로 붙인다.
//
// 승인 흐름이 다른 도구와 다른 점: **등급을 실행 전에 알 수 없다.**
// `local.file` 은 action 만 보면 읽기인지 삭제인지 알지만, 명령은 돌려 봐야 안다.
// 그래서 계획 단계에서 **probe** 를 먼저 돌린다 — 쓰기·네트워크·비밀읽기가 막힌 상태라
// 승인 없이 돌려도 아무 영향이 없다(그래서 이게 안전하다). 그 결과가 등급을 정한다:
//   · probe 성공  → 아무것도 안 바꿨다는 증명. 그대로 답한다(A0).
//   · probe 막힘  → 바꾸려 했다는 뜻. 승인 카드로 간다(A2). 승인 뒤 granted 로 다시 돌린다.
import { runCommand, executionBlock } from './terminal-run.js';
import { protectionFor } from './local-protection.js';
import { lifecycleRisk, lifecycleMessage } from './lifecycle-guard.js';
import { homedir } from 'node:os';
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
function looksBlocked(r) {
  const block = executionBlock(r);
  return block?.kind === 'sandbox' || block?.kind === 'permission';
}

/** 명령이 지금 이 자리에서 무엇을 하려 하는지 사용자 말로. 승인 카드에 실린다. */
export function describeCommand(command, probe) {
  const block = executionBlock(probe);
  if (!block || (block.kind !== 'sandbox' && block.kind !== 'permission')) return `\`${command}\` 실행`;
  return `\`${command}\` — ${block.userWhy}`;
}

export function makeLocalTerminalTool(deps = {}) {
  const run = deps.run ?? runCommand;
  // 기본 자리는 **사용자의 홈**이다. process.cwd() 는 서버를 띄운 자리라 사용자와 무관하고,
  // 거기가 빈 작업 폴더면 모델이 아무리 찾아도 안 나와서 결국 "경로를 알려줘"로 떠넘긴다(실측).
  // 쓰기는 커널이 막으므로 넓게 둘러보는 것 자체는 안전하다 — 좁혀야 할 이유가 없다.
  const cwdOf = () => deps.cwd ?? homedir();

  /**
   * 계획 단계에서 부른다(실행 아님). 등급을 정할 사실을 만든다.
   * @returns {Promise<{command:string, cwd:string, probe:object, changes:boolean}>}
   */
  async function probe(command, opts = {}) {
    const risk = lifecycleRisk(command, { dataDir: deps.dataDir });
    if (risk) return { command, cwd: blank(opts.cwd) ?? cwdOf(), lifecycle: risk, changes: true };
    const cwd = blank(opts.cwd) ?? cwdOf();
    const r = await run(String(command ?? ''), { mode: 'probe', cwd, timeoutMs: opts.timeoutMs });
    return { command, cwd, probe: r, changes: looksBlocked(r) };
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
      // 계획 단계에서 돌린 결과가 오면 **그대로 쓴다.** 같은 명령을 두 번 돌리면 `date`·`ls` 처럼
      // 답이 달라지는 것에서 승인 카드에 보인 것과 실제 결과가 갈라진다.
      const r = (mode === 'probe' && args.probeResult)
        ? args.probeResult
        : await run(command, { mode, cwd, timeoutMs: args.timeoutMs });

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
          userSafeSummary: `${describeCommand(command, r)} — 바꾸는 걸 막아 둔 채 한 번 시험해 봤고,`
            + ' 이 컴퓨터는 아직 아무것도 바뀌지 않았어요.',
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
      const 끈PID = mode === 'granted' && /\b(kill|pkill|killall)\b/.test(command)
        ? [...new Set((command.match(/\b\d{2,}\b/g) ?? []).map(Number))].filter((n) => n > 0)
        : [];
      const 종료확인 = 끈PID.length
        ? 끈PID.map((pid) => ({ pid, stillRunning: alive(pid) }))
        : undefined;
      return {
        result: {
          command, cwd, exitCode: r.exitCode, durationMs: r.durationMs,
          // 끈 대상의 **지금 상태**. 이름 검색 결과가 아니라 PID 로 직접 확인한 사실이다.
          ...(종료확인 ? { terminated: 종료확인 } : {}),
          stdout: r.stdout, stderr: r.stderr,
          // 코드 실패 / 실행 환경 / 샌드박스 차단을 구분해 남긴다(섞으면 사용자가 잘못 판단한다).
          ...(끝난이유 ? { failedBy: 끝난이유.kind, failReason: 끝난이유.why } : {}),
          ...(r.truncated ? { truncated: true, omittedChars: r.omittedChars } : {}),
          ...(r.stopped ? { stopped: r.stopped } : {}),
          applied: mode === 'granted',
        },
        // 못 한 것을 한 척하지 않는다 — exit code 를 그대로 말한다.
        // 끈 대상이 있으면 **그 사실을 먼저** 말한다(이름 검색으로 다시 헷갈리지 않게).
        userSafeSummary: 종료확인?.length && r.exitCode === 0
          ? (종료확인.every((x) => !x.stillRunning)
            ? `껐어요 — ${종료확인.map((x) => x.pid).join(', ')} 는 지금 없어요.`
            : `일부는 아직 돌고 있어요 — 남은 것: ${종료확인.filter((x) => x.stillRunning).map((x) => x.pid).join(', ')}.`)
          : r.stopped === 'timeout'
          ? `시간이 다 돼서 멈췄어요(${Math.round((args.timeoutMs ?? 120000) / 1000)}초).`
          : r.exitCode === 0 ? '실행했어요.'
            // **샌드박스가 막은 것을 "실패"라고 말하지 않는다.** 코드 문제가 아니다.
            : (끝난이유?.kind === 'sandbox' || 끝난이유?.kind === 'permission') ? `${끝난이유.userWhy} — 코드 문제가 아니에요.`
              : 끝난이유?.kind === 'env' ? `${끝난이유.userWhy}`
                : `실행했는데 오류로 끝났어요(코드 ${r.exitCode}).`,
      };
    },
  };
}
