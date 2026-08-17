// 칸 0 · 상태 계측기 검사 (선빨강)
//
// 무는 것: 계획서 §2「지금 상태」를 사람이 손으로 안 고쳐도 되게 하는 계측기가
// **실제로 돌고**, 오늘 확인된 기계 사실과 **어긋나면 빨개진다**.
//
// 왜 필요한가: 오늘 PM 계획서가 하루에 세 번 틀렸다(A5 이미 닫힘 · A1 과잉 진단 ·
// A6 오분류). 전부 코드 대조 없이 옛 문안을 옮긴 탓이다. 문서는 낡지만 스크립트는
// 안 낡는다. 이 검사는 **계측기가 낡지 않았는지**를 문다.
//
// 이 검사는 판정하지 않는다 — 계측기가 코드에서 뜬 값과, 오늘 사람이 코드에서 직접
// 읽은 값이 같은지만 대조한다. 코드가 바뀌면 이 검사가 먼저 빨개지고, 그때
// §2 를 고칠지 계측기를 고칠지는 사람이 정한다.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);
const 저장소 = dirname(dirname(fileURLToPath(import.meta.url)));
const 계측기 = join(저장소, 'scripts', 'state-probe.mjs');

/** 계측기를 실제로 돌린다. 종료 코드는 항상 0 이어야 한다(계측기는 판정하지 않는다). */
// ★ **같은 계측을 열일곱 번 다시 돌리고 있었다**(F-104 곁가지 · 2026-08-12).
// 이 파일의 검사 대부분이 `계측(['--json'])` 을 각자 새 프로세스로 부른다 — 한 번에 ~0.8초라
// 게이트의 **테스트 CPU 기준선**(§17)을 이 파일 하나가 크게 밀어 올렸다.
// 계측기는 **같은 입력에 같은 값을 내는 읽기 전용**이므로 인자별로 한 번만 돌리고 나눠 쓴다.
// 기준선을 올리는 것이 금지(C5)라, 자를 무르게 하는 대신 **같은 것을 여러 번 재는 낭비**를 없앤다.
const 계측결과 = new Map();
async function 계측(args = []) {
  const 열쇠 = JSON.stringify(args);
  if (!계측결과.has(열쇠)) {
    계측결과.set(열쇠, run(process.execPath, [계측기, ...args], {
      cwd: 저장소,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GPAO_T5_STATE_PROBE_TEST: '1' },
    }).then(({ stdout, stderr }) => ({ stdout, stderr })));
  }
  return 계측결과.get(열쇠);
}

test('칸0 계측기: 실행되고 기계 판독용 JSON 을 낸다', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  assert.equal(typeof 결과, 'object');
  assert.ok(Array.isArray(결과.hands), 'hands 배열이 있어야 한다');
  assert.ok(Array.isArray(결과.modelExposedTools?.names), 'modelExposedTools.names 배열이 있어야 한다');
  assert.ok(Array.isArray(결과.controlChannels), 'controlChannels 배열이 있어야 한다');
  assert.ok(Array.isArray(결과.organs), 'organs 배열이 있어야 한다');
  assert.ok(Array.isArray(결과.absence), 'absence 배열이 있어야 한다');
});

test('칸0 계측기 ①: desktop.act 동사 17개를 코드에서 떠서 낸다', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  const 화면손 = 결과.hands.find((h) => h.id === 'desktop.act');
  assert.ok(화면손, 'desktop.act 손이 인벤토리에 있어야 한다');
  assert.equal(화면손.verbs?.length, 17, `desktop.act 동사는 17개다 — 실측 ${JSON.stringify(화면손.verbs)}`);
  assert.ok(화면손.verbs.includes('type'), 'desktop.act 는 칸에 글자를 넣을 수 있다(성질 1 의 근거)');
});

