import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = join(root, 'refoundation', 'bin', 't5-document.mjs');

test('t5-document help는 모델이 커스텀 parser 없이 쓸 최소 계약을 JSON으로 준다', async () => {
  const help = JSON.parse((await runFile(process.execPath, [cli, 'help'], { encoding: 'utf8' })).stdout);
  assert.deepEqual(help.actions.map((action) => action.name), ['inspect', 'create-xlsx']);
  assert.match(help.actions[0].usage, /ABSOLUTE_PATH/);
  assert.match(help.actions[1].spec, /columns.*rows.*formulas/is);
});

test('t5-document CLI는 workbook 명세를 만들고 JSON 관측으로 다시 연다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-cli-'));
  const spec = join(room, 'spec.json');
  const output = join(room, 'result.xlsx');
  await writeFile(spec, JSON.stringify({
    sheets: [{
      name: '통합', title: '월별 통합',
      columns: [{ key: 'name', header: '거래처' }, { key: 'amount', header: '금액' }],
      rows: [{ name: '한빛', amount: 1200 }],
      formulas: [{ cell: 'B4', formula: 'SUM(B3:B3)', result: 1200 }],
    }],
  }));

  const created = JSON.parse((await runFile(process.execPath, [
    cli, 'create-xlsx', '--spec', spec, '--output', output,
  ], { encoding: 'utf8' })).stdout);
  assert.equal(created.created, true);
  assert.equal(created.observation.kind, 'xlsx');

  const inspected = JSON.parse((await runFile(process.execPath, [
    cli, 'inspect', output, '--max-cells', '20',
  ], { encoding: 'utf8' })).stdout);
  assert.equal(inspected.workbook.sheets[0].cells.find((cell) => cell.address === 'B4').result, 1200);
});

test('t5-document CLI는 알 수 없는 행동과 상대경로를 성공 JSON으로 꾸미지 않는다', async () => {
  await assert.rejects(() => runFile(process.execPath, [cli, 'unknown'], { encoding: 'utf8' }));
  await assert.rejects(() => runFile(process.execPath, [cli, 'inspect', 'relative.xlsx'], { encoding: 'utf8' }));
});

test('t5-document CLI는 symlink workbook 명세를 읽지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-cli-spec-'));
  const actual = join(room, 'actual.json');
  const linked = join(room, 'linked.json');
  await writeFile(actual, '{"sheets":[]}');
  await symlink(actual, linked);
  await assert.rejects(() => runFile(process.execPath, [
    cli, 'create-xlsx', '--spec', linked, '--output', join(room, 'out.xlsx'),
  ], { encoding: 'utf8' }), /symbolic link/i);
});
