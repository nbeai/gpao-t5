// W2 서두 · 본선 직렬 선행 계약 (AC1-RECHECK §5) — 병렬 개방 전에 닫는 세 자리.
//
// 왜 병렬 전인가: AC-2·AC-3·AC-4 가 전부 이 세 가지 위에 선다. 어긋난 채로 열면 세 작업선이
// 각자 다른 진실을 상속한다(프랙탈 위반 — 같은 사실을 두 층이 따로 계산하면 이미 결함이다).
//
//   R4  skills.json v1/v2 왕복이 v2 상태를 조용히 낮춘다(stale·retired·quarantined 소실).
//   R5  automation 저장이 skills.json·agent-profiles.json 까지 되쓴다(안 바꾼 파일도).
//   R1  authorityEnvelope.allowedKinds 가 "행동 종류"와 "도구 id" 두 어휘로 읽힌다.
//
// 반대시험은 **계약 문장의 정의역**에서 뽑는다. W1 에서 구현 모양에서 뽑았다가 감사에 걸렸다
// (`args?: *` 인데 최상위 문자열만 봤다) — 같은 실수를 되풀이하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillStore, SkillDefinitionStore } from '../src/surface/skill-store.js';
import { AutomationJobStore, AutomationStore } from '../src/surface/automation-store.js';
import {
  AUTOMATION_SCHEMA_VERSION,
  SKILL_DEFINITION_STATES,
  validateAuthorityEnvelope,
  migrateAutomationStateV1,
  projectAutomationJobV1,
  contentHash,
  skillHashSource,
} from '../src/kernel/l5-growth/automation-contracts.js';
import { AUTHORITY_KINDS } from '../src/kernel/l2-plan/authority.js';
import { MODEL_CONTROL_SCHEMAS, modelSchemasFor, splitModelControlCalls } from '../src/kernel/l2-plan/model-control.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const 새디렉 = () => mkdtemp(join(tmpdir(), 'gpao-t5-w2-'));

// fixture 도 계약을 지킨다(contentHash 는 내용에서 파생). 지어낸 fixture 는 계약이 아니라
// 내 상상을 재게 된다 — W1 에서 배운 것과 같은 자리다.
function v2스킬(id, state) {
  const 뼈대 = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id, name: `${id} 스킬`, purpose: '테스트', version: 1, contentHash: '',
    inputs: [], steps: ['한 걸음'], resultContract: { kind: 'text' }, requiredCapabilities: [],
    authorityHints: [], replayCases: [], source: { kind: 'test', sessionId: 's', traceIds: [] },
    state, createdAt: 1, updatedAt: 1, previousVersion: null,
  };
  return { ...뼈대, contentHash: contentHash(skillHashSource(뼈대)) };
}

// ── R4 · v1 투영은 읽기용이다. 왕복이 v2 상태를 낮추지 않는다 ─────────────
// 계약 정의역: SKILL_DEFINITION_STATES 아홉 상태 전부. v1 어휘(6종)로 표현 못 하는 상태가
// 셋(stale·retired·quarantined) 있고, 그 셋이 정확히 드리프트 지점이다.
test('R4: v1 투영을 거쳐 저장해도 v2 상태 아홉 가지가 전부 보존된다', async () => {
  const dir = await 새디렉();
  const v2 = new SkillDefinitionStore(dir);
  const v1 = new SkillStore(dir);
  await v2.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: SKILL_DEFINITION_STATES.map((s) => v2스킬(s, s)) });

  const 투영 = await v1.load();          // 런타임(v1 선)이 읽고
  await v1.save(투영);                    // 그대로 다시 저장한다(무관한 저장 클릭 하나)

  const 후 = await v2.load();
  for (const state of SKILL_DEFINITION_STATES) {
    const 레코드 = 후.skills.find((s) => s.id === state);
    assert.equal(레코드?.state, state, `${state} 가 왕복에서 ${레코드?.state} 로 바뀌었다`);
  }
});

test('R4: v1 층이 실제로 상태를 바꾸면 그 결정은 반영된다(투영이 결정을 삼키지 않는다)', async () => {
  const dir = await 새디렉();
  const v2 = new SkillDefinitionStore(dir);
  const v1 = new SkillStore(dir);
  await v2.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [v2스킬('s1', 'approved')] });

  const 투영 = await v1.load();
  투영.skills[0].state = 'admitted';       // v1 어휘의 실제 전이(승격)
  await v1.save(투영);

  assert.equal((await v2.load()).skills[0].state, 'active', 'v1 이 내린 결정이 v2 에 안 닿았다');
});

