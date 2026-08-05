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
  // 2026-08-04 · **표면 사실에 받는 쪽이 생겼다**(b5152b97 → a39a31a3). 이 슬라이스에서
  // 시스템 프롬프트가 움직인 **첫 번째**다. 지시를 더한 것이 아니라 **사실 한 문장**이 늘었다:
  // "여기로는 사용자가 파일을 건넬 수 없다 — 이 컴퓨터에 이미 있는 파일만 다룬다."
  // 사람 사용시험 실측에서 T5 가 "첨부 기능이 **있으면** 그걸로 올려줘"라고 답했다 —
  // 그런 문은 어디에도 없다. 나가는 쪽만 말하고 들어오는 쪽을 안 줘서 모델이 짐작했다.
  프롬프트: 'a39a31a34b5e223d',
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
  // 2026-08-04 · S3 방 확장: `local.file` 스키마에 **문**(`offset`·`limit`)을 선언했다.
  // 모델이 스키마에서 봐야 쓸 수 있으므로 스키마 지문이 움직이는 것이 이 작업의 정의다.
  // 54b6cb359cefe010 → 222bf7de5bcb503d. **시스템 프롬프트는 그대로다**(b5152b97) —
  // 지시 문구를 더한 것이 아니라 손이 받는 인자가 늘었다.
  // 2026-08-04 · S4 캡슐: 손이 하나 늘었다(`local.capsule`) — 16 → 17.
  // 222bf7de5bcb503d → 56c6c2070f77f98d. **시스템 프롬프트는 그대로다**(b5152b97).
  // 캡슐은 커널 격리를 쓸 수 있을 때만 서므로, 못 쓰는 환경에서는 16 그대로다.
  // 2026-08-04 · 캡슐 스키마에 **돌아오는 모양**을 적었다(56c6c207 → 0c7dfe4e).
  // 안 적었더니 모델이 `listRes.entries` 를 지어내 빈 배열을 받고, 아무것도 안 옮긴 채
  // "옮겼다"고 답했다(실측 라이브). 도구가 모양을 안 주면 모델은 모양을 지어낸다.
  // 2026-08-04 · **손이 자기 방을 말한다**(0c7dfe4e → 17d84d2e). 사람 사용시험 라이브에서
  // T5 가 "~/Documents 도 다룬다"고 답했는데 실제로 시키자 "작업 폴더 밖"으로 막혔다.
  // 원인은 모델이 아니라 선언이었다 — `local.file` 의 능력 문장과 스키마 설명에
  // "Downloads·Documents·Desktop" 이 **박혀** 있었고 `GPAO_T5_FILE_ROOTS` 를 안 읽었다.
  // 이제 실제 방 이름이 들어가므로 **설치마다 이 지문은 달라진다** — 여기 동결값은
  // 고정판 실험 환경(다운로드 한 방)의 값이다. **시스템 프롬프트는 그대로다**(b5152b97).
  // 2026-08-04 · **방 배선이 절반이었다**(17d84d2e → 597f073c). 아침 수정은 `liveDeps` 가
  // 돌려주는 `descriptors` 만 채웠는데, 모델이 실제로 읽는 것은 `buildSelfState(env)` →
  // `modelSchemasFor` 이고 그 `env.descriptors` 는 방을 안 받고 있었다. 라이브에서 T5 의
  // 답에 `{방}` 이 글자 그대로 나온 뒤에야 알았다("지금 이 {방} 말고 다른 자리").
  // 이제 모델이 보는 스키마·능력 문장에 **실제 방 이름**이 들어간다.
  // 2026-08-05 · **"내 컴퓨터"는 내 컴퓨터다**(597f073c → f3959d64). 오너 실사용에서 T5 가
  // 도큐먼트 밖으로 못 나갔다 — 테스트 때부터 계속. 네 폴더 울타리가 **읽기에도** 걸려 있었고,
  // 그런데 같은 파일이 `local.terminal` 로는 읽혔다. **우회되는 울타리는 위험을 못 막고
  // 사용자가 시킨 일만 막는다.** 파괴도 같은 선으로 옮겼다 — 오너 지시대로 막는 것은 울타리가
  // 아니라 승인이다(시킨 것은 하고, 안 시킨 파괴는 `발화밖파괴` 가 카드로, 반복은 학습으로).
  // 그래서 `local.file` 의 스키마 설명이 실제 범위를 말하도록 바뀌었다 —
  // **넓혀도 설명이 그대로면 모델에게는 안 넓어진 것과 같다**(S1 의 자리).
  // 남는 절대선은 보호 규칙 하나다: 열쇠·인증서·앱 개인데이터·시스템은 읽기도 쓰기도 안 열린다.
  // 2026-08-05 · **웹에 문이 생겼다**(f3959d64 → 4e647623). `web.collect` 스키마에
  // `offset`·`limit` 을 선언하고, 결과에 `readWindow{시작,끝,총,다음}` 이 온다는 것을 적었다.
  // 모델이 스키마에서 봐야 쓸 수 있으므로 스키마 지문이 움직이는 것이 이 작업의 정의다.
  // 라이브 사고: 본문이 조용히 접혀 온도표가 사라졌고, 모델은 접힌 줄 모른 채 지어냈다.
  // **시스템 프롬프트는 그대로다**(a39a31a3).
  // 2026-08-05 · **찾는 손과 읽는 손을 나눴다**(4e647623b7d16c64 → 0d8f019c2626d81f · 17 → 18).
  // `web.search` 가 섰다. 오너 라이브에서 같은 질문에 T5 는 첫 결과를 읽고 막히면 **질의 문구만**
  // 바꿨고(세 번 다), 같은 코드로 6턴을 돌려 4턴만 맞았다 — 첫 결과가 좋은 날엔 맞고 아닌 날엔
  // 틀리는 **출처 편차**다. 원인은 모델이 아니라 손의 모양이었다: `web.collect{request}` 한 칸에
  // "찾을 것"과 "읽을 주소"가 섞여 있어 **"후보만 보여 줘"를 부를 수가 없었다.**
  // 고를 기회가 없으니 고를 수 없다. 이 슬라이스의 정의가 곧 스키마 이동이다(S1 의 자리).
  //
  // **시스템 프롬프트는 그대로다**(a39a31a3) — 지시 문구를 더한 것이 아니라 손이 하나 늘었다.
  // 커널이 "어느 출처가 옳다"를 말하기 시작하면 걷어낸 심문이 돌아온다(§1.2). 목록을 주고
  // 고르는 것은 모델이 한다.
  // 2026-08-05 · **묻는 일을 모델에게 돌려줬다**(S8 ④ · 0d8f019c → 76ad5f4b · 18 → 19).
  // `ask.user` 통제 채널이 섰다. 지금까지 **커널이 자기 문장으로 되물었다**(`turn.js` 세 자리) —
  // 말은 프로세스의 것인데 커널이 대신 한 자리다(§1 소유의 분할).
  // **시스템 프롬프트는 그대로다**(a39a31a3) — 지시 문구를 더한 게 아니라 채널이 하나 늘었다.
  // **질문 총량은 안 늘었다**: 늘리는 장치를 하나도 안 만들었고 모델이 안 부르면 안 돈다
  // (오너 지시 — *"안 그러면 질문 수도꼭지가 된다"*). 그 계약은 별도 검사가 잰다.
  스키마: '76ad5f4b43840fe4',
  도구수: 19,
  // 2026-08-05 · **배치를 처음 동결한다.** 여태 지문은 `.sort()` 로 재서 순서를 안 봤다 —
  // `web.collect` 가 `web.search` 보다 앞이던 우연한 배치도 그래서 안 잡혔다.
  // 안 재던 축이라 기준선 이동이 아니라 **새 칸**이다(기존 두 칸은 그대로다).
  // 배치도 함께 움직인다. **접두는 살아 있다** — 새 채널을 통제 목록 **끝**에 붙였다(불변식 A).
  // 처음엔 맨 앞에 뒀다가 기억 채널 넷이 밀려 접두가 죽었고(옛 배치와 6/10 만 겹쳤다),
  // 직접 재서 잡고 끝으로 옮겼다. 손 축만 재는 검사는 통제 채널 이동을 안 본다 — 이 칸이 잡는다.
  순서: '09467637a99877f2',
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
  // 통제 채널 설명에 **되는 것**을 더했다(2026-08-04). 라이브 2회에서 모델이 자동화 채널을
  // 쥐고도 "예약 기능이 없다"며 사용자에게 cron 을 짜 줬다 — 설명이 안 되는 것만 말했다.
  'src/kernel/l2-plan/model-control.js',
  'src/kernel/model-sovereign.js',
  // §S2 본 전환 — 심문 ①(`currentRequestCalls`)을 **제품에서 걷어냈다.** 그 자리를 지키던
  // 절대 게이트 "현재 요청 침해"는 왕복을 쓰는 되묻기 대신 **승인 경계로 보이기**가 받는다.
  // 걷어낸 근거는 같은 코드·같은 문장 실측이다(2026-08-04): 심문 켬 18호출·178k토큰·무진전 4
  // / 심문 끔 5호출·51k토큰·무진전 0. 심문은 왕복만 먹은 게 아니라 모델이 자기 계획을 잃게 했다.
  'src/kernel/l2-plan/carryover.js',
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
  // **횡단 계약**(오너 목표 문장 2026-08-04: "파일·코드·웹·데스크톱·외부 전송·자동화·복구에
  // 일반화한다"). "못 찾았다"를 말할 때 **얼마나 훑었는지**를 함께 주는 계약을 손 계열 전반에
  // 세웠다 — 조용한 0 은 파일 손의 버릇이 아니라 모든 손에 있는 병의 모양이다.
  'src/runtime/local-file.js',
  'src/runtime/local-locate.js',
  'src/runtime/session-search-tool.js',
  // S2 필수 계약 둘: ③ 영수증 진실(applied:false 는 확인된 사실이 아니다) ·
  // ② exchange 저장(재시작해도 모델의 행동 이력이 남는다).
  'src/kernel/l0-evidence/ledger.js',
  // **제안과 실행을 나눈다**(2026-08-04). 계약은 "호출 안 했으면 actualCall 은 null" 인데
  // 다중 호출 줄 세우기가 미실행 호출에도 채우고 있었다 — 원장이 "안 부른 것"을 "부른 것"으로
  // 말했다. `제안한호출` 칸을 세워 모델은 자기 호출을 그대로 돌려받고 원장은 정직해진다.
  'src/kernel/contracts.js',
  'src/kernel/l0-evidence/tool-receipt.js',
  // F-8 · 되돌림은 이어감이 아니라 대체다 — `answer_reset` 어휘 한 종류를 더했다(2026-08-04).
  'src/kernel/l0-evidence/turn-event.js',
  'src/kernel/turn-surface.js',
  // 표면 사실에 **받는 쪽**을 더했다(못 지킬 약속 차단, 2026-08-04).
  'src/kernel/l0-evidence/response-surface.js',
  'src/surface/server.js',
  // S4 캡슐 — 격리 실행. `sandbox.js` 에 캡슐 프로파일(프로세스 생성 0)을 텄고,
  // `terminal-run.js` 는 `redactEnv` 를 내보내기만 했다(한 자리에서 나오게).
  'src/runtime/capsule.js',
  'src/runtime/sandbox.js',
  'src/runtime/terminal-run.js',
  'src/surface/demo-context.js',
  'src/surface/live-context.js',
  'src/runtime/tool-runner.js',
  // F-5 멈춤 — 표면(HTTP 문 + 화면 버튼)에서 커널 취소 이음새까지.
  'src/surface/web/index.html',
  // §S5 출구 검증 — 완료 주장을 원장과 대조하고 어긋나면 모델에게 되돌린다.
  'src/kernel/l2-plan/exit-verification.js',
  'src/runtime/model-provider.js',
  // **S0 계측**(2026-08-05). 조립된 프롬프트를 볼 수 없어서 "안녕에 능력을 읊는" 원인을 세 번
  // 잘못 짚었다. 이 모듈은 고치는 도구가 아니라 **보는 도구**이고, 기본은 꺼짐이라 제품 동작을
  // 바꾸지 않는다(검사 ③ 이 그걸 잰다). chatgpt 경로에만 있던 원문 덤프도 여기로 합쳐 비밀을 가린다.
  'src/runtime/prompt-dump.js',
  // **F-15**(2026-08-05) — 거짓 성공 게이트가 정직한 답도 버렸다. 라이브에서 모델이
  // "못 읽었어, 대신 이렇게 해보자"라고 정확히 답했는데 런타임이 갈아치웠다.
  // 판정을 문구에서 **뒷받침 없는 구체 사실**로 바꿨다. P0 게이트라 반대시험 두 축을
  // 같은 파일에 세웠다(정직한 답은 살고 · 2026-08-03 실제 지어낸 문장은 여전히 막힌다).
  'src/kernel/l2-plan/recovery-ladder.js',
  // **S4 집**(2026-08-05) — 사용자가 열어 고치는 지침·자기소개가 사는 자리.
  // T5 의 행동 규칙은 전부 `judgmentCharter()` 에 박혀 있었고 **사용자는 한 글자도 못 고쳤다.**
  // 비교군 넷은 전부 이걸 파일로 준다. 설정·상태(`~/.local/state/`)와 다른 자리이고,
  // 매 세션 실리므로 예산(4,000/6,000자)이 걸려 있다.
  'src/surface/agent-home.js',
  // **S5a 기억이 집에 산다**(2026-08-05) — 사용자가 자기 기억을 열어 보고 고치고 지운다.
  // 지금까지는 못 봤다(암호화돼서가 아니라 평문인데 볼 자리가 없어서다).
  // 원장(memory-ledger.json + HMAC)은 안 건드린다 — 철회는 기존 경로를 그대로 탄다.
  'src/surface/memory-home.js',
  // **S6-a 실행 경계**(2026-08-05) — 판정이 사는 한 자리.
  // `turn.js` 가 같은 판정을 **두 벌** 돌리던 것을 한 벌로 만드는 첫 걸음이다.
  // S6-a 는 **행동을 하나도 안 바꾼다** — 걸음 경로의 인라인 판정을 글자 그대로 옮겼다.
  // 계획 경로를 같은 자리로 넣는 것은 S6-b 이고, 거기서 F-20(헌장 ③ 이 경로에 갈림)이 닫힌다.
  'src/kernel/l2-plan/tool-boundary.js',
  // **S7 착수 조건 ① — 손 제시 계측**(오너 지시 2026-08-05).
  // *"안 준 손은 흔적이 없다."* S7 은 손 집합 자체를 상황에서 계산하는 칸이라 틀려도
  // 화면에 안 나타난다("모델이 요즘 좀 이상한데"로만 보인다). S6 은 216칸 표가 잡았지만
  // 여기는 잡을 표가 없어, **거른 사실 자체를 기록으로 만드는 것**이 착수 전 조건이다.
  // 판정하지 않고 이미 난 결정을 볼 수 있게만 한다 — S0 이 S1 을 살린 그 자리와 같다.
  'src/kernel/l2-plan/tool-offer.js',
  // **F-18 을 걷은 자리**(2026-08-05 · 오너가 S7 착수 조건 ③ 으로 "고치는 칸"이라 못 박았다).
  // 오너 설치 실측: 승격된 기억 0개 · 집 파일 비어 있음 — 기억이 모델에게 한 번도 간 적이 없다.
  // 그 위에 낱말 겹침 필터가 얹혀 `"내가 뭘 마시는지 알아?"` 에 `"홍차를 마신다"` 가 안 실렸다.
  // **분류기가 사실 공급 여부를 정하고 있었다.** 선호는 사용자에 대한 사실이라 발화로 거르지
  // 않고 개수만 묶는다. 검증 사례가 있는 원칙은 그대로 사례로 범위가 정해진다.
  'src/kernel/l1-intent/context-mesh.js',
  // **S7 ③ · F-18 두 자리**(2026-08-05 · 오너 지적으로 다시 열었다).
  // 앞선 커밋의 grep 을 도구 목록 만드는 넷에만 걸어 통과시켰는데, 계획서가 파일명까지 적어 둔
  // 자리는 여기다 — **F-18 의 병은 도구가 아니라 사실 공급**이다(limits 와 기억이 걸러진다).
  // `T5_FACTS_UNFILTERED` 플래그 뒤에 둔다: 끄면 기준선과 글자 하나 안 달라야 하고
  // (아래 ③④ 가 매 실행 전 그걸 잰다), 켜면 한계 3줄(79자)이 분류와 무관하게 실린다.
  'src/kernel/model-sovereign.js',
  // **S8 — 검색 슬롯**(2026-08-05 · 오너 착수 지시 ①③).
  // 예전엔 `const order = [duckduckgo, searxng, tavily]` 가 이 파일에 박혀 있어, 새 검색기를
  // 붙이려면 코어를 고쳐야 했다 — §4 발자국 사다리의 **6칸**이고 불변식 B 와 부딪힌다.
  // 목록을 인자로 받고 드라이버가 `needs` 로 자기 조건을 밝히게 했다.
  // 성공 판정은 오너가 못 박은 그대로다: **이 파일을 한 글자도 안 고치고 네 번째가 붙는가.**
  'src/runtime/web-search.js',
  // **읽어 온 글자를 모델이 읽을 수 있게**(2026-08-05 라이브). 엔티티가 16진수면 안 풀려서
  // 모델이 한글을 통째로 못 읽었다 — 데이터는 와 있었는데 답은 지어낸 25℃ 였다(실제 체감 40°).
  'src/runtime/readable.js',
  // **웹도 문을 갖는다**(2026-08-05 라이브). 본문 4,588자가 재료 조립에서 1,183자로 접히며
  // 온도표가 통째로 사라져, 폭염경보(37.9°C·체감 43.7°C) 날에 "31도, 얇은 우산"이 나갔다.
  // 상한을 올리는 것은 이미 기각됐고(1200→6000 도 3분의 1), 그때 세운 답이 **문**이다 —
  // `local.file list` 는 이미 `offset`/`limit` 을 준다. 웹 손만 없었다.
  'src/kernel/l2-plan/web-tool.js',
  'src/runtime/web-collector.js',
  // **찾는 손과 읽는 손을 나눈다**(2026-08-05 · S8 ③). 넓힌 이유는 위 `기준지문.스키마`
  // 주석에 적혀 있다 — 한 사실을 두 곳에 적으면 한쪽이 낡는다.
  'src/runtime/web-search-tool.js',
  // **배치는 선언에서 한다**(2026-08-05). 역할로 런타임 정렬하는 판을 만들었다가
  // 불변식 A 검사에 걸려 되돌렸다 — 새 손이 띠 한가운데 끼면 프롬프트 접두가 죽는다.
  // 남은 변경은 주석과 `DESCRIPTORS` 선언 순서뿐이다(찾기 → 읽기).
  // S1 지문은 `.sort()` 로 재므로 **순서 변경을 안 본다** — 내용은 그대로다.
  'src/kernel/l2-plan/tool-schema.js',
  // **S8 · 등록 — 계약 슬롯과 드라이버**(2026-08-05). 커널이 슬롯을 정의하고
  // 기능이 드라이버로 붙는다. 검색기 셋이 첫 소비자다(오너 착수 지시 ①).
  // **지문은 안 움직였다** — 슬롯은 모델이 보는 것을 안 바꾼다(대조군 보존).
  'src/kernel/l2-plan/slot-registry.js',
  'src/runtime/search-slot.js',
  // **CU A — 화면 슬롯**(2026-08-05). S8 의 **두 번째 슬롯**이다(오너: *CU 는 다음
  // 기능이 아니라 S8 의 판정이다*). 같은 등록소·같은 계약 검사를 쓰고 아무것도 새로
  // 발명하지 않았다 — 발명해야 했으면 슬롯이 아니라 검색 전용 함수였다는 뜻이다.
  // 네이티브 드라이버는 **코어 밖**이고, 없으면 손이 정직하게 "볼 수 없다"를 말한다.
  'src/runtime/desktop-slot.js',
  'src/runtime/desktop-tool.js',
  'src/runtime/desktop-native-driver.js',
  // CU C — 첫 손. 읽기 손과 **따로** 선다(권한 종류가 손 단위로 판정되므로).
  'src/runtime/desktop-act-tool.js',
  // **cua 드라이버**(2026-08-05) — 화면 슬롯의 두 번째 드라이버. 크로스 플랫폼 요구로 갈아탔다.
  'src/runtime/desktop-cua-driver.js',
  'src/kernel/l2-plan/action-plan.js',
];

