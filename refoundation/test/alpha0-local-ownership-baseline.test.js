import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const plan = await readFile(new URL('T5-THIRD-ALPHA.md', root), 'utf8');
const evidence = JSON.parse(await readFile(new URL(
  'refoundation/evidence/alpha0-local-ownership-baseline-2026-08-27.json', root,
), 'utf8'));

test('3차알파 공식 계획은 오너 승인 순서·완료 문장·검증 중단선을 보존한다', () => {
  assert.match(plan, /3차 source 완료[\s\S]*→ 3차α source 개발[\s\S]*→ macOS 제품·설치 자격[\s\S]*→ Windows 제품·설치 자격/u);
  assert.match(plan, /UI를 닫아도[\s\S]*백업·이동·삭제[\s\S]*전송 범주[\s\S]*다른 모델/u);
  assert.match(plan, /α1 — Resident Runtime[\s\S]*α2 — Whole-State Backup[\s\S]*α3 — Transmission Truth[\s\S]*α4 — Existing Capability Broker[\s\S]*α5 — Model Continuity[\s\S]*α6 — Local Ownership UX/u);
  assert.match(plan, /전체 `refoundation:ci`는 단계의 exact 완료 후보에서 한 번 실행/u);
  assert.match(plan, /같은 결함 가족에 세 번째 patch가 필요하면/u);
});

test('Alpha0은 여섯 후보를 재구축 전 현재 현실로 분류하고 제품 완료를 주장하지 않는다', () => {
  assert.equal(evidence.schema, 't5.alpha0.local-ownership-baseline.v1');
  assert.equal(evidence.baselineSourceCommit, '5e9d10a11453df24fe77a896d59d891c423da621');
  assert.equal(evidence.productBehaviorChanged, false);
  assert.equal(evidence.modelCalls, 0);
  assert.equal(evidence.externalWrites, 0);
  assert.equal(evidence.assessments.length, 6);
  assert.deepEqual(evidence.summary, {
    alreadyEstablished: 0, partial: 4, actualFailure: 2, unmeasured: 0, alphaComplete: true,
  });
  assert.ok(evidence.assessments.every((item) => item.firstCountertest
    && item.alreadyEstablished.length && item.missing.length));
});

test('Alpha0 evidence에는 비밀·사용자 원문·개인 절대경로가 없다', () => {
  const text = JSON.stringify(evidence);
  assert.doesNotMatch(text, /sk-[A-Za-z0-9]|-----BEGIN|\/Users\/|C:\\Users\\/u);
});
