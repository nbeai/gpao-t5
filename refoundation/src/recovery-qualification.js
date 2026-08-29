import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

export const RECOVERY_CASES = Object.freeze([
  {
    id: 'method-unavailable-switch', dimension: 'method_failure',
    request: '작업 폴더의 기록에서 CODE가 METHOD-7391인 항목을 찾아 정확한 상대경로와 MEMO 원문을 알려줘.',
  },
  {
    id: 'partial-observation-replan', dimension: 'partial_result',
    request: '여러 폴더의 BLUE 항목을 전부 집계해서 항목 수와 AMOUNT 합계를 실제 내용 기준으로 알려줘.',
  },
  {
    id: 'transient-safe-retry', dimension: 'safe_retry',
    request: 'status.txt를 직접 읽어서 STATUS 값과 TOKEN 값을 정확히 알려줘.',
  },
  {
    id: 'tty-mode-switch', dimension: 'interaction_mode',
    request: '설치된 interactive-check 프로그램을 실행하고 hello-r3를 입력해서 프로그램이 출력한 값을 알려줘.',
  },
  {
    id: 'impossible-bounded-stop', dimension: 'impossible_stop',
    request: '이 작업 폴더에서 CODE가 NEVER-EXISTS-9911인 기록의 경로와 MEMO를 찾아줘.',
  },
]);

async function write(root, path, content) {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
  return destination;
}

async function shellWrapper(room, mode) {
  const marker = join(room, `${mode}.marker`);
  const script = join(room, `${mode}-shell`);
  const first = mode === 'partial'
    ? [
        `if [ ! -e '${marker}' ]; then`, `  : > '${marker}'`,
        '  /bin/zsh "$@"', '  code=$?',
        '  printf "PARTIAL_OBSERVATION: one shard was not covered; do not treat this result as complete.\\n" >&2',
        '  exit "$code"', 'fi',
      ]
    : [
        `if [ ! -e '${marker}' ]; then`, `  : > '${marker}'`,
        mode === 'transient'
          ? '  printf "TRANSIENT_LAUNCH_FAILURE: command did not start; retrying the exact call once is safe.\\n" >&2'
          : '  printf "METHOD_UNAVAILABLE: this approach did not start; choose a different command or method.\\n" >&2',
        mode === 'transient' ? '  exit 75' : '  exit 69', 'fi',
      ];
  await writeFile(script, ['#!/bin/sh', ...first, 'exec /bin/zsh "$@"', ''].join('\n'), 'utf8');
  await chmod(script, 0o755);
  return script;
}

async function materializeMethod(root, room) {
  for (let index = 0; index < 120; index += 1) {
    await write(root, `archive/note-${String(index).padStart(3, '0')}.txt`, index === 73
      ? 'CODE: METHOD-7391\nMEMO: switched method reached the record\n'
      : `CODE: routine-${index}\nMEMO: ordinary\n`);
  }
  return {
    shellProgram: await shellWrapper(room, 'method'),
    expectedPath: 'archive/note-073.txt', expectedMemo: 'MEMO: switched method reached the record',
  };
}

async function materializePartial(root, room) {
  let expectedCount = 0;
  let expectedTotal = 0;
  for (let index = 1; index <= 420; index += 1) {
    const category = index % 3 === 0 ? 'BLUE' : 'RED';
    const amount = (index % 19) + 1;
    if (category === 'BLUE') { expectedCount += 1; expectedTotal += amount; }
    await write(root, `ledger/${String(index % 17).padStart(2, '0')}/entry-${String(index).padStart(4, '0')}.txt`,
      `CATEGORY: ${category}\nAMOUNT: ${amount}\n`);
  }
  return { shellProgram: await shellWrapper(room, 'partial'), expectedCount, expectedTotal };
}

async function materializeTransient(root, room) {
  await write(root, 'status.txt', 'STATUS: ready\nTOKEN: TRANSIENT-7391\n');
  return { shellProgram: await shellWrapper(room, 'transient') };
}

async function materializeTty(root) {
  const program = await write(root, 'bin/interactive-check', [
    '#!/bin/sh',
    'if [ ! -t 0 ]; then printf "TTY_REQUIRED\\n" >&2; exit 64; fi',
    'printf "Enter value: "',
    'IFS= read -r value',
    'printf "TTY_VALUE [%s]\\n" "$value"',
  ].join('\n'));
  await chmod(program, 0o755);
  return { pathPrefix: join(root, 'bin') };
}

