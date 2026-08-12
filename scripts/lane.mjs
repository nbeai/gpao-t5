// **방 하나에 손 하나** — 자기 worktree 를 여는 손 (오너 지시 2026-08-12: *"방 나눠"*)
//
// ── 왜 이 파일인가 ──────────────────────────────────────────────────────────
// 이 규칙은 **이미 문장으로 있었다**(`AGENTS.md`: *"When multiple agents work at once,
// isolate by `git worktree`; do not co-edit one file"*). 그리고 2026-08-12 에 **두 번 깨졌다**:
//   · 손 A 의 `merge --no-commit` 창에서 손 B 가 커밋 → 조각 A 병합이 남의 제목으로 닫혔다
//   · 손 B 의 미추적 검사 파일이 손 A 의 `npm test` 분모에 들어갔다(4,034 가 독립 기준선이 아니었다)
// 손 B 는 막으려고 방어를 둘 세웠고 **둘 다 그 창이 껐다**(경로 지정 커밋은 git 이 거부하고,
// 색인에서 내려도 흡수는 MERGE_HEAD 로 일어난다).
//
// **나쁜 반복은 문장이 아니라 구조로 막는다**(오너 개발철학 · 프랙탈). 구조는 둘이다:
//   ① `.githooks/pre-commit` — 커밋 그 순간에 문다(남의 병합 창 위에서는 커밋 거절)
//   ② **이 파일** — 거절당한 손이 **갈 곳**을 준다. 막기만 하면 다음 사람은 우회가 아니라
//      훅 삭제로 간다(막는 것과 길을 주는 것은 한 세트다).
//
// npm 의존성 0. 새 저장소·표면을 만들지 않는다 — `git worktree` 는 이미 이 저장소의 방식이다.
//
// 쓰는 법:
//   node scripts/lane.mjs 목록            지금 열린 방을 본다
//   node scripts/lane.mjs <이름>          `../t5-lanes/<이름>` 에 자기 방을 연다(있으면 그 자리를 알려준다)
//   node scripts/lane.mjs 닫기 <이름>     그 방을 치운다(깨끗할 때만 — 안 깨끗하면 무엇이 남았는지 말한다)
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const 저장소 = dirname(dirname(fileURLToPath(import.meta.url)));
// 방은 **저장소 밖**에 판다 — 안에 파면 진입 감사와 `.gitignore` 를 둘 다 건드린다.
const 방뿌리 = resolve(저장소, '..', 't5-lanes');
const 셸 = (자리, ...a) => execFileSync(a[0], a.slice(1), { cwd: 자리, encoding: 'utf8' }).trim();

function 열린방들() {
  return 셸(저장소, 'git', 'worktree', 'list', '--porcelain')
    .split('\n\n')
    .map((덩이) => {
      const 줄 = 덩이.split('\n');
      const 자리 = (줄.find((l) => l.startsWith('worktree ')) ?? '').replace('worktree ', '');
      const 가지 = (줄.find((l) => l.startsWith('branch ')) ?? '').replace('branch refs/heads/', '');
      return 자리 ? { 자리, 가지: 가지 || '(떼어낸 머리)' } : null;
    })
    .filter(Boolean);
}

/** 그 방에 미커밋 변경이 있나 — 있으면 무엇인지 함께 준다(치우기 전에 사람이 읽는다). */
function 남은것(자리) {
  try { return 셸(자리, 'git', 'status', '--short').split('\n').filter(Boolean); } catch { return []; }
}

const [명령, 인자] = process.argv.slice(2);

if (!명령 || 명령 === '목록') {
  const 방들 = 열린방들();
  console.log(`\n── 지금 열린 방 ${방들.length}개 ──\n`);
  for (const b of 방들) {
    const 남 = 남은것(b.자리);
    console.log(`  ${b.가지}\n    ${b.자리}${남.length ? `\n    ⚠ 미커밋 ${남.length}개` : ''}`);
  }
  console.log(`\n자기 방을 열려면:  node scripts/lane.mjs <이름>\n`);
  process.exitCode = 0;
} else if (명령 === '닫기') {
  if (!인자) { console.error('닫을 방 이름을 주세요: node scripts/lane.mjs 닫기 <이름>'); process.exitCode = 1; }
  else {
    const 자리 = join(방뿌리, 인자);
    if (!existsSync(자리)) { console.error(`그 방이 없어요: ${자리}`); process.exitCode = 1; }
    else {
      const 남 = 남은것(자리);
      if (남.length) {
        // **남의 일을 조용히 지우지 않는다.** 무엇이 남았는지 말하고 사람이 판정한다.
        console.error(`\n그 방에 미커밋 변경 ${남.length}개가 있어요 — 치우지 않았습니다:\n`);
        남.slice(0, 20).forEach((l) => console.error(`  ${l}`));
        console.error(`\n살릴 것이면 그 방에서 커밋하고, 버릴 것이면 그 방에서 직접 정리한 뒤 다시 부르세요.\n`);
        process.exitCode = 1;
      } else {
        console.log(셸(저장소, 'git', 'worktree', 'remove', 자리) || `방을 치웠어요: ${자리}`);
      }
    }
  }
} else {
  const 이름 = 명령;
  const 자리 = join(방뿌리, 이름);
  const 가지 = `lane/${이름}`;
  if (existsSync(자리)) {
    console.log(`\n이미 그 방이 있어요. 거기서 일하세요:\n\n  cd ${자리}\n`);
    process.exitCode = 0;
  } else {
    const 있는가지 = 셸(저장소, 'git', 'branch', '--list', 가지);
    // 있는 가지면 그 자리를 붙이고, 없으면 **지금 본선 tip 에서** 새로 낸다.
    const 인자들 = 있는가지
      ? ['worktree', 'add', 자리, 가지]
      : ['worktree', 'add', '-b', 가지, 자리, 'HEAD'];
    console.log(셸(저장소, 'git', ...인자들));
    console.log(`\n방을 열었어요. **여기서만** 일하세요:\n\n  cd ${자리}\n`);
    console.log('끝나면 그 방에서 커밋하고, 본선 통합은 통합 담당 한 손이 합니다');
    console.log('(자동 병합 금지 · AGENTS.md 병렬 개발 계약).\n');
  }
}