test('R4: 스킬 하나를 건드린 저장이 다른 스킬의 상태를 바꾸지 않는다', async () => {
  const dir = await 새디렉();
  const v2 = new SkillDefinitionStore(dir);
  const v1 = new SkillStore(dir);
  await v2.save({
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    skills: [v2스킬('건드릴것', 'approved'), v2스킬('무관', 'stale'), v2스킬('무관2', 'retired')],
  });

  const 투영 = await v1.load();
  투영.skills.find((s) => s.id === '건드릴것').state = 'admitted';
  await v1.save(투영);

  const 후 = await v2.load();
  assert.equal(후.skills.find((s) => s.id === '무관').state, 'stale');
  assert.equal(후.skills.find((s) => s.id === '무관2').state, 'retired');
});

// ── R5 · 안 바꾼 파일은 쓰지 않는다 ──────────────────────────────────────
// 계약: workspace migration 은 "job 이 참조할 skill·profile 이 실재하게" 만드는 것이다.
// 이미 그 조건이 참인 파일까지 되쓰면, 같은 데이터 디렉터리를 쓰는 다른 저장선의 갱신을
// 덮어쓴다(읽고→쓰는 사이에 낀 남의 저장이 사라진다).
test('R5: 다시 돌아도 바꿀 것이 없으면 세 파일 중 어느 것도 되쓰지 않는다', async () => {
  const dir = await 새디렉();
  const v2 = new SkillDefinitionStore(dir);
  await v2.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [v2스킬('보존', 'active')] });

  const auto = new AutomationStore(dir);
  const 상태 = await auto.load();
  상태.jobs.push({ id: 'j1', statement: '매주 정리', action: { tool: 'web.collect', args: { request: 'x' } }, state: 'scheduled', nextRunAt: 1, intervalMs: 1000, executions: [] });
  await auto.save({ ...상태, schemaVersion: AUTOMATION_SCHEMA_VERSION }); // 1차: synthetic skill 생성(정당)

  // 기존 레코드는 그 과정에서 살아남는다.
  assert.ok((await v2.load()).skills.some((s) => s.id === '보존'), '기존 스킬이 migration 에서 사라졌다');

  const 파일들 = ['skills.json', 'agent-profiles.json', 'automation.json'];
  const 전 = {};
  for (const f of 파일들) 전[f] = (await stat(join(dir, f))).mtimeMs;
  await new Promise((r) => setTimeout(r, 12)); // mtime 해상도 확보

  const { migrateAutomationWorkspaceV1 } = await import('../src/surface/automation-workspace-migration.js');
  await migrateAutomationWorkspaceV1(dir, Date.now());   // 2차: 바꿀 것이 없다

  for (const f of 파일들) {
    assert.equal((await stat(join(dir, f))).mtimeMs, 전[f],
      `${f} 를 되썼다 — 내용이 같아도 쓰면 그 사이 남의 갱신이 사라진다`);
  }
});

test('R5: 그래도 job 이 참조할 skill·profile 이 없으면 만든다(기능은 그대로)', async () => {
  const dir = await 새디렉();
  const auto = new AutomationStore(dir);
  const 상태 = await auto.load();
  상태.jobs.push({ id: 'j1', statement: '매주 정리', action: { tool: 'web.collect', args: {} }, state: 'scheduled', nextRunAt: 1, intervalMs: 1000, executions: [] });
  await auto.save({ ...상태, schemaVersion: AUTOMATION_SCHEMA_VERSION });

  const skills = JSON.parse(await readFile(join(dir, 'skills.json'), 'utf8'));
  assert.ok((skills.skills ?? []).length >= 1, 'job 이 가리킬 skill 이 생기지 않았다');
});

// ── R1 · allowedKinds 는 행동 종류다. 도구 id 는 allowedTools 다 ─────────
test('R1: allowedKinds 는 authority 종류 어휘만 받는다', () => {
  const 기본 = { ceiling: 'A1', allowedTargets: [], workspaceRoots: [], expiresAt: null, maxRuns: 1, maxCost: null, requiresFreshApprovalFor: [] };
  assert.equal(validateAuthorityEnvelope({ ...기본, allowedKinds: ['read', 'delete'] }).ok, true);
  assert.equal(validateAuthorityEnvelope({ ...기본, allowedKinds: ['local.file'] }).ok, false,
    '도구 id 가 행동 종류 칸을 통과했다 — 부모⊇자식 비교가 무의미해진다');
  assert.equal(validateAuthorityEnvelope({ ...기본, allowedKinds: ['아무말'] }).ok, false);
  for (const kind of AUTHORITY_KINDS) {
    assert.equal(validateAuthorityEnvelope({ ...기본, allowedKinds: [kind] }).ok, true, `${kind} 가 거부됐다`);
  }
});