// **기대값이 뒤집혔다**(2026-08-11 · C5 — 기준 완화가 아니라 현실 이동).
// 원본: `browser.act 동사에 type·navigate 가 없다`. `type` 부재는 PM 이 「정밀 읽기 전용」
// 으로 정한 결과였고, 실측이 그 결정을 뒤집었다 — 브라우저로 열어 놓고 글자를 치려니
// 화면 손(픽셀)으로 돌아갔고 **승인 카드 2장**이 떴다(「사용자 손 0회」가 깨진 자리).
// `navigate` 는 그대로 없다 — 주소로 여는 것은 `browser.observe:open` 하나로 족하다.
test('칸0 계측기 ②: browser.act 동사에 type·press 는 있고 navigate 는 없다', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  const 브라우저손 = 결과.hands.find((h) => h.id === 'browser.act');
  assert.ok(브라우저손, 'browser.act 손이 인벤토리에 있어야 한다');
  assert.ok(Array.isArray(브라우저손.verbs), 'browser.act 는 action enum 이 있다');
  assert.equal(브라우저손.verbs.includes('type'), true, `browser.act 에 type 이 있다 — 실측 ${JSON.stringify(브라우저손.verbs)}`);
  assert.equal(브라우저손.verbs.includes('press'), true, `browser.act 에 press 가 있다 — 실측 ${JSON.stringify(브라우저손.verbs)}`);
  assert.equal(브라우저손.verbs.includes('navigate'), false, `browser.act 에 navigate 는 없다 — 실측 ${JSON.stringify(브라우저손.verbs)}`);
});

test('칸0 계측기 ③: automation.control operation 에 commit 이 있다(오늘 조립됨)', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  const 채널 = 결과.controlChannels.find((c) => c.name === 'automation.control');
  assert.ok(채널, 'automation.control 채널이 있어야 한다');
  assert.ok(Array.isArray(채널.operations), 'automation.control 은 operation enum 이 있다');
  assert.ok(채널.operations.includes('commit'), `commit 이 있어야 한다 — 실측 ${JSON.stringify(채널.operations)}`);
});

test('칸0 계측기 ④: 서버 실기동으로 모델이 실제 받은 도구 목록에 local.file 이 있다', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  const 노출 = 결과.modelExposedTools;
  assert.equal(노출.capturedFrom, 'live-server-turn', '추정이 아니라 실기동 한 턴에서 떠야 한다');
  assert.ok(노출.names.includes('local.file'), `모델 노출 도구에 local.file 이 있어야 한다 — 실측 ${JSON.stringify(노출.names)}`);
  assert.ok(노출.names.length > 0, '도구 이름이 하나라도 잡혀야 한다');
});

// ★ **이 검사가 틀린 사실을 못박고 있었다**(F-104 · 2026-08-12).
// 옛 판은 `assert.equal(부재.found.length, 0)` — *"문서 생성 부품은 0건이다"* 를 **계약으로**
// 세웠다. 그런데 그건 사실이 아니었다: xlsx 는 `document-intake.js:buildXlsx` 가 **직접 만들고**,
// pdf·docx 는 `src/skills/pdf-docx/SKILL.md` 가 `cupsfilter`·`textutil` 로 **만든다.**
// 계측기 검색어가 외부 라이브러리 이름뿐이라 0건이 나왔고, **그 0 을 이 검사가 봉인했다** —
// 그래서 아무도 못 고쳤고 지도·계획서가 「기관 ⑧ = 없음」을 받아 적었다.
// 자를 무르게 하는 것이 아니라 **틀린 동결을 푸는 것**이다. 계약은 F-56 그대로 남는다:
// *"부재를 주장하려면 무엇을 찾았는지 함께 낸다."*
test('칸0 계측기: 부재 주장은 근거(검색어·경로·양성대조)와 함께 낸다', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  const 부재 = 결과.absence.find((a) => a.subject === 'xlsx-create');
  assert.ok(부재, 'xlsx 생성 부재 확인 항목이 있어야 한다');
  assert.ok(부재.found.length > 0,
    '**xlsx 생성기는 실재한다** — 0건이 나오면 자가 또 눈이 먼 것이다(F-104)');
  // F-56: 관측 안 됨 ≠ 부재. 무엇을 찾았는지 함께 내야 부재를 주장할 수 있다.
  assert.ok(부재.searchedTerms?.length > 0, '검색어를 함께 내야 한다');
  assert.ok(부재.searchedPaths?.length > 0, '검색 경로를 함께 내야 한다');
  assert.ok(Number.isInteger(부재.filesScanned) && 부재.filesScanned > 0, '실제로 훑은 파일 수를 내야 한다');
});

