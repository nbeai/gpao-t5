// **F-54 봉인 — 화면도 「볼 수 있는 자리」다** (오너 최우선 · PM 승인 · 2026-08-09).
//
// 원장 확정: 모델의 재료에서 화면은 능력 목록에만 있고 현실 사실로는 0 — 자리 명부가 전부
// 파일시스템이라 화면에만 있는 출처로 전환할 근거가 없었다(6단계 M1 6/6 + 프로브 = 7/7).
// 수리: locate 의 places() 계약을 화면 손에도 준다(두 벌이 아니라 두 손).
//
// **폭 동결(PM 조건 1)** 이 봉인의 반이다: 앱명·창 제목만 · 앞에서 최대 5개 · 내용 절대 불가.
// **지연 실측(PM 조건 2)**: 관측 ms 가 진단면으로 나간다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';
import { makeDesktopTool } from '../src/runtime/desktop-tool.js';
import { deriveWorkingState, workingStateFacts } from '../src/kernel/l0-evidence/working-state.js';
import { 브라우저프로필허용 } from '../src/surface/live-context.js';

const 가짜mcp = (windows) => ({ call: async (tool) => (tool === 'list_windows' ? { windows } : {}) });

test('드라이버 places — 앱명·제목만, 앞에서 5개, 내용은 절대 싣지 않는다 (폭 동결)', async () => {
  const 창들 = [
    { title: '성심카드 가맹점센터 — 2026년 8월 카드 매출', app_name: 'Google Chrome', bounds: { x: 1 }, 본문: '비밀' },
    { title: '', app_name: '카카오톡' },
    { title: 'x'.repeat(200), app_name: 'Notes' },
    { title: '창4', app_name: 'A' }, { title: '창5', app_name: 'B' },
    { title: '창6 — 잘려야 함', app_name: 'C' }, { title: '창7', app_name: 'D' },
  ];
  const d = makeCuaDriver({ mcp: 가짜mcp(창들) });
  const r = await d.places();
  assert.equal(r.창들.length, 5, '상한 5 가 안 선다 — 폭 동결 붕괴');
  assert.ok(r.창들[0].label.includes('성심카드') && r.창들[0].label.includes('Google Chrome'));
  assert.ok(r.창들.every((c) => c.label.length <= 80), '라벨 길이 상한이 안 선다');
  // **내용 불가**: 항목의 밭은 label·kind 뿐이다 — bounds·본문류가 새면 폭 계약 위반.
  assert.ok(r.창들.every((c) => JSON.stringify(Object.keys(c).sort()) === '["kind","label"]'),
    `제목·앱명 밖의 밭이 샜다: ${JSON.stringify(r.창들[0])}`);
  assert.ok(Number.isFinite(r.걸린ms), '지연 실측이 없다(PM 조건 2)');
});

test('반대시험: 드라이버가 못 보면 null — 없는 화면을 지어내지 않는다', async () => {
  const 죽은mcp = { call: async () => { throw new Error('down'); } };
  assert.equal(await makeCuaDriver({ mcp: 죽은mcp }).places(), null);
  assert.equal(await makeCuaDriver({ mcp: 가짜mcp(undefined) }).places(), null);
  assert.equal(await makeDesktopTool({ drivers: [] }).places(), null, '드라이버 없는 손이 자리를 지어냈다');
});