test('R1: 도구 신분은 allowedTools 로 따로 선다', () => {
  const e = { ceiling: 'A1', allowedKinds: ['read'], allowedTools: ['local.file'], allowedTargets: [], workspaceRoots: [], expiresAt: null, maxRuns: 1, maxCost: null, requiresFreshApprovalFor: [] };
  assert.equal(validateAuthorityEnvelope(e).ok, true);
  assert.equal(validateAuthorityEnvelope({ ...e, allowedTools: 'local.file' }).ok, false, '문자열 배열이어야 한다');
});

test('R1: 레거시 job migration 이 행동 종류를 같은 판정 함수로 뽑는다', () => {
  const state = migrateAutomationStateV1({
    candidates: [],
    jobs: [{ id: 'j1', statement: '매주 메모 지워줘', action: { tool: 'local.file', args: { action: 'delete', path: '메모.md' } }, state: 'scheduled', nextRunAt: 1, intervalMs: 1000, executions: [] }],
  }, 1);
  const env = state.jobs[0].authorityEnvelope;
  assert.deepEqual(env.allowedKinds, ['delete'], '도구 id 가 아니라 행동 종류여야 한다(toolActionKind 단일 판정)');
  assert.deepEqual(env.allowedTools, ['local.file']);
});

test('R1: 이미 저장된 v2 레코드가 옛 어휘를 갖고 있어도 격리되지 않고 복구된다', () => {
  const 옛 = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    candidates: [],
    jobs: [{
      schemaVersion: AUTOMATION_SCHEMA_VERSION, id: 'j1', name: '매주 정리',
      skillRef: { id: 's1', version: 1, contentHash: 'h' }, agentProfileId: 'a1',
      trigger: { kind: 'interval', timezone: 'Asia/Seoul', intervalMs: 1000, misfirePolicy: 'skip', nextRunAt: 1 },
      inputTemplate: {},
      authorityEnvelope: { ceiling: 'A1', allowedKinds: ['local.file'], allowedTargets: [], workspaceRoots: [], expiresAt: null, maxRuns: 1, maxCost: null, requiresFreshApprovalFor: [] },
      deliveryPolicy: { kind: 'chat' }, state: 'scheduled', nextRunAt: 1, lastRunId: null, createdAt: 1, updatedAt: 1,
    }],
  };
  const state = migrateAutomationStateV1(옛, 2);
  const env = state.jobs[0].authorityEnvelope;
  assert.deepEqual(env.allowedTools, ['local.file'], '도구 id 가 allowedTools 로 옮겨져야 한다');
  assert.ok(!env.allowedKinds.includes('local.file'), '옛 어휘가 그대로 남았다');
  assert.equal(validateAuthorityEnvelope(env).ok, true, '복구 뒤에도 계약을 통과해야 한다(격리 금지)');
});

test('R1: v1 투영이 도구를 allowedTools 에서 읽는다', () => {
  const state = migrateAutomationStateV1({
    candidates: [],
    jobs: [{ id: 'j1', statement: '매주 정리', action: { tool: 'web.collect', args: { request: 'x' } }, state: 'scheduled', nextRunAt: 1, intervalMs: 1000, executions: [] }],
  }, 1);
  const job = { ...state.jobs[0] };
  delete job.legacyV1;                       // 옛 뷰가 없어도 투영이 도구를 알아야 한다
  assert.equal(projectAutomationJobV1(job).action.tool, 'web.collect');
});

// ── 통제 3슬롯 사전 배선 ─────────────────────────────────────────────────
// 계약: 통제 호출은 한 배열에만 선언하고 한 경계에서만 걷어낸다. 세 작업선이 같은 배열을
// 동시에 고치지 않도록 본선이 미리 뚫는다. **소비자가 없는 동안은 모델에게 보이지 않는다** —
// 보이면 모델이 "스킬로 등록했어요" 같은 못 지킬 약속을 한다(memory.propose 와 같은 계약).
test('통제 3슬롯이 한 배열에 선언돼 있다', () => {
  const names = MODEL_CONTROL_SCHEMAS.map((s) => s.name);
  for (const n of ['skill.propose', 'automation.propose', 'agent.propose']) {
    assert.ok(names.includes(n), `${n} 슬롯이 없다`);
  }
});

