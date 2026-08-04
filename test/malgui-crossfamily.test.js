// **말귀 일반화 — 손 계열 횡단.**
//
// 오너 목표 문장(2026-08-04): *"개별 과업은 범용 계약을 검증하는 수단으로만 사용하며,
// 파일·코드·웹·데스크톱·외부 전송·자동화·복구에 일반화한다."*
//
// S1~S5 에서 실측으로 닫힌 계약은 셋이다. 셋 다 같은 병의 다른 얼굴이다 —
// **런타임이 조용히 무언가를 버리거나 숨겼고, 모델은 빈칸을 추측으로 메웠다.**
//
//   ① 모델이 낸 호출을 버리지 않는다      (다중 호출 병합·심문 제거)
//   ② 이유를 숨기지 않는다                (조용한 0)
//   ③ 남은 것과 **문**을 함께 말한다      (조용한 절단)
//
// 이 파일은 그 셋을 **파일 손 밖에서** 잰다. 손마다 검사를 따로 쓰지 않는다 — 계약이
// 손 개수만큼 늘어나면 새 손이 생길 때마다 조용히 샌다. 모든 손의 결과가 지나는
// **한 자리**(`compactResult`)에서 재고, 손 쪽은 빈 결과 계약만 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactResult } from '../src/kernel/l1-intent/task-context.js';

/** 잘렸으면 **얼마나** 잘렸는지가 반드시 글에 있어야 한다. */
function 절단계약(이름, 글, { 전체 }) {
  assert.ok(글, `${이름}: 요약이 아예 없다`);
  const t = String(글);
  const 숫자들 = (t.match(/\d[\d,]*/g) ?? []).map((s) => Number(s.replace(/,/g, '')));
  assert.ok(숫자들.includes(전체),
    `${이름}: 전체가 ${전체}인데 그 수가 요약에 없다 — 모델은 자기가 받은 것이 전부인 줄 안다\n${t.slice(0, 400)}`);
}

// ── ① 웹 — 링크·비교 후보를 조용히 자르지 않는다 ───────────────────────────
test('웹: 링크를 잘라 실으면 **전체 개수**가 함께 온다', () => {
  const 글 = compactResult({
    title: '검색 결과', markdown: '본문'.repeat(50),
    links: Array.from({ length: 40 }, (_, i) => `https://ex.com/${i}`),
  });
  절단계약('web.collect 링크', 글, { 전체: 40 });
});

test('웹: 비교 후보를 잘라 실으면 **전체 개수**가 함께 온다', () => {
  const 글 = compactResult({
    title: '비교', markdown: '본문',
    comparisonCandidates: Array.from({ length: 11 }, (_, i) => ({ rank: i + 1, title: `후보${i}`, url: `https://ex.com/${i}` })),
  });
  절단계약('web.collect 비교후보', 글, { 전체: 11 });
});

// ── ② 브라우저(데스크톱 화면) — 본 범위와 **못 본 범위**가 함께 온다 ────────
test('브라우저: 화면을 일부만 읽었으면 **못 받은 양**이 함께 온다', () => {
  const 글 = compactResult({
    title: '어떤 페이지',
    observation: {
      seen: { chars: 1200, of: 48_000, percent: 3 },
      unseen: { chars: 46_800, percent: 97 },
      moreBelow: true,
    },
    markdown: 'ㅁ'.repeat(3000),
  });
  assert.match(String(글), /못 받은 글: 46,?800자|못 받은 글: 46800자/,
    '화면을 3%만 읽고도 못 받은 양을 안 말하면 모델은 그게 전부인 줄 안다');
  assert.match(String(글), /화면 아래 남음: 있음/, '더 있다는 사실이 빠졌다 — 문이 없는 절단이다');
});

// ── ③ 코드·명령 — 출력이 잘리면 **뺀 양**이 함께 온다 ──────────────────────
//
// 터미널·캡슐·원격 손의 결과는 위 갈래에 안 걸려 마지막 갈래(`fold`)로 떨어진다.
// 여기가 조용히 자르면 "grep 결과가 이게 전부"라는 거짓이 모델에게 사실로 간다.
test('명령: 긴 출력이 잘리면 **생략한 글자 수**가 함께 온다', () => {
  const 글 = compactResult({
    command: 'grep -rn TODO .', exitCode: 0, applied: true,
    stdout: Array.from({ length: 400 }, (_, i) => `src/a${i}.js:${i}:TODO 고치기`).join('\n'),
  });
  assert.match(String(글), /생략/, '명령 출력이 조용히 잘렸다 — 모델은 받은 것이 전부인 줄 안다');
});

test('캡슐: 안쪽에서 많이 돌았으면 **몇 번 돌았는지**가 요약에 남는다', () => {
  const 글 = String(compactResult({
    calls: 214, changed: 198, elapsedMs: 8_400,
    summary: '조건별로 나눠 옮겼어요.',
  }));
  assert.ok(글.includes('214'), `캡슐이 몇 번 손을 썼는지가 사라졌다: ${글.slice(0, 200)}`);
});

