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

// **스윕 2번은 아직 안 닫혔다 — 이 검사가 그 사실을 붙든다.**
// 기본 켬으로 뒤집었다가 기존 봉인("밝힐 때만 켠다")에 물려 되돌렸다. 봉인이 지키는 것은
// 플래그 값이 아니라 **우리가 동의 시트를 직접 누르는 경로가 기본으로 열리는 것**이고,
// 그 경로는 아직 코드에 있다(실측에서 안 탔을 뿐). 순서: 시트 클릭 갈래 제거 → 기본 켬.
// F-54(화면도 자리다)는 이 플래그와 독립이다 — 창 목록 관측은 프로필 붙기가 아니다.
test('크롬 프로필 관찰 — 아직 옵트인(스윕 2번 미완) · 켜는 길은 =1 하나', () => {
  assert.equal(브라우저프로필허용({}), false, '시트 클릭 갈래가 남은 채 기본이 열렸다 — 봉인이 지키는 자리');
  assert.equal(브라우저프로필허용({ GPAO_T5_BROWSER_PROFILE: '1' }), true, '켜는 길이 막혔다');
  assert.equal(브라우저프로필허용({ GPAO_T5_BROWSER_PROFILE: '0' }), false);
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