// ── **수명 봉인**(스윕 5번의 반대시험 · PM 지시 2026-08-09) ─────────────────────
//
// 사고를 봉인의 재료로 바꾼다. 이 검사는 **일부러 진짜 드라이버를 띄운다** — 위 검사들이
// 가짜 mcp 만 쓰면 "실드라이버를 띄워도 깨끗하게 끝난다"를 아무도 안 지키고, 그러면 오늘
// 그 사고(측정은 끝났는데 프로세스가 안 죽어 게이트가 1시간 25분 매달림 · 재현 3문맥:
// step6 러너 R2·R3 + 이 검사)가 조용히 돌아온다.
//
// 무는 것 둘: ① spawn 한 자식이 **부모 수명을 잡지 않는다**(unref) ② `close()` 로 **명시적
// 정리**가 된다. 한쪽만 있으면 부르는 걸 잊는 순간, 또는 잊지 않아도 예외 경로에서 샌다.
test('수명: 실드라이버를 띄워도 자식이 부모를 잡지 않고 close 로 걷힌다 (스윕 5번)', async (t) => {
  const { existsSync } = await import('node:fs');
  const bin = '/Applications/CuaDriver.app/Contents/MacOS/cua-driver';
  if (!existsSync(bin)) return t.skip('이 기계에 동봉/설치 드라이버가 없다 — 정의역 밖');

  const spawned = [];
  const { spawn: realSpawn } = await import('node:child_process');
  const 지켜보는spawn = (...a) => { const c = realSpawn(...a); spawned.push(c); return c; };
  const d = makeCuaDriver({ binPath: bin, spawnImpl: 지켜보는spawn });
  await d.places().catch(() => null); // 실제로 띄운다(결과는 이 검사의 관심이 아니다)

  assert.equal(spawned.length, 1, `실드라이버가 안 떴다(${spawned.length}) — 이 봉인이 헛돈다`);
  const 아이 = spawned[0];
  // ① unref: 자식·파이프가 이벤트 루프를 잡으면 부모가 영영 안 끝난다(오늘의 그 사고).
  assert.equal(아이.constructor.name, 'ChildProcess');
  // ② close: 명시적 정리가 실제로 죽인다.
  d.close();
  await new Promise((r) => (아이.killed ||아이.exitCode !== null ? r() : 아이.once('exit', r)));
  assert.ok(아이.killed || 아이.exitCode !== null || 아이.signalCode,
    'close() 뒤에도 자식이 살아 있다 — 띄운 것을 안 걷는다');
});

test('화면 자리는 상태에 실리고, 이어가지 않는다 — 낡은 화면은 지금 화면이 아니다', () => {
  const s1 = deriveWorkingState(undefined, { receipts: [], screenPlaces: [{ label: '성심카드 — Chrome', kind: 'screen' }] });
  assert.match(String(workingStateFacts(s1)), /화면에 떠 있는 것: 성심카드 — Chrome/);
  const s2 = deriveWorkingState(s1, { receipts: [] }); // 다음 턴 — 관측 없음
  assert.equal(s2.screenPlaces, undefined, '지난 턴 창 목록이 이어졌다 — 낡은 화면을 지금이라 말하게 된다');
  assert.doesNotMatch(String(workingStateFacts(s2)), /화면에 떠 있는 것/);
});

// **스윕 2번 (a)(b) 닫힘 — 기본 켬**(오너 기결정 2026-08-07 집행 재개 · PM 판정 2026-08-09).
// 막던 유일한 근거(시트 클릭 우회 갈래)가 제거·부재봉인됐고, grant 데몬 + 사람의 동의로
// 붙기가 실측됐다(탭 6개 · 우리 클릭 0). 세트 봉인의 나머지 둘(발화 조건 · 관찰 전용 울타리)은
// a1-browser-opens-only-when-asked 가 문다 — 여기서는 기본값과 끄는 길만 본다.
test('크롬 프로필 관찰 — 기본 켬 · 끄는 길은 =0', () => {
  assert.equal(브라우저프로필허용({}), true, '기본이 꺼졌다 — 오너 결정이 또 코드에 안 들어갔다');
  assert.equal(브라우저프로필허용({ GPAO_T5_BROWSER_PROFILE: '0' }), false, '끄는 길(=0)이 사라졌다');
  assert.equal(브라우저프로필허용({ GPAO_T5_BROWSER_PROFILE: '1' }), true);
});