test('소비자가 붙기 전에는 모델 스키마에 노출되지 않는다', () => {
  const selfState = buildSelfState(demoEnv());
  const names = modelSchemasFor(selfState).map((s) => s.name);
  for (const n of ['skill.propose', 'automation.propose', 'agent.propose']) {
    assert.ok(!names.includes(n), `${n} 이 소비자 없이 모델에게 보인다 — 못 지킬 약속의 씨앗`);
  }
  assert.ok(names.includes('memory.propose'), '기존 통제 채널까지 가리면 안 된다');
});

test('통제 채널은 설치된 소비자를 명시한 턴에만 선택적으로 열린다', () => {
  const selfState = buildSelfState(demoEnv());
  const names = modelSchemasFor(selfState, ['skill.propose', '알수없는.통제']).map((s) => s.name);
  assert.ok(names.includes('skill.propose'), '설치된 skill 소비자 채널이 열리지 않았다');
  assert.ok(!names.includes('automation.propose'), '설치하지 않은 automation 소비자까지 열렸다');
  assert.ok(!names.includes('agent.propose'), '설치하지 않은 agent 소비자까지 열렸다');
  assert.ok(!names.includes('알수없는.통제'), '선언되지 않은 통제 이름이 스키마가 됐다');
});

test('세 통제 호출은 실행 경로로 새지 않는다', () => {
  const 분리 = splitModelControlCalls([
    { name: 'skill.propose', args: { name: '주간 정산' } },
    { name: 'automation.propose', args: { statement: '매주 금요일' } },
    { name: 'agent.propose', args: { name: '분석 담당' } },
    { name: 'local.file', args: { action: 'read', path: 'a.md' } },
  ]);
  assert.deepEqual(분리.rest.map((c) => c.name), ['local.file'], '통제 호출이 실행 계획으로 샜다');
  // 자리만 있는지가 아니라 **값이 실제로 담기는지**를 본다 — 자리만 검사하면 반환을 null 로
  // 바꿔도 통과한다(스윕이 이 약점을 `빠져나갔다`로 잡아 줬다).
  assert.deepEqual(분리.skillProposal, { name: '주간 정산' });
  assert.deepEqual(분리.automationProposal, { statement: '매주 금요일' });
  assert.deepEqual(분리.agentProposal, { name: '분석 담당' });
});

// ── Codex 중간 감사 차단(2026-08-02) · v1 저장이 v2 최신 갱신을 덮는다 ──────
//
// 계약 문장(AC1-RECHECK §3 R4·R5): "v1/v2 이중 저장 절단 — 런타임 소비자를 v2 store 로
// 전환, workspace migration 재작성 경계 정리."
// 내가 1차로 한 것: 상태 매핑 드리프트만. **절단은 하지 않았다** — 그래서 v1 view 가 들고 있는
// `__v2Definition`/`__v2Job` **전체 스냅샷**이 나중에 통째로 되쓰이는 lost update 가 남았다.
//
// 정의역(계약 문장에서 뽑는다):
//   · 소비자 — `server.js` 한 곳, load→변경→save 19 자리. 워커(자동화 tick)와 라우트가
//     같은 저장소를 번갈아 쓰므로 **한 프로세스 안에서도** T0 로드 → T1 타 갱신 → T2 저장이 난다.
//   · 두 저장선 모두(skills.json 의 SkillStore, automation.json 의 AutomationStore).
//   · v1 이 소유한 칸(state·nextRunAt·lastRunId·legacy 블록)과 v2 소유 칸의 구분.
//   · 삭제 호출 지점은 0 — 뷰에 없는 디스크 레코드는 지우지 않는 것이 현재 계약이다.
test('R4 차단: 오래된 v1 view 저장이 그 사이의 v2 갱신을 덮지 않는다(skills)', async () => {
  const dir = await 새디렉();
  const v2 = new SkillDefinitionStore(dir);
  const v1 = new SkillStore(dir);
  await v2.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [v2스킬('s1', 'approved')] });

  const 오래된뷰 = await v1.load();                       // T0: v1 이 읽는다

  const 새것 = { ...v2스킬('s1', 'approved'), purpose: '바뀐 목적' };
  await v2.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [{ ...새것, contentHash: contentHash(skillHashSource(새것)) }] }); // T1: v2 가 갱신

  await v1.save(오래된뷰);                                 // T2: 오래된 뷰를 저장

  assert.equal((await v2.load()).skills[0].purpose, '바뀐 목적',
    'v1 의 오래된 스냅샷이 v2 갱신을 되돌렸다(lost update)');
});

