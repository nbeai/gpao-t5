// **셸을 첫 수단으로. 능력은 도구가 아니라 문서 한 장으로 늘린다.**
//
// 선빨강 둘(라이브 실측 2026-08-11):
//   · "네이버 검색 결과"  → 모델이 주소를 지어냈다(`www.naver.com/search.naver` — 호스트가 틀림)
//   · "엑셀 만들어줘"     → 「생성 부품 0건」으로 끝났다. 실측으로는 셸에서 그냥 만들어진다
// 손이 없어서가 아니다 — `local.terminal` 은 이미 굵고(`needsApproval:false`) 안 막혀 있다.
// 진 자리는 둘이다: **셸이 마지막 수단처럼 놓여 있었고**, **하는 법이 어디에도 없었다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { toolSchemasFor } from '../src/kernel/l2-plan/tool-schema.js';
import { demoDescriptors } from '../src/surface/demo-context.js';
import {
  parseSkillDoc, skillIndex, skillPromptSection, bundledSkillsDir, userSkillsDir,
} from '../src/surface/skill-docs.js';

const 순서 = () => String(buildTaskContext({
  processEnv: {},
  selfState: { currentModel: { id: 't' }, connectedTools: [], riskyActions: [], limits: {} },
  intent: { answerMode: 'work', goal: 'x', currentRequest: '엑셀로 만들어줘' },
  plan: { autoAllowed: [], needsApproval: [], forbidden: [] }, receipts: [],
}).도구쓰는순서 ?? '');

test('순서에 「터미널로 먼저」 축이 있다 — 없으면 전용 손이 없다는 이유로 일이 죽는다', () => {
  const s = 순서();
  assert.match(s, /터미널로 먼저/, `셸이 순서에 없다: ${s}`);
  assert.match(s, /전용 손이 없어도/, `**없는 손 = 못 함**이라는 등식을 안 끊었다: ${s}`);
});

test('그 축이 모델 프롬프트까지 간다 — 소비자가 0곳이면 무엇을 적든 안 간다', () => {
  const tc = buildTaskContext({
    processEnv: {},
    selfState: { currentModel: { id: 't' }, connectedTools: [], riskyActions: [], limits: {} },
    intent: { answerMode: 'work', goal: 'x', currentRequest: '엑셀로 만들어줘' },
    plan: { autoAllowed: [], needsApproval: [], forbidden: [] }, receipts: [],
  });
  const 글 = String(buildModelMessages({ currentRequest: '엑셀로 만들어줘', ...tc }).system ?? '');
  assert.match(글, /터미널로 먼저/, '순서가 모델에게 안 간다');
});

test('공통 운전 고리는 관찰→실행→기계 결과 대조→같은 턴 수정이다', () => {
  const s = 순서();
  assert.match(s, /실제 입력의 형식과 내용을 관찰/, '입력 현실보다 처리법을 먼저 고른다');
  assert.match(s, /stdout·stderr·exit code/, '실행 결과의 기계 사실을 대조하지 않는다');
  assert.match(s, /방법을 바꿔 같은 턴에 다시 실행·확인/, '실패 뒤 설명으로 끝나고 다음 행동이 없다');
  assert.doesNotMatch(s, /마지막 절대경로|local\.file로 읽/, '특정 산출물 문장이나 손을 공통 고리에 박았다');
});

test('셸이 의미별 로컬 손보다 앞에 놓인다 — 배치는 선언 순서로 한다', () => {
  const 이름 = demoDescriptors({}).map((d) => d.id);
  const 셸 = 이름.indexOf('local.terminal');
  assert.ok(셸 >= 0, '셸 선언이 없다');
  for (const 뒤 of ['local.file', 'local.discovery', 'local.locate', 'local.process']) {
    const i = 이름.indexOf(뒤);
    assert.ok(i > 셸, `${뒤}(${i}위)가 셸(${셸}위)보다 앞이다 — 이름으로 먼저 잡히는 손이 셸을 가린다`);
  }
});

test('배치가 손 집합을 바꾸지 않았다 — 순서를 정하는 일이 능력을 정하는 일이 되면 심문이다', () => {
  const self = buildSelfState({
    model: { id: 't' },
    connections: demoDescriptors({}).map((d) => ({ id: d.id, label: d.label, connected: true, hasHandler: true, ...d })),
    grantedAuthorities: [],
  });
  const 실린것 = new Set(toolSchemasFor(self).map((t) => t.name));
  const 실행가능 = new Set(self.connectedTools.filter((t) => t.executable && t.schema).map((t) => t.id));
  assert.deepEqual(실린것, 실행가능);
});

// ── 파일 스킬 ───────────────────────────────────────────────────────────────

