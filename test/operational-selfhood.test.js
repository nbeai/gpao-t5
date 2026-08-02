// P-ID-1 · 자가 정체성 / 지속 자기인지 검증.
// 오너 실사용에서 무너진 네 가지를 계약으로 고정한다:
//   ①"저는 ChatGPT예요"(하부 모델을 정체로) ②자기가 OS 인 줄 모름 ③자기 이름을 못 알아들음
//   ④지어 준 이름이 안 남음
// 그리고 헌법 §5 다섯 항목이 실제로 모델에 도달하는지, 상시 입력이 가벼운지(Phase 2)를 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIdentityFacts, DEFAULT_IDENTITY, PRODUCT_NAME } from '../src/kernel/identity.js';
import { SOUL_SEED } from '../src/kernel/soul-seed.js';
import {
  buildCapabilityFacts, capabilityCounts, renderDerivedSection, replaceDerivedSection,
  DERIVED_BEGIN, DERIVED_END,
} from '../src/kernel/capabilities.js';
import { detectSelfNaming } from '../src/kernel/l1-intent/self-naming.js';
import { selfhoodLookup, selectSelfhoodDetail } from '../src/kernel/l1-intent/selfhood-lookup.js';
import { SelfhoodStore, readNameFromSoul, replaceNameInSoul } from '../src/surface/selfhood-store.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { buildSelfState, selfStateSummary } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';
import { runTurn } from '../src/kernel/turn.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { demoTools } from '../src/surface/demo-context.js';

const selfState = () => buildSelfState(demoEnv());

// ── 정체(매 턴, 짧게) ─────────────────────────────────────────────────────
test('정체 사실: 자기가 OS 임을 말하고, 모델은 두뇌일 뿐임을 구분한다(①②)', () => {
  const lines = buildIdentityFacts(DEFAULT_IDENTITY, { model: 'gpt-5.5', ready: 2 }).join('\n');
  assert.ok(lines.includes(PRODUCT_NAME));
  assert.ok(lines.includes('AI 모델이 아니라'), '자기가 모델이 아님을 말한다');
  assert.ok(lines.includes('운영체제'), '자기가 OS 임을 안다');
  assert.ok(lines.includes('gpt-5.5'));
  assert.ok(lines.includes('두뇌일 뿐'), '모델을 정체로 말하지 않는 경계');
  assert.ok(lines.includes('제공자의 이름을 네 이름처럼 말하지 마라'), '디브랜딩 계약');
});

test('정체 사실: 지어 준 이름이 있으면 그 이름으로, 제품 이름과 구분한다', () => {
  const lines = buildIdentityFacts({ name: '아이기스', named: true }, { model: 'x' }).join('\n');
  assert.ok(lines.includes('너의 이름은 아이기스다'));
  assert.ok(lines.includes(`제품 이름은 ${PRODUCT_NAME}`));
});

test('상시 입력은 가볍다 — 정체는 개수 요약까지만(계획서 Phase 2 다이어트)', () => {
  const facts = buildIdentityFacts(DEFAULT_IDENTITY, { model: 'm', ready: 2, needsApproval: 1, blocked: 2 });
  assert.ok(facts.join('\n').length < 700, '상시 정체 블록이 장문이 되면 안 된다');
  assert.ok(facts.some((l) => l.includes('2가지')), '개수 요약은 담는다');
});

// ── 능력 문서(헌법 §5 다섯 항목) ──────────────────────────────────────────
test('능력 사실: 헌법 §5 다섯 항목을 모두 담는다(필요한 걸 빼지 않는다)', () => {
  const f = buildCapabilityFacts(selfState());
  assert.ok(f.model.id, '① 어떤 모델인가');
  assert.ok(f.ready.length > 0, '② 연결된 도구와 실행 가능성');
  assert.ok(f.ready.some((r) => r.needsApproval), '③ 승인 필요한 것');
  assert.ok(f.ready.some((r) => r.risk), '④ 어떤 실행이 위험한가');
  assert.ok('nextSafeAction' in f, '⑤ 다음 안전 행동 자리');
  assert.ok(f.blocked.every((b) => b.why), '못 하는 것엔 이유가 붙는다');
});

test('자기상태 요약은 실제 실행 가능한 손에서 승인 필요 범위를 파생한다', () => {
  const state = selfState();
  const expected = state.connectedTools
    .filter((tool) => tool.executable && tool.needsApproval)
    .map((tool) => tool.label ?? tool.id);
  assert.ok(expected.length > 0, 'fixture에 승인 필요 실행 손이 있어야 한다');
  assert.deepEqual(selfStateSummary(state).approvalRequired, expected);
});