test('R4 차단: 그래도 v1 이 그 턴에 내린 결정은 최신 레코드 위에 반영된다(skills)', async () => {
  const dir = await 새디렉();
  const v2 = new SkillDefinitionStore(dir);
  const v1 = new SkillStore(dir);
  await v2.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [v2스킬('s1', 'approved')] });

  const 뷰 = await v1.load();
  뷰.skills[0].state = 'admitted';                        // v1 의 결정
  const 새것 = { ...v2스킬('s1', 'approved'), purpose: '바뀐 목적' };
  await v2.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [{ ...새것, contentHash: contentHash(skillHashSource(새것)) }] });
  await v1.save(뷰);

  const 후 = (await v2.load()).skills[0];
  assert.equal(후.state, 'active', 'v1 의 결정이 사라졌다');
  assert.equal(후.purpose, '바뀐 목적', 'v2 의 갱신이 사라졌다');
});

test('R5 차단: 오래된 v1 view 저장이 그 사이의 v2 갱신을 덮지 않는다(automation)', async () => {
  const dir = await 새디렉();
  const auto = new AutomationStore(dir);
  const 초기 = await auto.load();
  초기.jobs.push({ id: 'j1', statement: '매주 정리', action: { tool: 'web.collect', args: { request: 'x' } }, state: 'scheduled', nextRunAt: 1, intervalMs: 1000, executions: [] });
  await auto.save({ ...초기, schemaVersion: AUTOMATION_SCHEMA_VERSION });

  const { AutomationJobStore } = await import('../src/surface/automation-store.js');
  const v2 = new AutomationJobStore(dir);
  const 오래된뷰 = await auto.load();                      // T0

  const 현재 = await v2.load();                            // T1: v2 가 이름을 바꾼다
  현재.jobs[0] = { ...현재.jobs[0], name: '바뀐 이름' };
  await v2.save(현재);

  await auto.save(오래된뷰);                               // T2

  assert.equal((await v2.load()).jobs[0].name, '바뀐 이름',
    'v1 의 오래된 스냅샷이 v2 갱신을 되돌렸다(lost update)');
});

test('R5 차단: v1 이 소유한 칸(state·nextRunAt·실행 이력)의 갱신은 살아남는다(automation)', async () => {
  const dir = await 새디렉();
  const auto = new AutomationStore(dir);
  const 초기 = await auto.load();
  초기.jobs.push({ id: 'j1', statement: '매주 정리', action: { tool: 'web.collect', args: { request: 'x' } }, state: 'scheduled', nextRunAt: 1, intervalMs: 1000, executions: [] });
  await auto.save({ ...초기, schemaVersion: AUTOMATION_SCHEMA_VERSION });

  const 뷰 = await auto.load();
  뷰.jobs[0].state = 'paused';                             // v1(워커·라우트)의 결정
  뷰.jobs[0].nextRunAt = 999;
  await auto.save(뷰);

  const 후 = (await auto.load()).jobs[0];
  assert.equal(후.state, 'paused');
  assert.equal(후.nextRunAt, 999);
});

test('R4·R5 차단: 그 사이 새로 생긴 레코드를 v1 저장이 지우지 않는다', async () => {
  const dir = await 새디렉();
  const v2 = new SkillDefinitionStore(dir);
  const v1 = new SkillStore(dir);
  await v2.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [v2스킬('s1', 'approved')] });

  const 오래된뷰 = await v1.load();
  await v2.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [v2스킬('s1', 'approved'), v2스킬('s2', 'active')] });
  await v1.save(오래된뷰);

  const ids = (await v2.load()).skills.map((s) => s.id);
  assert.ok(ids.includes('s2'), '오래된 뷰 저장이 그 사이 생긴 레코드를 지웠다');
});

