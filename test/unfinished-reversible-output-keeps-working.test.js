import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

test('가역 결과를 만들고 스스로 미완료라 밝혔으면 같은 턴에 고친다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-unfinished-output-'));
  const output = join(dir, 'inventory.tsv');
  let first = true;
  let sawRepair = false;
  let repairPrompts = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) {
        return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
      }
      if (tc?.goalNotReached?.산출물미완료) {
        repairPrompts += 1;
        if (repairPrompts === 1) return '이번 턴 실행 몫이 소진돼 아직 못 고쳤습니다.';
        sawRepair = true;
        return { text: '', toolCalls: [{ name: 'local.file', args: {
          action: 'write', path: output, text: 'name\tbytes\na.txt\t17\n',
        } }] };
      }
      if (opts.tools?.length && first) {
        first = false;
        return { text: '', toolCalls: [{ name: 'local.file', args: {
          action: 'write', path: output, text: 'name\tbytes\na.txt\t\n',
        } }] };
      }
      return '파일은 만들었지만 바이트 수는 아직 못 넣었습니다.';
    },
  };

  await runTurn({ text: `${output}에 파일명과 바이트 수를 완성해줘.` }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model,
  });

  assert.equal(sawRepair, true, '모델이 스스로 미완료라고 밝혔는데 작업 고리가 종료됐다');
  assert.equal(await readFile(output, 'utf8'), 'name\tbytes\na.txt\t17\n');
});

test('빈 파생 결과를 원본 부재로 단정하기 전에 실제 원본을 읽고 같은 턴에 고친다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-empty-derived-output-'));
  const sourceA = join(dir, 'first.log');
  const sourceB = join(dir, 'second.log');
  const output = join(dir, 'summary.tsv');
  await import('node:fs/promises').then(({ writeFile }) => Promise.all([
    writeFile(sourceA, 'ERROR E_ONE\n'),
    writeFile(sourceB, 'ERROR E_TWO\n'),
  ]));
  let phase = 0;
  let sawGroundingNudge = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) {
        return { text: '', toolCalls: [{ name: 'work.deliverable', args: {
          output: 'file', sourcePolicy: 'all_current', verification: 'admin_grounded',
        } }] };
      }
      if (tc?.goalNotReached?.빈산출물근거없음) {
        sawGroundingNudge = true;
        return { text: '', toolCalls: [sourceA, sourceB].map((path) => ({
          name: 'local.file', args: { action: 'read', path },
        })) };
      }
      phase += 1;
      if (phase === 1) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: dir } }] };
      if (phase === 2) return { text: '', toolCalls: [{ name: 'local.file', args: {
        action: 'write', path: output, text: '', source: sourceA,
      } }] };
      if (phase === 3) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: output } }] };
      if (phase === 4) return '결과가 비어 있으므로 원본에는 오류 코드가 없습니다.';
      if (phase === 5) return { text: '', toolCalls: [{ name: 'local.file', args: {
        action: 'write', path: output, text: 'E_ONE\t1\nE_TWO\t1\n', source: sourceA,
      } }] };
      if (phase === 6) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: output } }] };
      return '두 원본을 읽고 결과를 고쳐 다시 확인했습니다.';
    },
  };

  await runTurn({ text: `${dir}의 로그를 분석해 ${output}에 오류 코드별 횟수를 만들어줘.` }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model,
  });

  assert.equal(sawGroundingNudge, true);
  assert.equal(await readFile(output, 'utf8'), 'E_ONE\t1\nE_TWO\t1\n');
});