test('칸0 계측기: 기관 열 전부에 대해 있는 동사 / 요구 동사 / 빠진 것을 낸다', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  assert.equal(결과.organs.length, 10, '계획서 §4 의 기관은 열이다');
  for (const 기관 of 결과.organs) {
    assert.ok(Array.isArray(기관.have), `${기관.key}: 있는 동사`);
    assert.ok(Array.isArray(기관.required), `${기관.key}: 요구 동사`);
    assert.ok(Array.isArray(기관.missing), `${기관.key}: 빠진 것`);
  }
  // ⑧ 문서 만들기는 만들기 동사가 전부 빠져 있다(계획서 §4 — 유일한 진짜 신축)
  // ⑧ 문서 만들기 — **셋 다 있다**(F-104 정정): xlsx 자체 구현 · pdf·docx 스킬.
  const 문서 = 결과.organs.find((o) => o.key === 'document-create');
  assert.equal(문서.missing.length, 0,
    `문서 만들기 셋은 실재한다(xlsx 자체 구현 · pdf·docx 스킬) — 실측 ${JSON.stringify(문서.missing)}`);
  // ⑤ 화면 손은 상한이 "새 동사 추가 없음" 이므로 빠진 동사가 0 이다 — 결손은 동사가 아니라 쓰임이다
  const 화면 = 결과.organs.find((o) => o.key === 'screen-hand');
  assert.equal(화면.missing.length, 0, `화면 손 상한은 새 동사 추가 없음 — 실측 ${JSON.stringify(화면.missing)}`);
});

// **이 검사는 2026-08-11 에 기대값이 뒤집혔다. 기준 완화가 아니라 계측 교정이다**(C5).
//
// 원본 기대값: `자동화·에이전트·스킬 ○ / 기억 ✕` — **틀린 채로 초록이었다.**
// 계측기가 저장소 배열 길이를 「확정」으로 셌고, 이 검사가 그 정의를 못박고 있었다.
// 그래서 `state:'proposed'` 로 앉은 스킬·담당이 ○ 로 나갔다. 같은 표 안에서 자동화가
// `binding_not_active` 로 떨어질 때조차 ○ 였다 — 계측기가 자기 표에서 모순을 냈다.
//
// 교정: 「선다」의 판정을 **제품이 실제로 쓰는 게이트**(canInfluence · canStartAgentRun ·
// isInfluenceEligible · projectAutomations)로 옮겼다. 검사도 그 축으로 다시 쓴다.
// 사유·원본 기대값을 여기 남긴다(C5 — 원본 실패 보존 + 이유 기록). 오너 지시 2026-08-11.
test('칸0 계측기: 확정 계열은 **저장이 아니라 활성**으로 잰다 — 저장>활성이면 안 선 것이다', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  const 표 = new Map(결과.settlementLineage.map((s) => [s.key, s]));

  // 두 값을 **따로** 낸다. 하나로 접으면 오늘의 오판이 그대로 돌아온다.
  for (const key of ['skill', 'agent', 'memory', 'automation']) {
    const 줄 = 표.get(key);
    assert.ok(Number.isInteger(줄?.stored), `${key}: 저장 수가 정수로 서야 한다`);
    assert.ok(Number.isInteger(줄?.settled), `${key}: 활성 수가 정수로 서야 한다`);
    assert.ok(줄.settled <= 줄.stored, `${key}: 활성이 저장보다 많을 수 없다`);
    assert.ok(줄.gate, `${key}: 어떤 게이트로 셌는지 함께 낸다 — 판정 근거 없는 숫자는 안 쓴다`);
    assert.equal(줄.settles, 줄.settled > 0, `${key}: 「섰나」는 활성으로만 판정한다`);
  }

  // 스킬·에이전트 — **만들어는 지는데 켜지지 않는다.** 제안 동사는 후보 상태로만 앉히고,
  // 활성으로 올리는 경로가 모델에게도 화면에도 없다(코드 대조 2026-08-11).
  assert.ok(표.get('skill').stored > 0, '스킬 제안은 저장까지 간다 — 제안 자체가 안 되는 것이 아니다');
  assert.equal(표.get('skill').settles, false, '스킬은 활성이 0 이라 안 선다');
  assert.ok(표.get('agent').stored > 0, '담당 제안은 저장까지 간다');
  assert.equal(표.get('agent').settles, false, '담당은 활성이 0 이라 안 선다');

  // 기억 — 후보는 서는데 승격이 0 (계획서 §3 성질 3).
  assert.ok(표.get('memory').candidates > 0, '기억 후보는 실제로 선다');
  assert.equal(표.get('memory').settles, false, '기억은 후보에서 멈춘다');

  // 자동화 — **씨앗(활성 스킬·활성 담당)이 있는 방에서만** commit 이 붙는다.
  // 씨앗 없는 방에서는 `binding_not_active` 로 떨어진다(신선 설치가 그 조건이다).
  assert.equal(표.get('automation').settles, true,
    `자동화는 commit 으로 살아 있는 예약까지 간다 — 거절 사유 ${표.get('automation').rejectedReason ?? '없음'}`);
});