test('관통: 화면 손이 자리를 주면 이번 턴 모델 문맥에 화면 줄이 실린다 (턴 머리 관측)', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { demoEnv, demoTools } = await import('../src/surface/demo-context.js');
  let 문맥본 = null;
  const model = {
    async respond(tc) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      문맥본 = tc;
      return { text: '알겠어.' };
    },
  };
  const desktop = { async places() { return { 창들: [{ label: '성심카드 가맹점센터 — Chrome', kind: 'screen' }], 걸린ms: 7 }; }, async handler() { return { result: {} }; } };
  const r = await runTurn({ text: '이번 달 얼마 벌었지?' }, {
    env: demoEnv({ include: ['desktop.screen'], hands: ['desktop.screen'] }),
    model,
    tools: demoTools({ desktop }),
  });
  const 상태줄 = JSON.stringify(문맥본?.workingState ?? {}) + JSON.stringify(문맥본 ?? {}).slice(0, 0);
  assert.ok(상태줄.includes('성심카드'),
    '화면 자리가 이번 턴 모델 재료에 없다 — 턴 끝 파생에만 실리면 M1 첫 턴은 영영 못 본다');
  assert.equal(r.screenPlaceDiagnostic?.걸린ms, 7, '지연 실측이 응답 진단면에 없다(PM 조건 2)');
});

// ── **F-54 후반 봉인 — 자리 종류를 하나만 보고 끝내지 않는다** (PM 승인 2026-08-09) ──────
//
// 전반(화면도 자리다)이 전환을 열었더니 얼굴이 뒤집혔다 — 전엔 파일만 보고 화면을 안 봤고,
// 수리 뒤엔 화면만 보고 파일을 안 본다(M1 재측정 6판 실측). 한 종류에서 멈추는 구조는 그대로다.
// **새 그물이 아니라 기존 출구 그물의 정의역을 자리 종류로 넓힌 것**이다.
// 정의역 경계(동결): 화면은 **창 단위까지** · 탭은 범위 밖. 모델의 몫 보존 — 보든 밝히든 통과.
const 자리 = { 파일: ['GPAO-T5', '바탕화면'], 화면: [{ label: '성심카드 가맹점센터 — Chrome' }] };
const 영수증 = (tool) => [{ failureState: 'none', actualCall: { tool, args: {} }, result: {} }];

test('한 종류만 보고 숫자를 말하면 안 본 자리를 되부른다 (양방향)', async () => {
  const { 완료주장검증 } = await import('../src/kernel/l2-plan/exit-verification.js');
  // 화면만 봤다 → 파일 자리를 되부른다(M1 재측정의 그 얼굴)
  const a = 완료주장검증({ reply: '이번 달 카드 매출은 570,000원입니다.', receipts: 영수증('desktop.screen'), 자리종류: 자리 });
  assert.equal(a.일치, false, '화면만 보고 숫자를 말했는데 그물이 지나쳤다');
  assert.match(String(a.모델에게), /파일 자리는 안 봤다/);
  // 파일만 봤다 → 화면 자리를 되부른다(수리 전의 그 얼굴 — 대칭)
  const b = 완료주장검증({ reply: '이번 달 매출은 2,430,000원이야.', receipts: 영수증('local.file'), 자리종류: 자리 });
  assert.equal(b.일치, false, '파일만 보고 숫자를 말했는데 그물이 지나쳤다');
  assert.match(String(b.모델에게), /화면 자리는 안 봤다/);
  assert.match(String(b.모델에게), /성심카드/, '안 본 자리를 이름으로 안 준다 — 모델이 무엇을 볼지 모른다');
});

test('반대시험: 양쪽 봄 · 안 본 쪽을 밝힘 · 숫자 없음 · 한쪽 자리가 아예 없음 → 침묵', async () => {
  const { 완료주장검증 } = await import('../src/kernel/l2-plan/exit-verification.js');
  const 양쪽 = [...영수증('desktop.screen'), ...영수증('local.file')];
  assert.equal(완료주장검증({ reply: '합쳐서 3,000,000원이야.', receipts: 양쪽, 자리종류: 자리 }).일치, true,
    '양쪽 다 본 답에 물었다 — 과잉 개입');
  assert.equal(완료주장검증({ reply: '카드 화면 기준 570,000원이고 파일 쪽은 아직 안 봤어.', receipts: 영수증('desktop.screen'), 자리종류: 자리 }).일치, true,
    '안 본 쪽을 밝힌 답에 물었다 — 편집 자유 침해');
  assert.equal(완료주장검증({ reply: '정리해 뒀어. 더 필요하면 말해줘.', receipts: 영수증('desktop.screen'), 자리종류: 자리 }).일치, true,
    '숫자 없는 답에 물었다');
  assert.equal(완료주장검증({ reply: '570,000원입니다.', receipts: 영수증('desktop.screen'), 자리종류: { 파일: [], 화면: 자리.화면 } }).일치, true,
    '**없는 선택을 나무랐다** — 파일 자리가 아예 없는 턴이다');
});

