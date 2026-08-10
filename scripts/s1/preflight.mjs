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
  // 2026-08-07 · **노드 K**(a39a31a3 → 6eb6590d). 이 슬라이스에서 시스템 프롬프트가 움직인
  // 두 번째다. 이번에도 지시가 아니라 **사실**이 늘었다 — 판 5판이 ③④⑦⑧ 을 0~1/3 로
  // 떨어뜨린 자리이고, 셋 다 "말이 기계 사실에서 안 나온다"였다:
  //   ① 손을 안 쓴 턴에 `[이번 턴 실행 사실]` 블록이 **통째로 없었다.** 모델은 *"안 한 것"* 과
  //      *"말 안 한 것"* 을 구분 못 하고 빈자리를 메웠다 — 원장 0 인데 *"방금 열어봤어요"*
  //      (거짓 성공 · 절대 게이트). 이제 0 을 0 이라고 적는다.
  //   ② `automationProposal` 이 여기 한 번도 안 왔다. 예약 후보를 만들어 놓고
  //      *"스스로 먼저 말 걸 수 없어요"* 라고 답했다(거짓 실패).
  //   ③ `[저장된 기본값 — 지금 실행할 명령이 아니다]` 딱지가 **사용자에 대한 사실**에도
  //      붙어, 실려 간 기억을 모델이 버렸다. 갈라야 할 선은 *과거냐*가 아니라
  //      **지시냐 사실이냐**이고, 그 선은 `context-mesh.js` 의 `kind` 에 이미 있었다.
  // 2026-08-07 · **노드 R**(6eb6590d → efcffbf9). 이 슬라이스에서 세 번째로 움직였다.
  // 이번엔 사실이 아니라 **판단의 순서**가 늘었다 — 헌장 `<끝났을 때>` 에 한 줄:
  //   *"하겠다고 말했으면 같은 답 안에서 그 손을 부른다. 약속으로 턴을 끝내지 않는다."*
  //
  // 판 ⑤⑬③ 의 공통 뿌리다. ⑤가 *"읽어서 계산해 드려야 해요"* 로 **미래형**으로 끝냈고
  // ③이 *"방금 확인했어요"* 로 **과거형**으로 끝냈다 — 둘 다 손 없이 턴이 끝났다.
  // 헌장에 *"다음 턴으로 미루지 않는다"* 는 있었는데 **약속으로 끝내는 자리**가 없었다.
  //
  // ⛔ 를 쪼갠 뒤의 첫 걸음이다(PM 정정): *말을 문구 목록으로 **검사**한다* 는 그대로 금지고
  // (`F-12`), *행동을 프롬프트로 **지시**한다* 는 우리가 해 본 적이 없다. 비교군(Hermes)은
  // 기본 프롬프트 두 번째 절 이름이 `# Tool-use enforcement` 이고 정면으로 문장이다.
  // 예시 문구는 안 넣었다 — 헌장은 보는 법이지 출력 템플릿이 아니다(검사 셋이 그걸 물었다).
  // 2026-08-09 · **동반 세 계단이 헌장에 실렸다**(efcffbf9 → 5280cec3 · F-54 태도 층 ·
  // 오너 승인 문안 원문 그대로 · PM "한 번이다"). 재료 층 4갈래(행동 0/8)와 모델 층
  // (5.1/5.5 동일 멈춤)이 소진된 뒤의 마지막 층이다 — 특정 문항·낱말 겨냥이 아니라 보는
  // 법 한 문장: "답하기 전에 스스로 본다 — 가진 손으로 볼 수 있는 것을 다 보았는가. …"
  // 헌장 1,849 → 1,955자(+106). 이 이동의 판정(행동 프로브 2표본)은 회차기록에 있다.
  프롬프트: '5280cec349840aee',
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
  // 2026-08-07 · **찾는 손 설명서를 고쳤다**(76ad5f4b → 603a2824 · **19개 그대로**).
  // 손이 는 것이 아니라 `local.locate` 의 설명 한 문장이 바뀌었다:
  //   전  *"후보가 하나면 그대로 쓰고, 여럿이면 짧게 보여주고 고르게 한다"*
  //   후  *"여럿이면 가장 그럴듯한 하나를 골라 진행하고, 무엇을 왜 골랐는지 말한다"*
  //
  // **손 설명서가 사용자에게 물으라고 시키고 있었다.** 판 ⑤에서 T5 가 정산 폴더 다섯을
  // 정확히 찾아 놓고 목록만 보여준 뒤 멈춘 것이 이 문장 때문이다 — 모델이 잘못한 게 아니라
  // 시킨 대로 한 것이다. 오늘 세 번째 같은 병이고(앞의 둘은 `userSafeSummary`·
  // `nextSafeAction`), 이번엔 `schema.description` 이라 기존 반대시험이 안 훑던 자리다.
  // 되묻기 금지가 아니다 — 계획서 「동반」 2계단(가정을 밝히고 진행한다)이다.
  // 2026-08-08 · **찾을 자리와 저장할 자리를 가른다**(603a2824 → b8394079 · 손 19개 그대로).
  // `local.locate` 의 `from` 설명 한 줄: ⑫ 실측 2/3 에서 *"바탕화면에 저장해줘"* 의
  // 바탕화면이 from 으로 들어가 바탕화면만 뒤지고 "못 찾았다"며 사용자에게 위치를 물었다.
  // 모르면 비우는 것(홈 전체)이 기본이라는 사실도 함께 — 지시가 아니라 인자의 뜻이다.
  // 2026-08-08 · **표의 형식은 짐작이 아니라 확인의 대상이다**(b8394079 → f3735a24 · 손 19개 그대로).
  // `local.capsule` code 설명 두 줄: ⑫ 회차 D 에서 열 이름을 "매출액"으로 짐작한 스크립트가
  // 0원을 합산해 그대로 파일에 썼다(실제 열은 "금액"). 헤더를 읽어 쓰고, 합계 0 이면 열 이름부터.
  // 2026-08-08 밤 · **읽기가 표 사실을 동봉한다**(f3735a24 → ec5e9fd9 · 손 19개 그대로).
  // `local.capsule` code 설명의 read 반환 모양 한 곳: `table?:{rows, columns, sums}` 추가
  // (매듭 ② 구조 층 · 회차 G 실측 — 합산이 암산으로 남아 회차마다 흔들렸다). 지시 문구가
  // 아니라 새로 생긴 사실 밭의 선언이다 — 합계는 파일 손이 세고, 요약줄에도 실린다.
  // 2026-08-08 밤 · **모양 선언을 정밀화한다**(ec5e9fd9 → 9b6ea7e7 · 손 19개 그대로).
  // 회차 H R2 실측: 캡슐 스크립트가 columns 를 [{name, kind}] 객체 배열로 짐작해 합계가
  // 전부 빠졌고 실물에 "undefined: 0원"이 적혔다 — 위 선언이 columns 원소 형을 안 밝힌
  // 탓이다. 같은 줄에 원소 형을 박는다(새 문장이 아니라 이번에 만든 선언의 정밀화).
  // 2026-08-09 · **기억 정의역에 사용자 사실을 만든다**(9b6ea7e7 → d54ae69f · 손 19개
  // 그대로). ④ 진단: "기억해 둬" 씨앗에 모델이 채널을 4회 연속 안 불렀다 — 정의역(선호·
  // 원칙)에 사실의 자리가 없어서다. memory.propose kind 에 user_fact 열거 추가(자동 반영
  // 없음 · 확인 카드 경로만). 낱말 그물 확장이 아니라 종류 신설(PM 승인 · 수리+봉인).
  스키마: 'd54ae69f4d4ab306',
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
  // 화면 손을 쓰는 법(사다리·순서)을 모델에게 가르치는 자리(노드 ② · 2026-08-06).
  // 커널은 사다리를 탈 수 있게 만들어 뒀는데 모델이 그게 있는 줄 몰라 여섯 번 다
  // 사람에게 떠넘겼다 — 손과 그 손 쓰는 법은 같이 가야 한다.
  'src/kernel/screen-guidance.js',
  // 그림의 **크기만** 봉투(PNG/JPEG 머리)에서 읽는다 — MCP 조각에 크기가 없어서,
  // 모델이 자리를 짚을 자를 못 받았다(창 크기를 주면 그림 밖을 짚는다). 알맹이는 안 본다.
  'src/runtime/image-size.js',
  // 손이 **무엇을 보는지** 축으로 선언하는 자리(노드 ③ · 2026-08-06). `operatorFact` 는
  // 모델이 읽는 글이고 이 축은 커널이 읽는 값이다 — 한 손이 막혔을 때 같은 것을 보는
  // 다른 손을 가리키려면 비교할 수 있어야 한다(글로는 못 비교한다).
  'src/kernel/l2-plan/tool-descriptor.js',
  // 그 축을 selfState 가 나른다 — 안 나르면 커널이 비교할 재료를 못 받는다.
  'src/kernel/l0-evidence/self-state.js',
  // **손을 스스로 찾는 자리**(PM 판정 2026-08-06). `GPAO_T5_CUA_BIN` 을 아무데서도 안 세워
  // 사장님이 켠 T5 에는 화면 손이 0개였다 — 실험실에서만 되던 것을 제품에 잇는다.
  'src/runtime/desktop-bin.js',
  // **화면 손 실행 파일**(오너 결정 2026-08-07: T5 설치에 같이 담는다).
  // 코드가 아니라 산출물이라 지문에 안 잡히지만, 빠지면 손이 통째로 없어진다.
  // **서명·공증된 앱을 동봉한다**(오너 결정 2026-08-07 · 장착을 공식대로).
  // 생 바이너리를 `mcp --direct` 로 띄우던 것이 **호스트 TCC 를 상속**해서
  // 이틀간 권한이 흔들렸다. 이제 앱을 `/Applications` 에 놓고 드라이버가 스스로
  // 데몬을 띄운다 — TCC 는 `com.trycua.driver` 에 붙는다. 코드가 아니라 산출물이라
  // 지문에 안 잡히지만, 빠지면 손이 통째로 없어진다.
  'vendor/cua-driver/darwin-arm64/CuaDriver.app/Contents/CodeResources',
  'vendor/cua-driver/darwin-arm64/CuaDriver.app/Contents/Info.plist',
  'vendor/cua-driver/darwin-arm64/CuaDriver.app/Contents/MacOS/cua-cursor-theme',
  'vendor/cua-driver/darwin-arm64/CuaDriver.app/Contents/MacOS/cua-driver',
  'vendor/cua-driver/darwin-arm64/CuaDriver.app/Contents/Resources/AppIcon.icns',
  'vendor/cua-driver/darwin-arm64/CuaDriver.app/Contents/_CodeSignature/CodeResources',
  'src/kernel/turn.js',
  'src/kernel/l1-intent/task-context.js',
  // F-66b 같은 턴 source 결산 — 초기 bounded source set과 실제 read Receipt를
  // WorkRef·sourceSetRef·revisionRef로 결속한다. 문구나 손 순서를 정하지 않고
  // read/excluded/unresolved 기계 현실만 다음 모델 호출에 공급한다.
  'src/kernel/l1-intent/source-coverage.js',
  // F-66b 독립 감사 차단 — CompletionContract/Receipt는 canonical 민감 경계를 지난
  // 바로 그 본문에 서명하고, source 결산이 서명 뒤 객체를 고치지 못하게 한다.
  'src/surface/work-event-store.js',
  // **사실을 묻는 것도 일이다**(2026-08-07 · 노드 R · 판 ⑤⑬).
  // `ACTION_SIGNALS` 가 명령 동사만 잡아 *"이번 달 얼마 벌었지?"* 가 `fast_chat` 으로
  // 분류됐다 — 계획 단계에서 손 후보가 0개가 되어 모델이 뻗을 길이 없었다.
  'src/kernel/l1-intent/intent.js',
  // **약속으로 턴을 끝내지 않는다**(2026-08-07 · 노드 R · 판 ⑤⑬③ 공통 뿌리).
  // ⑤가 *"읽어서 계산해 드려야 해요"* 로 미래형으로 끝냈고 ③이 *"방금 확인했어요"* 로
  // 과거형으로 끝냈다 — 둘 다 손 없이 턴이 끝났다. 헌장 `<끝났을 때>` 에 그 줄이 없었다.
  'src/kernel/judgment-charter.js',
  // **막혔을 때의 다음 길은 소비자가 둘이다**(노드 R 첫 걸음 · 2026-08-07).
  // 원장이 `userSafeSummary — nextSafeAction` 을 **합쳐서** 모델에게 보낸다(`ledger.js:59`).
  // 그래서 *"그 폴더를 열어 주시면"* 이 모델의 다음 행동이 되어 사장님께 되물었다(⑫ 0/3).
  'src/kernel/l0-evidence/ledger.js',
  // **돌연변이 주입 자리**(노드 K · 2026-08-07). 커널블록이 지시/사실로 갈리면서
  // §5-J 격리를 노리던 주입 문자열이 0곳이 됐다 — 재는 것은 그대로이고 자리만 옮겼다.
  'scripts/audit-mutation.mjs',
  // **격리 증명은 강제를 재야 한다**(PM 당부 2026-08-07 · 노드 R 순서 ② 선행).
  // 첫 항목이 `scopeRoots` 가 하나인지(=선언)만 봤다. 오늘 F-46 이 증명한 것이
  // **선언은 강제를 보증하지 않는다**이고, 루트를 넓히면 이 증명이 먼저 깨진다.
  'scripts/human-use/prove-isolation.mjs',
  // **선언을 실제 강제에 맞춘다**(오너 방향 2026-08-07 · 노드 R 순서 ②).
  // 선언은 넷인데 강제는 홈 전체였고, 모델이 좁은 선언을 믿어 `from:'Desktop'` 으로
  // 범위를 좁혀 찾다 실패했다(판 ⑫ 0/3). 넓히는 같은 걸음에서 노출면을 닫는다.
  'src/runtime/file-scope.js',
  'src/runtime/local-protection.js',
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
  // **모델 응답에서 총 소요 시간 상한을 없앤다**(오너 결정 2026-08-09 · 제품 결함).
  // `DEFAULT_HTTP_TIMEOUT_MS = 25_000` 이 사용자 앞에서 정상 응답을 잘랐다. 자를 근거는
  // 총 시간이 아니라 **진짜 죽음(정체)** 이어야 한다 — 그 판정이 이 두 파일에 산다.
  // 값이 세 자리(어댑터 둘·서버 하나)에 흩어져 있어 하나를 풀어도 나머지에서 잘렸다.
  // 이제 한 자리에서만 산다(`model-timeout.js`), 재는 자(25초 개발 기준선)도 여기다.
  'src/runtime/model-timeout.js',
  'src/runtime/with-timeout.js',
  // **0 은 상한이 아니라 없음이다**(밟은 자리 2026-08-09). 응답 상한을 0(무제한)으로 내리자
  // 같은 값이 진단까지 흘렀고 `withTimeout(…, 0)` 이 바로 abort 라 진단이 늘 `unreachable` 로
  // 떨어졌다 — 사용자에게는 "연결이 되지 않아요"였다. 진단은 응답과 다른 일이라 상한을 지킨다.
  'src/runtime/model-doctor.js',
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
  // **사장님이 부르는 말을 자리 목록에 붙인다**(PM 매듭 ① · 2026-08-07).
  // 판 ⑫에서 *"바탕화면에 저장해줘"* 가 `~/GPAO-T5/Desktop` 으로 갔다 — 파일도
  // 내용도 맞았고 자리만 틀렸다. 모델이 `Desktop` 과 "바탕화면"을 이을 근거가 없었다.
  'src/runtime/local-locate.js',
  'src/kernel/l0-evidence/working-state.js',
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
  'src/runtime/desktop-identity.js',   // CU-1 계열 A — 신분을 한 벌로만 만든다
  'src/runtime/desktop-driver-answer.js',   // CU-1 계열 B — 드라이버 답을 한 자리에서 읽는다
  'src/kernel/l0-evidence/sensitive-text.js',   // F-32 — 비밀만 가리고 나머지는 준다
  // F-64 slice 1 — 사용자 exact path와 quoted body의 독립 span만 완료 계약 재료로 입장한다.
  'src/kernel/l1-intent/file-parse.js',
  'src/surface/server.js',
  // L6 — canonical 자동화 원장의 same-principal bounded reality 투영과 승인 후보 계약.
  // 후보가 delivery intent 를 실제 deliveryPolicy 로 나르고, scheduler 는 durable AgentRun
  // 발생 원장에서 maxRuns 를 세어 재시작·동시 실행에서도 같은 권한 상한을 지킨다.
  'src/kernel/l5-growth/automation-contracts.js',
  // L6 — 반복 문구 정규식 후보를 제품 진실에서 걷고 structured automation.propose 한 자리만 쓴다.
  'src/kernel/l5-growth/automation.js',
  'src/runtime/automation-engine.js',
  'src/runtime/automation-scheduler.js',
  'src/runtime/canonical-automation-runtime.js',
  // L6 — candidate/job/control settlement를 job 한 칸 덮어쓰기 대신 append-only로 보존한다.
  'src/surface/automation-store.js',
  'src/surface/automation-settlement.js',
  'src/surface/automation-surface.js',
  // L6 local conversation delivery — immutable run target, append-only delivery/readback,
  // session exact-once append, trusted tick reconciliation are one product path.
  'src/surface/automation-run-ledger.js',
  'src/surface/delivery-store.js',
  'src/surface/session-store.js',
  'src/surface/tick-scheduler.js',
  // S4 캡슐 — 격리 실행. `sandbox.js` 에 캡슐 프로파일(프로세스 생성 0)을 텄고,
  // `terminal-run.js` 는 `redactEnv` 를 내보내기만 했다(한 자리에서 나오게).
  'src/runtime/capsule.js',
  'src/runtime/sandbox.js',
  'src/runtime/terminal-run.js',
  // **터미널 유보 해제**(오너 결정 2026-08-06). 계획서 v3.1 §20·§22 가 *"임의 명령 실행은
  // 계속 유보"* 라고 적어 뒀는데 코드에 그런 유보는 없었다 — 셸은 통째로 열려 있고 명령 목록도
  // 없다. 라이브로 가른 실제 마찰은 하나였다: **읽기성 네트워크가 승인 카드로 갔다**
  // (`curl` 조회 · `git pull` · `npm ls`). 이 컴퓨터를 하나도 안 바꾸는 일이고 헌장 넷 어디에도
  // 없다. 그리고 웹 손은 이미 임의 주소로 자동 GET 을 한다 — 두 손이 다른 선을 쓰고 있었다.
  // 재료는 이미 있었다: `sandbox.js` 의 `reach`(쓰기✗·네트워크✓·비밀✗)를 커넥터 CLI 손만 쓰고
  // 터미널 본체는 안 썼다. 둘을 이었다. 명령 목록은 안 만든다 — 돌려 보고 판정하는 구조 그대로다.
  // 배선하다 밟은 것: `포트 열기`와 `나가서 읽기`가 같은 `why:'network'` 였다. 안 가르고 열었더니
  // 서버 띄우기가 승인 없이 돌았고 회귀가 잡았다 — `why:'listen'` 으로 갈랐다.
  'src/runtime/local-terminal.js',
  // **주석만 고쳤다**(2026-08-06 · F-46). 머리말이 *"기본값이 홈 전체가 되지 않는다"* 라고
  // 적어 뒀는데 강제 경계는 이미 홈 전체다(오너 결정 · `local-file.js:216·331`). 읽은 사람이
  // 그 문장 때문에 **T5 가 없는 능력을 주장한다고 오판**했다. 코드는 한 줄도 안 바꿨다 —
  // 선언과 강제를 한 벌로 만드는 것은 격리 증명의 판정 축을 먼저 정해야 해서 F-46 으로 남겼다.
  'src/runtime/file-scope.js',
  // **design/ 정리**(오너 지시 2026-08-06) — 47개를 `design/archive/` 로 옮기고 그 경로를
  // 감사의 제외 목록에 더했다. 안 더하면 보관한 문서가 계속 "활성"으로 세어져서, 보관이
  // 정리가 아니라 이름만 바꾼 것이 된다. 제품 코드는 안 건드렸다.
  'scripts/audit-project-entry.mjs',
  // **계획서 도달성 게이트**(검사 10 · 오너 규칙 2·3, 2026-08-06). 계획서를 하나로 합치면서
  // 오너가 건 조건이 "맵에서 필요한 영역을 찾아가 읽을 수 있고, 연관 내용이 단절 없이
  // 이어진다"였다. 맵이 가리키는데 절이 없으면 찾아갈 수 없고, 절에 파일·근거가 없으면
  // 거기서 더 못 간다 — 둘 다 맵만 읽으면 멀쩡해 보여서 사람 눈으로는 안 잡힌다.
  // 붙이자마자 실제 구멍 하나를 잡았다(노드 B·C·D 에 파일 칸 없음). 반대시험 4/4 빨강.
  // 제품 코드는 안 건드렸다 — 검사와 문서만이다.
  'scripts/audit-docs.mjs',
  // **검사 임시방 정리**(오너 지시 2026-08-07). 2026-08-06 에 디스크가 100% 로 찼고,
  // 주범은 다른 것이었지만 검사가 남긴 임시 폴더도 2.1GB 였다. 접두 목록으로 지우려 했더니
  // `mkdtemp` 자리가 400곳이 넘고 `what-`·`zero-locate-` 같은 것까지 있어 **목록이 샌다.**
  // 그래서 목록이 아니라 경계로 풀었다 — 검사에게 `TMPDIR` 전용 방을 주고 그 방만 지운다.
  // 남의 임시 자리는 애초에 손댈 일이 없다. 한 회차에 15.4MB 가 실제로 남고 있었다.
  'scripts/gate.mjs',
  // 위 정리량을 세는 함수. `gate.mjs` 는 불러오면 게이트 전체가 도는 스크립트라 따로 뺐다.
  'scripts/dir-size.mjs',
  // **주석만 고쳤다**(오너 결정 2026-08-06 · BUTLER §9 D2). 이 파일 머리가
  // *"사용자 프로필 활용은 별도 결정이 필요한 사안"* 이라 적고 사흘을 기다리고 있었다.
  // 결정이 났으므로 그 자리에 기록했다 — **구현은 안 했다**(4단계 슬라이스다).
  'src/runtime/browser.js',
  'src/surface/demo-context.js',
  'src/surface/live-context.js',
  'src/runtime/tool-runner.js',
  // F-5 멈춤 — 표면(HTTP 문 + 화면 버튼)에서 커널 취소 이음새까지.
  'src/surface/web/index.html',
  // §S5 출구 검증 — 완료 주장을 원장과 대조하고 어긋나면 모델에게 되돌린다.
  'src/kernel/l2-plan/exit-verification.js',
  // **P-OP 결함 가족 A-②**(2026-08-10) — 물음표로 끝나는 인용은 합의의 증거가 아니다.
  // 거짓 전제 질문("~포함한다고 했지?")이 그 문장 그대로 agreement_set 으로 입장하는 것을
  // 기계 확인으로 재현하고 닫았다. 프롬프트·스키마 지문은 안 바뀐다(입장 경계만).
  'src/surface/work-state-admission.js',
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
  // **F-58 · 승인 기억의 열쇠는 상대·내용이다**(2026-08-09). 헌장 ③ 의 조건
  // (`counterpartKnown`)이 계약으로만 있고 **세우는 배선이 없어** 화면 손은 같은 방에도
  // 매번 물었다(사거리 비대칭병). grant 가 카드와 함께 상대 열쇠를 나르도록 한 줄 더한다 —
  // 승인 판정 규칙은 안 바꾼다(새 상대·미상은 그대로 카드).
  'src/kernel/l2-plan/authority.js',
  // **F-9 · 표를 그린다**(0단계 옆줄 · 2026-08-08). 모델이 표를 정확히 냈는데 화면에
  // 파이프 문자가 그대로 떴다 — 장부 판정 ①(렌더러가 그리게 한다. 능력을 줄이는 쪽은
  // 방향이 아니다). 같은 안전 계약(선 escape · 우리 태그만) 안에서 표 블록만 넓힌다.
  'src/surface/web/markdown.js',
  'src/surface/web/index.html',
  // **노드 W · 모델의 창을 알고 몫을 나눈다**(2단계 · 2026-08-08). 이력 4,000자·결과 1,200자는
  // 창을 모른 채 박은 값이었고(입력 여유의 1%), ⑪이 그 상한에 정확히 잘렸다. 창표+설정 덮기
  // (작은 쪽)에서 예산을 세우고 이력·발화·결과 상한이 그 파생값이 된다. 모르는 모델은 옛 값.
  'src/kernel/l1-intent/model-window.js',
  'src/kernel/l1-intent/conversation.js',
  // 지금 실릴 모델 id 를 밝히는 문 하나(`activeModelId`) — doctor 와 같은 해석(두 진실 금지).
  'src/surface/model-connection.js',
  // §1-B 오너 지시(2026-08-09) — 「손이 세는 사실은 도메인 낱말 없이 참이어야 한다」.
  // 게이트 불변식의 기계(정의역·금지어·주석뺀코드)를 한 벌로 두는 모듈 — 게이트가 실제
  // 소스로 부르고 반대시험이 심은 소스로 불러 빨개짐을 확인한다(규격 4).
  'scripts/checks/fact-purity.mjs',
  // 5단계 다리(PM 지시 2026-08-09) — 설치 산출물에서 동봉 화면 손이 실제로 뜨는지까지
  // 다리가 검증한다(①⑥은 설치본 기준으로만 성립 — 소스 손 차용 측정 금지).
  'scripts/verify-package.mjs',
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
  // `gate-idle.mjs` 는 §1-A(벽시계→유휴) 판정식 — 게이트에서 검사가 대조할 수 있게 뺀 조각이다.
  /^scripts\/gate\.mjs$/, /^scripts\/gate-baseline\.json$/, /^scripts\/gate-idle\.mjs$/,
  // 판 회차 러너도 측정 하네스다 — 제품을 재는 대본이지 제품이 아니다(0단계 · 2026-08-08).
  /^scripts\/board\//,
  // 비교군 라이브 계측기도 같은 범주다 — 세 제품을 나란히 재는 자이지 제품이 아니다.
  // (6단계 · 2026-08-09. 기준선 f5ef144 에 이미 있던 파일들이라 여태 안 걸렸을 뿐,
  // 새 러너 step6-round.mjs 가 처음으로 "목록 밖"에 걸려 이 빈칸이 드러났다.)
  /^scripts\/compare-live\//,
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
      // **기준지문은 기계에 안 흔들려야 한다.** 화면 손은 이제 표준 자리를 스스로 훑는데
      // (PM 판정 2026-08-06 · 사장님이 켠 T5 에 손이 0개였다), 그러면 **이 컴퓨터에 뭐가
      // 깔렸느냐**로 도구 수가 바뀐다(실측 19 → 21). 지문은 계약을 재는 자이지 환경을 재는
      // 자가 아니다 — 자동 탐색을 끄고 잰다.
      GPAO_T5_NO_AUTO_SCREEN_BIN: '1',
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