/** 계약·하네스·검사는 제품 행동이 아니므로 비교에서 제외한다(변경돼도 팔의 차이가 아니다). */
const 무시 = [
  /^design\//, /^docs\//, /^test\//, /^scripts\/s1\//, /^scripts\/s4\//, /^scripts\/live\//,
  // S0 뷰어도 같은 범주다 — 모델을 부르지 않고 **조립된 프롬프트를 찍어 보기만** 한다.
  // 제품 코드는 `src/runtime/prompt-dump.js` 쪽이고 그건 허용 목록에 사유와 함께 올라 있다.
  /^scripts\/s0\//,
  // S6 판정 대조표도 같은 범주다 — **경계가 내리는 결정을 찍어 얼리는 계측 하네스**다.
  // 제품은 `src/kernel/l2-plan/tool-boundary.js` 쪽이고 그건 허용 목록에 사유와 함께 있다.
  /^scripts\/s6\//,
  // 게이트는 **검사 하네스**다 — 제품 행동이 아니라 검사 자체이므로 팔의 차이가 아니다.
  // (§S3 에서 "조용한 절단 금지" 매듭을 여기 묶었다.)
  /^scripts\/gate\.mjs$/, /^scripts\/gate-baseline\.json$/,
  // 돌연변이 스윕도 같은 이유다 — 주입 정의는 **검사가 무는지를 재는 하네스**이지 제품이 아니다.
  // 제품 코드가 정당하게 바뀌면 주입점(찾기 문자열)이 따라 움직이는 것이 정상 동작이다.
  /^scripts\/audit-mutation\.mjs$/,
  // 사람 사용시험 서버도 하네스다 — 격리 방을 열어 실제 브라우저에 문만 내준다.
  /^scripts\/human-use\//,
  // 개발 하네스 — 제품 행동이 아니다. `preview:isolated` 는 다른 세션의 서버와 데이터 자리가
  // 겹치지 않게 화면을 띄우는 스크립트다(쓰기 잠금이 옳게 막아서 필요해졌다).
  /^package\.json$/, /^\.claude\//,
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
  // **`-z` 로 받는다.** git 은 기본으로 비ASCII 경로를 따옴표로 감싸고 8진 이스케이프한다
  // (`"docs/…/\354\203\210-….md"`). 이 저장소는 한글 파일명이 대부분이라, 줄 단위로 읽으면
  // 무시 필터(`test/`·`.md`)가 **전부 빗나간다** — 경로가 `"` 로 시작해 `"` 로 끝나기 때문이다.
  // 실측 2026-08-05: 한글 이름 문서 두 개가 "제품 변경"으로 잡혀 preflight 가 빨개졌고,
  // 반대로 한글 이름 **검사 파일**은 여태 필터를 그냥 통과하고 있었다. 구멍은 양쪽이었다.
  const 걸러 = (s) => s.split('\0').filter(Boolean);
  // base..작업트리 (추적 파일의 커밋·스테이지·미스테이지 변경을 모두 포함)
  const 추적 = 걸러(execFileSync('git', ['diff', '--name-only', '-z', base], { cwd: repo, encoding: 'utf8' }));
  // 미추적 파일도 제품 코드일 수 있다 — 새 모듈을 안 커밋한 채 도는 경우.
  const 미추적 = 걸러(execFileSync(
    'git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: repo, encoding: 'utf8' },
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
      // **순서도 잰다**(2026-08-05). 위 지문은 `.sort()` 로 재서 **배치 변경을 아예 안 본다** —
      // 내용이 같으면 순서가 뒤집혀도 초록이다. 그런데 모델이 보는 것은 순서가 있는 목록이고,
      // 새 손이 중간에 끼면 프롬프트 접두가 죽는다(불변식 A). 안 재던 축이라 칸을 따로 세운다.
      // 합치지 않는 이유: 합치면 동결값이 바뀌어 "무엇이 움직였나"를 못 가른다(한 번에 하나).
      순서: sha(schemas.map((s) => s.name).join('|')),
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
  // **배치도 동결한다.** 위 칸은 내용만 보고 순서를 안 본다 — 그래서 배치가 바뀌어도 초록이었다.
  잰다('플래그 OFF 도구 배치가 기준선과 같다', off1.순서 === 기준지문.순서,
    `현재 ${off1.순서} vs 기준 ${기준지문.순서}`);

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
