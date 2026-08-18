import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEY = 'sk-loopback-only';

function responseJson(res, body) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

test('live runner는 Responses HTTP → exec → function output → 최종 답을 관통한다', async () => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ authorization: req.headers.authorization, body });
    if (requests.length === 1) {
      responseJson(res, {
        id: 'response-1',
        output: [{
          type: 'function_call', id: 'fc-1', call_id: 'call-1', name: 'exec',
          arguments: JSON.stringify({
            command: "awk '{ total += $1 } END { print total }' *.txt",
            cwd: null,
          }),
        }],
      });
      return;
    }
    const toolOutput = body.input.find((item) => item.type === 'function_call_output');
    assert.ok(toolOutput);
    assert.match(toolOutput.output, /"stdout":"42\\n"/);
    responseJson(res, {
      id: 'response-2',
      output: [{
        type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: '실제 파일을 확인한 합계는 42입니다.' }],
      }],
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const endpoint = `http://127.0.0.1:${server.address().port}/v1/responses`;

  try {
    const child = spawn(process.execPath, ['refoundation/scripts/run-live.mjs', '--model', 'gpt-test'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        T5_REFOUNDATION_OPENAI_API_KEY: KEY,
        T5_REFOUNDATION_AUTH: 'api-key',
        T5_REFOUNDATION_OPENAI_ENDPOINT: endpoint,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve) => child.once('close', resolve));

    assert.equal(code, 0, stderr);
    assert.doesNotMatch(stdout, /sk-loopback-only/);
    const result = JSON.parse(stdout);
    assert.equal(result.status, 'completed');
    assert.equal(result.fixturePassed, true);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].outcome, 'succeeded');
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.authorization === `Bearer ${KEY}`));
    assert.ok(requests.every((request) => !JSON.stringify(request.body).includes(KEY)));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('live runner는 콘솔에 저장된 OAuth 연결만으로 같은 과업을 관통한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-console-oauth-integration-'));
  const connectionFile = join(room, 'model-connection.json');
  await writeFile(connectionFile, JSON.stringify({
    version: 2,
    activeId: 'chatgpt_oauth:gpt-test',
    roleBindings: {},
    connections: [{
      id: 'chatgpt_oauth:gpt-test', kind: 'chatgpt_oauth', provider: 'chatgpt_oauth', modelId: 'gpt-test',
      credential: {
        access: KEY, refresh: 'loopback-refresh', accountId: 'acct-loopback', expiresAt: Date.now() + 600_000,
      },
    }],
  }), { mode: 0o600 });
  let call = 0;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    call += 1;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (call === 1) {
      const functionCall = {
        type: 'function_call', call_id: 'oauth-live-call', name: 'exec',
        arguments: JSON.stringify({ command: "awk '{ total += $1 } END { print total }' *.txt", cwd: null }),
      };
      res.write(`data: ${JSON.stringify({ type: 'response.output_item.done', item: functionCall })}\n\n`);
      res.write(`data: ${JSON.stringify({
        type: 'response.completed', response: { id: 'r1', model: 'gpt-test', output: [functionCall] },
      })}\n\n`);
    } else {
      const output = body.input.find((item) => item.type === 'function_call_output');
      assert.match(output.output, /"stdout":"42\\n"/);
      res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '합계는 42입니다.' })}\n\n`);
      res.write(`data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          id: 'r2', model: 'gpt-test',
          output: [{
            type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: '합계는 42입니다.' }],
          }],
        },
      })}\n\n`);
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const endpoint = `http://127.0.0.1:${server.address().port}/backend-api/codex/responses`;

  try {
    const child = spawn(process.execPath, ['refoundation/scripts/run-live.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        T5_REFOUNDATION_AUTH: 'console',
        T5_REFOUNDATION_MODEL_CONNECTION_FILE: connectionFile,
        T5_REFOUNDATION_CHATGPT_ENDPOINT: endpoint,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve) => child.once('close', resolve));
    assert.equal(code, 0, stderr);
    assert.doesNotMatch(stdout, /sk-loopback-only|loopback-refresh/);
    const result = JSON.parse(stdout);
    assert.equal(result.auth, 'chatgpt_oauth');
    assert.equal(result.fixturePassed, true);
    assert.equal(call, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
