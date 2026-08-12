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
const DF = '/bin/df';
const MAX_ROWS = 40;
const KIB = 1024;   // `df -k` 는 1024 바이트 블록으로 센다

// ── **「상태」에 저장 공간이 없었다** (F-103 · 2026-08-12) ────────────────────────
//
// 이 파일 첫 줄이 *"이 컴퓨터가 지금 어떤 상태인가"* 인데 구현은 **프로세스 한 축**뿐이었다.
// 그래서 *"이 맥 디스크 여유 공간이 얼마나 남았어?"* 에 T5 가 쓸 손이 **아예 없었다**
// (`df`·`diskutil`·`freeSpace` 전수 grep 0). 손 이름과 자기 선언은 이미 「상태」였다.
//
// **새 손을 만들지 않는다.** 만들면 사용자는 *"컴퓨터 상태"* 하나를 묻는데 손이 둘로 갈리고
// 모델이 매번 고르게 된다 — 이 저장소가 「두 벌」로 하루에 네 번 데인 그 모양이다.
//
// **축을 묻지도 않는다.** `axis` 를 고르게 하면 고를 자리가 하나 늘고 틀릴 자리도 하나 는다.
// 둘 다 읽기 전용이고 빠르므로 **한 번에 둘 다** 준다 — *"컴퓨터가 느려"* 와 *"용량 얼마 남았어"*
// 가 같은 손 한 번으로 답해진다(§24 모델을 멍청하게 만들지 않는다).
//
// 위 안전 계약을 그대로 따른다: **고정 명령·고정 인자·사용자 입력 0·읽기 전용.**
// `df -k` 는 setuid 가 아니라 셸도 샌드박스도 필요 없고, 돌려주는 것은 용량 숫자뿐이다.
function 저장읽기({ run = execFile, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    run(DF, ['-k', '/'], { timeout: timeoutMs, maxBuffer: 1 << 20 },
      (err, stdout) => resolve(err ? { failed: err.message } : { text: String(stdout ?? '') }));
  });
}

/**
 * `df -k` 표 → 사실. **마운트 지점이 `/` 인 줄**만 본다 — 맥은 볼륨이 여럿이고(VM·Data·
 * Preboot) 첫 줄을 그냥 집으면 사용자가 아는 용량과 다른 수를 말하게 된다.
 * 칸 수가 판마다 다르므로 **앞에서 세지 않고 뒤에서 센다**(마지막 칸이 마운트 지점).
 */
function 저장해석(text) {
  for (const 줄 of String(text ?? '').split('\n').slice(1)) {
    const 칸 = 줄.trim().split(/\s+/);
    if (칸.length < 4) continue;
    const mount = 칸[칸.length - 1];
    if (mount !== '/') continue;
    const total = Number(칸[1]); const free = Number(칸[3]);
    if (!Number.isFinite(total) || !Number.isFinite(free)) return null;
    return { mount, totalBytes: total * KIB, freeBytes: free * KIB };
  }
  return null;
}

/** 사람이 읽는 크기. 사용자가 아는 단위로 준다(맥 화면은 GB 로 말한다). */
function 사람크기(bytes) {
  const gb = bytes / 1e9;
  return gb >= 100 ? `${Math.round(gb)}GB` : `${gb.toFixed(1)}GB`;
}

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
      // **두 축을 나란히 읽는다.** 한쪽이 막혀도 다른 쪽은 그대로 준다 —
      // 부재를 통째 실패로 읽으면 볼 수 있던 것까지 잃는다(이 저장소의 반복 흉터).
      const [r, 저장원문] = await Promise.all([
        topProcesses({ run: deps.run, limit: 개수, timeoutMs: deps.timeoutMs }),
        저장읽기({ run: deps.run, timeoutMs: deps.timeoutMs }),
      ]);
      const storage = 저장원문.failed ? null : 저장해석(저장원문.text);
      // ── **한쪽이 막혀도 쥔 것은 준다** (F-103 · 공정검문이 짚었다) ────────────────
      //
      // 바로 위 계약을 코드가 반쪽만 지키고 있었다: `ps` 가 실패하면 **이미 성공한 `storage` 를
      // 버리고** 통째 실패로 돌아갔다. 이론이 아니다 — 이 파일 머리가 `/bin/ps` 는 setuid root 라
      // `operation not permitted` 가 **실측으로** 났다고 적어 뒀다. 그 경로에서
      // *"디스크 여유 얼마 남았어?"* 가 **숫자를 손에 쥔 채** "돌고 있는 것을 확인하지 못했어요"
      // 로 끝난다. 못 본 것만 못 봤다고 말한다(조용한 절단 금지).
      if (r.failed && storage) {
        return {
          result: { processes: [], total: 0, storage },
          userSafeSummary: `남은 저장 공간은 ${사람크기(storage.freeBytes)}예요`
            + `(전체 ${사람크기(storage.totalBytes)}). 지금 무엇이 돌고 있는지는 못 봤어요.`,
          diagnosticTrace: String(r.failed).slice(0, 300),
        };
      }
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
      // **못 본 축은 못 봤다고 말한다**(조용한 절단 금지). 지어내지도, 통째로 실패하지도 않는다.
      const 저장말 = storage
        ? `남은 저장 공간은 ${사람크기(storage.freeBytes)}예요(전체 ${사람크기(storage.totalBytes)}).`
        : '남은 저장 공간은 이번엔 못 봤어요.';
      return {
        result: { ...r, storage },
        // 사람 말로 한 줄. 숫자는 사용자가 판단할 근거라 남긴다.
        userSafeSummary: `${상위
          ? `지금 돌고 있는 것 ${r.total}개 중 위에서부터 봤어요. 제일 많이 쓰는 건 ${상위.name}(CPU ${상위.cpu}%)예요.`
          : '지금 돌고 있는 것을 확인했어요.'} ${저장말}`,
      };
    },
    subjectOf(rec) {
      const p = rec?.result?.processes?.[0];
      return p ? { key: `system:processes`, kind: 'place', label: '이 컴퓨터에서 돌고 있는 것' } : null;
    },
  };
}
