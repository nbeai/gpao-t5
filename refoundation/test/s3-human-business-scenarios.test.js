import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  auditS3HumanBusinessPortfolio, loadS3HumanBusinessScenarios,
  materializeS3HumanBusinessScenario, planS3HumanBusinessWave, snapshotS3BusinessWorkspace,
} from '../src/s3-human-business-scenarios.js';
import {
  makeS3HumanBusinessObservationTemplate, validateS3HumanBusinessObservation,
} from '../src/s3-human-business-observation.js';

const root = new URL('../../', import.meta.url);
const execute = promisify(execFile);

test('정식 인간 시나리오는 출처가 있는 발견·연결·업무 목적이고 합성 후속업무와 분리된다', async () => {
  const catalog = await loadS3HumanBusinessScenarios();
  assert.equal(catalog.schema, 't5.s3.human-business-scenarios.v1');
  assert.ok(catalog.scenarios.length >= 50, catalog.scenarios.length);
  assert.ok(catalog.scenarios.filter((item) => item.sentinel).length >= 10);
  assert.equal(new Set(catalog.scenarios.map((item) => item.id)).size, catalog.scenarios.length);
  for (const business of [
    'online_seller', 'restaurant', 'reservation_service', 'freelancer_consultant',
    'small_manufacturer_wholesaler', 'owner_common', 'multi_channel_service',
  ]) assert.ok(catalog.scenarios.some((item) => item.business === business), business);
  assert.ok(catalog.scenarios.every((item) => (
    item.primaryPrompt && item.purpose && item.environment && item.acceptance.length >= 5
  )));
  assert.ok(catalog.scenarios.some((item) => item.testerInterventions?.length >= 3));
  const sourceIds = new Set(catalog.sourceRecords.map((item) => item.id));
  const canonical = catalog.scenarios.filter((item) => item.qualificationStatus === 'source_grounded');
  const researchDerived = catalog.scenarios
    .filter((item) => item.qualificationStatus === 'research_derived_hypothesis');
  assert.ok(canonical.length >= 10, canonical.length);
  assert.ok(canonical.some((item) => item.requestStage === 'connection_reality'));
  assert.ok(canonical.some((item) => item.requestStage === 'market_research_capability'));
  assert.ok(canonical.every((item) => item.sourceRefs.length > 0));
  assert.ok(canonical.every((item) => item.sourceRefs.every((id) => sourceIds.has(id))));
  assert.ok(researchDerived.length > 0);
  assert.ok(researchDerived.some((item) => item.portfolioRole === 'workflow_coverage'));
  assert.ok(researchDerived.some((item) => item.portfolioRole === 'structural_stress'));
  assert.ok(canonical.every((item) => item.portfolioRole === 'observed_demand'));
  assert.equal(catalog.portfolioPolicy.lanes.structural_stress.includes('partial evidence'), true);
});

test('사전 테스터 wave는 세 증거 lane을 모두 포함하고 전체 행렬을 강제하지 않는다', async () => {
  const catalog = await loadS3HumanBusinessScenarios();
  const audit = auditS3HumanBusinessPortfolio(catalog);
  assert.deepEqual(audit.byRole, {
    observed_demand: 12, workflow_coverage: 39, structural_stress: 6,
  });
  assert.ok(audit.researchBacklog.includes('education'));
  const fast = planS3HumanBusinessWave(catalog, 'developer_fast_feedback');
  const reality = planS3HumanBusinessWave(catalog, 'pre_tester_reality');
  assert.equal(fast.scenarios.length, 6);
  assert.equal(reality.scenarios.length, 16);
  for (const wave of [fast, reality]) {
    assert.deepEqual(new Set(wave.scenarios.map((item) => item.portfolioRole)), new Set([
      'observed_demand', 'workflow_coverage', 'structural_stress',
    ]));
  }
  assert.throws(() => planS3HumanBusinessWave(catalog, 'unknown'), /unknown/u);
});