test('칸0 계측기: 캐시 접두 안정성을 낸다 (제품 원가)', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  const c = 결과.cachePrefix;
  assert.ok(c.calls > 0, '모델 호출 판이 잡혀야 한다');
  assert.ok(c.stableCaptured > 0, '안정 접두를 뜬 판이 있어야 한다');
  assert.ok(Number.isInteger(c.systemStableShaKinds) && c.systemStableShaKinds >= 1, '안정 접두 지문 종류 수');
  assert.ok(Number.isInteger(c.toolListShaKinds) && c.toolListShaKinds >= 1, '도구 목록 지문 종류 수');
  assert.ok(c.systemStableCharsMin > 0 && c.systemStableCharsMax >= c.systemStableCharsMin, '안정부 크기 최소~최대');
});

// **기대값이 뒤집혔다**(2026-08-11). 원본: `Input.* 부재를 근거와 함께 낸다`.
// 타이핑을 열면서 `Input.insertText`·`Input.dispatchKeyEvent` 를 배선했다. 부재를 세던
// 검사는 이제 **존재**를 센다 — 그리고 열린 것이 그 둘뿐임(마우스 좌표 이벤트는 없음)을
// 함께 문다. 좌표 타이핑을 열지 않았다는 것이 이 슬라이스의 경계이기 때문이다.
test('칸0 계측기: 브라우저 CDP 를 코드에서 떠서 Input.* 를 근거와 함께 낸다', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  const b = 결과.browserCdp;
  for (const d of ['Page', 'Runtime', 'Target']) {
    assert.ok(b.domains.includes(d), `${d} 도메인이 있어야 한다 — 실측 ${JSON.stringify(b.domains)}`);
  }
  assert.equal(b.hasInputDomain, true, `Input.* 가 있다 — 실측 ${JSON.stringify(b.inputHits)}`);
  assert.ok(b.inputHits.includes('Input.insertText'), `글자는 insertText 로 넣는다 — 실측 ${JSON.stringify(b.inputHits)}`);
  assert.equal(b.inputHits.includes('Input.dispatchMouseEvent'), false,
    `좌표로 짚는 길은 열지 않았다 — 실측 ${JSON.stringify(b.inputHits)}`);
  assert.ok(b.inputSearchedTerms.length > 0, '있다/없다를 주장하려면 검색어를 함께 낸다(F-56)');
});

test('칸0 계측기: 창 예산 표·문서 읽기 형식·l5-growth 고아를 코드에서 센다', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  assert.equal(결과.windowTable.count, 3, `창 예산 표는 3종 — 실측 ${JSON.stringify(결과.windowTable.models)}`);
  assert.equal(결과.readFormats.familyCount, 4,
    `문서 읽기는 4계열 — 실측 ${JSON.stringify(결과.readFormats.families)}`);
  assert.deepEqual(결과.growthOrphans.orphans, ['tcell-verdict.js'],
    `l5-growth 고아는 tcell-verdict.js 하나 — 실측 ${JSON.stringify(결과.growthOrphans.orphans)}`);
});

