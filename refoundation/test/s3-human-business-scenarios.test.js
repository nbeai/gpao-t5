import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  loadS3HumanBusinessScenarios, materializeS3HumanBusinessScenario,
  snapshotS3BusinessWorkspace,
} from '../src/s3-human-business-scenarios.js';

const root = new URL('../../', import.meta.url);

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