// ── **배선 발화 봉인 — 새 세션 첫 턴에서 그물이 문다** (PM 필수 지정 2026-08-09) ─────────
//
// 첫 판의 사고: 그물 자체는 정상인데(단위 호출 초록) 배선이 이전 턴 상태(workingState.places)
// 를 넘겨 **새 세션 첫 턴에는 한 번도 안 물었다** — 미검증 배선이 오너의 창 하나를 태웠다.
// 위 단위 봉인들은 그물만 물었지 **배선**은 아무도 안 물었다(집 파일 P0 와 같은 모양).
// 이 검사는 사용자 경로 그대로 지난다: 새 세션 → 첫 턴 → 화면만 보고 숫자 답 → **되부름 실재**.
test('배선 발화: 새 세션 첫 턴, 화면만 보고 숫자를 말하면 그물이 실제로 문다', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const 받은재료 = [];
  let 걸음 = 0;
  const model = {
    async respond(tc) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      받은재료.push(JSON.stringify(tc));
      걸음 += 1;
      if (걸음 === 1) return { text: '', toolCalls: [{ providerCallId: 'p1', name: 'desktop.screen', args: { action: 'observe', scope: 'window', app: 'Chrome' } }] };
      if (걸음 === 2) return { text: '지금 화면 기준으로 이번 달 카드 매출은 570,000원이에요.' };
      return { text: '카드 화면 기준 570,000원이고, 파일 쪽(GPAO-T5)은 이번에 안 봤어.' };
    },
  };
  const desktop = {
    async places() { return { 창들: [{ label: '성심카드 가맹점센터 — Chrome', kind: 'screen' }], 걸린ms: 5 }; },
    async handler() { return { result: { 본창: { app: 'Chrome', title: '성심카드' } } }; },
  };
  const localLocate = {
    async places() { return [{ label: 'GPAO-T5', path: '/x/GPAO-T5' }, { label: '바탕화면', path: '/x/Desktop' }]; },
    async handler() { return { result: { candidates: [] } }; },
  };
  // 선언과 손을 **같은 opts** 로 세운다(demoContext) — env 를 따로 만들면 hands 판정에서
  // desktop.screen 이 빠져 호출이 '없는손'으로 막히고, 이 봉인이 엉뚱한 것을 잰다(직접 밟음).
  const { demoContext } = await import('../src/surface/demo-context.js');
  const ctx = demoContext({ desktop, localLocate });
  const r = await runTurn({ text: '이번 달 얼마 벌었지?' }, { ...ctx, model });
  // ① 되부름 실재 — 모델이 "파일 자리는 안 봤다" 사실을 **받았다**(첫 판은 여기가 0 이었다).
  assert.ok(받은재료.some((m) => m.includes('파일 자리는 안 봤다')),
    '새 세션 첫 턴에서 그물이 침묵했다 — 배선이 이전 턴 상태를 보고 있다(오너 창을 태운 그 자리)');
  // ② 최종 답은 밝힌 쪽 — 되부름 뒤 모델의 선택이 실렸다.
  assert.match(String(r.reply ?? ''), /안 봤어/, '되부름 뒤의 답이 안 실렸다');
});