test('칸0 계측기: 유료로만 알 수 있는 항목은 값을 지어내지 않고 §2 를 인용한다', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  assert.equal(결과.paidOnly.available, true, '계획서 §2 블록을 실제로 떠야 한다');
  assert.ok(결과.paidOnly.items.length > 0);
  for (const p of 결과.paidOnly.items) {
    assert.equal(p.상태, '미측정(유료 필요)');
    assert.ok(p.재측정명령?.length > 0, `${p.항목}: 재측정 명령이 있어야 한다`);
    assert.ok(p.최종측정값?.length > 0, `${p.항목}: 최종 측정값(인용)이 있어야 한다`);
  }
  // 인용은 **파일에서 온다** — 계측기가 값을 알고 있으면 안 된다.
  const 회귀 = 결과.paidOnly.items.find((p) => p.항목 === '회귀 건수');
  // 값은 문서가 갖는다 — 여기서는 「§2 의 회귀 줄을 인용했다」는 모양만 잰다.
  // (숫자를 박으면 문서가 갱신될 때마다 이 검사가 낡는다 — 2026-08-12 3,721 갱신에서 실제로 밟았다.)
  assert.match(회귀.최종측정값, /^회귀\s+[\d,]+건/, '§2 의 회귀 줄을 그대로 인용한다');
  assert.match(회귀.출처, /T5-FINAL-ASSEMBLY-ko\.md/);
});

test('칸0 계측기: 정답을 계측기 본체에 적어 넣지 않는다 (하드코딩 0)', async () => {
  const { readFile } = await import('node:fs/promises');
  const 소스 = await readFile(계측기, 'utf8');
  // 계측기가 값을 알고 있으면 문서보다 나쁘다 — 안 낡은 척하기 때문이다.
  for (const 금지 of ['tcell-verdict', '3,721', '3721']) {
    assert.equal(소스.includes(금지), false, `계측기 본체에 정답 '${금지}' 가 있으면 안 된다`);
  }
  // 동사 수·와이어 수 같은 **측정값**을 기대치로 박아 두는 것도 금지다.
  assert.equal(/개수:\s*\d+/.test(소스), false, '동사 수 기대치를 상수로 박지 않는다');
});

// **기대값이 뒤집혔다**(2026-08-11). 원본: `타이핑은 결손이 아니다 — 안 여는 것이 설계다`.
// 그 「설계」는 PM 결정이었고 실측이 뒤집었다(승인 카드 2장). 이제 타이핑은 요구이고
// **채워져 있다.** 대신 **열지 않은 것이 여전히 안 열려 있는지**를 같은 줄에서 문다 —
// 뒤집으면서 경계까지 함께 넓히는 것이 가장 흔한 사고라서다.
test('칸0 계측기 ⑥: 타이핑은 요구이고 채워졌다 — 그러나 폼 제출·구매는 여전히 안 열렸다', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  const 브라우저 = 결과.organs.find((o) => o.key === 'browser-hand');
  assert.ok(브라우저.required.some((r) => r.startsWith('타이핑')),
    `타이핑이 ⑥ 의 요구다 — 실측 ${JSON.stringify(브라우저.required)}`);
  assert.equal(브라우저.missing.some((m) => m.includes('browser.act:type')), false,
    `타이핑 요구가 아직 비어 있다 — 실측 ${JSON.stringify(브라우저.missing)}`);
  assert.equal(브라우저.missing.some((m) => m.includes('browser.act:press')), false,
    `검색 엔터 요구가 아직 비어 있다 — 실측 ${JSON.stringify(브라우저.missing)}`);
  // 손의 **기계 사실**로도 확인한다(② 검사가 무는 자리와 같은 값).
  const 손 = 결과.hands.find((h) => h.id === 'browser.act');
  assert.equal(손.verbs.includes('type'), true);
  assert.equal(손.verbs.includes('press'), true);
  // 경계 — 뒤집힌 것은 타이핑 하나뿐이다.
  for (const 안연것 of ['submit', 'upload', 'buy', 'navigate']) {
    assert.equal(손.verbs.includes(안연것), false, `${안연것} 은 안 열었다 — 실측 ${JSON.stringify(손.verbs)}`);
  }
  assert.ok(/폼 제출·전송·구매는 열지 않는다/.test(브라우저.상한 ?? ''),
    `상한에 안 여는 것이 그대로 남아야 한다 — 실측 ${브라우저.상한}`);
});

