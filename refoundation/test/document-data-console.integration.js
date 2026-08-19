import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { workbookToBytes } from '@office-kit/xlsx/io';
import { addWorksheet, createWorkbook } from '@office-kit/xlsx/workbook';
import { setCell } from '@office-kit/xlsx/worksheet';

import { makeConsoleServer } from '../src/console-server.js';

test('콘솔 모델은 document-data skill 뒤 T5_DOCUMENT_CLI로 실제 XLSX를 관측한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-console-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const file = join(workspace, '정산.xlsx');
  const workbook = createWorkbook();
  const sheet = addWorksheet(workbook, '정산');
  setCell(sheet, 1, 1, '거래처');
  setCell(sheet, 1, 2, '금액');
  setCell(sheet, 2, 1, '한빛');
  setCell(sheet, 2, 2, 42000);
  await writeFile(file, await workbookToBytes(workbook));

  let turn = 0;
  const modelFactory = () => ({ async respond(input) {
    turn += 1;
    if (turn === 1) return { text: '', toolCalls: [{
      id: 'skill-search', name: 'skill', args: { action: 'search', name: 'XLSX PDF document data' },
    }] };
    const receipt = JSON.parse(input.messages.at(-1).content);
    if (turn === 2) {
      assert.equal(receipt.result.skills[0].name, 'document-data');
      return { text: '', toolCalls: [{
        id: 'skill-view', name: 'skill', args: { action: 'view', name: 'document-data' },
      }] };
    }
    if (turn === 3) {
      assert.match(receipt.result.content, /T5_DOCUMENT_CLI/);
      return { text: '', toolCalls: [{ id: 'inspect-xlsx', name: 'exec', args: {
        command: `"$T5_DOCUMENT_CLI" inspect "${file}"`, cwd: null,
        effect: { kind: 'observe', summary: '정산 workbook 관측', targets: [file], reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null },
      } }] };
    }
    assert.equal(receipt.actualCall.name, 'exec');
    assert.equal(receipt.outcome, 'succeeded');
    const observation = JSON.parse(receipt.result.stdout);
    assert.equal(observation.kind, 'xlsx');
    assert.match(observation.workbook.sheets[0].cells.find((cell) => cell.address === 'B2').text, /42000/);
    return { text: '정산표에서 한빛 42,000원을 확인했습니다.', toolCalls: [] };
  } });

  const server = makeConsoleServer({
    stateDir, workspace, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'document-model' }),
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const result = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: `${file}에서 한빛 정산 금액을 확인해줘.` }),
    }).then((response) => response.json());
    assert.match(result.reply, /42,000/);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(room, { recursive: true, force: true });
  }
});
