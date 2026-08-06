// S1 preflight 계약 검사 — **게이트가 정말 무는지**를 잰다.
//
// 왜 이 파일이 있는가: 첫 판 preflight 는 `off1 vs off2` 를 비교했다. 같은 것을 두 번 부르는
// 것이라 구조적으로 실패할 수 없었고, 판단 헌장에 라우팅 문구를 몰래 넣었는데도 전부
// 초록이었다(실측 2026-08-04). **통과만 하는 게이트는 게이트가 아니다** — 그래서 여기서
// 일부러 깨뜨려 걸리는 것을 확인한다(구조원칙 §2-C 그대로).
import test from 'node:test';
import assert from 'node:assert/strict';

import { preflight, 현실지문, 변경파일, 기준지문, 허용파일, 기준선 } from '../scripts/s1/preflight.mjs';

test('preflight: 현재 상태는 통과한다(기준선과 같다)', async () => {
  const { 결과, 통과 } = await preflight();
  assert.equal(통과, true, 결과.filter((r) => !r.통과).map((r) => `${r.이름}: ${r.근거}`).join(' / '));
});

test('preflight: 기준지문은 동결값이다(스스로 갱신되지 않는다)', async () => {
  // 지문이 코드에서 파생되면 무엇이 바뀌어도 늘 같다고 말한다 — 그건 기준선이 아니다.
  const 지문 = await 현실지문({ sovereign: false });
  assert.equal(지문.프롬프트, 기준지문.프롬프트, '제품 코드가 바뀌었으면 기준지문을 손으로 옮기고 이유를 적는다');
  assert.equal(지문.스키마, 기준지문.스키마);
  assert.equal(지문.도구수, 기준지문.도구수);
});

test('preflight: 판정이 동결 기준지문을 실제로 대조한다(자기 자신이 아니라)', async () => {
  // 첫 판의 병이 정확히 이것이었다 — 자기 자신과 비교하면 늘 통과한다.
  // 그러니 **근거 문자열에 동결값이 실려 있는지**를 본다. 실려 있지 않으면 대조 대상이
  // 코드에서 파생된 것이고, 그건 기준선이 아니다.
  const { 결과 } = await preflight();
  const 프롬프트항 = 결과.find((r) => r.이름.includes('시스템 프롬프트'));
  const 스키마항 = 결과.find((r) => r.이름.includes('도구 스키마'));
  assert.ok(프롬프트항, '프롬프트 대조 항목이 있다');
  assert.ok(프롬프트항.근거.includes(기준지문.프롬프트),
    `근거에 동결 기준값이 없다 — 자기 자신과 비교하는 중일 수 있다: ${프롬프트항.근거}`);
  assert.ok(스키마항.근거.includes(기준지문.스키마), `근거에 동결 스키마 기준값이 없다: ${스키마항.근거}`);

  // 실제 주입 반대검증(판단 헌장에 라우팅 문구 한 줄)은 소스를 건드려야 하므로 검사 밖에서
  // 수행했고 결과를 기록한다: 프롬프트 sha b5152b97 → 13c5adb1 로 바뀌며 이 항목이 **빨개졌다**.
  // 미커밋 오염(authority.js 한 줄)도 "목록 밖"으로 걸렸다.
});

test('preflight: 변경 파일 목록이 작업 트리와 미추적까지 본다', () => {
  // 첫 판은 `git diff base..HEAD` 라 커밋만 봤고, 미커밋 오염이 통째로 안 보였다
  // (실측: authority.js 에 한 줄 넣었는데 "제품 변경 0개"로 통과).
  const 목록 = 변경파일(process.cwd(), 기준선);
  assert.ok(Array.isArray(목록));
  // 이 시험 파일 자신은 test/ 라 무시 목록에 들어간다 — 제품 변경만 남는다.
  assert.ok(목록.every((p) => !p.startsWith('test/')), `검사 파일이 제품 변경으로 샜다: ${목록}`);
  assert.ok(목록.every((p) => !p.endsWith('.md')), '문서가 제품 변경으로 샜다');
  // **이 검사는 통과하면서 깨져 있었다**(2026-08-05). git 은 비ASCII 경로를 따옴표로 감싸
  // 8진 이스케이프해서 준다(`"docs/…/\354\203\210-….md"`). 그러면 위 두 줄이 전부 빗나간다 —
  // `.md` 로 끝나지 않고 `test/` 로 시작하지도 않기 때문이다. 한글 이름이 대부분인 저장소에서
  // 무시 필터가 통째로 새고 있었고, 검사는 초록이었다. **재는 자리를 검증하지 않으면 그렇게 된다.**
  assert.ok(목록.every((p) => !p.startsWith('"')),
    `git 이 따옴표로 감싼 경로가 그대로 왔다 — 무시 필터가 전부 빗나간다: ${목록.filter((p) => p.startsWith('"'))}`);
  assert.ok(목록.every((p) => !/\\\d{3}/.test(p)),
    `8진 이스케이프된 경로가 그대로 왔다(한글 이름이 원문으로 안 온다): ${목록.filter((p) => /\\\d{3}/.test(p))}`);
});