test('칸0 계측기 ⑥: 정밀 읽기의 알맹이 — 텍스트 추출은 있고, 요소 목록은 전달에서 잘린다', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  const 브라우저 = 결과.organs.find((o) => o.key === 'browser-hand');
  assert.ok(브라우저.required.some((r) => r.startsWith('텍스트 추출')), '텍스트 추출이 요구에 있다');
  assert.ok(브라우저.required.some((r) => r.startsWith('요소 목록')), '요소 목록이 요구에 있다');
  assert.ok(브라우저.have.some((h) => h.startsWith('텍스트 추출')),
    `텍스트 추출은 코드에 있다 — 실측 ${JSON.stringify(브라우저.have)}`);
  assert.ok(브라우저.missing.some((m) => m.startsWith('요소 목록')),
    `요소 목록은 모델까지 안 간다 — 실측 ${JSON.stringify(브라우저.missing)}`);

  // F-56: 「없음」이라 적었으면 **찾은 자리**가 함께 있어야 한다.
  const 글 = 결과.absence.find((a) => a.subject === 'browser-text-extract');
  assert.ok(글.foundCount > 0, '텍스트 추출은 히트가 있어야 한다');
  const 요소 = 결과.absence.find((a) => a.subject === 'browser-element-list-to-model');
  assert.equal(요소.foundCount, 0);
  assert.ok(요소.searchedTerms.length > 0 && 요소.searchedPaths.length > 0, '검색어·경로를 함께 낸다');
  // 모아 놓고 걸러내는 자리를 짚어야 한다 — "안 만들었다"와 "잘라서 안 준다"는 다른 사실이다.
  assert.ok(요소.ambiguousCount > 0 && 요소.ambiguous.some((h) => h.term === 'canOpen'),
    `잘리는 자리(canOpen)를 찾은 자리로 내야 한다 — 실측 ${JSON.stringify(요소.ambiguous)}`);
});

test('칸0 계측기: 체감 지표를 저장된 회차 기록에서 사후 집계한다 — 비율은 안 낸다', async () => {
  const { stdout } = await 계측(['--json']);
  const e = JSON.parse(stdout).experience;
  assert.ok(e.recordFiles > 0, '집계한 회차 기록이 있어야 한다');
  assert.ok(e.turnsScanned > 0, '집계한 턴이 있어야 한다');
  // ① 승인 대기 · ④ 결과 없이 닫힌 턴은 건수와 **목록**을 낸다.
  assert.ok(Number.isInteger(e.승인대기.count));
  assert.ok(Array.isArray(e.승인대기.turns));
  assert.ok(Number.isInteger(e.결과없이닫힌턴.count));
  assert.ok(Array.isArray(e.결과없이닫힌턴.turns));
  // 비율은 계측기가 내지 않는다 — 분모(과업/문답)는 사람 판정이다.
  assert.equal(typeof e.비율, 'string');
  for (const 칸 of ['승인대기', '결과없이닫힌턴']) {
    assert.equal(Object.hasOwn(e[칸], 'rate'), false, `${칸}: 비율을 내면 안 된다`);
    assert.equal(Object.hasOwn(e[칸], '비율'), false, `${칸}: 비율을 내면 안 된다`);
  }
  // 묶음별로도 낸다 — 합계만 내면 어느 시험의 수인지 알 수 없다.
  assert.ok(e.byRecordSet.length > 0);
  assert.ok(Array.isArray(e.skippedSets), '집계에서 빠진 묶음을 숨기지 않는다');
});

