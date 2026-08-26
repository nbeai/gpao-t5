import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('제품 콘솔은 safe login PATH와 configured HOME을 실제 모델 Terminal 호출에 배선한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-console-terminal-environment-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  const bin = join(room, 'user-bin'); const cli = join(bin, 'fixture-cli');
  await Promise.all([mkdir(workspace, { recursive: true }), mkdir(bin, { recursive: true })]);
  await writeFile(cli, '#!/bin/sh\nprintf SAFE-CONSOLE-CLI', { mode: 0o700 }); await chmod(cli, 0o700);
  let turn = 0;
  const modelFactory = () => ({ async respond(input) {
    turn += 1;
    if (turn === 1) return { text: '', toolCalls: [{ id: 'terminal-env', name: 'exec', args: {
      command: 'printf "HOME=%s\\n" "$HOME"; command -v fixture-cli; fixture-cli', cwd: null,
      effect: { kind: 'observe', summary: 'Terminal 환경 확인', targets: [], reversible: true,
        backupAvailable: false, recipientNew: false, approvalToken: null },
    } }] };
    const receipt = JSON.parse(input.messages.at(-1).content);
    assert.equal(receipt.actualCall.name, 'exec');
    assert.ok(receipt.result.stdout.includes(`HOME=${workspace}`));
    assert.match(receipt.result.stdout, /SAFE-CONSOLE-CLI/u);
    assert.ok(receipt.result.stdout.includes(cli));
    return { text: 'Terminal 환경 연결됨', toolCalls: [] };
  } });
  const server = makeConsoleServer({
    stateDir, workspace, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'terminal-env-model' }),
    terminalEnvironment: {
      PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: workspace, USERPROFILE: workspace, ZDOTDIR: workspace,
    },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '내 Terminal 환경을 확인해줘' }) }).then((response) => response.json());
    assert.equal(reply.reply, 'Terminal 환경 연결됨');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('잘린 foreground output은 다음 모델 턴에만 recall tool을 열고 exact 중간을 재실행 없이 읽는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-console-terminal-recall-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let turn = 0; let execCalls = 0;
  const modelFactory = () => ({ async respond(input) {
    turn += 1;
    if (turn === 1) {
      assert.equal(input.tools.some((tool) => tool.name === 'terminal_output'), false);
      execCalls += 1;
      return { text: '', toolCalls: [{ id: 'large-output', name: 'exec', args: {
        command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
          "process.stdout.write('HEAD-' + 'x'.repeat(40000) + '-EXACT-MIDDLE-' + 'y'.repeat(40000) + '-TAIL')",
        )}`, cwd: null,
        effect: { kind: 'observe', summary: 'large output', targets: [], reversible: true,
          backupAvailable: false, recipientNew: false, approvalToken: null },
      } }] };
    }
    const receipt = JSON.parse(input.messages.at(-1).content);
    if (turn === 2) {
      assert.equal(receipt.actualCall.name, 'exec'); assert.equal(receipt.result.truncated, true);
      assert.ok(receipt.result.outputRecall.handle);
      assert.equal(input.tools.some((tool) => tool.name === 'terminal_output'), true);
      return { text: '', toolCalls: [{ id: 'recall-output', name: 'terminal_output', args: {
        handle: receipt.result.outputRecall.handle, stream: 'stdout', offset: 39980, limit: 100,
      } }] };
    }
    assert.equal(receipt.actualCall.name, 'terminal_output');
    assert.match(receipt.result.text, /EXACT-MIDDLE/u);
    return { text: '중간 출력까지 확인했습니다.', toolCalls: [] };
  } });
  const server = makeConsoleServer({ stateDir, workspace, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'terminal-recall-model' }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '긴 출력의 중간 표식을 확인해줘' }) }).then((response) => response.json());
    assert.equal(reply.reply, '중간 출력까지 확인했습니다.'); assert.equal(execCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});

test('빈 스킬 root인 비교군은 skill 도구 없이 기존 터미널만 모델에 제공한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-console-no-skills-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  const skillsRoot = join(room, 'empty-skills');
  await Promise.all([workspace, skillsRoot].map((path) => mkdir(path, { recursive: true })));
  const modelFactory = () => ({ async respond(input) {
    assert.equal(input.tools.some((tool) => tool.name === 'skill'), false);
    assert.equal(input.tools.some((tool) => tool.name === 'exec'), true);
    return { text: '기존 터미널만 제공됨', toolCalls: [] };
  } });
  const server = makeConsoleServer({
    stateDir, workspace, skillsRoot, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'no-skill-model' }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: created.id, text: '확인해줘' }),
    }).then((response) => response.json());
    assert.equal(reply.reply, '기존 터미널만 제공됨');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('모델은 필요한 스킬만 열고 기존 터미널로 실행하며 두 사실을 같은 Run에 남긴다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-console-skill-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  const skillsRoot = join(room, 'skills');
  const skillDir = join(skillsRoot, 'file-discovery');
  await mkdir(workspace, { recursive: true });
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), [
    '---',
    'name: file-discovery',
    'description: Find the intended local file across filename variations.',
    '---',
    '',
    '# File discovery',
    '',
    'Normalize names, search the title stem, then verify the extension.',
  ].join('\n'));

  let turn = 0;
  const modelFactory = () => ({ async respond(input) {
    turn += 1;
    if (turn === 1) {
      const skill = input.tools.find((tool) => tool.name === 'skill');
      assert.ok(skill);
      assert.doesNotMatch(skill.description, /file-discovery|Normalize names/);
      assert.match(skill.description, /action=search/i);
      return { text: '', toolCalls: [{
        id: 'search-skill', name: 'skill', args: { action: 'search', name: 'local file filename' },
      }] };
    }
    const observation = JSON.parse(input.messages.at(-1).content);
    if (turn === 2) {
      assert.equal(observation.actualCall.name, 'skill');
      assert.equal(observation.result.state, 'searched');
      assert.equal(observation.result.skills[0].name, 'file-discovery');
      return { text: '', toolCalls: [{
        id: 'view-skill', name: 'skill', args: { action: 'view', name: 'file-discovery' },
      }] };
    }
    if (turn === 3) {
      assert.equal(observation.actualCall.name, 'skill');
      assert.match(observation.result.content, /Normalize names/);
      return { text: '', toolCalls: [{ id: 'use-terminal', name: 'exec', args: {
        command: "printf 'found-after-skill'", cwd: null,
        effect: { kind: 'observe', summary: '스킬 절차 적용 결과', targets: [], reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null },
      } }] };
    }
    assert.equal(observation.actualCall.name, 'exec');
    assert.equal(observation.result.stdout, 'found-after-skill');
    return { text: '스킬을 읽고 터미널로 확인했습니다.', toolCalls: [] };
  } });

  const server = makeConsoleServer({
    stateDir, workspace, skillsRoot, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'skill-model' }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: created.id, text: '이름이 조금 다른 파일을 찾아줘' }),
    }).then((response) => response.json());
    assert.equal(reply.reply, '스킬을 읽고 터미널로 확인했습니다.');
    const run = await fetch(`${base}/runs/${reply.runId}`).then((response) => response.json());
    const completed = run.events.filter((event) => event.type === 'tool_completed');
    assert.deepEqual(completed.map((event) => event.payload.receipt.actualCall.name), ['skill', 'skill', 'exec']);
    assert.equal(completed[0].payload.receipt.result.state, 'searched');
    assert.equal(completed[1].payload.receipt.result.state, 'viewed');
    assert.match(completed[1].payload.receipt.result.contentDigest, /^[0-9a-f]{64}$/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('기존 콘솔 UI가 새 session → agent loop → terminal → persisted reply를 왕복한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-console-surface-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const modelFactory = () => {
    let turn = 0;
    return {
      async respond(input) {
        turn += 1;
        if (turn === 1) return {
          text: '', toolCalls: [{ id: 'console-call', name: 'exec', args: {
            command: "printf 'console-ok'", cwd: null,
            effect: { kind: 'observe', summary: '문자 출력', targets: [], reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null },
          } }],
          responseId: 'r1', responseModel: 'console-model',
          contextReceipt: {
            schema: 't5.context-receipt.v1', provider: 'test', model: 'console-model',
            requestBytes: 100, instructionsBytes: 10,
            input: { items: 1, bytes: 20, byKind: {} },
            tools: { definitions: 1, bytes: 30 },
            source: { messages: 1, bytes: 20, currentUserBytes: 10, byRole: {} },
          },
        };
        const receipt = JSON.parse(input.messages.at(-1).content);
        assert.equal(receipt.result.stdout, 'console-ok');
        assert.equal(receipt.result.commandExplanation.steps[0].executable, 'printf');
        return {
          text: '콘솔 터미널 연결 완료', toolCalls: [], responseId: 'r2', responseModel: 'console-model',
          contextReceipt: {
            schema: 't5.context-receipt.v1', provider: 'test', model: 'console-model',
            requestBytes: 200, instructionsBytes: 10,
            input: { items: 3, bytes: 120, byKind: {} },
            tools: { definitions: 1, bytes: 30 },
            source: { messages: 3, bytes: 120, currentUserBytes: 10, byRole: {} },
          },
        };
      },
    };
  };
  const errors = [];
  const revealed = [];
  const server = makeConsoleServer({
    stateDir, workspace, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'console-model' }),
    onError: (error) => errors.push(error),
    revealPath: async (path) => {
      revealed.push(path);
      return { openedPath: path, targetType: 'file' };
    },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const html = await fetch(`${base}/`).then((response) => response.text());
    assert.match(html, /GPAO-T5/);
    assert.match(html, /path-links\.js/);
    assert.match(html, /wake-events\.js/);
    assert.match(html, /name="t5-runtime-instance" content="[0-9a-f-]{36}"/u);
    const reveal = await fetch(`${base}/computer/reveal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-t5-console-action': 'reveal' },
      body: JSON.stringify({ path: '/private/tmp/example.txt' }),
    }).then((response) => response.json());
    assert.equal(reveal.ok, true);
    assert.deepEqual(revealed, ['/private/tmp/example.txt']);
    const created = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const start = await fetch(`${base}/turn/stream-start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: created.id, text: '터미널 연결을 확인해줘' }),
    }).then((response) => response.json());
    assert.ok(start.streamId);
    const stream = await fetch(`${base}/turn/stream?sessionId=${created.id}&streamId=${start.streamId}`)
      .then((response) => response.text());
    assert.equal(errors.length, 0, errors[0]?.stack ?? errors[0]?.message);
    assert.match(stream, /event: trace_status/);
    assert.match(stream, /event: tool_progress/);
    assert.match(stream, /event: answer_delta/);
    assert.match(stream, /콘솔 터미널 연결 완료/);
    assert.match(stream, /event: complete/);

    for (const [event, elapsedMs] of [
      ['first_feedback_visible', 12], ['first_grounded_content', 34], ['turn_complete', 56],
    ]) {
      const metric = await fetch(`${base}/turn/metrics/visible`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ measurementId: start.measurementId, event, elapsedMs, visibilityState: 'visible' }),
      }).then((response) => response.json());
      assert.equal(metric.ok, true);
    }

    const session = await fetch(`${base}/sessions/${created.id}`).then((response) => response.json());
    assert.equal(session.transcript.length, 2);
    assert.equal(session.transcript[0].role, 'user');
    assert.equal(session.transcript[1].result.reply, '콘솔 터미널 연결 완료');
    assert.ok(session.transcript[1].result.runId);
    const runs = await fetch(`${base}/runs?sessionId=${created.id}`).then((response) => response.json());
    assert.equal(runs.runs.length, 1);
    assert.equal(runs.runs[0].runId, session.transcript[1].result.runId);
    assert.equal(runs.runs[0].status, 'completed');
    const run = await fetch(`${base}/runs/${runs.runs[0].runId}`).then((response) => response.json());
    assert.ok(run.events.some((event) => event.type === 'model_started'));
    assert.ok(run.events.some((event) => event.type === 'model_completed'));
    const receiptEvent = run.events.find((event) => event.type === 'tool_completed');
    assert.equal(receiptEvent.payload.receipt.actualCall.args.command, "printf 'console-ok'");
    assert.equal(receiptEvent.payload.receipt.result.stdout, 'console-ok');
    assert.equal(receiptEvent.payload.receipt.result.exitCode, 0);
    assert.equal(run.events.at(-1).type, 'surface_metric');
    const speed = await fetch(`${base}/runs/${run.runId}/speed`).then((response) => response.json());
    assert.deepEqual(speed.visible, {
      firstFeedbackMs: 12, firstGroundedContentMs: 34, turnCompleteMs: 56,
    });
    assert.equal(speed.model.calls, 2);
    assert.equal(speed.tools.calls, 1);
    assert.equal(speed.tools.outputChars, 'console-ok'.length);
    const context = await fetch(`${base}/runs/${run.runId}/context`).then((response) => response.json());
    assert.equal(context.calls.length, 2);
    assert.deepEqual(context.aggregate, {
      calls: 2, requestBytes: 300, inputBytes: 140, instructionsBytes: 20,
      toolSchemaBytes: 60, providerInputTokens: null,
    });
    const listed = await fetch(`${base}/sessions`).then((response) => response.json());
    assert.equal(listed.sessions[0].turns, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('콘솔 모델이 장기 exec handle을 poll해 새 출력과 실제 완료를 관측한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-console-process-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const modelFactory = () => {
    let observed = '';
    return { async respond(input) {
      const last = input.messages.at(-1);
      if (!input.tools.some((tool) => tool.name === 'process_start')) return {
        text: '', toolCalls: [{
          id: 'find-long-process', name: 'tool_search',
          args: { query: 'long running background command managed process' },
        }],
      };
      if (last.role !== 'tool' || last.name === 'tool_search') return {
        text: '', responseId: 'start', responseModel: 'process-model',
        toolCalls: [{
          id: 'long-exec', name: 'process_start',
          args: {
            command: "printf 'phase-1'; sleep 0.08; printf 'phase-2'", cwd: null,
            effect: { kind: 'observe', summary: '진행 출력', targets: [], reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null },
          },
        }],
      };
      const receipt = JSON.parse(last.content);
      if (receipt.requestedCall.name === 'process_start') {
        assert.equal(receipt.result.state, 'running');
        observed += receipt.result.stdout;
        return {
          text: '', responseId: 'poll', responseModel: 'process-model',
          toolCalls: [{
            id: 'long-poll', name: 'process_control', args: {
              action: 'poll', processId: receipt.result.processId,
              cursor: receipt.result.cursor, input: null, end: null, waitMs: 200,
            },
          }],
        };
      }
      assert.equal(receipt.requestedCall.name, 'process_control');
      observed += receipt.result.stdout;
      if (receipt.result.state === 'running') return {
        text: '', responseId: 'poll-again', responseModel: 'process-model',
        toolCalls: [{
          id: `long-poll-${Date.now()}`, name: 'process_control', args: {
            action: 'poll', processId: receipt.result.processId,
            cursor: receipt.result.cursor, input: null, end: null, waitMs: 200,
          },
        }],
      };
      assert.equal(receipt.result.state, 'completed');
      assert.equal(observed, 'phase-1phase-2');
      assert.equal(receipt.result.processExitCode, 0);
      assert.equal(receipt.result.effectObservation.declared.kind, 'observe');
      return {
        text: '장기 작업의 새 출력과 완료를 확인했습니다.', toolCalls: [],
        responseId: 'done', responseModel: 'process-model',
      };
    } };
  };
  const errors = [];
  const server = makeConsoleServer({
    stateDir, workspace, modelFactory, processYieldMs: 20,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'process-model' }),
    onError: (error) => errors.push(error),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: created.id, text: '시간이 걸리는 작업을 끝까지 확인해줘' }),
    }).then((response) => response.json());
    assert.equal(errors.length, 0, errors[0]?.stack ?? errors[0]?.message);
    assert.equal(reply.reply, '장기 작업의 새 출력과 완료를 확인했습니다.');
    assert.equal(server.managedProcesses.list(created.id)[0].state, 'completed');
  } finally {
    await server.managedProcesses.stopAll('test_cleanup');
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('콘솔 취소는 실행 중인 자식 프로세스 트리를 실제로 끝낸다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-console-cancel-process-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  const marker = join(workspace, 'should-not-exist.txt');
  await mkdir(workspace, { recursive: true });
  const modelFactory = () => ({
    async respond(input) {
      const last = input.messages.at(-1);
      if (!input.tools.some((tool) => tool.name === 'process_start')) return {
        text: '', toolCalls: [{
          id: 'find-cancel-process', name: 'tool_search',
          args: { query: 'long running background command managed process' },
        }],
      };
      if (last.role !== 'tool' || last.name === 'tool_search') return {
        text: '', toolCalls: [{
          id: 'cancel-exec', name: 'process_start',
          args: {
            command: `(sleep 0.5; printf late > '${marker}') & wait`, cwd: null,
            effect: { kind: 'local_change', summary: '테스트 marker 생성', targets: [marker], reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null },
          },
        }],
      };
      const receipt = JSON.parse(last.content);
      return {
        text: '', toolCalls: [{
          id: `cancel-poll-${Date.now()}`, name: 'process_control', args: {
            action: 'poll', processId: receipt.result.processId,
            cursor: receipt.result.cursor, input: null, end: null, waitMs: 30000,
          },
        }],
      };
    },
  });
  const server = makeConsoleServer({ stateDir, workspace, modelFactory, processYieldMs: 20 });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const start = await fetch(`${base}/turn/stream-start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: created.id, text: '오래 걸리는 작업을 시작해줘' }),
    }).then((response) => response.json());
    const streamPromise = fetch(`${base}/turn/stream?sessionId=${created.id}&streamId=${start.streamId}`)
      .then((response) => response.text());
    for (let attempt = 0; attempt < 50 && !server.managedProcesses.list(created.id).length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(server.managedProcesses.list(created.id)[0]?.state, 'running');
    await fetch(`${base}/turn/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: created.id }),
    });
    const stream = await streamPromise;
    assert.match(stream, /멈췄어요/);
    assert.equal(server.managedProcesses.list(created.id)[0].state, 'stopped');
    const runs = await fetch(`${base}/runs?sessionId=${created.id}`).then((response) => response.json());
    assert.equal(runs.runs[0].status, 'cancelled');
    const run = await fetch(`${base}/runs/${runs.runs[0].runId}`).then((response) => response.json());
    assert.equal(run.events.at(-1).type, 'run_cancelled');
    const toolReceipts = run.events.filter((event) => event.type === 'tool_completed')
      .map((event) => event.payload.receipt);
    assert.ok(toolReceipts.some((receipt) => receipt.result.state === 'stopped'), JSON.stringify(toolReceipts));
    await new Promise((resolve) => setTimeout(resolve, 550));
    const { access } = await import('node:fs/promises');
    await assert.rejects(() => access(marker));
  } finally {
    await server.managedProcesses.stopAll('test_cleanup');
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('모델 호출 실패는 run_failed 원문과 다시 볼 사용자용 실패 안내를 함께 남긴다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-console-failed-run-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const server = makeConsoleServer({
    stateDir, workspace,
    modelFactory: () => ({ async respond() {
      throw Object.assign(new Error('provider exploded'), { status: 200 });
    } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const response = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: created.id, text: '실패도 기록해' }),
    });
    assert.equal(response.status, 500);
    const runs = await fetch(`${base}/runs?sessionId=${created.id}`).then((item) => item.json());
    assert.equal(runs.runs[0].status, 'failed');
    const run = await fetch(`${base}/runs/${runs.runs[0].runId}`).then((item) => item.json());
    assert.equal(run.events.at(-1).type, 'run_failed');
    assert.equal(run.events.at(-1).payload.error, 'provider exploded');
    const session = await fetch(`${base}/sessions/${created.id}`).then((item) => item.json());
    assert.equal(session.transcript.length, 2);
    assert.equal(session.transcript[1].result.kind, 'error');
    assert.match(session.transcript[1].result.reply, /요청을 처리하는 중/u);
    assert.doesNotMatch(JSON.stringify(session.transcript[1]), /provider exploded/u);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('관측되지 않은 process_start 완료가 같은 세션의 모델 Run을 자동으로 깨운다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-console-process-wake-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const modelFactory = () => {
    let turn = 0;
    return { async respond(input) {
      const request = input.messages.at(-1)?.content ?? '';
      if (request.includes('managed process terminal event')) return {
        text: '자동 완료 알림: wake-output', toolCalls: [],
        responseId: 'wake-model', responseModel: 'wake-test-model',
      };
      if (!input.tools.some((tool) => tool.name === 'process_start')) return {
        text: '', toolCalls: [{
          id: 'find-wake-process', name: 'tool_search',
          args: { query: 'long running background command managed process' },
        }],
      };
      if (turn++ === 0) return {
        text: '', toolCalls: [{
          id: 'wake-process', name: 'process_start',
          args: {
            command: "sleep 0.08; printf 'wake-output'", cwd: null,
            effect: { kind: 'observe', summary: '완료 출력', targets: [], reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null },
          },
        }],
        responseId: 'start-model', responseModel: 'wake-test-model',
      };
      return {
        text: '작업을 시작했고 실행 중입니다.', toolCalls: [],
        responseId: 'running-model', responseModel: 'wake-test-model',
      };
    } };
  };
  const server = makeConsoleServer({ stateDir, workspace, modelFactory, processYieldMs: 20 });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const wakeResponse = await fetch(`${base}/events/stream`);
  const wakeReader = wakeResponse.body.getReader();
  const decoder = new TextDecoder();
  await wakeReader.read();
  try {
    const created = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: created.id, text: '백그라운드 작업을 시작하고 기다리지 마' }),
    }).then((response) => response.json());
    assert.equal(first.reply, '작업을 시작했고 실행 중입니다.');
    let session;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      session = await fetch(`${base}/sessions/${created.id}`).then((response) => response.json());
      if (session.transcript.length === 4) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(session.transcript.length, 4);
    assert.equal(session.transcript[2].role, 'system_event');
    assert.equal(session.transcript[2].event.state, 'completed');
    assert.equal(session.transcript[2].event.stdout, 'wake-output');
    assert.equal(session.transcript[2].event.effectObservation.declared.kind, 'observe');
    assert.equal(session.transcript[3].result.reply, '자동 완료 알림: wake-output');
    const runs = await fetch(`${base}/runs?sessionId=${created.id}`).then((response) => response.json());
    assert.equal(runs.runs.length, 2);
    assert.ok(runs.runs.some((run) => run.status === 'completed'));
    const details = await Promise.all(runs.runs.map((run) => (
      fetch(`${base}/runs/${run.runId}`).then((response) => response.json())
    )));
    const wakeRun = details.find((run) => run.metadata.trigger === 'managed_process_terminal');
    assert.ok(wakeRun);
    assert.equal(wakeRun.metadata.originRunId, session.transcript[1].result.runId);
    assert.equal(wakeRun.events.some((event) => event.type === 'work_bound'), false);
    assert.equal(wakeRun.events.some((event) => event.type === 'work_observation'), true);
    let wakeWire = '';
    for (let attempt = 0; attempt < 10 && !wakeWire.includes('managed_process_wake'); attempt += 1) {
      const chunk = await Promise.race([
        wakeReader.read(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('wake event timeout')), 500)),
      ]);
      wakeWire += decoder.decode(chunk.value ?? new Uint8Array());
    }
    assert.match(wakeWire, /event: managed_process_wake/);
    assert.match(wakeWire, /자동 완료 알림: wake-output/);
  } finally {
    await wakeReader.cancel();
    await server.managedProcesses.stopAll('test_cleanup');
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('백업 없는 삭제는 승인 전 실행되지 않고 exact call 승인 뒤 한 번만 실행된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-console-authority-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  const target = join(workspace, 'delete-me.txt');
  await mkdir(workspace, { recursive: true });
  await writeFile(target, 'keep until approved\n', 'utf8');
  const destructiveArgs = {
    command: `rm '${target}'`, cwd: null,
    effect: {
      kind: 'destructive', summary: 'delete-me.txt 삭제', targets: [target],
      reversible: false, backupAvailable: false, recipientNew: false, approvalToken: null,
    },
  };
  const modelFactory = () => ({ async respond(input) {
    const last = input.messages.at(-1);
    if (last.role === 'tool') {
      const receipt = JSON.parse(last.content);
      if (receipt.result.state === 'approval_required') {
        assert.equal(receipt.actualCall, null);
        return { text: '삭제 전에 승인이 필요합니다.', toolCalls: [] };
      }
      assert.equal(receipt.outcome, 'succeeded');
      return { text: '승인된 파일을 삭제했습니다.', toolCalls: [] };
    }
    if (last.content.includes('authority approval event')) {
      const encoded = last.content.split('\n').find((line) => line.startsWith('{'));
      const approved = JSON.parse(encoded);
      return {
        text: '', toolCalls: [{ id: 'approved-delete', name: approved.toolName, args: approved.args }],
      };
    }
    return { text: '', toolCalls: [{ id: 'proposed-delete', name: 'exec', args: destructiveArgs }] };
  } });
  const server = makeConsoleServer({ stateDir, workspace, modelFactory });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const proposed = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: created.id, text: '파일을 삭제해줘' }),
    }).then((response) => response.json());
    assert.equal(proposed.kind, 'approval');
    assert.ok(proposed.pendingId);
    await access(target);
    const beforeSession = await fetch(`${base}/sessions/${created.id}`).then((response) => response.json());
    assert.deepEqual(beforeSession.activePendingIds, [proposed.pendingId]);
    assert.equal((await server.authorityStore.read(proposed.pendingId)).status, 'pending');

    const approved = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: created.id, approve: proposed.pendingId }),
    }).then((response) => response.json());
    assert.equal(approved.kind, 'reply');
    assert.equal(approved.reply, '승인된 파일을 삭제했습니다.');
    await assert.rejects(() => access(target));
    assert.equal((await server.authorityStore.read(proposed.pendingId)).status, 'consumed');
    const afterSession = await fetch(`${base}/sessions/${created.id}`).then((response) => response.json());
    assert.deepEqual(afterSession.activePendingIds, []);
    const runs = await fetch(`${base}/runs?sessionId=${created.id}`).then((response) => response.json());
    assert.equal(runs.runs.length, 2);
    const details = await Promise.all(runs.runs.map((run) => (
      fetch(`${base}/runs/${run.runId}`).then((response) => response.json())
    )));
    const firstReceipt = details.find((run) => run.metadata.trigger === 'user').events
      .find((event) => event.type === 'tool_completed').payload.receipt;
    assert.equal(firstReceipt.outcome, 'not_executed');
    assert.equal(firstReceipt.actualCall, null);
    const approvedReceipt = details.find((run) => run.metadata.trigger === 'authority_approved').events
      .find((event) => event.type === 'tool_completed').payload.receipt;
    assert.equal(approvedReceipt.outcome, 'succeeded');
    assert.equal(approvedReceipt.actualCall.args.command, destructiveArgs.command);
    assert.equal(approvedReceipt.result.effectObservation.before.targets[0].exists, true);
    assert.equal(approvedReceipt.result.effectObservation.after.targets[0].exists, false);
    assert.equal(approvedReceipt.result.effectObservation.changed, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