test('시나리오 library는 실제 플랫폼 업무를 근거로 하지만 제품 Prompt와 개인정보 fixture가 아니다', async () => {
  const raw = await readFile(new URL('refoundation/config/s3-human-business-scenarios.json', root), 'utf8');
  const catalog = JSON.parse(raw);
  assert.equal(catalog.execution.libraryIsNotProductPrompt, true);
  assert.equal(catalog.execution.fullFactorial, false);
  assert.equal(catalog.execution.humanVerdictRequired, true);
  assert.equal(catalog.privacy.realAccounts, false);
  assert.equal(catalog.privacy.realExternalWrites, false);
  assert.ok(catalog.researchBasis.length >= 6);
  assert.ok(catalog.sourceRecords.some((item) => item.kind === 'public_community_first_person'));
  const vendor = catalog.sourceRecords.find((item) => item.id === 'SRC-KR-VENDOR-CATALOG-01');
  assert.equal(vendor.strength,
    'supply_side_coverage_signal_not_user_demand_or_outcome_evidence');
  assert.equal(catalog.coverageTaxonomies[0].use, 'coverage_gap_detection_only');
  assert.ok(catalog.evidencePolicy.prohibitedPromotion.includes('invented likely request'));
  assert.ok(catalog.testerIntakeContract.required.includes('exactUserWording'));
  assert.doesNotMatch(raw, /\/Users\//u);
  assert.doesNotMatch(raw, /\bntn_[A-Za-z0-9_-]+|bot\d+:[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,}/u);
});

test('모든 business 환경은 격리 workspace에 결정적으로 materialize된다', async () => {
  const catalog = await loadS3HumanBusinessScenarios();
  const room = await mkdtemp(join(tmpdir(), 't5-s3-business-fixtures-'));
  try {
    for (const [index, profile] of catalog.environmentProfiles.entries()) {
      const scenario = catalog.scenarios.find((item) => item.environment === profile.id);
      assert.ok(scenario, profile.id);
      const first = join(room, `a-${index}`); const second = join(room, `b-${index}`);
      const a = await materializeS3HumanBusinessScenario({ scenario, catalog, workspace: first });
      const b = await materializeS3HumanBusinessScenario({ scenario, catalog, workspace: second });
      assert.equal(a.profile.connectionReality, profile.connectionReality);
      assert.deepEqual(await snapshotS3BusinessWorkspace(first), await snapshotS3BusinessWorkspace(second));
    }
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('판매자료 있음·부분 자료·자료 없음은 서로 다른 현실로 고정된다', async () => {
  const catalog = await loadS3HumanBusinessScenarios();
  const room = await mkdtemp(join(tmpdir(), 't5-s3-ecommerce-realities-'));
  try {
    const byId = (id) => catalog.scenarios.find((item) => item.id === id);
    const full = await materializeS3HumanBusinessScenario({
      scenario: byId('KHB-E01'), catalog, workspace: join(room, 'full'),
    });
    const absent = await materializeS3HumanBusinessScenario({
      scenario: byId('KHB-E02'), catalog, workspace: join(room, 'absent'),
    });
    const partial = await materializeS3HumanBusinessScenario({
      scenario: byId('KHB-E03'), catalog, workspace: join(room, 'partial'),
    });
    assert.equal(full.expectedFacts.bluePaidQuantity, 10);
    assert.equal(absent.expectedFacts.availableSalesEvidence, false);
    assert.equal(partial.expectedFacts.evidenceCoverage, 'smartstore_only');
    const fullFiles = Object.keys(await snapshotS3BusinessWorkspace(join(room, 'full')));
    const partialFiles = Object.keys(await snapshotS3BusinessWorkspace(join(room, 'partial')));
    assert.ok(fullFiles.some((path) => path.includes('쿠팡_주문.csv')));
    assert.equal(partialFiles.some((path) => path.includes('쿠팡_주문.csv')), false);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('라이브 launcher는 실제 연결을 mock하지 않고 인간 통제·격리·빈 connector 상태를 강제한다', async () => {
  const launcher = await readFile(
    new URL('refoundation/scripts/launch-s3-human-business-console.mjs', root), 'utf8',
  );
  assert.match(launcher, /--human-controlled is required/u);
  assert.match(launcher, /--include-research-derived/u);
  assert.match(launcher, /acceptanceChecks: scenario\.acceptance/u);
  assert.match(launcher, /feltLikeCapableCoworker/u);
  assert.match(launcher, /neededTechnicalKnowledge/u);
  assert.match(launcher, /workspaceConnectionInspectors: \[\], workspaceConnectionServices: \[\]/u);
  assert.match(launcher, /messenger-empty/u);
  assert.match(launcher, /browserAutomationLoaded: false/u);
  assert.match(launcher, /legacy raw secret field/u);
  assert.match(launcher, /protectedReadRoots/u);
  assert.match(launcher, /process\.platform === 'darwin'[\s\S]*process\.platform === 'win32'/u);
  assert.match(launcher, /cmd\.exe[\s\S]*start/u);
  assert.doesNotMatch(launcher, /makeNotionMcpConnection|makeSlackMcpConnection|makeChannelTalkConnection/u);
});

test('요약기는 기계 관측과 인간 체감 판정을 합치지 않는다', async () => {
  const [summarizer, pkg] = await Promise.all([
    readFile(new URL('refoundation/scripts/summarize-s3-human-business-console.mjs', root), 'utf8'),
    readFile(new URL('package.json', root), 'utf8').then(JSON.parse),
  ]);
  assert.match(summarizer, /pending_human_review/u);
  assert.match(summarizer, /Tool success alone is not purpose achievement/u);
  assert.match(summarizer, /humanAssessmentComplete/u);
  assert.equal(pkg.scripts['refoundation:qualify:business-human'],
    'node refoundation/scripts/launch-s3-human-business-console.mjs --human-controlled');
  assert.equal(pkg.scripts['refoundation:summarize:business-human'],
    'node refoundation/scripts/summarize-s3-human-business-console.mjs');
});

test('단일 Run과 wave 요약은 인간 acceptance 미확인을 PASS로 만들지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-s3-business-summary-'));
  const control = join(room, 'tester-control');
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await Promise.all([control, stateDir, workspace].map((path) => mkdir(path, { recursive: true })));
  const catalog = await loadS3HumanBusinessScenarios();
  const scenario = catalog.scenarios.find((item) => item.id === 'KHB-D01');
  assert.equal(scenario.testerInterventions.length, 1);
  const publicScenario = {
    id: scenario.id, title: scenario.title, business: scenario.business,
    domain: scenario.domain, environment: scenario.environment,
    sentinel: scenario.sentinel, qualificationStatus: scenario.qualificationStatus,
    portfolioRole: scenario.portfolioRole, requestStage: scenario.requestStage,
    sourceRefs: scenario.sourceRefs,
  };
  await writeFile(join(control, 'run-manifest.json'), JSON.stringify({
    schema: 't5.s3.human-business-live-run.v1', sourceCommit: 'fixture',
    scenario: publicScenario, variant: 0, model: { provider: 'fixture', modelId: 'fixture-model' },
    environment: {}, boundaries: { realExternalWrites: false },
    acceptance: scenario.acceptance, baseline: {}, paths: { stateDir, workspace },
  }));
  await writeFile(join(stateDir, 'console-sessions.json'), JSON.stringify({
    sessions: [{ transcript: [{ role: 'user' }, { role: 'assistant', result: { reply: '확인했습니다.' } }] }],
  }));
  const assessment = {
    schema: 't5.s3.human-business-assessment.v1', scenarioId: scenario.id,
    modelId: 'fixture-model', purposeAchieved: true, resultCorrect: true,
    resultComplete: true, feltEasy: true, feltLikeCapableCoworker: true,
    progressReassuring: 'not_applicable', correctionAndCancelWorked: 'not_applicable',
    artifactActuallyUsable: 'not_applicable', resultEasyToUse: true,
    uncertaintyHonest: true, connectionRealityClear: 'not_applicable',
    failureOrLimitHandledUsefully: 'not_applicable', unnecessaryApprovalOrSetup: false,
    neededTechnicalKnowledge: false, wouldDelegateAgain: true, humanTimeSaved: 'unknown',
    acceptanceChecks: scenario.acceptance.map((criterion) => ({ criterion, status: 'pass', note: '' })),
    observedFailureFamilies: [], notes: '',
  };
  await writeFile(join(control, 'human-assessment.json'), JSON.stringify(assessment));
  try {
    const single = await execute(process.execPath, [
      new URL('../scripts/summarize-s3-human-business-console.mjs', import.meta.url).pathname,
      '--room', room,
    ]);
    const summary = JSON.parse(single.stdout);
    assert.equal(summary.verdict, 'passed');
    const wave = await execute(process.execPath, [
      new URL('../scripts/summarize-s3-human-business-wave.mjs', import.meta.url).pathname,
      '--wave', 'developer_fast_feedback', '--room', room,
    ]);
    const waveSummary = JSON.parse(wave.stdout);
    assert.equal(waveSummary.verdict, 'incomplete');
    assert.equal(waveSummary.counts.passed, 1);
    assert.equal(waveSummary.counts.not_run, 5);

    assessment.acceptanceChecks[0].status = null;
    await writeFile(join(control, 'human-assessment.json'), JSON.stringify(assessment));
    const pending = await execute(process.execPath, [
      new URL('../scripts/summarize-s3-human-business-console.mjs', import.meta.url).pathname,
      '--room', room,
    ]);
    assert.equal(JSON.parse(pending.stdout).verdict, 'pending_human_review');
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('현장 관측 입구는 실제 표현을 보존하되 개인정보와 비밀을 저장 전에 막는다', () => {
  const observation = {
    ...makeS3HumanBusinessObservationTemplate(),
    collectionAuthority: 'consented_tester',
    sourceReference: 'tester-session-redacted-01',
    exactUserWording: '내가 매일 확인하는 주문 중 오늘 꼭 처리할 것만 먼저 보고 싶어요.',
    businessSituation: '온라인 판매와 오프라인 출고를 한 사람이 함께 관리한다.',
    availableAccountsConnectionsAndFiles: '판매 계정은 미연결이고 비식별 주문 내보내기 파일이 있다.',
    expectedOutcome: '긴 설정 없이 오늘 처리할 주문과 이유를 확인한다.',
    observedT5Behavior: '파일을 확인하고 우선순위와 근거를 화면에 제시했다.',
    feltFriction: '첫 진행 설명 전 잠시 기다려야 했다.',
    usableResult: '우선 처리 목록은 실제 출고 업무에 바로 사용할 수 있었다.',
    manualRecovery: '추가 조치는 필요하지 않았다.',
    wouldDelegateAgain: true,
    redactionConfirmed: true,
  };
  const result = validateS3HumanBusinessObservation(observation);
  assert.equal(result.valid, true);
  assert.equal(result.nextState, 'deidentified_observation_ready_for_purpose_labeling');
  assert.equal(JSON.stringify(result).includes(observation.exactUserWording), false);
  assert.throws(() => validateS3HumanBusinessObservation({
    ...observation, exactUserWording: '자료는 /Users/real-owner/Desktop/orders.csv 에 있어요.',
  }), /absolute user path/u);
  assert.throws(() => validateS3HumanBusinessObservation({
    ...observation, sourceReference: 'owner@example.com',
  }), /email address/u);
});

test('3차 핵심 정본은 기술 완료 뒤 내부 두 wave와 외부 테스터 순서를 누락할 수 없다', async () => {
  const [third, agents] = await Promise.all([
    readFile(new URL('T5-THIRD-ACTIVATION-PREPARATION.md', root), 'utf8'),
    readFile(new URL('AGENTS.md', root), 'utf8'),
  ]);
  assert.match(third,
    /각 S3 기술 개발선의 exact 완료·회귀[\s\S]*S3-WA 읽기 전용 다중 에이전트 배선 감사[\s\S]*developer_fast_feedback[\s\S]*pre_tester_reality[\s\S]*외부 인간 테스터/u);
  assert.match(third, /S3-WA Whole-product Wiring Audit·재현 P0\/P1 close/u);
  assert.match(third, /THIRD_COMPLETION_SOURCE_PASS_WITH_OBSERVATION/u);
  assert.match(third, /3차 완성 범위로 동결했다/u);
  assert.match(third,
    /S3-A·T·M·UX·CA·CH·VD·PW와 종료 Gate인 S3-WA·HQ까지만[\s\S]*3차를 완료하고 종료한다/u);
  assert.match(third, /AND S3-VD Visual Deliverable Core/u);
  assert.match(third, /S3-VD \|[^\n]*Core `PASS WITH OBSERVATION`/u);
  assert.match(third,
    /Windows WebView2 또는 동등 native renderer actual[\s\S]*editable PPTX[\s\S]*user-approved brand parameter/u);
  assert.match(third,
    /화면 보고서·대시보드·온보딩·고정 인포그래픽[\s\S]*편집 가능한 발표자료/u);
  assert.match(third, /Runtime은 업종·문구·색 이름·template keyword로 디자인을 선택하지 않는다/u);
  assert.match(third,
    /새 범용 canvas\/editor[\s\S]*새 HTML→PPTX 변환 engine[\s\S]*Typst·Marp Core dependency 내장/u);
  assert.match(third,
    /VD0 failure constitution[\s\S]*VD1 renderer 후보 A\/B[\s\S]*VD2 factual DesignReceipt[\s\S]*VD3 render-observe-model repair[\s\S]*VD4 brand parameter/u);
  assert.match(third, /감사 중 병렬 제품 수정[\s\S]*금지한다/u);
  assert.match(third, /S3-HQ developer_fast_feedback·pre_tester_reality 내부 인간 자격/u);
  assert.match(third, /미실행·미평가 0/u);
  assert.match(agents,
    /모든 3차 기술 개발선이 닫힌 뒤[\s\S]*S3-WA[\s\S]*외부 테스터·설치본 평가나 3차 종합 완료를 주장하지 않는다/u);
});
