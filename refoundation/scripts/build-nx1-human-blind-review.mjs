#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const argument = (name) => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return resolve(process.argv[index + 1]);
};
const current = JSON.parse(await readFile(argument('--current'), 'utf8'));
const candidateFiles = {
  purchase_reconciliation: argument('--purchase-candidate'),
  contract_revision: argument('--contract-candidate'),
  expense_evidence: argument('--expense-candidate'),
};
const output = argument('--output'); const mappingOutput = argument('--mapping-output');
const seed = String(process.env.T5_NX1_BLIND_SEED ?? 'nx1-owner-blind-v1');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const promptByScenario = new Map([
  ['purchase_reconciliation', '이 폴더의 발주·입고·세금계산서·거래명세를 서로 맞춰 보고, 실제로 확인된 누락이나 금액 차이만 근거 위치와 함께 알려줘.'],
  ['contract_revision', '계약서 1판과 2판, 책임표와 서명 이미지를 대조해서 금액·기간·책임·서명에서 달라졌거나 서로 안 맞는 것만 원문 근거와 함께 알려줘.'],
  ['expense_evidence', '카드 내역과 영수증·세금계산서를 맞춰서 증빙 누락, 금액 불일치, 중복 증빙만 거래 ID와 원문 근거로 알려줘. 정상 건은 나열하지 마.'],
]);
const displayName = new Map([
  ['purchase_reconciliation', '구매·입고 대사'],
  ['contract_revision', '계약 개정 대조'],
  ['expense_evidence', '비용 증빙 대사'],
]);
const mapping = [];
const sections = [];
for (const scenarioId of Object.keys(candidateFiles)) {
  const currentResult = current.results.find((item) => item.scenarioId === scenarioId)?.arms
    ?.find((arm) => arm.arm === 'A');
  const candidate = JSON.parse(await readFile(candidateFiles[scenarioId], 'utf8'));
  const candidateResult = candidate.results.find((item) => item.scenarioId === scenarioId)?.arms
    ?.find((arm) => arm.arm === 'B');
  if (!currentResult?.answer || !candidateResult?.answer || candidateResult.machine?.passed !== true) {
    throw new Error(`complete current and passing candidate answers are required for ${scenarioId}`);
  }
  const candidateFirst = parseInt(digest(`${seed}:${scenarioId}`).slice(0, 2), 16) % 2 === 0;
  const answers = candidateFirst
    ? [candidateResult.answer, currentResult.answer] : [currentResult.answer, candidateResult.answer];
  mapping.push({ scenarioId, result1: candidateFirst ? 'candidate' : 'current',
    result2: candidateFirst ? 'current' : 'candidate',
    result1Sha256: digest(answers[0]), result2Sha256: digest(answers[1]) });
  sections.push([
    `## ${displayName.get(scenarioId)}`,
    '',
    `사용자 요청: ${promptByScenario.get(scenarioId)}`,
    '',
    '### 결과 1', '', answers[0], '', '### 결과 2', '', answers[1], '',
    '### 평가', '',
    '- 더 빨리 전체 차이를 알 수 있는 결과: `1 / 2`',
    '- 가장 큰 원인을 더 빨리 찾을 수 있는 결과: `1 / 2`',
    '- 바로 할 행동이 더 명료한 결과: `1 / 2`',
    '- 정확성과 근거 신뢰가 더 높은 결과: `1 / 2`',
    '- 불필요한 정상·부수 사실이 더 적은 결과: `1 / 2`',
    '- 실제로 다시 맡기고 싶은 결과: `1 / 2`',
    '- 첫 판단까지 걸린 시간(초): `결과 1 __ / 결과 2 __`',
    '- 한 줄 이유:', '',
  ].join('\n'));
}
const review = [
  '# T5 NX-1 Blind Human Review', '',
  '두 결과의 제품·모델·실행 identity는 숨겨져 있습니다. 각 결과를 처음부터 끝까지 읽고, 기능 수가 아니라',
  '정확성·이해 속도·범위 절제·바로 쓸 수 있는 정도로 평가해 주세요. 내부 구현을 추측하지 마십시오.',
  '',
  '각 목적에서 먼저 타이머를 켠 뒤 `전체 차이`, `가장 큰 원인`, `바로 할 행동`을 찾고 시간을 적습니다.',
  '',
  ...sections,
].join('\n');
await writeFile(output, review, 'utf8');
await writeFile(mappingOutput, JSON.stringify({ schema: 't5.nx1.blind-human-mapping.v1',
  recordedOn: '2026-09-01', seedSha256: digest(seed), actualUserData: false,
  evaluatorIdentityExposed: false, mapping }, null, 2), 'utf8');
process.stdout.write(`${JSON.stringify({ output, mappingOutput, scenarios: mapping.length })}\n`);
