import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditScenarioRecord,
  createLivingSimRoom,
  createRecordingFetch,
  LIVE_SERVER_CONTROL_IDS,
  loadPilotDefinition,
  loadOpenAiCredential,
  materializeFixture,
  parseChildProcessOutput,
  renderScenarioTurns,
  runLivingSimPilot,
  verifyLivingSimBatchEvidence,
  verifyLivingSimScenarioEvidence,
} from '../scripts/human-use/living-sim-runner.mjs';
import { digest, runHarnessQualification } from '../scripts/human-use/harness-qualification.mjs';
import { containsSensitiveValue } from '../src/kernel/l0-evidence/sensitive-text.js';

const tree = new URL('..', import.meta.url).pathname;
const frozenPath = join(tree, 'scripts/human-use/living-sim-pilot-v1.json');
const room = (prefix) => mkdtemp(join(tmpdir(), prefix));

test('동결본: 예비 7 전부와 requiredHands를 읽고 L3 원문·렌더·base 신분을 가른다', async () => {
  const pilot = await loadPilotDefinition(frozenPath);
  assert.equal(pilot.sha256, '873fb72de05f1d1143d569a9eeab34e99409d28466202aa434b6dd984df441f0');
  assert.deepEqual(pilot.document.scenarios.map((scenario) => scenario.id), [
    'L1-settlement-files', 'L2-customer-policy', 'L3-policy-research', 'L4-content-document',
    'L5-admin-preparation', 'L6-schedule-automation', 'L7-pc-mixed-work',
  ]);
  assert.equal(pilot.document.scenarios.some((scenario) => 'allowedHands' in scenario), false);
  assert.match(pilot.document.scenarios[0].turns[3], /8월_채널별_순매출\.csv/);
  const l3 = pilot.document.scenarios[2];
  const rendered = renderScenarioTurns(l3, { webBase: 'http://127.0.0.1:43123' });
  assert.match(rendered[0].frozen, /\{\{WEB_BASE\}\}/);
  assert.match(rendered[0].rendered, /http:\/\/127\.0\.0\.1:43123\/current\.html/);
  assert.equal(rendered[0].baseIdentity, 'http://127.0.0.1:43123');
});

test('긴 macOS TMPDIR 토큰은 격리 방 신분에 들어오지 않고 실제 홈과도 겹치지 않는다', async () => {
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = '/var/folders/c7/vw1b0dhs3dddrx6r102srgvm0000gn/T/';
  let generated;
  try {
    generated = await createLivingSimRoom();
    const ownerHome = await realpath(homedir());
    assert.match(generated, /^\/private\/tmp\/t5-ls-/);
    assert.equal(containsSensitiveValue(`${generated}/home/GPAO-T5/작업결과`), false,
      '격리 방의 기계 토큰이 working state/subject label을 가린다');
    assert.equal(generated === ownerHome || generated.startsWith(`${ownerHome}/`) || ownerHome.startsWith(`${generated}/`), false);
  } finally {
    if (generated) await rm(generated, { recursive: true, force: true });
    if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous;
  }
});

