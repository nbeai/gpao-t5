import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

export const TERMINAL_PERFORMANCE_CASES = Object.freeze([
  {
    id: 'expression-content-needle',
    dimension: 'expression',
    request: '이 작업 폴더 어딘가에 기록이 아주 많아. 파일 이름으로 찍지 말고 내용에서 등급이 오로라-7이고 담당이 은솔인 기록 딱 하나를 찾아서, 실제 경로와 MEMO 줄 원문을 그대로 알려줘.',
  },
  {
    id: 'scale-aggregate',
    dimension: 'scale',
    request: '장부가 여러 폴더에 흩어져 있어. BLUE 항목만 전부 집계해서 항목 수와 AMOUNT 합계를 실제 파일 내용 기준으로 알려줘. 파일 목록 전체를 답에 늘어놓지는 마.',
  },
  {
    id: 'ambiguity-no-write',
    dimension: 'ambiguity',
    request: 'comet 서비스 설정 파일 중 내가 실제로 쓰는 것 하나만 찾아서 STATE를 completed로 바꿔줘.',
  },
  {
    id: 'failure-switch',
    dimension: 'failure_recovery',
    request: '먼저 rg로 BEACON-91을 찾아봐. 그 실행이 실패하면 실패 결과를 읽고 다른 설치된 수단으로 전환해서, 해당 기록의 실제 경로와 MEMO 줄을 알려줘.',
  },
]);

async function write(root, path, content) {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

async function materializeExpression(root) {
  const writes = [];
  const targetIndex = 731;
  for (let index = 0; index < 900; index += 1) {
    const bucket = String(index % 23).padStart(2, '0');
    const name = `record-${String(index).padStart(4, '0')}.txt`;
    const path = join('records', bucket, name);
    const content = index === targetIndex
      ? 'GRADE: 오로라-7\nHANDLER: 은솔\nMEMO: 겨울 전에 북문 봉인\n'
      : `GRADE: standard\nHANDLER: worker-${index % 31}\nMEMO: routine-${index}\n`;
    writes.push(write(root, path, content));
  }
  await Promise.all(writes);
  return {
    expectedPath: join('records', String(targetIndex % 23).padStart(2, '0'), `record-${String(targetIndex).padStart(4, '0')}.txt`),
    expectedMemo: 'MEMO: 겨울 전에 북문 봉인',
  };
}

async function materializeScale(root) {
  const writes = [];
  let expectedCount = 0;
  let expectedTotal = 0;
  for (let index = 1; index <= 1600; index += 1) {
    const category = index % 2 === 0 ? 'BLUE' : 'RED';
    const amount = (index % 17) + 1;
    if (category === 'BLUE') { expectedCount += 1; expectedTotal += amount; }
    writes.push(write(root, join('ledger', String(index % 37).padStart(2, '0'), `entry-${String(index).padStart(4, '0')}.txt`), [
      `CATEGORY: ${category}`, `AMOUNT: ${amount}`, `ENTRY: ${index}`, '',
    ].join('\n')));
  }
  await Promise.all(writes);
  return { expectedCount, expectedTotal };
}

async function materializeAmbiguity(root) {
  await Promise.all([
    write(root, 'configs/comet-east.txt', 'SERVICE: comet\nREGION: east\nSTATE: pending\n'),
    write(root, 'configs/comet-west.txt', 'SERVICE: comet\nREGION: west\nSTATE: pending\n'),
    write(root, 'configs/lumen.txt', 'SERVICE: lumen\nREGION: central\nSTATE: pending\n'),
  ]);
  return { candidates: ['configs/comet-east.txt', 'configs/comet-west.txt'] };
}

async function materializeFailure(root) {
  const writes = [];
  for (let index = 0; index < 120; index += 1) {
    const target = index === 83;
    writes.push(write(root, join('archive', `note-${String(index).padStart(3, '0')}.txt`), target
      ? 'CODE: BEACON-91\nMEMO: fallback reached the beacon\n'
      : `CODE: ordinary-${index}\nMEMO: routine\n`));
  }
  const fakeRg = join(root, '.fixture-bin', 'rg');
  await write(root, '.fixture-bin/rg', '#!/bin/sh\nprintf "rg deliberately unavailable\\n" >&2\nexit 69\n');
  await chmod(fakeRg, 0o755);
  await Promise.all(writes);
  return {
    expectedPath: 'archive/note-083.txt',
    expectedMemo: 'MEMO: fallback reached the beacon',
    pathPrefix: join(root, '.fixture-bin'),
  };
}

export async function materializeTerminalPerformanceCase(definition, root) {
  if (definition.id === 'expression-content-needle') return materializeExpression(root);
  if (definition.id === 'scale-aggregate') return materializeScale(root);
  if (definition.id === 'ambiguity-no-write') return materializeAmbiguity(root);
  if (definition.id === 'failure-switch') return materializeFailure(root);
  throw new Error(`unknown terminal performance case: ${definition.id}`);
}

async function walk(root, current = root) {
  const out = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) out.push(...await walk(root, path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

export async function snapshotTerminalRoom(root) {
  const snapshot = {};
  for (const path of (await walk(root)).sort()) {
    snapshot[relative(root, path)] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return snapshot;
}

function containsNumber(answer, number) {
  const normalized = String(answer ?? '').replaceAll(',', '');
  return new RegExp(`(^|\\D)${number}(\\D|$)`).test(normalized);
}

export function assessTerminalPerformanceCase({ definition, fixture, before, after, agentResult }) {
  const answer = String(agentResult?.answer ?? '');
  const receipts = agentResult?.receipts ?? [];
  const common = {
    modelCompleted: agentResult?.status === 'completed' && Boolean(answer.trim()),
    usedTerminal: receipts.some((receipt) => receipt.actualCall?.name === 'exec'),
  };
  let specific;
  if (definition.dimension === 'expression') {
    specific = {
      foundExpectedPath: answer.includes(fixture.expectedPath),
      readExactMemo: answer.includes(fixture.expectedMemo),
    };
  } else if (definition.dimension === 'scale') {
    specific = {
      reportedCount: containsNumber(answer, fixture.expectedCount),
      reportedTotal: containsNumber(answer, fixture.expectedTotal),
      avoidedTruncatedObservation: !receipts.some((receipt) => receipt.result?.truncated),
    };
  } else if (definition.dimension === 'ambiguity') {
    specific = {
      leftFilesUnchanged: JSON.stringify(before) === JSON.stringify(after),
      surfacedAmbiguity: /둘|두\s*개|2개|여러|모호|east|west|지역|어느/.test(answer),
      boundedDecisionCost: receipts.length <= 4
        && (agentResult?.modelTurns ?? receipts.length + 1) <= 5,
    };
  } else {
    const failedRg = receipts.findIndex((receipt) => (
      /(^|\s)rg(?:\s|$)/.test(receipt.actualCall?.args?.command ?? '')
      && (receipt.outcome === 'failed' || receipt.result?.exitCode !== 0)
    ));
    const laterSuccess = receipts.findIndex((receipt, index) => index > failedRg
      && receipt.actualCall?.name === 'exec' && receipt.outcome === 'succeeded');
    specific = {
      observedRgFailure: failedRg >= 0,
      switchedAfterFailure: laterSuccess > failedRg,
      foundExpectedPath: answer.includes(fixture.expectedPath ?? ''),
      readExactMemo: answer.includes(fixture.expectedMemo),
    };
  }
  const checks = { ...common, ...specific };
  return { checks, passed: Object.values(checks).every(Boolean) };
}
