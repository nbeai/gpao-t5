// **격리를 기계로 증명한다.** 통과하기 전에는 사람 사용시험의 문을 열지 않는다.
//
// ── 왜 생겼나 (사고 2026-08-04) ────────────────────────────────────────────
// `GPAO_T5_FILE_ROOTS` · `GPAO_T5_HOME` 만 격리 폴더로 주고 "오너 파일 접촉 0"이라고
// **선언했다.** 실제로는 뚫렸다 — 시험 중 T5 가 오너의 실제 `~/Documents` 목록을 냈다.
//
// 원장으로 확인한 기제:
//   `local.file  list ~/Documents`  → **blocked** ("작업 폴더 밖이에요") — 파일 손은 계약대로였다
//   `local.terminal ls -la ~/Documents` → **성공**, `cwd: /Users/jyp` (**실제 홈**)
//
// `GPAO_T5_HOME` 은 T5 의 개념적 홈이고, 터미널 손의 기본 자리는 `homedir()` — 즉
// **프로세스의 진짜 `HOME`** 이다. 그걸 안 바꿨다. 선언과 사실이 갈렸고, 갈린 채로 문을 열었다.
//
// ── 무엇을 증명하고, 무엇을 증명하지 않는가 ────────────────────────────────
// **재는 것은 선언이 아니라 강제다**(2026-08-07 · 노드 R 순서 ② 선행).
// 첫 판은 ①이 `scopeRoots` 가 **하나인지**를 셌다. 그건 선언이고, 오늘 F-46 이
// **선언은 강제를 보증하지 않는다**를 증명했다 — 선언 넷(`defaultFileRoots`)에
// 강제 홈 전체(`local-file.js:331`)였고 사람 셋이 그 차이에 걸렸다.
// 게다가 루트를 넓히는 순간 그 항목이 먼저 깨지면서, **강제는 한 번도 안 재진 채**
// 증명이 무너진다. 물어야 할 것은 하나다 — **오너 홈이 안 보이는가.**
//
// 증명한다:
//   ① 파일 손이 보는 `~` 가 **격리 방**이다 (표식으로 확인 — ④와 같은 축)
//   ② 파일 손이 홈 기준 경로(`~/Documents`)로 **오너 홈에 닿지 않는다**
//   ③ 터미널 손의 기본 자리가 **격리 홈**이다 (`pwd` · `echo ~`)
//   ④ 터미널로 `~/Documents` 를 훑어도 **오너 홈이 안 나온다**
//
// **증명하지 않는다(정직 고지)**: 터미널 손은 이 컴퓨터에서 읽을 수 있는 자리를 본다
// (오너 결정 P0-b · 능력 유지 + 고지). 그러니 **절대경로를 직접 주면 막히지 않는다.**
// 격리는 "홈 기준 경로"까지다. 그래서 시험 대본은 오너의 절대경로를 절대 입력하지 않는다.
// 이 한계를 여기 적어 두는 이유: 안 적으면 다음 사람이 또 "격리됨"으로 읽는다.
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

/**
 * @param {{root:string, fixtureDir:string, stateDir:string}} 방
 * @returns {Promise<{ok:boolean, 결과:Array<{항목:string, 통과:boolean, 사실:string}>}>}
 */