// 읽기-병합-쓰기 사이의 비동기 경쟁(오너 지적 2026-08-02) — 병합만으로는 안 닫힌다.
// `현재 읽기 → 병합 → 쓰기` 가 원자적이지 않으면 두 저장이 서로를 지운다. 한 파일에 대한
// 저장을 직렬화한다(automation-run-ledger 의 키별 직렬화와 같은 원리).
test('동시 저장이 서로를 지우지 않는다(읽기-병합-쓰기 직렬화, skills)', async () => {
  const dir = await 새디렉();
  const v2 = new SkillDefinitionStore(dir);
  const v1 = new SkillStore(dir);
  await v2.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [v2스킬('a', 'approved'), v2스킬('b', 'approved')] });

  const 뷰1 = await v1.load();
  const 뷰2 = await v1.load();
  뷰1.skills.find((s) => s.id === 'a').state = 'admitted';
  뷰2.skills.find((s) => s.id === 'b').state = 'admitted';

  await Promise.all([v1.save(뷰1), v1.save(뷰2)]);   // 동시에 저장

  const 후 = await v2.load();
  assert.equal(후.skills.find((s) => s.id === 'a').state, 'active', 'a 의 결정이 사라졌다');
  assert.equal(후.skills.find((s) => s.id === 'b').state, 'active', 'b 의 결정이 사라졌다');
});

test('동시 저장이 서로를 지우지 않는다(읽기-병합-쓰기 직렬화, automation)', async () => {
  const dir = await 새디렉();
  const auto = new AutomationStore(dir);
  const 초기 = await auto.load();
  for (const id of ['j1', 'j2']) {
    초기.jobs.push({ id, statement: `${id} 정리`, action: { tool: 'web.collect', args: { request: id } }, state: 'scheduled', nextRunAt: 1, intervalMs: 1000, executions: [] });
  }
  await auto.save({ ...초기, schemaVersion: AUTOMATION_SCHEMA_VERSION });

  const 뷰1 = await auto.load();
  const 뷰2 = await auto.load();
  뷰1.jobs.find((j) => j.id === 'j1').state = 'paused';
  뷰2.jobs.find((j) => j.id === 'j2').state = 'cancelled';

  await Promise.all([auto.save(뷰1), auto.save(뷰2)]);

  const 후 = await auto.load();
  assert.equal(후.jobs.find((j) => j.id === 'j1').state, 'paused');
  assert.equal(후.jobs.find((j) => j.id === 'j2').state, 'cancelled');
});

test('canonical skill update 와 legacy 결정이 같은 파일 경계에서 합쳐진다', async () => {
  const dir = await 새디렉();
  const v2 = new SkillDefinitionStore(dir);
  const v1 = new SkillStore(dir);
  await v2.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [v2스킬('s1', 'approved')] });

  const 오래된뷰 = await v1.load();
  오래된뷰.skills[0].state = 'admitted';
  await Promise.all([
    v2.update((state) => {
      const next = { ...state.skills[0], purpose: 'canonical 변경' };
      next.contentHash = contentHash(skillHashSource(next));
      state.skills[0] = next;
      return state;
    }),
    v1.save(오래된뷰),
  ]);

  const 후 = (await v2.load()).skills[0];
  assert.equal(후.purpose, 'canonical 변경');
  assert.equal(후.state, 'active');
});

test('canonical automation update 와 legacy 결정이 후보·job 을 잃지 않는다', async () => {
  const dir = await 새디렉();
  const v1 = new AutomationStore(dir);
  const 초기 = await v1.load();
  초기.jobs.push({ id: 'j1', statement: '매주 정리', action: { tool: 'web.collect', args: { request: 'x' } }, state: 'scheduled', nextRunAt: 1, intervalMs: 1000, executions: [] });
  await v1.save({ ...초기, schemaVersion: AUTOMATION_SCHEMA_VERSION });

  const v2 = new AutomationJobStore(dir);
  const 오래된뷰 = await v1.load();
  오래된뷰.jobs[0].state = 'paused';
  await Promise.all([
    v2.update((state) => {
      state.candidates.push({ candidateId: 'c2', statement: '새 후보', approved: false });
      state.jobs[0] = { ...state.jobs[0], name: 'canonical 이름' };
      return state;
    }),
    v1.save(오래된뷰),
  ]);

  const 후 = await v2.load();
  assert.equal(후.jobs[0].name, 'canonical 이름');
  assert.equal(후.jobs[0].state, 'paused');
  assert.equal(후.candidates.some((c) => c.candidateId === 'c2'), true);
});
