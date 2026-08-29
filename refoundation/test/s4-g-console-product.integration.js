import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleServer } from '../src/console-server.js';

const effect = (targets) => ({ kind: 'local_change', targets,
  confirmation: 'not_applicable', rollbackOfToolCallId: null });

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}

for (const modelId of ['provider-a-model', 'provider-b-model']) test(
  `기존 exec의 exact Python은 모델 identity와 무관하게 G→Artifact로 끝난다: ${modelId}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 't5-s4g-console-product-'));
    const workspace = join(root, 'workspace'); const stateDir = join(root, 'state');
    const skillsRoot = join(root, 'skills'); await Promise.all([workspace, skillsRoot].map((path) => mkdir(path)));
    const input = join(workspace, 'input.txt'); await writeFile(input, 'A\nB\n'); let turn = 0;
    const server = makeConsoleServer({ stateDir, workspace, skillsRoot,
      computerEnvironment: discoverComputerEnvironment({ userHome: workspace }),
      modelStatus: () => ({ connected: true, provider: 'fixture', modelId }),
      modelFactory: () => ({ async respond(request) {
        turn += 1;
        if (turn === 1) {
          const lines = ['from pathlib import Path',
            "rows=Path('input.txt').read_text().splitlines()",
            "Path('summary.csv').write_text('rows\\n'+str(len(rows))+'\\n')",
            "Path('names.txt').write_text('\\n'.join(rows)+'\\n')"];
          const command = modelId === 'provider-a-model' ? ["python3 - <<'PY'", ...lines, 'PY'].join('\n')
            : `python3 -c ${JSON.stringify(lines.join(';'))}`;
          return { text: '', toolCalls: [{ id: `exec-${modelId}`, name: 'exec', args: {
          command,
          cwd: null, effect: effect(['summary.csv', 'names.txt']),
        } }] };
        }
        const receipt = JSON.parse(request.messages.findLast((message) => message.role === 'tool').content);
        if (turn === 2) {
          assert.equal(receipt.actualCall.name, 'exec');
          assert.equal(receipt.result.outputHandoff?.state, 'artifacts_registered', JSON.stringify(receipt));
          assert.equal(receipt.result.artifacts?.length, 2, JSON.stringify(receipt));
          return { text: '', toolCalls: [{ id: `complete-${modelId}`, name: 'work_completion',
            args: { outcome: 'achieved', inputSettlements: [] } }] };
        }
        return { text: '입력을 확인해 결과 파일 두 개를 만들었습니다.', toolCalls: [] };
      } }),
    });
    const base = await listen(server);
    try {
      const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
      const response = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, text: 'input.txt를 처리해서 summary.csv와 names.txt를 만들어줘.' }) });
      const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.artifacts.length, 2); assert.deepEqual(result.artifacts.map((item) => item.originalName).sort(),
        ['names.txt', 'summary.csv']);
      assert.equal(await readFile(input, 'utf8'), 'A\nB\n');
      const run = await server.runLedger.read(result.runId);
      const receipts = run.events.filter((event) => event.type === 'tool_completed')
        .map((event) => event.payload.receipt);
      assert.equal(receipts.filter((receipt) => receipt.requestedCall.name === 'attachment').length, 0);
      assert.equal(receipts.filter((receipt) => receipt.requestedCall.name === 'exec').length, 1);
      assert.equal(run.events.filter((event) => event.type === 'output_produced').length, 2);
    } finally {
      server.closeWakeStreams(); server.closeModelConnections(); await server.closeCommandExplainer();
      await server.closeMessengers(); await server.managedProcesses.stopAll('s4g_console_test');
      await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true });
    }
  });
