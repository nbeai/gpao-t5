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
async function 계측(args = []) {
  const { stdout, stderr } = await run(process.execPath, [계측기, ...args], {
    cwd: 저장소,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GPAO_T5_STATE_PROBE_TEST: '1' },
  });
  return { stdout, stderr };
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

test('칸0 계측기 ②: browser.act 동사에 type·navigate 가 없다', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  const 브라우저손 = 결과.hands.find((h) => h.id === 'browser.act');
  assert.ok(브라우저손, 'browser.act 손이 인벤토리에 있어야 한다');
  assert.ok(Array.isArray(브라우저손.verbs), 'browser.act 는 action enum 이 있다');
  assert.equal(브라우저손.verbs.includes('type'), false, `browser.act 에 type 은 없다 — 실측 ${JSON.stringify(브라우저손.verbs)}`);
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

test('칸0 계측기: 문서 생성 부품 0건을 근거(검색어·경로)와 함께 낸다', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  const 부재 = 결과.absence.find((a) => a.subject === 'document-create');
  assert.ok(부재, '문서 생성 부품 부재 확인 항목이 있어야 한다');
  assert.equal(부재.found.length, 0, `생성 부품은 0건이다 — 실측 ${JSON.stringify(부재.found)}`);
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
  const 문서 = 결과.organs.find((o) => o.key === 'document-create');
  assert.ok(문서.missing.length > 0, '문서 만들기는 빠진 것이 있어야 한다(생성 부품 0건)');
  // ⑤ 화면 손은 상한이 "새 동사 추가 없음" 이므로 빠진 동사가 0 이다 — 결손은 동사가 아니라 쓰임이다
  const 화면 = 결과.organs.find((o) => o.key === 'screen-hand');
  assert.equal(화면.missing.length, 0, `화면 손 상한은 새 동사 추가 없음 — 실측 ${JSON.stringify(화면.missing)}`);
});

test('칸0 계측기: 확정 계열을 대본 모델 관통으로 잰다 — 자동화·에이전트·스킬 ○ / 기억 ✕', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  const 표 = new Map(결과.settlementLineage.map((s) => [s.key, s]));
  assert.equal(표.get('skill')?.settles, true, '스킬은 저장까지 간다');
  assert.equal(표.get('agent')?.settles, true, '에이전트는 저장까지 간다');
  assert.equal(표.get('automation')?.settles, true,
    `자동화는 commit 으로 job 까지 간다 — 거절 사유 ${표.get('automation')?.rejectedReason ?? '없음'}`);
  // **기억만 다르다**(계획서 §3 성질 3). 후보는 서는데 승격이 0 이다.
  assert.equal(표.get('memory')?.settles, false, '기억은 후보에서 멈춘다');
  assert.ok(표.get('memory')?.candidates > 0, '기억 후보는 실제로 선다 — 제안 자체가 안 되는 것이 아니다');
  assert.equal(표.get('memory')?.settled, 0, '승격은 0 이다');
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

test('칸0 계측기: 브라우저 CDP 를 코드에서 떠서 Input.* 부재를 근거와 함께 낸다', async () => {
  const { stdout } = await 계측(['--json']);
  const 결과 = JSON.parse(stdout);
  const b = 결과.browserCdp;
  for (const d of ['Page', 'Runtime', 'Target']) {
    assert.ok(b.domains.includes(d), `${d} 도메인이 있어야 한다 — 실측 ${JSON.stringify(b.domains)}`);
  }
  assert.equal(b.hasInputDomain, false, `Input.* 는 없다 — 실측 ${JSON.stringify(b.inputHits)}`);
  assert.ok(b.inputSearchedTerms.length > 0, '부재를 주장하려면 검색어를 함께 낸다(F-56)');
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
  assert.match(회귀.최종측정값, /3,607/, '§2 의 회귀 줄을 그대로 인용한다');
  assert.match(회귀.출처, /T5-FINAL-ASSEMBLY-ko\.md/);
});

test('칸0 계측기: 정답을 계측기 본체에 적어 넣지 않는다 (하드코딩 0)', async () => {
  const { readFile } = await import('node:fs/promises');
  const 소스 = await readFile(계측기, 'utf8');
  // 계측기가 값을 알고 있으면 문서보다 나쁘다 — 안 낡은 척하기 때문이다.
  for (const 금지 of ['tcell-verdict', '3,607', '3607']) {
    assert.equal(소스.includes(금지), false, `계측기 본체에 정답 '${금지}' 가 있으면 안 된다`);
  }
  // 동사 수·와이어 수 같은 **측정값**을 기대치로 박아 두는 것도 금지다.
  assert.equal(/개수:\s*\d+/.test(소스), false, '동사 수 기대치를 상수로 박지 않는다');
});

test('칸0 계측기: 사람이 읽는 표를 내고 종료 코드는 0 이다', async () => {
  const { stdout } = await 계측([]);
  assert.ok(stdout.includes('손 인벤토리'), '사람이 읽는 표에 손 인벤토리가 있어야 한다');
  assert.ok(stdout.includes('desktop.act'), '표에 화면 손이 보여야 한다');
  assert.ok(stdout.includes('기관별 결손'), '표에 기관별 결손이 있어야 한다');
  assert.ok(stdout.includes('확정 계열'), '표에 확정 계열이 있어야 한다');
  assert.ok(stdout.includes('캐시 접두 안정성'), '표에 캐시 접두 안정성이 있어야 한다');
  assert.ok(stdout.includes('미측정(유료 필요)'), '표에 유료 필요 항목이 있어야 한다');
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
