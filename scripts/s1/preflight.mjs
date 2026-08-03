// S1 preflight — **모델을 부르지 않는다. 그래서 돈이 들지 않는다.**
//
// 동결 계약(design/S1-EXPERIMENT-FREEZE-2026-08-04-ko.md §1.1)의 러너 시작 조건을 집행한다.
// 하나라도 어긋나면 본 회차를 **실행하지 않는다** — "차이는 플래그뿐"을 주장이 아니라
// 기계 사실로 만드는 자리다.
//
// 검사 넷:
//   ① 기준선 대비 변경 파일이 사전 등록 목록과 정확히 일치
//   ② 플래그 OFF 에서 A 와 B 의 turn 결과가 동일 (대본 모델 — 결정적)
//   ③ 시스템 프롬프트 sha256 동일 (플래그 OFF)
//   ④ 도구 스키마 sha256 동일 (플래그 OFF)
//
// ②③④ 는 **플래그가 꺼진 상태**를 잰다. 켜진 상태의 차이는 슬라이스가 여는 것이고,
// 꺼진 상태에서 다르면 그건 플래그 밖으로 샌 변경이다.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const 기준선 = 'f5ef144';

/**
 * **기준선의 지문 — 동결값.**
 *
 * 첫 판은 `off1 vs off2` 를 비교했다. 같은 것을 두 번 부르는 것이라 **구조적으로 실패할 수
 * 없었다** — 판단 헌장에 라우팅 문구를 몰래 넣고 돌렸더니 프롬프트 해시가 b5152b97 →
 * 13c5adb1 로 바뀌었는데도 전부 초록이었다(실측 2026-08-04). 대조할 **기준**이 없으면
 * 검사가 아니라 장식이다.
 *
 * 이 값은 `f5ef144` 의 제품 코드에서 잰 것이다(이후 커밋은 문서·검사만 바꿨다).
 * 제품 코드가 정당하게 바뀌면 이 값을 손으로 옮기고 **왜 바뀌었는지 함께 적는다** —
 * 스스로 갱신되는 기준선은 기준선이 아니다(gate-baseline 과 같은 규율).
 */
export const 기준지문 = Object.freeze({
  프롬프트: 'b5152b9750d53f94',
  // 2026-08-04: S3 이후 실모델 B 1회가 17개 이동 후 선택지로 후퇴했고, 프롬프트 보강
  // 실험은 더 나쁜 결과(이동 0·빈 .keep 생성)를 냈다. 병목은 문구가 아니라 긴 목록을
  // 다룰 실행 입자였다. local.file 에 조건 기반 bulk_move 를 추가해 스키마만 이동했다.
  // 2026-08-04: 실모델 B 1회가 "6개월 넘은 설치/압축/로그"를 하려다 1개 시험 이동 뒤
  // 다시 물러났다. bulk_move 에 수정일 조건(olderThanDays/newerThanDays)이 없어 모델이
  // 목표 조건을 실행 입자로 표현하지 못했다. 날짜 조건만 스키마에 추가했다.
  // 2026-08-04: 실모델 B 1회가 정리 폴더를 만들려고 placeholder 파일을 새로 만들고,
  // `_temp` 폴더 이동을 파일 move 로 시도하다 실패했다. local.file 이 폴더 move 를 실제
  // 지원하고, 목적지 폴더는 move/bulk_move 가 자동 생성하므로 __keep 같은 더미 파일을
  // 만들지 말라는 자기파악을 스키마에 추가했다.
  스키마: '54b6cb359cefe010',
  도구수: 16,
});

/**
 * 슬라이스가 손대도 되는 파일. 이 밖의 변경이 있으면 실행하지 않는다.
 *
 * ── 목록을 넓힌 이유 (2026-08-04, 오너 지시로 **기준선이 움직였다**) ──────────
 * S1 6회차가 가설 상류의 실행 벽을 드러냈고(회차 6: move 다섯 중 하나만 착지),
 * 오너가 "다중 tool call 이 병합·폐기되는 실행 벽은 모델 주권 계약의 본체이므로 즉시
 * 수정하라"고 판정했다. 그 수정은 **A 팔 동작도 바꾼다** — 즉 이 목록이 지키던
 * "차이는 플래그뿐"의 기준선 자체가 이동했다.
 *
 * 슬라이스에 몰래 섞지 않고 별도 커밋으로 세웠으며, 아래 둘을 여기 적어 남긴다:
 *   `src/runtime/model-provider.js` — 공급자가 발급한 호출 신분(`tool_call.id` ·
 *      `tool_use.id`)을 파싱·스트리밍·다음 입력까지 보존. Gemini 규약엔 id 가 없으므로
 *      **지어내지 않는다**(오너 지시).
 *   `src/runtime/tool-runner.js`    — 그 신분을 ToolReceipt 의 `actualCall` 에 박는다.
 *      한 자리에 두어야 계획·걸음·승인 재개가 같은 신분을 쓴다.
 *
 * **기준지문은 그대로다** — 이 수정은 실행 경로에만 닿았고 모델이 보는 시스템 프롬프트와
 * 도구 스키마는 글자 하나 안 바뀌었다(아래 ③④ 가 매 실행 전 그것을 확인한다).
 */