test('파생 구역 렌더: 할 수 있는 일·못 하는 일·모델을 사용자 언어로 적는다', () => {
  const md = renderDerivedSection(buildCapabilityFacts(selfState()));
  assert.ok(md.includes('## 지금 할 수 있는 일'));
  assert.ok(md.includes('## 지금은 못 하는 일'));
  assert.ok(md.includes('## 지금 쓰는 모델'));
  assert.ok(!/web\.collect|slack\.post|mail\.send/.test(md), '내부 도구 id 가 새지 않는다');
});

test('파생 구역만 갈아끼운다 — 사람이 쓴 메모는 보존된다', () => {
  const first = replaceDerivedSection(null, '파생1');
  const edited = `${first}\n\n## 내가 쓴 메모\n\n지우지 마세요.\n`;
  const again = replaceDerivedSection(edited, '파생2');
  assert.ok(again.includes('파생2'));
  assert.ok(!again.includes('파생1'));
  assert.ok(again.includes('지우지 마세요.'), '사용자 편집 보존');
  assert.equal(again.split(DERIVED_BEGIN).length - 1, 1, '표식이 중복되지 않는다');
  assert.ok(again.includes(DERIVED_END));
});

// ── 필요할 때만 찾기 (a 방식) ─────────────────────────────────────────────
test('조회 판단: 능력·한계·정체를 물을 때만 상세가 필요하다', () => {
  assert.equal(selfhoodLookup('넌 뭘 할 수 있어?').needed, true);
  assert.equal(selfhoodLookup('어디까지 가능해?').needed, true);
  assert.equal(selfhoodLookup('넌 누구야?').needed, true);
  assert.equal(selfhoodLookup('지파오티파이브가 뭐야?').needed, true); // ③ 자기 이름을 알아듣는다
  assert.equal(selfhoodLookup('왜 안 돼?').needed, true);
  assert.equal(selfhoodLookup('지금 상태 어때?').needed, true, '자연스러운 상태 질문도 자기 현실을 찾는다');
  assert.equal(selfhoodLookup('뭐가 연결돼 있어?').needed, true, '연결 질문을 능력 질문으로 알아듣는다');
  assert.equal(selfhoodLookup('어디에서 어떻게 돌아가고 있어?').needed, true, '실행 환경 질문을 놓치지 않는다');
  assert.equal(selfhoodLookup('오늘 날씨 어때?').needed, false, '평범한 대화엔 상세를 싣지 않는다');
});

test('상세 선택: 고른 대목만 꺼내고, 문서가 없으면 지어내지 않는다', () => {
  const docs = { soul: 'SOUL 내용', capabilities: 'CAP 내용' };
  assert.equal(selectSelfhoodDetail(docs, ['identity']), 'SOUL 내용');
  assert.equal(selectSelfhoodDetail(docs, ['capabilities']), 'CAP 내용');
  assert.ok(selectSelfhoodDetail(docs, ['identity', 'capabilities']).includes('SOUL 내용'));
  assert.equal(selectSelfhoodDetail({}, ['capabilities']), '', '없으면 빈 값(지어내지 않는다)');
});

test('프롬프트: 물어봤을 때만 상세가 실린다', () => {
  const base = { selfStateFacts: { model: 'm' }, currentRequest: '안녕', authorityFacts: {} };
  assert.ok(!buildModelMessages(base).system.includes('자세한 사실'));
  const withDetail = buildModelMessages({ ...base, selfhoodDetail: 'CAP 내용' });
  assert.ok(withDetail.system.includes('자세한 사실'));
  assert.ok(withDetail.system.includes('CAP 내용'));
});

test('프롬프트: 로컬 실행 환경과 승인 필요 손을 실제 자기상태로 구분한다', () => {
  const system = buildModelMessages({
    selfStateFacts: {
      model: 'gpt-5.5',
      readyTools: ['로컬 파일'],
      approvalRequired: ['로컬 파일 쓰기'],
    },
    runtimeEnvironment: {
      locality: 'this_computer',
      networkExposure: 'loopback_only',
      costTracking: 'not_tracked',
    },
    surface: { responseSurface: 'web', audience: 'web_chat' },
    currentRequest: '지금 어디서 돌아가?', authorityFacts: {},
  }).system;
  assert.match(system, /이 컴퓨터에서 로컬로 실행/);
  assert.match(system, /이 컴퓨터 안에서만 열려/);
  assert.match(system, /확인받고 실행하는 일: 로컬 파일 쓰기/);
  assert.match(system, /호출 비용은 현재 T5가 직접 집계하지 않/);
  assert.match(system, /웹 대화 화면/);
});