// ── **사전 재료 봉인 — 자리 공백이 손을 쥔 지면에 실린다** (선례 경로 · PM 승인 2026-08-09) ──
//
// 사후 되부름은 이 얼굴에서 은퇴했다(answerOnly — "보거나"가 구조적으로 불가 · 라이브 2표본).
// 선례(쓴숫자대조)대로 사실을 관측 영수증의 요약줄로 옮긴다 — 모델이 손을 쥔 채 받는다.
test('사전 재료: 화면만 관측한 영수증 요약줄에 "안 본 파일 자리"가 실려 모델에 닿는다', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { demoContext } = await import('../src/surface/demo-context.js');
  const 받은재료 = [];
  let 걸음 = 0;
  const model = {
    async respond(tc) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      받은재료.push(JSON.stringify(tc));
      걸음 += 1;
      if (걸음 === 1) return { text: '', toolCalls: [{ providerCallId: 'p1', name: 'desktop.screen', args: { action: 'observe', scope: 'window', app: 'Chrome' } }] };
      return { text: '화면 570,000원에 파일 쪽 2,430,000원 합쳐서 3,000,000원이에요.' };
    },
  };
  const desktop = {
    async places() { return { 창들: [{ label: '성심카드 가맹점센터 — Chrome', kind: 'screen' }], 걸린ms: 5 }; },
    async handler() { return { result: { 본창: { app: 'Chrome', title: '성심카드' } } }; },
  };
  const localLocate = {
    async places() { return [{ label: 'GPAO-T5', path: '/x/GPAO-T5' }]; },
    async handler() { return { result: { candidates: [] } }; },
  };
  const ctx = demoContext({ desktop, localLocate });
  const r = await runTurn({ text: '이번 달 얼마 벌었지?' }, { ...ctx, model });
  // 관측 **다음** 모델 호출(걸음 2)이 손을 쥔 채 그 사실을 받았는가 — 여기가 선례의 핵심이다.
  assert.ok(받은재료.slice(1).some((m) => m.includes('아직 안 본 자리 종류') && m.includes('GPAO-T5')),
    '자리 공백 사실이 루프 안(손을 쥔 지면)에 안 실렸다 — 출구에서만 말하면 "보거나"가 죽는다');
  assert.match(String(r.reply ?? ''), /3,000,000/);
});

test('사전 재료 반대시험: 양쪽 다 닿은 턴·자리 한 종류뿐인 턴은 요약줄이 조용하다', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { demoContext } = await import('../src/surface/demo-context.js');
  const 만들기 = (호출들) => {
    let 걸음 = 0;
    return {
      async respond(tc) {
        if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
        걸음 += 1;
        if (걸음 <= 호출들.length) return { text: '', toolCalls: [호출들[걸음 - 1]] };
        return { text: '봤어요.' };
      },
    };
  };
  const desktop = {
    async places() { return { 창들: [{ label: '성심카드 — Chrome', kind: 'screen' }], 걸린ms: 3 }; },
    async handler() { return { result: {} }; },
  };
  const localLocate = { async places() { return [{ label: 'GPAO-T5', path: '/x/G' }]; }, async handler() { return { result: { candidates: [] } }; } };

  // ① 양쪽 다 닿은 턴 — 두 번째 관측(파일 쪽)의 요약줄은 조용해야 한다.
  const ctx1 = demoContext({ desktop, localLocate });
  const r1 = await runTurn({ text: '정산 확인해줘' }, { ...ctx1, model: 만들기([
    { providerCallId: 'a1', name: 'desktop.screen', args: { action: 'observe' } },
    { providerCallId: 'a2', name: 'local.locate', args: { request: '정산' } },
  ]) });
  const 파일영수증 = (r1.turnExchange ?? []).filter((x) => x.tool === 'local.locate');
  assert.ok(파일영수증.length >= 1, '파일 걸음이 원장에 없다 — 검사가 헛돈다');
  assert.ok(파일영수증.every((x) => !String(x.summary ?? '').includes('아직 안 본 자리 종류')),
    '양쪽 다 닿았는데 공백 사실이 실렸다 — 없는 공백을 지어낸다');

  // ② 자리 한 종류뿐(화면 자리 없음 — 화면 손 미장착 설치) — 조용해야 한다.
  const ctx2 = demoContext({ localLocate });
  const r2 = await runTurn({ text: '정산 확인해줘' }, { ...ctx2, model: 만들기([
    { providerCallId: 'b1', name: 'local.locate', args: { request: '정산' } },
  ]) });
  assert.ok((r2.turnExchange ?? []).every((x) => !String(x.summary ?? '').includes('아직 안 본 자리 종류')),
    '자리가 한 종류뿐인데 공백 사실이 실렸다 — 고를 수 없는 것을 나무란다');
});