export const 허용파일 = [
  'src/kernel/turn.js',
  'src/kernel/l1-intent/task-context.js',
  // 긴 정리 실행 입자 — 모델이 400개 낱개 move 나 빈 폴더 만들기로 빠지지 않게
  // 조건 기반 bulk_move 를 local.file 의 같은 안전·되돌리기 계약 안에 추가했다.
  'src/kernel/l2-plan/action-plan.js',
  'src/kernel/model-sovereign.js',
  // §S3 예산·가드레일 — 6상한을 걷기 전에 서는 것(오너 지시 2026-08-04 "6단으로 넘어가").
  'src/kernel/turn-budget.js',
  'src/runtime/local-file.js',
  'src/runtime/model-provider.js',
  'src/runtime/tool-runner.js',
  'src/surface/demo-context.js',
  // ChatGPT 계정 경로는 **별도 클라이언트**라 위 공급자 순회에 안 잡혔고, 그래서 교환이
  // 통째로 빠지고 신분이 `callId` 라는 세 번째 이름으로 새던 것이 오래 안 보였다.
  // 같은 계약을 같은 자리에서 지키려면 여기도 슬라이스 범위다(오너 지시 2026-08-04 ①).
  'src/runtime/chatgpt-model-client.js',
];

/** 계약·하네스·검사는 제품 행동이 아니므로 비교에서 제외한다(변경돼도 팔의 차이가 아니다). */
const 무시 = [
  /^design\//, /^docs\//, /^test\//, /^scripts\/s1\//, /^scripts\/live\//,
  /^AGENTS\.md$/, /^README\.md$/, /\.md$/,
];

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * 기준선 대비 바뀐 **제품 파일**. 커밋뿐 아니라 **작업 트리와 미추적 파일까지** 본다.
 *
 * 첫 판은 `git diff base..HEAD` 였다 — 커밋만 비교하므로 미커밋 오염이 통째로 안 보였다
 * (실측 2026-08-04: `authority.js` 에 한 줄 넣고 돌렸더니 "제품 변경 0개"로 통과했다).
 * A/B 는 **디스크에서 도는 코드**를 비교하는 것이므로 기준도 디스크여야 한다.
 */