test('L7 fixture: 안전한 상대경로 중첩은 만들고 절대·상위탈출은 거부한다', async () => {
  const root = await room('t5-living-fixture-');
  try {
    await materializeFixture(root, { '승인본/배포설정.txt': '상태=승인\n' });
    assert.equal(await readFile(join(root, '승인본/배포설정.txt'), 'utf8'), '상태=승인\n');
    await assert.rejects(() => materializeFixture(root, { '../owner.txt': 'x' }), /안전한 상대경로/);
    await assert.rejects(() => materializeFixture(root, { '/tmp/out.txt': 'x' }), /안전한 상대경로/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('qualification 실패는 child와 모델 경로에 들어가기 전에 0호출로 멈춘다', async () => {
  let spawned = 0;
  await assert.rejects(() => runLivingSimPilot({
    runId: 'qualification-red', scenarioFile: frozenPath,
    qualificationManifest: '/missing/qualification.json', qualificationHistoryDir: '/missing/history',
    evidenceDir: '/unused/evidence', historyDir: '/unused/history', sourceRoot: tree,
    hooks: {
      verifyQualification: async () => ({ ok: false, failures: ['cut'] }),
      spawnScenario: async () => { spawned += 1; },
    },
  }), (error) => error.code === 'QUALIFICATION_REQUIRED');
  assert.equal(spawned, 0);
});

test('실제 T5 상태 감시 경로는 빈 fixture 경로로 바꿔치기할 수 없다', async () => {
  let verified = 0;
  await assert.rejects(() => runLivingSimPilot({
    runId: 'protected-path-forbidden', scenarioFile: frozenPath,
    qualificationManifest: '/unused/qualification.json', qualificationHistoryDir: '/unused/history',
    evidenceDir: '/unused/evidence', historyDir: '/unused/history', sourceRoot: tree,
    protectedPath: '/tmp/fake-empty-state',
    hooks: { verifyQualification: async () => { verified += 1; return { ok: true }; } },
  }), (error) => error.code === 'PROTECTED_PATH_OVERRIDE_FORBIDDEN');
  assert.equal(verified, 0, '감시 경계가 거짓이면 qualification이나 모델 경로도 열면 안 된다');
});

test('7개 고정 목록은 결과와 무관하게 child를 한 번씩 직렬로만 열고 선택 인자를 거부한다', async () => {
  const root = await room('t5-living-serial-');
  const qualificationPath = join(root, 'qualification.json');
  const source = { kind: 'source', gitSha: 'a'.repeat(40), dirty: false, worktreeDigest: 'b'.repeat(64), changesDigest: 'c'.repeat(64) };
  await writeFile(qualificationPath, JSON.stringify({ runId: 'q', attemptId: 'qa', artifact: source }));
  let active = 0; let maxActive = 0; const order = [];
  try {
    const result = await runLivingSimPilot({
      runId: 'serial-seven', scenarioFile: frozenPath, qualificationManifest: qualificationPath,
      qualificationHistoryDir: join(root, 'qualification-history'), evidenceDir: join(root, 'evidence'),
      historyDir: join(root, 'history'), sourceRoot: tree,
      hooks: {
        verifyQualification: async () => ({ ok: true }), artifactIdentity: async () => source,
        spawnScenario: async ({ scenarioId }) => {
          active += 1; maxActive = Math.max(maxActive, active); order.push(scenarioId);
          await new Promise((done) => setTimeout(done, 2)); active -= 1;
          return order.length === 7 ? { status: 'HARNESS_UNAVAILABLE' }
            : { status: 'RECORDED', manifestPath: join(root, `${scenarioId}.json`) };
        },
      },
    });
    assert.equal(result.status, 'HARNESS_INVALID');
    assert.equal(maxActive, 1);
    assert.deepEqual(order, [
      'L1-settlement-files', 'L2-customer-policy', 'L3-policy-research', 'L4-content-document',
      'L5-admin-preparation', 'L6-schedule-automation', 'L7-pc-mixed-work',
    ]);
    await assert.rejects(() => runLivingSimPilot({
      runId: 'selection-forbidden', scenarioFile: frozenPath, qualificationManifest: qualificationPath,
      qualificationHistoryDir: join(root, 'qualification-history'), evidenceDir: join(root, 'evidence'),
      historyDir: join(root, 'history'), sourceRoot: tree, scenarioId: 'L1-settlement-files',
    }), (error) => error.code === 'SCENARIO_SELECTION_FORBIDDEN');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('child의 기계 무효 exit 결과는 버리지 않고 부모가 다음 attempt 판단에 쓸 수 있다', () => {
  assert.deepEqual(parseChildProcessOutput('', [
    'child diagnostic',
    JSON.stringify({ ok: false, status: 'HARNESS_UNAVAILABLE', invalidReason: 'evidence_incomplete', manifestPath: '/evidence/manifest.json' }),
  ].join('\n')), {
    ok: false, status: 'HARNESS_UNAVAILABLE', invalidReason: 'evidence_incomplete', manifestPath: '/evidence/manifest.json',
  });
  assert.deepEqual(parseChildProcessOutput('', JSON.stringify({ ok: false, code: 'SOURCE_IDENTITY_MISMATCH' })), {
    ok: false, code: 'SOURCE_IDENTITY_MISMATCH', status: 'HARNESS_INVALID', invalidReason: 'evidence_incomplete',
  });
  assert.throws(() => parseChildProcessOutput('', 'not json'), /child result unreadable/);
});

test('공급자 관측기는 요청을 변형하지 않고 자격 원문만 증거에서 가린다', async () => {
  const secret = 'sk-test-secret-value';
  let received;
  const records = [];
  const observed = createRecordingFetch({
    fetchImpl: async (url, init) => {
      received = { url, init };
      return new Response(JSON.stringify({ model: 'gpt-5.1-2026-08-01', choices: [{ finish_reason: 'stop', message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }, access_token: secret }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    },
    record: async (event) => records.push(event), secretValues: [secret],
  });
  const init = { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: '{"model":"gpt-5.1","max_completion_tokens":8192,"tools":[]}' };
  await observed('https://api.openai.com/v1/chat/completions', init);
  assert.equal(received.init, init, 'forward 요청 객체를 바꿨다');
  assert.equal(received.init.body, init.body);
  assert.equal(JSON.stringify(records).includes(secret), false);
  assert.equal(records[0].requestBodySha256, records[0].forwardedBodySha256);
  assert.equal(records[0].requestBody.max_completion_tokens, 8192, '토큰 설정 수치가 비밀로 오인돼 가려졌다');
  assert.equal(records[0].usage.prompt_tokens, 1, 'prompt token 사용량이 사라졌다');
  assert.equal(records[0].usage.total_tokens, 3, 'total token 사용량이 사라졌다');
  assert.equal(records[0].response.access_token, '[REDACTED]');
  assert.equal(records[0].responseModelId, 'gpt-5.1-2026-08-01');
});

test('저장 자격은 실제 홈 model-connection에서만 읽고 provider/model/base가 다르면 호출 전에 unavailable이다', async () => {
  const root = await room('t5-living-credential-');
  const file = join(root, '.local/state/gpao-t5/sessions/model-connection.json');
  await mkdir(join(file, '..'), { recursive: true });
  try {
    const write = async (connection) => writeFile(file, JSON.stringify({
      version: 2, activeId: 'active', connections: [{ id: 'active', kind: 'api_key', ...connection }], roleBindings: {},
    }));
    await write({ provider: 'openai', key: 'saved-owner-secret', modelId: 'gpt-5.1', baseUrl: 'https://api.openai.com/v1' });
    const loaded = loadOpenAiCredential(root);
    assert.equal(loaded.key, 'saved-owner-secret');
    assert.deepEqual(loaded.identity, {
      source: 'saved-model-connection', provider: 'openai', configuredModelId: 'gpt-5.1',
      baseUrl: 'https://api.openai.com/v1', baseOrigin: 'https://api.openai.com',
    });
    for (const wrong of [
      { provider: 'anthropic', key: 'x', modelId: 'gpt-5.1', baseUrl: 'https://api.openai.com/v1' },
      { provider: 'openai', key: 'x', modelId: 'gpt-5.2', baseUrl: 'https://api.openai.com/v1' },
      { provider: 'openai', key: 'x', modelId: 'gpt-5.1', baseUrl: 'http://127.0.0.1:9/v1' },
    ]) {
      await write(wrong);
      assert.throws(() => loadOpenAiCredential(root), (error) => error.code === 'HARNESS_UNAVAILABLE');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('control 계약은 live server가 소비하는 네 ID만이며 응답의 dated model 신분은 원문으로 허용한다', () => {
  assert.deepEqual(LIVE_SERVER_CONTROL_IDS, ['skill.propose', 'automation.propose', 'agent.propose', 'work.state']);
  const dated = structuredClone(validRecord());
  dated.events.find((event) => event.type === 'provider_call').responseModelId = 'gpt-5.1-2026-08-01';
  assert.equal(auditScenarioRecord(dated).ok, true);
});

function validRecord() {
  const protectedPath = join(homedir(), '.local', 'state', 'gpao-t5');
  const outputPath = '/tmp/living-sim-out.csv';
  return {
    manifest: {
      schemaVersion: 1, kind: 'living-sim-pilot-scenario', status: 'RECORDED',
      batchRunId: 'pilot', runId: 'pilot::L1-settlement-files', attemptId: 'attempt',
      scenarioId: 'L1-settlement-files',
      source: { kind: 'source', gitSha: 'a'.repeat(40), dirty: false, worktreeDigest: 'b'.repeat(64), changesDigest: 'c'.repeat(64) },
      scenarioFile: { sha256: 'd'.repeat(64) }, scenarioDigest: 'e'.repeat(64),
      provider: { provider: 'openai', configuredModelId: 'gpt-5.1', baseOrigin: 'https://api.openai.com', observedCalls: 1 },
      runtime: { requiredHands: ['local.file'], usableToolIds: ['local.file'], exposedToolIds: ['local.file'], unavailableRequiredHands: [] },
      protectedState: { paths: [protectedPath], beforeSnapshotDigest: digest([]), afterSnapshotDigest: digest([]), changed: [] },
      fixtureState: { sourcePaths: [], beforeSnapshotDigest: digest([]), afterSnapshotDigest: digest([]), changed: [] },
      surface: { sessionId: 'session-1', entryCount: 1 },
      rawEvidence: [{ name: '000001-execution.json', sha256: 'f'.repeat(64) }],
      evaluation: {
        machineConditions: {
          outputFile: { status: 'PASS', expected: 'out.csv', observed: 'out.csv' },
          sourceHashesUnchanged: { status: 'PASS', expected: true, observed: [] },
          outputReadBack: { status: 'PASS', expected: true, observed: true },
        },
        semanticConditions: [], safetyConditions: [], forbiddenOutcomes: [], overall: 'PM_UNJUDGED',
      },
    },
    scenario: {
      id: 'L1-settlement-files', requiredHands: ['local.file'], turns: ['첫 턴'],
      resultConditions: { outputFile: 'out.csv', sourceHashesUnchanged: true, outputReadBack: true },
      safetyConditions: [], forbiddenOutcomes: [],
    },
    events: [
      { type: 'execution', source: { kind: 'source', gitSha: 'a'.repeat(40), dirty: false, worktreeDigest: 'b'.repeat(64), changesDigest: 'c'.repeat(64) }, scenarioFileSha256: 'd'.repeat(64), scenarioDigest: 'e'.repeat(64) },
      { type: 'runtime_reality', usableToolIds: ['local.file'], exposedToolIds: ['local.file'], requiredHands: ['local.file'], unavailableRequiredHands: [] },
      { type: 'surface_session', sessionId: 'session-1' },
      { type: 'surface_turn', entryIndex: 0, inputKind: 'user_text', sessionId: 'session-1', endpoint: '/turn', renderedText: '첫 턴', response: { kind: 'reply' } },
      { type: 'provider_call', endpointOrigin: 'https://api.openai.com', requestModelId: 'gpt-5.1', responseModelId: 'gpt-5.1', requestBodySha256: '1'.repeat(64), forwardedBodySha256: '1'.repeat(64) },
      {
        type: 'final_state', sessionId: 'session-1',
        ledgerEntries: [{ actualCall: { tool: 'local.file', args: { action: 'read', path: outputPath } } }],
        workEvents: [], outputReadBack: true,
        output: { path: 'out.csv', absolutePath: outputPath, exists: true, sha256: '2'.repeat(64), readbackSha256: '2'.repeat(64) },
        runnerMutations: [],
      },
      {
        type: 'path_snapshots', protected: { paths: [protectedPath], before: [], after: [] },
        sources: { paths: [], before: [], after: [] }, protectedChanged: [], sourceChanged: [],
      },
    ],
  };
}

test('반례: 제품 턴·실 provider·출력 실물·clean source·실사용 상태·대필 중 하나라도 거짓이면 빨강이다', () => {
  assert.equal(auditScenarioRecord(validRecord()).ok, true);
  for (const [name, mutate, expected] of [
    ['제품 턴 미관통', (r) => { r.events = r.events.filter((event) => event.type !== 'surface_turn'); }, 'product_turns'],
    ['가짜 provider', (r) => { r.events.find((event) => event.type === 'provider_call').endpointOrigin = 'http://127.0.0.1:9'; }, 'provider_identity'],
    ['출력 없이 성공', (r) => { r.events.find((event) => event.type === 'final_state').output.exists = false; }, 'output_binding'],
    ['dirty source', (r) => { r.manifest.source.dirty = true; r.events[0].source.dirty = true; }, 'source_dirty'],
    ['실사용 상태 오염', (r) => { r.events.find((event) => event.type === 'path_snapshots').protectedChanged = ['/Users/owner/.local/state/gpao-t5']; }, 'protected_state_changed'],
    ['실행기 대필', (r) => { r.events.find((event) => event.type === 'final_state').runnerMutations = ['/automation/pause']; }, 'runner_ghost_action'],
  ]) {
    const forged = structuredClone(validRecord()); mutate(forged);
    const result = auditScenarioRecord(forged);
    assert.equal(result.ok, false, name);
    assert.ok(result.failures.includes(expected), `${name}: ${JSON.stringify(result.failures)}`);
  }
});

test('절단: 보호·fixture before/after snapshot 주장은 raw path_snapshots와 각각 결합돼야 한다', () => {
  assert.equal(auditScenarioRecord(validRecord()).ok, true);
  for (const [name, mutate, expected] of [
    ['보호 before', (r) => { r.manifest.protectedState.beforeSnapshotDigest = '0'.repeat(64); }, 'protected_snapshot_binding'],
    ['보호 after', (r) => { r.manifest.protectedState.afterSnapshotDigest = '0'.repeat(64); }, 'protected_snapshot_binding'],
    ['fixture before', (r) => { r.manifest.fixtureState.beforeSnapshotDigest = '0'.repeat(64); }, 'fixture_snapshot_binding'],
    ['fixture after', (r) => { r.manifest.fixtureState.afterSnapshotDigest = '0'.repeat(64); }, 'fixture_snapshot_binding'],
  ]) {
    const cut = structuredClone(validRecord()); mutate(cut);
    const result = auditScenarioRecord(cut);
    assert.equal(result.ok, false, name);
    assert.ok(result.failures.includes(expected), `${name}: ${JSON.stringify(result.failures)}`);
  }
});

test('선빨강: 평가·세션·실제 보호 경로는 manifest와 raw 양쪽이 함께 거짓이어도 통과하면 안 된다', () => {
  assert.equal(auditScenarioRecord(validRecord()).ok, true);
  const cases = [
    ['sourceHashes 거짓 PASS', (r) => {
      r.events.find((event) => event.type === 'path_snapshots').sourceChanged = ['/fixture/source.csv'];
      r.manifest.fixtureState.changed = ['/fixture/source.csv'];
    }, 'evaluation_binding'],
    ['outputReadBack 거짓 PASS', (r) => {
      const final = r.events.find((event) => event.type === 'final_state');
      final.ledgerEntries = []; final.outputReadBack = false;
    }, 'evaluation_binding'],
    ['다른 final session', (r) => { r.events.find((event) => event.type === 'final_state').sessionId = 'session-other'; }, 'session_binding'],
    ['다른 manifest surface session', (r) => { r.manifest.surface.sessionId = 'session-other'; }, 'session_binding'],
    ['빈 보호 경로로 양쪽 바꿔치기', (r) => {
      r.manifest.protectedState.paths = ['/tmp/empty-owner-state'];
      r.events.find((event) => event.type === 'path_snapshots').protected.paths = ['/tmp/empty-owner-state'];
    }, 'protected_path_identity'],
  ];
  const observed = cases.map(([name, mutate, expected]) => {
    const forged = structuredClone(validRecord()); mutate(forged);
    const result = auditScenarioRecord(forged);
    return { name, ok: result.ok, caught: result.failures.includes(expected) };
  });
  assert.deepEqual(observed, cases.map(([name]) => ({ name, ok: false, caught: true })));
});

test('raw 삭제·변조와 manifest 단독 변조는 파일·history 결합 검증에서 빨강이다', async () => {
  const root = await room('t5-living-evidence-');
  try {
    const attempt = join(root, 'attempt'); const raw = join(attempt, 'raw'); const history = join(root, 'history');
    await Promise.all([mkdir(raw, { recursive: true }), mkdir(history, { recursive: true })]);
    await writeFile(join(raw, '000001-execution.json'), '{"type":"execution"}\n');
    await writeFile(join(attempt, 'manifest.json'), JSON.stringify({ rawEvidence: [{ name: '000001-execution.json', sha256: '0'.repeat(64) }] }));
    const result = await verifyLivingSimScenarioEvidence(join(attempt, 'manifest.json'), { historyDir: history, scenarioFile: frozenPath });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => /raw_hash|manifest|history/.test(failure)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

function fixtureEvaluation(scenario, { output, sourceChanged = [], outputReadBack = false }) {
  const machineConditions = {};
  for (const [name, expected] of Object.entries(scenario.resultConditions ?? {})) {
    if (name === 'outputFile') {
      machineConditions[name] = { status: output?.exists ? 'PASS' : 'FAIL', expected, observed: output?.exists ? output.path : null };
    } else if (name === 'sourceHashesUnchanged') {
      machineConditions[name] = { status: expected === true && sourceChanged.length === 0 ? 'PASS' : 'FAIL', expected, observed: sourceChanged };
    } else if (name === 'outputReadBack') {
      machineConditions[name] = { status: expected === true && outputReadBack ? 'PASS' : 'FAIL', expected, observed: outputReadBack };
    }
  }
  const machineNames = new Set(['outputFile', 'sourceHashesUnchanged', 'outputReadBack']);
  return {
    machineConditions,
    semanticConditions: Object.entries(scenario.resultConditions ?? {})
      .filter(([name]) => !machineNames.has(name))
      .map(([name, expected]) => ({ name, expected, status: 'PM_UNJUDGED' })),
    safetyConditions: (scenario.safetyConditions ?? []).map((condition) => ({ condition, status: 'PM_UNJUDGED' })),
    forbiddenOutcomes: (scenario.forbiddenOutcomes ?? []).map((outcome) => ({ outcome, status: 'PM_UNJUDGED' })),
    overall: 'PM_UNJUDGED',
  };
}

async function writeValidEvidence(root, suffix, options = {}) {
  const pilot = await loadPilotDefinition(frozenPath);
  const scenario = pilot.document.scenarios[options.scenarioIndex ?? 0];
  const batchRunId = options.batchRunId ?? 'pilot';
  const runId = options.runId ?? `pilot::L1-settlement-files::${suffix}`;
  const attemptId = options.attemptId ?? `attempt-${suffix}`;
  const attempt = join(root, suffix); const rawDir = join(attempt, 'raw');
  const historyDir = options.historyDir ?? join(root, `history-${suffix}`);
  const qualificationPath = join(root, `qualification-${suffix}.json`);
  await mkdir(rawDir, { recursive: true });
  const source = options.source ?? { kind: 'source', gitSha: 'a'.repeat(40), dirty: false, worktreeDigest: 'b'.repeat(64), changesDigest: 'c'.repeat(64) };
  let qualification = options.qualification;
  if (!qualification) {
    await writeFile(qualificationPath, '{"qualified":true}\n');
    qualification = { manifestPath: qualificationPath, historyDir: join(root, 'q-history'), sha256: digest(await readFile(qualificationPath)), runId: 'q', attemptId: 'qa' };
  }
  const runtime = {
    requiredHands: scenario.requiredHands, usableToolIds: scenario.requiredHands,
    exposedToolIds: scenario.requiredHands, unavailableRequiredHands: [],
  };
  const protectedPath = join(homedir(), '.local', 'state', 'gpao-t5');
  const outputName = scenario.resultConditions?.outputFile ?? null;
  const outputPath = outputName ? `/tmp/${suffix}-output` : null;
  const output = outputName ? {
    path: outputName, absolutePath: outputPath, exists: true,
    sha256: '2'.repeat(64), readbackSha256: '2'.repeat(64),
  } : null;
  const ledgerEntries = outputPath
    ? [{ actualCall: { tool: 'local.file', args: { action: 'read', path: outputPath } } }] : [];
  const outputReadBack = Boolean(outputPath);
  const events = [
    { type: 'execution', runId, attemptId, source, scenarioFileSha256: pilot.sha256, scenarioDigest: digest(scenario), qualification },
    { type: 'runtime_reality', ...runtime },
    { type: 'surface_session', sessionId: 'session-1' },
    ...scenario.turns.map((entry, entryIndex) => ({
      type: 'surface_turn', entryIndex, sessionId: 'session-1', endpoint: typeof entry === 'string' ? '/turn' : null,
      inputKind: typeof entry === 'string' ? 'user_text' : 'action',
      ...(typeof entry === 'string' ? { renderedText: entry } : { action: entry.action }), response: { kind: 'reply' },
    })),
    { type: 'provider_call', endpointOrigin: 'https://api.openai.com', requestModelId: 'gpt-5.1', responseModelId: 'gpt-5.1', requestBodySha256: '1'.repeat(64), forwardedBodySha256: '1'.repeat(64) },
    { type: 'final_state', sessionId: 'session-1', output, outputReadBack, ledgerEntries, runnerMutations: [] },
    {
      type: 'path_snapshots', protected: { paths: [protectedPath], before: [], after: [] },
      sources: { paths: [], before: [], after: [] }, protectedChanged: [], sourceChanged: [],
    },
  ];
  const rawEvidence = [];
  for (let index = 0; index < events.length; index += 1) {
    const name = `${String(index + 1).padStart(6, '0')}-${events[index].type}.json`;
    const path = join(rawDir, name); await writeFile(path, `${JSON.stringify(events[index])}\n`);
    rawEvidence.push({ name, sha256: digest(await readFile(path)) });
  }
  const manifest = {
    schemaVersion: 1, kind: 'living-sim-pilot-scenario', status: 'RECORDED', batchRunId, runId, attemptId,
    scenarioId: scenario.id, source, scenarioFile: { sha256: pilot.sha256 }, scenarioDigest: digest(scenario), qualification,
    provider: { provider: 'openai', configuredModelId: 'gpt-5.1', baseOrigin: 'https://api.openai.com', observedCalls: 1 },
    runtime,
    protectedState: { paths: [protectedPath], beforeSnapshotDigest: digest([]), afterSnapshotDigest: digest([]), changed: [] },
    fixtureState: { sourcePaths: [], beforeSnapshotDigest: digest([]), afterSnapshotDigest: digest([]), changed: [] },
    surface: { sessionId: 'session-1', entryCount: scenario.turns.length },
    evaluation: fixtureEvaluation(scenario, { output, outputReadBack }),
    rawEvidence,
  };
  const manifestPath = join(attempt, 'manifest.json'); await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  const runDir = join(historyDir, 'runs', digest(runId)); await mkdir(runDir, { recursive: true });
  const historySeq = Number(options.historySeq ?? 1) * 2;
  await writeFile(join(runDir, `${String(historySeq - 1).padStart(6, '0')}-started.json`), JSON.stringify({ type: 'started', runId, attemptId, executionKind: 'headless_isolated' }));
  await writeFile(join(runDir, `${String(historySeq).padStart(6, '0')}-finished.json`), JSON.stringify({ type: 'finished', runId, attemptId, status: 'RECORDED', invalidReason: null, manifestHash: digest(await readFile(manifestPath)) }));
  return { manifestPath, manifest, historyDir, rawDir, verify: () => verifyLivingSimScenarioEvidence(manifestPath, {
    historyDir, scenarioFile: frozenPath, verifyQualification: async () => ({ ok: true }),
  }) };
}

async function makeQualificationRef(root, suffix) {
  const historyDir = join(root, `qualification-history-${suffix}`);
  const protectedFile = join(root, `qualification-protected-${suffix}.txt`);
  await writeFile(protectedFile, 'unchanged\n');
  const result = await runHarnessQualification({
    runId: `living-batch-qualification-${suffix}`, sourceRoot: tree,
    evidenceDir: join(root, `qualification-evidence-${suffix}`), historyDir,
    protectedPaths: [protectedFile],
  });
  assert.equal(result.status, 'QUALIFIED', JSON.stringify(result.manifest));
  const bytes = await readFile(result.manifestPath);
  return {
    ref: {
      manifestPath: result.manifestPath, historyDir, sha256: digest(bytes),
      runId: result.manifest.runId, attemptId: result.manifest.attemptId,
    },
    source: result.manifest.artifact,
    historyDir,
  };
}

async function writeBatchEvidence(root, suffix, {
  batchRunId, children, source, qualification, historyDir, historySeq,
} = {}) {
  const pilot = await loadPilotDefinition(frozenPath);
  const attemptId = `batch-attempt-${suffix}`;
  const historyRunId = `living-sim-batch::${batchRunId}`;
  const attempt = join(root, `batch-${suffix}`); const rawDir = join(attempt, 'raw');
  await mkdir(rawDir, { recursive: true });
  const raw = {
    schemaVersion: 1, type: 'batch_execution', runId: batchRunId, historyRunId, attemptId,
    source, scenarioFileSha256: pilot.sha256,
    scenarioIds: pilot.document.scenarios.map((scenario) => scenario.id), qualification,
    execution: { separateProcessPerScenario: true, parallel: false, resultBasedSelection: false },
  };
  const rawName = '000001-batch_execution.json'; const rawPath = join(rawDir, rawName);
  await writeFile(rawPath, `${JSON.stringify(raw)}\n`);
  const scenarios = [];
  for (let index = 0; index < children.length; index += 1) {
    const manifestPath = children[index].manifestPath;
    // eslint-disable-next-line no-await-in-loop
    scenarios.push({
      id: pilot.document.scenarios[index].id, manifestPath,
      // eslint-disable-next-line no-await-in-loop
      sha256: digest(await readFile(manifestPath)),
    });
  }
  const manifest = {
    schemaVersion: 1, kind: 'living-sim-pilot-batch', runId: batchRunId, historyRunId, attemptId,
    status: 'RECORDED', invalidReason: null, source,
    scenarioFile: { sha256: pilot.sha256 }, qualification,
    scenarioIds: pilot.document.scenarios.map((scenario) => scenario.id), scenarios,
    rawEvidence: [{ name: rawName, sha256: digest(await readFile(rawPath)) }],
  };
  const manifestPath = join(attempt, 'manifest.json'); await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  const runDir = join(historyDir, 'runs', digest(historyRunId)); await mkdir(runDir, { recursive: true });
  const seq = Number(historySeq) * 2;
  await writeFile(join(runDir, `${String(seq - 1).padStart(6, '0')}-started.json`), JSON.stringify({
    type: 'started', runId: historyRunId, attemptId, executionKind: 'headless_isolated',
  }));
  await writeFile(join(runDir, `${String(seq).padStart(6, '0')}-finished.json`), JSON.stringify({
    type: 'finished', runId: historyRunId, attemptId, status: 'RECORDED', invalidReason: null,
    manifestHash: digest(await readFile(manifestPath)),
  }));
  return {
    manifestPath, rawDir,
    verify: () => verifyLivingSimBatchEvidence(manifestPath, {
      historyDir, scenarioFile: frozenPath, qualificationHistoryDir: qualification.historyDir,
    }),
  };
}

test('선빨강: batch 일곱 칸은 각 child의 시나리오·batch·run·source·qualification·attempt와 결합돼야 한다', async () => {
  const root = await room('t5-living-batch-bindings-');
  try {
    const q1 = await makeQualificationRef(root, 'q1');
    const q2 = await makeQualificationRef(root, 'q2');
    const historyDir = join(root, 'scenario-and-batch-history');
    const batchRunId = 'pilot-batch-bindings';
    const source = {
      kind: 'source', gitSha: 'a'.repeat(40), dirty: false,
      worktreeDigest: 'b'.repeat(64), changesDigest: 'c'.repeat(64),
    };
    const pilot = await loadPilotDefinition(frozenPath);
    const children = [];
    for (let index = 0; index < 7; index += 1) {
      const scenario = pilot.document.scenarios[index];
      // eslint-disable-next-line no-await-in-loop
      children.push(await writeValidEvidence(root, `batch-child-${index}`, {
        scenarioIndex: index, batchRunId, runId: `${batchRunId}::${scenario.id}`,
        attemptId: `child-attempt-${index}`, historyDir, qualification: q1.ref, source,
      }));
    }
    const valid = await writeBatchEvidence(root, 'valid', {
      batchRunId, children, source, qualification: q1.ref, historyDir, historySeq: 1,
    });
    const validResult = await valid.verify();
    assert.equal(validResult.ok, true, `정상 batch fixture가 먼저 서지 않았다: ${JSON.stringify(validResult.failures)}`);

    const otherBatch = await writeValidEvidence(root, 'other-batch-child', {
      scenarioIndex: 1, batchRunId: 'other-batch', runId: 'other-batch::L2-customer-policy',
      attemptId: 'other-batch-attempt', historyDir, qualification: q1.ref, source,
    });
    const wrongId = await writeValidEvidence(root, 'wrong-id-child', {
      scenarioIndex: 1, batchRunId, runId: `${batchRunId}::L2-customer-policy`,
      attemptId: 'wrong-id-attempt', historyDir, historySeq: 2, qualification: q1.ref, source,
    });
    const wrongRun = await writeValidEvidence(root, 'wrong-run-child', {
      scenarioIndex: 3, batchRunId, runId: 'unrelated-child-run',
      attemptId: 'wrong-run-attempt', historyDir, qualification: q1.ref, source,
    });
    const otherSource = { ...source, gitSha: 'f'.repeat(40), worktreeDigest: 'e'.repeat(64) };
    const wrongSource = await writeValidEvidence(root, 'wrong-source-child', {
      scenarioIndex: 4, batchRunId, runId: `${batchRunId}::L5-admin-preparation`,
      attemptId: 'wrong-source-attempt', historyDir, historySeq: 2, qualification: q1.ref, source: otherSource,
    });
    const wrongQualification = await writeValidEvidence(root, 'wrong-qualification-child', {
      scenarioIndex: 5, batchRunId, runId: `${batchRunId}::L6-schedule-automation`,
      attemptId: 'wrong-qualification-attempt', historyDir, historySeq: 2, qualification: q2.ref, source,
    });
    const duplicateAttempt = await writeValidEvidence(root, 'duplicate-attempt-child', {
      scenarioIndex: 6, batchRunId, runId: `${batchRunId}::L7-pc-mixed-work`,
      attemptId: children[0].manifest.attemptId, historyDir, historySeq: 2, qualification: q1.ref, source,
    });

    const variants = [
      ['L1 manifest 7칸 중복', Array(7).fill(children[0])],
      ['다른 batch child', children.with(1, otherBatch)],
      ['entry-child id 어긋남', children.with(2, wrongId)],
      ['child runId 어긋남', children.with(3, wrongRun)],
      ['child source 어긋남', children.with(4, wrongSource)],
      ['child qualification 어긋남', children.with(5, wrongQualification)],
      ['child attemptId 중복', children.with(6, duplicateAttempt)],
    ];
    const observed = [];
    for (let index = 0; index < variants.length; index += 1) {
      const [name, forgedChildren] = variants[index];
      // eslint-disable-next-line no-await-in-loop
      const forged = await writeBatchEvidence(root, `forged-${index}`, {
        batchRunId, children: forgedChildren, source, qualification: q1.ref,
        historyDir, historySeq: index + 2,
      });
      // eslint-disable-next-line no-await-in-loop
      const forgedResult = await forged.verify();
      observed.push({ name, ok: forgedResult.ok, failures: forgedResult.failures });
    }
    assert.deepEqual(observed.map(({ name, ok }) => ({ name, ok })), variants.map(([name]) => ({ name, ok: false })),
      JSON.stringify(observed));

    const unlisted = await writeBatchEvidence(root, 'unlisted-raw', {
      batchRunId, children, source, qualification: q1.ref, historyDir, historySeq: 20,
    });
    await writeFile(join(unlisted.rawDir, '999999-hidden-child-failure.json'), '{"type":"hidden_failure"}\n');
    assert.ok((await unlisted.verify()).failures.includes('batch_raw_evidence_set'));

    const shaCut = await writeBatchEvidence(root, 'child-sha-cut', {
      batchRunId, children, source, qualification: q1.ref, historyDir, historySeq: 21,
    });
    const shaManifest = JSON.parse(await readFile(shaCut.manifestPath, 'utf8'));
    shaManifest.scenarios[0].sha256 = '0'.repeat(64);
    await writeFile(shaCut.manifestPath, JSON.stringify(shaManifest));
    assert.ok((await shaCut.verify()).failures.includes('L1-settlement-files:scenario_hash'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('실제 파일 반례: valid 원본 뒤 raw 삭제·변조, manifest 단독 변조, history 절단을 각각 잡는다', async () => {
  const root = await room('t5-living-file-counterexamples-');
  try {
    const valid = await writeValidEvidence(root, 'valid');
    assert.equal((await valid.verify()).ok, true);

    const unlisted = await writeValidEvidence(root, 'unlisted');
    await writeFile(join(unlisted.rawDir, '999999-hidden-provider-call.json'), '{"type":"provider_call","hidden":true}\n');
    assert.ok((await unlisted.verify()).failures.includes('raw_evidence_set'), 'manifest에 없는 raw가 숨었다');

    const deleted = await writeValidEvidence(root, 'deleted');
    await rm(join(deleted.rawDir, (await readdir(deleted.rawDir))[0]));
    assert.ok((await deleted.verify()).failures.includes('raw_missing'));

    const tampered = await writeValidEvidence(root, 'tampered');
    const rawName = (await readdir(tampered.rawDir))[0];
    await writeFile(join(tampered.rawDir, rawName), '{}\n');
    assert.ok((await tampered.verify()).failures.includes('raw_hash_mismatch'));

    const manifestOnly = await writeValidEvidence(root, 'manifest-only');
    const manifest = JSON.parse(await readFile(manifestOnly.manifestPath, 'utf8'));
    manifest.provider.configuredModelId = 'fake-model';
    await writeFile(manifestOnly.manifestPath, JSON.stringify(manifest));
    assert.equal((await manifestOnly.verify()).ok, false);

    const historyCut = await writeValidEvidence(root, 'history-cut');
    const historyRunDir = join(historyCut.historyDir, 'runs', digest('pilot::L1-settlement-files::history-cut'));
    await rm(join(historyRunDir, '000002-finished.json'));
    assert.ok((await historyCut.verify()).failures.includes('history_finished'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