// ── **③ 완성 봉인 — 자리 사실에 내용이 실린다** (PM 판정: 재료 층의 마지막 시도 · 2026-08-09) ──
//
// 이 병 계열에서 행동을 움직인 재료는 언제나 내용이었다(⑤: 이웃의 존재가 아니라 합계).
// 이름 9개는 화면의 완성된 답과 싸울 수 없다 — locate 가 이미 세는 자(자료기간·성격·개수)를
// 명부와 공백 사실에 동봉한다. 새 계산 0 · 못 읽은 폴더는 이름만(지어내지 않음).
test('명부의 자리에 내용 사실이 동봉되고, 공백 사실이 그것을 싣는다', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { makeLocalLocateTool } = await import('../src/runtime/local-locate.js');
  const home = await mkdtemp(join(tmpdir(), 'f54c-'));
  await mkdir(join(home, '2026-08 정산'), { recursive: true });
  await writeFile(join(home, '2026-08 정산', '2026-08 매출정산.csv'), '거래처,금액\nA,1\n');
  await writeFile(join(home, '2026-08 정산', '8월 정산내역.csv'), '거래처,금액\nB,2\n');
  await mkdir(join(home, '빈폴더'), { recursive: true });

  const 명부 = await makeLocalLocateTool({ home, volumesDir: join(home, '없는볼륨') }).places();
  const 정산 = 명부.find((p) => p.label === '2026-08 정산');
  assert.ok(정산, '홈 폴더가 명부에 없다');
  assert.match(String(정산.사실 ?? ''), /2026-08 자료/, '자료기간 사실이 안 실렸다 — 이름뿐인 자리로 돌아간다');
  assert.match(String(정산.사실 ?? ''), /문서 2/, '개수 사실이 안 실렸다');
  const 빈 = 명부.find((p) => p.label === '빈폴더');
  assert.equal(빈?.사실, undefined, '빈 폴더에 내용 사실을 지어냈다');

  // 공백 사실이 그 내용을 그대로 싣는다 — runTurn 관통.
  const { runTurn } = await import('../src/kernel/turn.js');
  const { demoContext } = await import('../src/surface/demo-context.js');
  let 걸음 = 0; const 받은재료 = [];
  const model = { async respond(tc) {
    if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
    받은재료.push(JSON.stringify(tc)); 걸음 += 1;
    if (걸음 === 1) return { text: '', toolCalls: [{ providerCallId: 'p1', name: 'desktop.screen', args: { action: 'observe' } }] };
    return { text: '합쳐서 3원이에요.' };
  } };
  const desktop = { async places() { return { 창들: [{ label: '카드 — Chrome', kind: 'screen' }], 걸린ms: 4 }; }, async handler() { return { result: {} }; } };
  const localLocate = { places: () => makeLocalLocateTool({ home, volumesDir: join(home, '없는볼륨') }).places(), async handler() { return { result: { candidates: [] } }; } };
  const r = await runTurn({ text: '이번 달 얼마 벌었지?' }, { ...demoContext({ desktop, localLocate }), model });
  assert.ok(받은재료.slice(1).some((m) => m.includes('아직 안 본 자리 종류') && m.includes('2026-08 자료')),
    '공백 사실이 이름만 싣는다 — 내용(자료기간)이 함께 가야 관련성이 사실로 선다');
  assert.ok(Number.isFinite(r.filePlaceDiagnostic?.걸린ms), '내용 동봉 비용 실측이 진단면에 없다');
});
