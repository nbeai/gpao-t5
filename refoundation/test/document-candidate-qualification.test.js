import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  D5_PINNED_FIXTURES, KORDOC_CANDIDATE, assessDocumentCandidateQualification,
  fetchD5PinnedFixtures, summarizeKordocObservation, tokenSimilarity,
} from '../src/document-candidate-qualification.js';

function successfulOutput(format, { tables = 1, pages = 1, markdown = '공통 한국어 본문 단어 '.repeat(30) } = {}) {
  return {
    success: true, fileType: format, markdown,
    blocks: [...Array(tables)].map(() => ({ type: 'table' })),
    pageCount: pages, pages: pages ? [{ pageNumber: 1, markdown }] : undefined,
  };
}

test('D5 후보와 공개 corpus는 exact version·commit·digest·license로 고정된다', async () => {
  assert.equal(KORDOC_CANDIDATE.version, '4.9.1');
  assert.equal(KORDOC_CANDIDATE.sourceCommit.length, 40);
  assert.match(KORDOC_CANDIDATE.tarballSha256, /^[a-f0-9]{64}$/u);
  assert.equal(KORDOC_CANDIDATE.license, 'MIT');
  assert.equal(KORDOC_CANDIDATE.declaredDependencies.cfb, '1.2.2');
  assert.equal(KORDOC_CANDIDATE.optionalDependenciesOmitted['pdfjs-dist'], '^4.10.38');
  assert.deepEqual(D5_PINNED_FIXTURES.map((row) => row.caseId), [
    'paired-hwp3', 'paired-hwp5', 'paired-hwpx', 'encrypted-hwp3', 'legacy-xls-biff8-korean',
  ]);
  assert.ok(D5_PINNED_FIXTURES.every((row) => row.sourceCommit.length === 40 && row.sha256.length === 64));
  const room = await mkdtemp(join(tmpdir(), 't5-d5-digest-'));
  await assert.rejects(() => fetchD5PinnedFixtures(room, {
    fetchImpl: async () => new Response('not the fixture', { status: 200 }),
  }), /digest mismatch/u);
});

test('후보 관측은 성공·본문·표·페이지·암호 경계를 합치지 않는다', () => {
  const hwp5 = summarizeKordocObservation({
    caseId: 'paired-hwp5', format: 'hwp5', sha256: 'a'.repeat(64), required: ['content', 'table_structure', 'page_structure'],
  }, successfulOutput('hwp'));
  assert.equal(hwp5.targetReady, true);
  const hwp3 = summarizeKordocObservation({
    caseId: 'paired-hwp3', format: 'hwp3', sha256: 'b'.repeat(64), required: ['content'],
  }, successfulOutput('hwp3', { tables: 0, pages: 0 }));
  assert.equal(hwp3.targetReady, true);
  assert.equal(hwp3.capabilities.table_structure, false);
  const encrypted = summarizeKordocObservation({
    caseId: 'encrypted-hwp3', format: 'hwp3', sha256: 'c'.repeat(64), required: ['encrypted_boundary'],
  }, { success: false, fileType: 'hwp3', code: 'ENCRYPTED', error: 'password required' });
  assert.equal(encrypted.targetReady, true);
  assert.equal(encrypted.capabilities.content, false);
});

test('동일 내용 세 형식은 공통 token 보존으로 비교하고 순서나 markdown 모양을 정답화하지 않는다', () => {
  const left = '개요\n빠른 네트워크 서버 클러스터 성능 가용성';
  const right = '# 개요\n성능·가용성 / 빠른 네트워크 서버 클러스터';
  const score = tokenSimilarity(left, right);
  assert.equal(score.intersection, 7);
  assert.equal(score.jaccard, 1);
});

test('모든 좁은 자격을 통과해도 package 전체 adopt가 아니라 split만 판정한다', () => {
  const common = '리눅스 가상 서버 클러스터 부하 분산 성능 가용성 '.repeat(30);
  const definitions = [
    ['paired-hwp3', 'hwp3', ['content'], 0, 0],
    ['paired-hwp5', 'hwp5', ['content', 'table_structure', 'page_structure'], 1, 1],
    ['paired-hwpx', 'hwpx', ['content', 'table_structure', 'page_structure'], 1, 1],
    ['legacy-xls-biff8-korean', 'xls', ['content', 'table_structure'], 1, 0],
    ['modern-docx', 'docx', ['content', 'table_structure'], 1, 0],
  ];
  const observations = definitions.map(([caseId, format, required, tables, pages]) => summarizeKordocObservation({
    caseId, format, sha256: 'd'.repeat(64), required,
  }, successfulOutput(format, { tables, pages, markdown: common })));
  observations.push(summarizeKordocObservation({
    caseId: 'encrypted-hwp3', format: 'hwp3', sha256: 'e'.repeat(64), required: ['encrypted_boundary'],
  }, { success: false, code: 'ENCRYPTED', error: 'password required' }));
  const corrupt = ['hwp3', 'hwp5', 'hwpx'].map((format, index) => summarizeKordocObservation({
    caseId: `corrupt-${format}`, format, sha256: String(index).repeat(64), required: ['corrupted_boundary'],
  }, { success: false, code: 'CORRUPTED', error: 'damaged' }));
  const verdict = assessDocumentCandidateQualification({
    candidateObservations: observations, corruptObservations: corrupt,
    sourceFilesUnchanged: true, platform: 'darwin',
    modelTasks: [{ passed: true }, { passed: true }],
  });
  assert.equal(verdict.passed, true);
  assert.equal(verdict.disposition, 'split');
  assert.deepEqual(verdict.qualifiedFormats, ['hwp3', 'hwp5', 'hwpx', 'xls', 'docx']);
  assert.ok(verdict.keepCurrentPaths.includes('pdf'));
});

test('손상 경고나 모델 과업이 하나라도 미달이면 연결 후보는 reject다', () => {
  const verdict = assessDocumentCandidateQualification({
    candidateObservations: [], corruptObservations: [], sourceFilesUnchanged: true,
    platform: 'darwin', modelTasks: [{ passed: true }],
  });
  assert.equal(verdict.passed, false);
  assert.equal(verdict.disposition, 'reject');
});