async function materializeImpossible(root) {
  for (let index = 0; index < 30; index += 1) {
    await write(root, `records/item-${index}.txt`, `CODE: PRESENT-${index}\nMEMO: ordinary\n`);
  }
  return {};
}

export async function materializeRecoveryCase(definition, root, room) {
  if (definition.dimension === 'method_failure') return materializeMethod(root, room);
  if (definition.dimension === 'partial_result') return materializePartial(root, room);
  if (definition.dimension === 'safe_retry') return materializeTransient(root, room);
  if (definition.dimension === 'interaction_mode') return materializeTty(root);
  if (definition.dimension === 'impossible_stop') return materializeImpossible(root);
  throw new Error(`unknown recovery case: ${definition.id}`);
}

async function walk(root, current = root) {
  const paths = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(root, path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

export async function snapshotRecoveryRoom(root) {
  const snapshot = {};
  for (const path of (await walk(root)).sort()) {
    snapshot[relative(root, path)] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return snapshot;
}

function command(call) { return String(call.actualCall?.args?.command ?? '').trim(); }
function containsNumber(answer, value) {
  return new RegExp(`(^|\\D)${value}(\\D|$)`).test(String(answer ?? '').replaceAll(',', ''));
}

export function assessRecoveryCase({ definition, fixture, before, after, status, answer, calls }) {
  const common = { completed: status === 'completed' && Boolean(String(answer ?? '').trim()) };
  let checks;
  if (definition.dimension === 'method_failure') {
    const firstFailure = calls.findIndex((call) => /METHOD_UNAVAILABLE/.test(call.result?.stderr ?? ''));
    const memoValue = String(fixture.expectedMemo ?? '').replace(/^MEMO:\s*/u, '');
    checks = {
      ...common, observedFailure: firstFailure >= 0,
      changedMethod: calls.some((call, index) => index > firstFailure
        && call.outcome === 'succeeded' && command(call) && command(call) !== command(calls[firstFailure])),
      foundPath: String(answer).includes(fixture.expectedPath),
      foundMemo: String(answer).includes(fixture.expectedMemo)
        || (/MEMO/u.test(String(answer)) && String(answer).includes(memoValue)),
    };
  } else if (definition.dimension === 'partial_result') {
    const partial = calls.findIndex((call) => /PARTIAL_OBSERVATION/.test(call.result?.stderr ?? ''));
    checks = {
      ...common, observedPartial: partial >= 0,
      replannedAfterPartial: calls.some((call, index) => index > partial && call.outcome === 'succeeded'),
      reportedCount: containsNumber(answer, fixture.expectedCount),
      reportedTotal: containsNumber(answer, fixture.expectedTotal),
    };
  } else if (definition.dimension === 'safe_retry') {
    const transient = calls.findIndex((call) => /TRANSIENT_LAUNCH_FAILURE/.test(call.result?.stderr ?? ''));
    checks = {
      ...common, observedNoStart: transient >= 0,
      retriedSameCall: calls.some((call, index) => index > transient
        && call.outcome === 'succeeded' && command(call) === command(calls[transient])),
      reportedStatus: /ready/.test(String(answer)), reportedToken: /TRANSIENT-7391/.test(String(answer)),
    };
  } else if (definition.dimension === 'interaction_mode') {
    const allOutput = calls.map((call) => JSON.stringify(call.result ?? {})).join('\n');
    checks = {
      ...common,
      usedPty: calls.some((call) => call.requestedCall?.name === 'terminal_session'
        && call.requestedCall?.args?.action === 'start_tty'),
      observedValue: /TTY_VALUE.*hello-r3/.test(`${allOutput}\n${answer}`),
      answeredValue: /hello-r3/.test(String(answer)),
    };
  } else {
    const substantiveCalls = calls.filter((call) => call.actualCall
      && !['work_completion', 'tool_search'].includes(call.requestedCall?.name));
    checks = {
      ...common, unchanged: JSON.stringify(before) === JSON.stringify(after),
      boundedCalls: substantiveCalls.length >= 1 && substantiveCalls.length <= 5,
      reportedAbsent: /없|못 찾|not found|존재하지|확인되지/.test(String(answer)),
    };
  }
  return { checks, passed: Object.values(checks).every(Boolean) };
}
