// L3 · 이 컴퓨터가 지금 어떤 상태인가 (P-OP-1, A 시나리오)
//
// 실측(오너 라이브 2026-07-28): "컴퓨터가 요즘 느린데, 바꾸지 말고 원인만 봐줘."
// T5 는 부하·메모리·발열까지 읽고도 **정작 무엇이 CPU 를 먹는지는 못 봤다**. 그리고
// "Activity Monitor 에서 CPU 탭 보시면 돼요"라고 사용자에게 떠넘겼다 — 축1 위반이다.
//
// 원인은 권한이 아니라 구조였다. `/bin/ps` 는 **setuid root** 라 `sandbox-exec` 가 실행
// 자체를 거부한다(`operation not permitted`). 샌드박스 규칙으로는 못 연다 — 규칙 문제가
// 아니라 setuid 바이너리를 못 띄우는 것이기 때문이다. 실측으로 확인했다:
//   (allow default) 만 있는 프로파일에서도 동일하게 거부됨
//
// 그래서 **셸과 샌드박스를 아예 안 거친다.** 대신 위험을 다른 방식으로 없앤다:
//   · 명령과 인자를 T5 가 고정 조립한다 — 사용자 말이 명령에 들어갈 자리가 없다(주입 불가)
//   · 읽기 전용이다 — 이 컴퓨터의 무엇도 바꾸지 않는다
//   · `comm` 만 읽는다. `command`/`args` 를 읽으면 `--token=…` 처럼 **인자에 섞인 비밀**이
//     그대로 딸려 온다(실측 가능한 유출 경로다). 실행 파일 이름까지만 본다.
import { execFile } from 'node:child_process';

const PS = '/bin/ps';
const MAX_ROWS = 40;

/** 인자 없이 고정된 명령 하나. 셸을 안 쓰므로 따옴표·주입을 걱정할 자리가 없다. */
function 프로세스읽기({ run = execFile, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    run(PS, ['-Ao', 'pid,pcpu,pmem,comm', '-r'], { timeout: timeoutMs, maxBuffer: 8 << 20 },
      (err, stdout) => resolve(err ? { failed: err.message } : { text: String(stdout ?? '') }));
  });
}

/** `ps` 표 한 줄 → 사실. 실행 파일 **이름만** 남긴다(경로 전체는 프롬프트를 먹는다). */
function 줄해석(line) {
  const m = String(line).trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/);
  if (!m) return null;
  const 경로 = m[4].trim();
  return {
    pid: Number(m[1]),
    cpu: Number(m[2]),
    mem: Number(m[3]),
    name: 경로.split('/').pop() || 경로,
  };
}

/**
 * 지금 돌고 있는 것 중 자원을 많이 쓰는 순서. **아무것도 바꾸지 않는다.**
 * @param {{run?:Function, limit?:number}} p
 */
export async function topProcesses({ run, limit = 10, timeoutMs } = {}) {
  const r = await 프로세스읽기({ run, timeoutMs });
  if (r.failed) return { failed: r.failed };
  const rows = r.text.split('\n').slice(1).map(줄해석).filter(Boolean);
  return { processes: rows.slice(0, Math.min(Math.max(1, limit), MAX_ROWS)), total: rows.length };
}

export function makeLocalSystemTool(deps = {}) {
  return {
    toolKind: 'read',
    async handler(args = {}) {
      const 개수 = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 10;
      const r = await topProcesses({ run: deps.run, limit: 개수, timeoutMs: deps.timeoutMs });
      if (r.failed) {
        // 원문을 사용자면에 옮기지 않는다. 왜 못 했는지는 진단면에.
        return {
          failed: true,
          userSafeSummary: '지금 무엇이 돌고 있는지 확인하지 못했어요.',
          diagnosticTrace: String(r.failed).slice(0, 300),
          nextSafeAction: '다른 쪽부터 살펴볼까요?',
        };
      }
      const 상위 = r.processes[0];
      return {
        result: r,
        // 사람 말로 한 줄. 숫자는 사용자가 판단할 근거라 남긴다.
        userSafeSummary: 상위
          ? `지금 돌고 있는 것 ${r.total}개 중 위에서부터 봤어요. 제일 많이 쓰는 건 ${상위.name}(CPU ${상위.cpu}%)예요.`
          : '지금 돌고 있는 것을 확인했어요.',
      };
    },
    subjectOf(rec) {
      const p = rec?.result?.processes?.[0];
      return p ? { key: `system:processes`, kind: 'place', label: '이 컴퓨터에서 돌고 있는 것' } : null;
    },
  };
}