// ── ④ 그 밖(작은 결과)은 **줄이지 않는다** — 과잉 절단도 같은 병이다 ────────
test('작은 결과는 통째로 간다(안 잘린 것을 잘렸다고 말하지 않는다)', () => {
  const 글 = String(compactResult({ ok: true, count: 3 }));
  assert.doesNotMatch(글, /생략/, '자르지 않았는데 잘렸다고 말하면 그것도 거짓이다');
  assert.ok(글.includes('3'));
});

// ── ⑤ 조용한 0 — 손 쪽. "못 찾았다"가 **얼마나 훑었는지**와 함께 오는가 ──────
//
// 파일·자리찾기·대화찾기는 `zero-result-contract` 가 잰다. 여기서는 그 밖의 계열을 잰다.
// **재는 자리는 문장이 아니라 "모델이 받는 것"이다** — 사실이 구조로 가면 문장에 없어도 된다.
// 문장으로만 재면 손마다 문구를 맞추게 되고, 그건 계약이 아니라 장식이다.
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalDiscoveryTool } from '../src/runtime/local-discovery.js';
import { makeLocalSystemTool } from '../src/runtime/local-system.js';

test('데스크톱·연결: 흔적을 못 찾아도 **몇 자리를 봤는지**가 모델에게 간다', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'malgui-')));
  const out = await makeLocalDiscoveryTool({ dataDir: dir }).handler({ subject: '없는서비스' }, {});
  assert.equal(out.result.candidates.length, 0, '이 시험은 0건일 때를 잰다');
  assert.ok(out.result.checked?.length > 0,
    '못 찾았다면서 어디를 봤는지가 없다 — 모델은 "안 찾아봤다"와 "찾았는데 없다"를 못 가른다');
  // 그 사실이 **모델 입력까지** 실제로 가는지 본다(영수증에만 있고 요약에서 빠지는 것이 그 병이었다).
  assert.match(String(compactResult(out.result)), /checked/,
    '훑은 자리가 모델 입력에서 사라졌다');
});

test('데스크톱·시스템: 위에서부터 봤으면 **전체가 몇 개인지**를 함께 말한다', async () => {
  const out = await makeLocalSystemTool({}).handler({}, {});
  const 말 = String(out.userSafeSummary ?? '');
  assert.match(말, /\d+개 중/,
    `일부만 보고 전체를 안 말하면 모델은 그게 전부인 줄 안다: "${말}"`);
});

// ── ⑥ 계약 ① — 손 계열이 섞여도 **모델이 낸 호출을 하나도 안 버린다** ───────
//
// S1 이 연 본체다. 예전엔 여러 호출이 하나로 병합되거나 뒤엣것이 폐기됐고, 파일 손으로만
// 재고 있었다. **계열이 섞이면 다시 새는지**가 이 계약의 진짜 시험이다 —
// 계획 경로는 손 이름으로 대표 하나를 뽑고 나머지를 줄에 세우므로, 계열이 늘수록 갈래가 는다.
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

test('계약 ①: 파일·명령·찾기를 한 응답에 내면 **셋 다 실행된다**', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'malgui-mix-')));
  const 실행 = [];
  const 기록손 = (id, 결과) => ({
    async probe() { return { changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(args) { 실행.push({ id, args }); return { result: 결과, userSafeSummary: '했어요.' }; },
  });
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !this.냈나) {
        this.냈나 = true;
        return { text: '', toolCalls: [
          { providerCallId: 'a1', name: 'local.file', args: { action: 'list', path: dir } },
          { providerCallId: 'a2', name: 'local.terminal', args: { command: 'echo hi' } },
          { providerCallId: 'a3', name: 'local.locate', args: { query: '정산' } },
        ] };
      }
      return '셋 다 봤어요.';
    },
  };
  await runTurn({ text: '이 폴더 보고, echo 한 번 돌리고, 정산 찾아줘' }, {
    env: demoEnv({ include: ['local.file', 'local.terminal', 'local.locate'], hands: ['local.file', 'local.terminal', 'local.locate'] }),
    tools: demoTools({
      localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }),
      localTerminal: 기록손('local.terminal', { command: 'echo hi', exitCode: 0, stdout: 'hi', applied: true }),
      localLocate: 기록손('local.locate', { matches: [], scanned: 12 }),
    }),
    model,
  });
  const 손들 = new Set(실행.map((x) => x.id));
  assert.ok(손들.has('local.terminal'), `명령 계열 호출이 버려졌다: ${JSON.stringify(실행)}`);
  assert.ok(손들.has('local.locate'), `찾기 계열 호출이 버려졌다: ${JSON.stringify(실행)}`);
});

// ── ⑦ 반대시험 — 계약 검사 자체가 무는가 ───────────────────────────────────
test('반대시험: 전체 수가 빠지면 절단계약이 걸린다', () => {
  assert.throws(() => 절단계약('가짜', '링크 6개를 실었어요.', { 전체: 40 }), /그 수가 요약에 없다/);
});