test('preflight: 허용 파일 목록이 슬라이스 범위와 같다', () => {
  // 목록이 넓어지면 "플래그뿐"이 무너진다. 넓힐 때는 이 시험이 먼저 걸린다.
  // 넓힐 때는 이 시험이 먼저 걸린다 — 그게 이 시험의 일이다. 넓힌 이유는 `preflight.mjs`
  // 의 `허용파일` 주석에 적혀 있어야 한다(2026-08-04: 실행 벽 수정으로 기준선 이동).
  assert.deepEqual(허용파일, [
    // 화면 손 쓰는 법(사다리·순서)을 모델에게 가르치는 자리(노드 ② · 2026-08-06).
    // 커널이 사다리를 만들어 뒀는데 모델이 있는 줄 몰라 여섯 번 다 사람에게 떠넘겼다.
    'src/kernel/screen-guidance.js',
    // 그림 크기만 봉투에서 읽는다 — 모델이 짚을 자를 주려면 필요하고, 알맹이는 안 본다.
    'src/runtime/image-size.js',
    // 손이 무엇을 보는지 축으로 선언한다 — 커널이 같은 것을 보는 손을 고를 수 있게.
    'src/kernel/l2-plan/tool-descriptor.js',
    // 그 축을 selfState 가 나른다.
    'src/kernel/l0-evidence/self-state.js',
    // 화면 손을 스스로 찾는다 — 환경변수를 손으로 넣어야 붙는 손은 제품에 없는 손이다.
    'src/runtime/desktop-bin.js',
    // **화면 손 실행 파일**(오너 결정 2026-08-07: T5 설치에 같이 담는다).
    // 코드가 아니라 산출물이라 지문에 안 잡히지만, 빠지면 손이 통째로 없어진다.
    'vendor/cua-driver/darwin-arm64/cua-driver',
    'src/kernel/turn.js',
    'src/kernel/l1-intent/task-context.js',
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
    'src/kernel/l2-plan/action-plan.js',
    // 통제 채널 설명에 **되는 것**을 더했다(2026-08-04). 라이브 2회에서 모델이 자동화 채널을
    // 쥐고도 "예약 기능이 없다"며 사용자에게 cron 을 짜 줬다 — 설명이 안 되는 것만 말했다.
    'src/kernel/l2-plan/model-control.js',
    'src/kernel/model-sovereign.js',
    // §S2 본 전환 — 심문 ① 을 걷고 그 자리를 승인 경계로 대체했다(2026-08-04).
    'src/kernel/l2-plan/carryover.js',
    'src/kernel/turn-budget.js',
    'src/runtime/local-file.js',
    'src/runtime/model-provider.js',
    'src/runtime/tool-runner.js',
    'src/surface/demo-context.js',
    'src/runtime/chatgpt-model-client.js',
    'src/runtime/local-file.js',
    'src/runtime/local-locate.js',
    'src/runtime/session-search-tool.js',
    'src/kernel/l0-evidence/ledger.js',
    // **제안과 실행을 나눈다**(2026-08-04). 계약은 "호출 안 했으면 actualCall 은 null" 인데
    // 다중 호출 줄 세우기가 미실행 호출에도 채우고 있었다 — 원장이 "안 부른 것"을 "부른 것"으로
    // 말했다. `제안한호출` 칸을 세워 모델은 자기 호출을 그대로 돌려받고 원장은 정직해진다.
    'src/kernel/contracts.js',
    'src/kernel/l0-evidence/tool-receipt.js',
    // F-8 · answer_reset — 되돌린 답이 앞의 답에 이어붙지 않게(2026-08-04).
    'src/kernel/l0-evidence/turn-event.js',
    'src/kernel/turn-surface.js',
    // 표면 사실에 받는 쪽을 더했다(2026-08-04).
    'src/kernel/l0-evidence/response-surface.js',
    // CU-1 계열 A·B(2026-08-06) — 신분은 한 벌로만, 드라이버 답은 한 자리에서.
    // 조각을 따로 집고 답을 흩어져 읽다가 같은 병을 여러 번 밟았다.
    'src/runtime/desktop-identity.js',
    'src/runtime/desktop-driver-answer.js',
    // F-32 — 비밀만 가리고 나머지는 준다(2026-08-05). 하나 걸렸다고 답을 통째로 버리면
    // 사용자는 화면 정보를 하나도 못 받는다. 가린 뒤 다시 검사해서 그때도 걸리면 버린다.
    'src/kernel/l0-evidence/sensitive-text.js',
    'src/surface/server.js',
    'src/runtime/capsule.js',
    'src/runtime/sandbox.js',
    'src/runtime/terminal-run.js',
    // **터미널 유보 해제**(오너 결정 2026-08-06) — 읽기성 네트워크를 승인에서 뺐다.
    // 넓힌 이유는 `preflight.mjs` 의 `허용파일` 주석에 적혀 있다.
    'src/runtime/local-terminal.js',
    // 주석만 고쳤다(F-46) — 선언 넷과 강제 홈 전체가 두 진실이라 그 사실을 머리말에 적었다.
    'src/runtime/file-scope.js',
    // design/ 정리(2026-08-06) — `design/archive` 를 감사 제외 경로에 더했다.
    'scripts/audit-project-entry.mjs',
    // 계획서 도달성 게이트(검사 10 · 2026-08-06) — 맵이 가리킨 노드 절이 있는지,
    // 노드마다 파일·근거가 있는지. 이유는 `preflight.mjs` 의 `허용파일` 주석에 적혀 있다.
    'scripts/audit-docs.mjs',
    // 검사 임시방 정리(오너 지시 2026-08-07) — TMPDIR 전용 방을 주고 그 방만 지운다.
    // 접두 목록으로는 샌다(mkdtemp 400곳 · what-·zero-locate- 까지 있다).
    'scripts/gate.mjs',
    // 정리량을 세는 함수. gate.mjs 는 불러오면 게이트가 도는 스크립트라 따로 뺐다.
    'scripts/dir-size.mjs',
    // 주석만 — 오너 결정(사용자 브라우저를 쓴다)을 그 자리에 기록했다. 구현 아님.
    'src/runtime/browser.js',
    'src/surface/demo-context.js',
    'src/surface/live-context.js',
    'src/runtime/tool-runner.js',
    'src/surface/web/index.html',
    'src/kernel/l2-plan/exit-verification.js',
    'src/runtime/model-provider.js',
    // S0 계측(2026-08-05) — 조립된 프롬프트를 보는 모듈. 기본 꺼짐이라 제품 동작을 안 바꾼다.
    'src/runtime/prompt-dump.js',
    // F-15(2026-08-05) — 거짓 성공 게이트를 문구가 아니라 뒷받침 없는 구체 사실로 판정한다.
    'src/kernel/l2-plan/recovery-ladder.js',
    // S4 집(2026-08-05) — 사용자가 열어 고치는 지침·자기소개. 매 세션 실리고 예산이 있다.
    'src/surface/agent-home.js',
    // S5a 기억이 집에 산다(2026-08-05) — 줄을 지우면 T5 가 잊는다. 원장은 그대로.
    'src/surface/memory-home.js',
    // S6-a 실행 경계(2026-08-05) — 두 벌 판정을 한 벌로 만드는 첫 자리. 행동 변화 0.
    'src/kernel/l2-plan/tool-boundary.js',
    // **S7 착수 조건 ① — 손 제시 계측**(오너 지시 2026-08-05).
    // *"안 준 손은 흔적이 없다."* S7 은 손 집합 자체를 바꾸는 칸이라 틀려도 화면에 안 나타난다.
    // S6 은 216칸 표가 잡았지만 여기는 잡을 표가 없어, 거른 사실을 기록으로 만드는 것이
    // 착수 전 조건이다. 판정하지 않고 이미 난 결정을 볼 수 있게만 한다.
    'src/kernel/l2-plan/tool-offer.js',
    // **F-18 을 걷은 자리**(2026-08-05 · 오너가 S7 착수 조건 ③ 으로 "고치는 칸"이라 못 박았다).
    // 오너 설치 실측: 승격된 기억 0개 · 집 파일 비어 있음 — 기억이 모델에게 한 번도 간 적이 없다.
    // 그 위에 낱말 겹침 필터가 얹혀 `"내가 뭘 마시는지 알아?"` 에 `"홍차를 마신다"` 가 안 실렸다.
    // **분류기가 사실 공급 여부를 정하고 있었다.** 선호는 사용자에 대한 사실이라 발화로 거르지
    // 않고 개수만 묶는다. 검증 사례가 있는 원칙은 그대로 사례로 범위가 정해진다.
    'src/kernel/l1-intent/context-mesh.js',
    // S7 ③ · F-18 — 사실 공급을 분류기가 정하지 않는다(플래그 `T5_FACTS_UNFILTERED` 뒤).
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
    // **찾는 손과 읽는 손을 나눈다**(2026-08-05 · S8 ③). `web.collect{request}` 한 칸에
    // "찾을 것"과 "읽을 주소"가 섞여 있어 모델이 **"후보만 보여 줘"를 부를 수 없었다.**
    // 고를 기회가 없으니 고를 수 없고, 그게 같은 코드로 6턴을 돌려 4턴만 맞던 편차의 정체다.
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
  ]);
});