test('머리말 세 칸만 읽는다 — 파서를 키우면 그게 또 하나의 계약이 된다', () => {
  const d = parseSkillDoc('---\nname: 이름\ndescription: 설명\nrequires:\n  bins: [sh, ls]\n---\n본문');
  assert.deepEqual(d, { name: '이름', description: '설명', bins: ['sh', 'ls'] });
  assert.deepEqual(parseSkillDoc('---\nname: 목록\nrequires:\n  bins:\n    - sh\n    - ls\n---\n').bins, ['sh', 'ls']);
  assert.equal(parseSkillDoc('머리말 없음'), null, '머리말이 없으면 스킬이 아니다');
  assert.equal(parseSkillDoc('---\ndescription: 이름 없음\n---\n'), null, '이름 없는 것을 목록에 올리지 않는다');
});

test('딸려온 스킬 세 장이 색인에 선다 — 파일이 있으면 쓰인다(등록·승인 없음)', () => {
  const 목록 = skillIndex({ ...process.env, GPAO_T5_AGENT_HOME: mkdtempSync(join(tmpdir(), 't5-skill-')) });
  const 이름 = 목록.map((s) => s.name);
  assert.ok(목록.length >= 3, `딸려온 스킬이 안 보인다: ${이름.join(' · ')}`);
  for (const s of 목록) {
    assert.ok(s.path.startsWith(bundledSkillsDir()), `경로가 딸려온 자리가 아니다: ${s.path}`);
    assert.ok(s.description, `${s.name} 에 설명이 없다 — 이름만으로는 모델이 언제 볼지 모른다`);
  }
});

test('사용자 집 스킬이 같은 이름의 딸려온 것을 이긴다 — 제품이 사용자 것을 덮지 않는다', () => {
  const 집 = mkdtempSync(join(tmpdir(), 't5-skill-home-'));
  const 딸려온이름 = skillIndex({ ...process.env, GPAO_T5_AGENT_HOME: 집 })[0].name;
  const dir = join(userSkillsDir({ GPAO_T5_AGENT_HOME: 집 }), 'mine');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${딸려온이름}\ndescription: 내가 고친 것\n---\n본문\n`, 'utf8');
  const 것 = skillIndex({ ...process.env, GPAO_T5_AGENT_HOME: 집 }).find((s) => s.name === 딸려온이름);
  assert.equal(것.description, '내가 고친 것');
  assert.ok(것.path.startsWith(집), '사용자 집 파일이 아니라 딸려온 것이 이겼다');
});

test('없는 명령을 요구하는 스킬은 목록에 안 올라간다 — 못 하는 법을 가르치면 못 지킬 약속이 된다', () => {
  const 집 = mkdtempSync(join(tmpdir(), 't5-skill-bin-'));
  const dir = join(집, 'skills', 'ghost');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'),
    '---\nname: 유령\ndescription: 없는 명령\nrequires:\n  bins: [t5-이런명령은없다]\n---\n본문\n', 'utf8');
  const 이름 = skillIndex({ ...process.env, GPAO_T5_AGENT_HOME: 집 }).map((s) => s.name);
  assert.ok(!이름.includes('유령'), `이 컴퓨터에 없는 법이 목록에 올랐다: ${이름.join(' · ')}`);
});

test('프롬프트에 계정 이름이 안 실린다 — 홈 아래면 `~/` 로 적는다', () => {
  const 덩어리 = skillPromptSection(skillIndex());
  assert.ok(!/\/Users\//.test(덩어리), `프롬프트에 계정 경로가 실렸다: ${덩어리}`);
  assert.match(덩어리, /~\/.*SKILL\.md/);
});

test('프롬프트에는 이름·설명·경로만 — 본문을 실으면 스킬이 늘수록 프롬프트가 먹힌다', () => {
  const 덩어리 = skillPromptSection([{ name: '가', description: '나', path: '/a/SKILL.md' }]);
  assert.match(덩어리, /가 — 나 · \/a\/SKILL\.md/);
  assert.ok(덩어리.length < 300, `한 장에 이만큼 쓰면 53장이 프롬프트를 먹는다: ${덩어리.length}자`);
  assert.equal(skillPromptSection([]), null, '없는 구역을 만들지 않는다');
});

test('스킬 목록이 모델 프롬프트의 안정 구역에 실린다', () => {
  const tc = buildTaskContext({
    processEnv: {},
    selfState: { currentModel: { id: 't' }, connectedTools: [], riskyActions: [], limits: {} },
    intent: { answerMode: 'work', goal: 'x', currentRequest: '엑셀로 만들어줘' },
    plan: { autoAllowed: [], needsApproval: [], forbidden: [] }, receipts: [],
  });
  const 글 = buildModelMessages({ currentRequest: '엑셀로 만들어줘', ...tc });
  const 첫스킬 = skillIndex()[0];
  assert.ok(String(글.systemStable).includes(첫스킬.보임),
    '스킬 경로가 접두(안정 구역)에 없다 — 매 턴 바뀌는 자리에 두면 캐시가 깨진다');
  assert.ok(!String(글.system).includes('Content_Types'),
    '본문이 프롬프트에 실렸다 — 실어야 할 것은 자리이지 내용이 아니다');
});