// ── 이름 지정·지속 (④) ───────────────────────────────────────────────────
test('이름 감지: 명시적 지시만 잡는다(추정으로 바꾸지 않는다)', () => {
  assert.equal(detectSelfNaming('니 이름은 이제부터 아이기스야').name, '아이기스');
  assert.equal(detectSelfNaming('네 이름은 하늘이다').name, '하늘');
  assert.equal(detectSelfNaming('앞으로 미르라고 불러').name, '미르');
  assert.equal(detectSelfNaming('이름을 별로 바꿔').name, '별');
  assert.equal(detectSelfNaming('네 이름은 뭐야?'), null, '질문은 지시가 아니다');
  assert.equal(detectSelfNaming('오늘 뭐 해?'), null);
});

test('SOUL.md: 오너 원문으로 시드하고, 이름 줄만 바꾸며 사용자 편집을 보존한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-soul-'));
  const store = new SelfhoodStore(dir);
  const soul = await store.ensureSoul();
  assert.equal(soul, SOUL_SEED);
  assert.ok(soul.includes('GPAO-T5는 AI 모델이 아니다'), '계획서 §0 원문');
  assert.ok(soul.includes('개인 AI 운영체제'), '계획서 §0.1 원문');
  assert.equal(readNameFromSoul(soul), PRODUCT_NAME);

  // 사용자가 직접 편집한 뒤에도 시드로 덮이지 않는다
  await writeFile(join(dir, 'SOUL.md'), `${soul}\n\n## 내 메모\n\n보존되어야 함\n`, 'utf8');
  const again = await store.ensureSoul();
  assert.ok(again.includes('보존되어야 함'), '두 번째 부팅에서 덮어쓰지 않는다');

  await store.setName('아이기스');
  const named = await readFile(join(dir, 'SOUL.md'), 'utf8');
  assert.equal(readNameFromSoul(named), '아이기스');
  assert.ok(named.includes('보존되어야 함'), '이름만 바뀌고 나머지는 그대로');
  assert.ok(named.includes('GPAO-T5는 AI 모델이 아니다'), '정체 원문도 그대로');
});

test('replaceNameInSoul: 이름 절이 없으면 만들어 붙인다(사용자가 지웠어도 동작)', () => {
  const out = replaceNameInSoul('# 소울\n\n내용만 있음\n', '미르');
  assert.equal(readNameFromSoul(out), '미르');
});

// ── 관통: 턴에서 이름이 이번 턴부터 반영되고 서버가 지속할 신호를 준다 ────
test('턴: 이름을 지어 주면 이번 턴부터 그 이름으로 답하고 identityUpdate 를 돌려준다', async () => {
  let seenSystem = '';
  const model = { respond: async (tc) => { seenSystem = buildModelMessages(tc).system; return '네'; } };
  const r = await runTurn(
    { text: '니 이름은 이제부터 아이기스야' },
    { env: demoEnv(), model, tools: new ToolRunner(demoTools()) },
  );
  assert.equal(r.identityUpdate?.name, '아이기스');
  assert.ok(seenSystem.includes('아이기스'), '이번 턴부터 그 이름으로 생각한다');
});

test('턴: 능력을 물으면 상세가 실리고, 평범한 대화엔 안 실린다', async () => {
  const seen = [];
  const model = { respond: async (tc) => { seen.push(buildModelMessages(tc).system); return 'ok'; } };
  const ctx = () => ({
    env: demoEnv(), model, tools: new ToolRunner(demoTools()),
    selfhoodDocs: { soul: 'SOUL 문서', capabilities: 'CAP 문서' },
  });
  await runTurn({ text: '넌 뭘 할 수 있어?' }, ctx());
  assert.ok(seen[0].includes('CAP 문서'), '물어보면 상세가 간다');
  await runTurn({ text: '오늘 기분이 좋네' }, ctx());
  assert.ok(!seen[1].includes('CAP 문서'), '평범한 대화엔 안 간다');
});

// ── 모델 무관 (오너 요구: "어떤 모델이 연결되더라도") ─────────────────────
test('모델이 바뀌어도 같은 정체 사실이 실린다', () => {
  for (const model of ['gpt-5.5', 'beai-8.6', 'gemini-flash-latest', 'claude-opus-4-8', 'beai5-stub']) {
    const sys = buildModelMessages({
      identity: DEFAULT_IDENTITY, selfStateFacts: { model }, currentRequest: 'x', authorityFacts: {},
    }).system;
    assert.ok(sys.includes(PRODUCT_NAME), `${model}: 제품 정체가 실린다`);
    assert.ok(sys.includes('운영체제'), `${model}: OS 임을 안다`);
    assert.ok(sys.includes(model), `${model}: 지금 쓰는 모델도 사실로 실린다`);
    assert.ok(sys.includes('두뇌일 뿐'), `${model}: 모델≠정체 경계가 유지된다`);
  }
});