export async function 격리증명(방) {
  const 진짜홈 = await realpath(homedir());
  const 결과 = [];
  const 적기 = (항목, 통과, 사실) => 결과.push({ 항목, 통과, 사실 });

  // 서버가 받을 것과 **같은 환경**을 만든다. 두 벌을 만들면 증명이 증명이 아니다.
  const env = {
    ...process.env,
    HOME: 방.root,                       // ← 사고의 원인. 진짜 HOME 을 격리 루트로.
    GPAO_T5_HOME: 방.root,
    GPAO_T5_DATA_DIR: 방.stateDir,
    GPAO_T5_FILE_ROOTS: 방.fixtureDir,
  };
  const 이전HOME = process.env.HOME;
  process.env.HOME = 방.root;            // `homedir()` 은 프로세스 env 를 본다
  try {
    const { liveDeps } = await import(`../../src/surface/live-context.js?t=${방.root}`);
    const { tools } = await liveDeps(env);
    const 파일 = tools?.tools?.['local.file'];
    const 터미널 = tools?.tools?.['local.terminal'];

    // ① **파일 손이 보는 `~` 가 격리 방인가** — 이름이 아니라 표식으로 가른다(④와 같은 축).
    //
    // 예전엔 `scopeRoots.length === 1` 을 봤다. 그건 **선언**이고, 선언은 강제를 보증하지
    // 않는다(F-46). 여기서 물어야 하는 것은 *"오너 홈이 안 보이는가"* 하나다.
    // 표식을 격리 방에 심고 **파일 손으로** 읽는다 — 읽히면 그 `~` 는 격리 방이다.
    // **점으로 시작하지 않는다.** 홈 최상위 숨김 자리는 보호가 막는다(2026-08-07) —
    // 점 이름으로 두면 보호가 이겨서 격리가 아니라 보호를 재게 된다.
    await writeFile(join(방.root, 't5-격리표식'), '이 자리는 시험용 격리 방이다.\n', 'utf8');
    const 표식 = await 파일?.handler?.({ action: 'read', path: '~/t5-격리표식' }, {});
    const 표식읽힘 = !표식?.blocked && !표식?.failed
      && /격리 방/.test(JSON.stringify(표식?.result ?? ''));
    적기('파일 손이 보는 `~` 가 격리 방이다(표식으로 확인)', 표식읽힘,
      표식읽힘 ? `scopeRoots=${JSON.stringify(파일?.scopeRoots ?? [])}`
        : `표식을 못 읽었다 — \`~\` 가 다른 자리다: ${String(표식?.userSafeSummary ?? '').slice(0, 60)}`);

    // ② **홈 기준 경로가 오너 홈에 닿지 않는가.** 격리 방에 같은 이름을 만들어 두고 잰다 —
    //    안 만들면 "폴더가 없어서 못 읽음"(ENOENT)이 통과로 세어져 **강제를 안 재게 된다.**
    await mkdir(join(방.root, 'Documents'), { recursive: true });
    await writeFile(join(방.root, 'Documents', 't5-격리표식'), '격리 방의 Documents 다.\n', 'utf8');
    const 밖 = await 파일?.handler?.({ action: 'list', path: '~/Documents' }, {});
    const 오너홈아님 = !JSON.stringify(밖?.result ?? '').includes(진짜홈);
    적기('파일 손의 ~/Documents 가 오너 홈이 아니다', 오너홈아님,
      오너홈아님 ? '격리 방의 Documents 를 본다' : '**오너 홈 경로가 결과에 있다**');

    // ③ 터미널의 기본 자리
    const pwd = await 터미널?.probe?.('pwd');
    const 자리 = String(pwd?.cwd ?? '');
    적기('터미널 기본 자리가 격리 홈', 자리 === 방.root && !자리.startsWith(진짜홈 + '/') && 자리 !== 진짜홈,
      `cwd=${자리 === 방.root ? '격리 루트' : 자리}`);

    // ④ 홈 기준으로 훑으면 **격리 방의 표식**이 보이고 오너 홈의 표식은 안 보이는가
    //
    // 첫 판은 `Documents`·`Desktop` 이름을 오너 홈의 증거로 삼았다. 그런데 오너 환경을
    // **복제한 시험 방**에도 그 이름이 있다 — 이름으로 가르면 정상 격리를 오너 홈으로 오인한다
    // (실측 2026-08-05). **이름이 아니라 표식으로 가른다**: 우리가 심은 것이 보이고,
    // 오너 홈에만 있는 `Library` 가 안 보이면 `~` 는 격리 방이다.
    // 표식은 ①에서 이미 심었다 — 여기서는 터미널의 `~` 로 같은 것을 본다.
    const ls = await 터미널?.probe?.('ls -a ~/');
    const 출력 = String(ls?.probe?.stdout ?? '');
    const 표식보임 = 출력.includes('t5-격리표식');
    const 오너홈표식 = 출력.includes('Library');
    적기('터미널 `~` 가 격리 방이다(표식으로 확인)', 표식보임 && !오너홈표식 && (ls?.probe?.exitCode === 0),
      !표식보임 ? '격리 표식이 안 보인다 — `~` 가 다른 자리다'
        : 오너홈표식 ? '오너 홈의 Library 가 보인다' : `exit=${ls?.probe?.exitCode}`);
  } finally {
    if (이전HOME === undefined) delete process.env.HOME; else process.env.HOME = 이전HOME;
  }
  return { ok: 결과.every((r) => r.통과), 결과 };
}

// 단독 실행 — 새 임시 방을 만들어 증명만 돌린다(오너 파일에 손대지 않는다).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 't5-iso-')));
  const fixtureDir = join(root, 'fixture');
  const stateDir = join(root, 'state');
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(fixtureDir, 'brief-v1.txt'), '시험용\n', 'utf8');
  const { ok, 결과 } = await 격리증명({ root, fixtureDir, stateDir });
  for (const r of 결과) console.log(`${r.통과 ? '  ok ' : '  X  '} ${r.항목} — ${r.사실}`);
  console.log(ok ? '\nISOLATION: PASS (홈 기준 경로까지. 절대경로는 막지 않는다 — 대본이 안 쓴다)'
    : '\nISOLATION: FAIL — 문을 열지 않는다');
  process.exit(ok ? 0 : 1);
}