test('칸0 계측기: 못 잰 것은 0 이 아니라 「계측 불가 · 사유」로 낸다', async () => {
  const { stdout } = await 계측(['--json']);
  const e = JSON.parse(stdout).experience;
  // ③ 거짓 건수 — 회차 기록에 손의 전·후 값이 없다. **0 으로 적으면 계측기가 거짓말을 시작한다.**
  assert.equal(e.거짓건수.계측불가, true, '거짓 건수를 숫자로 적으면 안 된다');
  assert.ok(e.거짓건수.사유?.length > 0, '계측 불가에는 사유가 붙는다');
  assert.equal(Object.hasOwn(e.거짓건수, 'count'), false, '못 잰 것에 건수를 달지 않는다');
  // ⑤ ask.user — fresh 턴에는 selector로 지연 공개된다. full schema를 상시 노출했다고 말하면 거짓이다.
  assert.equal(e.askUser.exposedToModel, false, 'fresh 턴에 ask.user full schema를 상시 노출했다');
  assert.equal(e.askUser.availableViaSelector, true, 'ask.user로 가는 selector 통로가 없다');
  assert.equal(e.askUser.usageCount.계측불가, true, '사용 횟수를 0 으로 적으면 안 된다');
  assert.ok(e.askUser.usageCount.사유?.length > 0);
});

test('칸0 계측기: 사람이 읽는 표를 내고 종료 코드는 0 이다', async () => {
  const { stdout } = await 계측([]);
  assert.ok(stdout.includes('손 인벤토리'), '사람이 읽는 표에 손 인벤토리가 있어야 한다');
  assert.ok(stdout.includes('desktop.act'), '표에 화면 손이 보여야 한다');
  assert.ok(stdout.includes('기관별 결손'), '표에 기관별 결손이 있어야 한다');
  assert.ok(stdout.includes('확정 계열'), '표에 확정 계열이 있어야 한다');
  assert.ok(stdout.includes('캐시 접두 안정성'), '표에 캐시 접두 안정성이 있어야 한다');
  assert.ok(stdout.includes('미측정(유료 필요)'), '표에 유료 필요 항목이 있어야 한다');
  assert.ok(stdout.includes('체감 지표'), '표에 체감 지표가 있어야 한다');
  assert.ok(stdout.includes('계측 불가'), '표가 못 잰 것을 「계측 불가」로 말해야 한다');
});

test('칸0 계측기: 채널 ⑦ 은 mail.send 를 「있음」으로 세지 않는다 (선언만 있고 손이 없다)', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  const 메일 = 결과.hands.find((h) => h.id === 'mail.send');
  assert.ok(메일, 'mail.send 선언은 있다');
  assert.equal(메일.handlerSlotExists, false, 'mail.send 는 손이 붙을 자리가 없다');
  const 채널 = 결과.organs.find((o) => o.key === 'channel');
  assert.ok(채널.missing.some((m) => m.includes('mail.send')),
    `선언만 있는 손을 「있음」으로 세면 안 된다 — 실측 ${JSON.stringify(채널.missing)}`);
});

test('칸0 계측기: 사람이 읽는 표가 JSON 과 같은 사실을 말한다 (칸 이름이 어긋나면 빨개진다)', async () => {
  // 첫 판에서 표가 지워진 칸 이름(`handlerInjectable`)을 읽어 **모든 손을 손 없음**으로
  // 그렸다 — JSON 은 맞았는데 사람이 보는 자리만 틀렸다. 계측기가 사람에게 거짓을
  // 보여주면 계측기가 아니다. 두 출력이 같은 사실을 말하는지 여기서 문다.
  const [{ stdout: 표 }, { stdout: 제이슨 }] = await Promise.all([계측([]), 계측(['--json'])]);
  const 결과 = JSON.parse(제이슨);
  const 손자리있는손 = 결과.hands.filter((h) => h.handlerSlotExists).length;
  assert.ok(손자리있는손 > 0, 'JSON 기준으로 손 자리가 있는 손이 하나는 있다');
  const 구간 = 표.split('\n## ').find((s) => s.startsWith('손 인벤토리')) ?? '';
  const 줄들 = 구간.split('\n')
    .filter((l) => l.startsWith('| ') && 결과.hands.some((h) => l.startsWith(`| ${h.id} `)));
  assert.equal(줄들.length, 결과.hands.length, '표가 손 전부를 그린다');
  const 마지막칸 = (l) => { const c = l.split('|'); return (c[c.length - 2] ?? '').trim(); };
  const 표에서손자리 = 줄들.filter((l) => 마지막칸(l) === '○').length;
  assert.equal(표에서손자리, 손자리있는손,
    `표의 「손 자리」 칸이 JSON 과 어긋난다 — 표 ${표에서손자리} vs JSON ${손자리있는손}`);
});