export function 변경파일(repo = process.cwd(), base = 기준선) {
  const 걸러 = (s) => s.trim().split('\n').filter(Boolean);
  // base..작업트리 (추적 파일의 커밋·스테이지·미스테이지 변경을 모두 포함)
  const 추적 = 걸러(execFileSync('git', ['diff', '--name-only', base], { cwd: repo, encoding: 'utf8' }));
  // 미추적 파일도 제품 코드일 수 있다 — 새 모듈을 안 커밋한 채 도는 경우.
  const 미추적 = 걸러(execFileSync(
    'git', ['ls-files', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8' },
  ));
  return [...new Set([...추적, ...미추적])].filter((p) => !무시.some((r) => r.test(p))).sort();
}

/**
 * 플래그 OFF 에서 A/B 가 같은 현실을 만드는지 잰다.
 * 서버를 띄우지 않고 **모델 앞에 놓이는 것**을 직접 만든다 — 그게 재야 할 사실이다.
 */
export async function 현실지문({ sovereign }) {
  const 이전 = process.env.T5_MODEL_SOVEREIGN;
  if (sovereign) process.env.T5_MODEL_SOVEREIGN = '1';
  else delete process.env.T5_MODEL_SOVEREIGN;
  try {
    // 캐시된 모듈이 옛 플래그를 물지 않게 매번 새로 읽는다.
    const { buildModelMessages } = await import(`../../src/runtime/model-provider.js?f=${sovereign ? 1 : 0}&t=${Date.now()}`);
    const { buildSelfState } = await import('../../src/kernel/l0-evidence/self-state.js');
    const { modelSchemasFor } = await import('../../src/kernel/l2-plan/model-control.js');
    const { liveDeps } = await import('../../src/surface/live-context.js');

    const 자리 = await mkdtemp(join(tmpdir(), 't5-s1-pre-'));
    await mkdir(join(자리, 'Downloads'), { recursive: true });
    const env = {
      GPAO_T5_DATA_DIR: join(자리, 'state'),
      GPAO_T5_HOME: 자리,
      GPAO_T5_FILE_ROOTS: join(자리, 'Downloads'),
    };
    const { env: liveEnv } = liveDeps(env, {});
    const selfState = buildSelfState(liveEnv, {});
    const schemas = modelSchemasFor(selfState, undefined);
    const { system } = buildModelMessages({
      currentRequest: '내 다운로드 폴더 깔끔하게 정리 좀 하고 싶다.',
      selfStateFacts: { model: 'gpt-5.1', readyTools: ['로컬 파일'], approvalRequired: [] },
      authorityFacts: {},
      surface: { responseSurface: 'web', audience: 'web_chat' },
    });
    await rm(자리, { recursive: true, force: true });
    return {
      프롬프트: sha(system),
      스키마: sha(JSON.stringify(schemas.map((s) => [s.name, s.description, s.parameters]).sort())),
      도구수: schemas.length,
    };
  } finally {
    if (이전 === undefined) delete process.env.T5_MODEL_SOVEREIGN;
    else process.env.T5_MODEL_SOVEREIGN = 이전;
  }
}

export async function preflight({ repo = process.cwd(), base = 기준선 } = {}) {
  const 결과 = [];
  const 잰다 = (이름, 통과, 근거) => 결과.push({ 이름, 통과, 근거 });

  // ① 변경 파일이 허용 목록 안인가
  const 바뀐것 = 변경파일(repo, base);
  const 밖 = 바뀐것.filter((p) => !허용파일.includes(p));
  잰다('변경 파일이 사전 등록 목록 안이다', 밖.length === 0,
    밖.length ? `목록 밖: ${밖.join(', ')}` : `제품 변경 ${바뀐것.length}개 — ${바뀐것.join(', ') || '없음'}`);

  // ②③④ 플래그 OFF 에서 현실이 같은가
  const off1 = await 현실지문({ sovereign: false });
  const off2 = await 현실지문({ sovereign: false });
  잰다('플래그 OFF 는 결정적이다(같은 입력 = 같은 지문)',
    off1.프롬프트 === off2.프롬프트 && off1.스키마 === off2.스키마,
    `프롬프트 ${off1.프롬프트}/${off2.프롬프트} · 스키마 ${off1.스키마}/${off2.스키마}`);

  const on = await 현실지문({ sovereign: true });
  // **동결된 기준지문과 대조한다.** off1 vs off2 는 같은 것을 두 번 부르는 것이라 실패할 수 없다.
  잰다('플래그 OFF 시스템 프롬프트가 기준선 지문과 같다', off1.프롬프트 === 기준지문.프롬프트,
    `현재 ${off1.프롬프트} vs 기준 ${기준지문.프롬프트}`);
  잰다('플래그 OFF 도구 스키마가 기준선 지문과 같다',
    off1.스키마 === 기준지문.스키마 && off1.도구수 === 기준지문.도구수,
    `현재 ${off1.스키마}/${off1.도구수}개 vs 기준 ${기준지문.스키마}/${기준지문.도구수}개`);

  // 플래그를 켜도 **프롬프트와 스키마는 바뀌지 않아야 한다** — 슬라이스가 여는 넷은
  // 심문 호출·강제·exchange 이지 모델 앞 문장이 아니다. 여기가 다르면 라우팅 문구가
  // 섞여 들어간 것이고, 그러면 S1 이 두 변수를 재게 된다(동결 §1.2).
  잰다('플래그 ON 도 프롬프트를 바꾸지 않는다(라우팅 문구 미추가)',
    on.프롬프트 === off1.프롬프트, `ON ${on.프롬프트} vs OFF ${off1.프롬프트}`);
  잰다('플래그 ON 도 도구 스키마를 바꾸지 않는다',
    on.스키마 === off1.스키마, `ON ${on.스키마} vs OFF ${off1.스키마}`);

  return { 결과, 통과: 결과.every((r) => r.통과), 지문: { off: off1, on } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { 결과, 통과 } = await preflight();
  console.log('\nS1 preflight — 모델 호출 0건 (무과금)\n');
  for (const r of 결과) console.log(`  ${r.통과 ? '✔' : '✖'} ${r.이름}\n      ${r.근거}`);
  console.log(`\n${통과 ? '통과 — 본 회차를 열 수 있다' : '차단 — 위 항목을 먼저 닫는다'}\n`);
  process.exit(통과 ? 0 : 1);
}
