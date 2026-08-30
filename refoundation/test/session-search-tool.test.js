import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConsoleSessionStore } from '../src/console-session-store.js';
import { ConversationLedger } from '../src/conversation-ledger.js';
import { makeSessionSearchTool } from '../src/session-search-tool.js';
import { RunLedger } from '../src/run-ledger.js';
import { WorkStore } from '../src/work-store.js';

async function addMessage(ledger, sessionId, messageId, role, content, extra = {}) {
  await ledger.appendMessage({
    sessionId, messageId, runId: 'seed-run', message: { role, content, ...extra },
  });
}

test('session_search는 과거 기록을 현재 durable memory나 forget 복원으로 쓰지 않는다고 밝힌다', () => {
  const tool = makeSessionSearchTool({ ledger: {}, sessions: {} });
  assert.match(tool.description, /not current external reality or current durable memory/u);
  assert.match(tool.description, /recoverable forget pointer[\s\S]*never use old conversation text/u);
});

test('session_search는 한국어 원문을 Session별로 찾고 stable ref 주변을 다시 읽는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-session-search-'));
  try {
    const sessions = new ConsoleSessionStore(room);
    const ledger = new ConversationLedger(join(room, 'conversations'));
    const first = await sessions.create();
    await sessions.append(first.id, { role: 'user', text: '다운로드 폴더의 비아이5 문서' });
    await ledger.ensure({ sessionId: first.id });
    await addMessage(ledger, first.id, 'first-user', 'user', '다운로드 폴더에서 비아이5 문서를 찾자.');
    await addMessage(ledger, first.id, 'first-assistant', 'assistant', '확인해볼게요.');
    await addMessage(ledger, first.id, 'first-result', 'tool', JSON.stringify({
      result: { stdout: '/Users/test/Downloads/비아이5.txt\nVALUE-7391\n' },
    }), { toolCallId: 'call-1', name: 'exec' });
    await ledger.appendCheckpoint({
      sessionId: first.id, checkpointId: 'cp-1', coversThroughMessageId: 'first-result',
      summary: '비아이5 문서를 확인했다.', sourceMessageCount: 3, sourceBytes: 200, tailMessageCount: 0,
    });

    const second = await sessions.create();
    await sessions.append(second.id, { role: 'user', text: '다른 문서' });
    await ledger.ensure({ sessionId: second.id });
    await addMessage(ledger, second.id, 'second-user', 'user', '바탕화면에서 다른 문서를 찾자.');

    const tool = makeSessionSearchTool({ ledger, sessions, currentSessionId: second.id });
    const found = await tool.execute({
      action: 'search', query: '다운로드 비아이5', sessionId: null,
      messageId: null, limit: 5, window: null, includeTools: false,
    });
    assert.equal(found.state, 'found');
    assert.equal(found.results.length, 1);
    assert.equal(found.results[0].sessionId, first.id);
    assert.equal(found.results[0].messageId, 'first-user');
    assert.match(found.results[0].snippet, /비아이5/);

    const read = await tool.execute({
      action: 'read', query: null, sessionId: first.id,
      messageId: 'first-user', limit: null, window: 3, includeTools: true,
    });
    assert.equal(read.state, 'read');
    assert.ok(read.messages.some((message) => /VALUE-7391/.test(message.content)));
    assert.ok(read.messages.some((message) => message.messageId === 'first-user' && message.anchor));
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('기본 search는 tool 원문을 제외하고 명시한 경우에만 찾는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-session-search-tools-'));
  try {
    const sessions = new ConsoleSessionStore(room);
    const ledger = new ConversationLedger(join(room, 'conversations'));
    const session = await sessions.create();
    await ledger.ensure({ sessionId: session.id });
    await addMessage(ledger, session.id, 'tool-only', 'tool', JSON.stringify({
      result: { stdout: 'TOOL-ONLY-8426' },
    }), { toolCallId: 'call-2', name: 'exec' });
    const tool = makeSessionSearchTool({ ledger, sessions, currentSessionId: null });
    const hidden = await tool.execute({
      action: 'search', query: 'TOOL-ONLY-8426', sessionId: null,
      messageId: null, limit: 5, window: null, includeTools: false,
    });
    const visible = await tool.execute({
      action: 'search', query: 'TOOL-ONLY-8426', sessionId: null,
      messageId: null, limit: 5, window: null, includeTools: true,
    });
    assert.equal(hidden.results.length, 0);
    assert.equal(visible.results[0].messageId, 'tool-only');
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('현재 live tail과 과거 session_search 영수증은 자기 자신을 다시 찾지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-session-search-self-'));
  try {
    const sessions = new ConsoleSessionStore(room);
    const ledger = new ConversationLedger(join(room, 'conversations'));
    const past = await sessions.create();
    await ledger.ensure({ sessionId: past.id });
    await addMessage(ledger, past.id, 'past-hit', 'user', 'ORIGINAL-7391 과거 원문');
    await addMessage(ledger, past.id, 'search-scaffold', 'tool', JSON.stringify({
      result: { results: [{ snippet: 'ORIGINAL-7391 과거 원문' }] },
    }), { toolCallId: 'search-call', name: 'session_search' });
    const current = await sessions.create();
    await ledger.ensure({ sessionId: current.id });
    await addMessage(ledger, current.id, 'current-query', 'user', 'ORIGINAL-7391을 과거에서 찾아줘');
    const tool = makeSessionSearchTool({ ledger, sessions, currentSessionId: current.id });
    const found = await tool.execute({
      action: 'search', query: 'ORIGINAL-7391', sessionId: null,
      messageId: null, limit: 5, window: null, includeTools: true,
    });
    assert.deepEqual(found.results.map((result) => result.messageId), ['past-hit']);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('browse와 search는 archived를 포함하고 soft-deleted Session은 제외한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-session-search-visibility-'));
  try {
    const sessions = new ConsoleSessionStore(room);
    const ledger = new ConversationLedger(join(room, 'conversations'));
    const archived = await sessions.create();
    await sessions.append(archived.id, { role: 'user', text: '보관된 ALPHA-5533 대화' });
    await ledger.ensure({ sessionId: archived.id });
    await addMessage(ledger, archived.id, 'archived-hit', 'user', 'ALPHA-5533');
    await sessions.setArchived(archived.id, true);
    const deleted = await sessions.create();
    await sessions.append(deleted.id, { role: 'user', text: '삭제된 ALPHA-5533 대화' });
    await ledger.ensure({ sessionId: deleted.id });
    await addMessage(ledger, deleted.id, 'deleted-hit', 'user', 'ALPHA-5533');
    await sessions.softDelete(deleted.id);
    const tool = makeSessionSearchTool({ ledger, sessions, currentSessionId: null });
    const found = await tool.execute({
      action: 'search', query: 'ALPHA-5533', sessionId: null,
      messageId: null, limit: 5, window: null, includeTools: false,
    });
    const browsed = await tool.execute({
      action: 'browse', query: null, sessionId: null,
      messageId: null, limit: 5, window: null, includeTools: false,
    });
    assert.deepEqual(found.results.map((result) => result.sessionId), [archived.id]);
    assert.deepEqual(browsed.sessions.map((result) => result.sessionId), [archived.id]);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('canonical 원장이 아직 없는 C0 이전 Session은 legacy UI transcript에서 검색한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-session-search-legacy-'));
  try {
    const sessions = new ConsoleSessionStore(room);
    const ledger = new ConversationLedger(join(room, 'conversations'));
    const legacy = await sessions.create();
    await sessions.append(legacy.id, { role: 'user', text: 'LEGACY-7391 과거 질문' });
    await sessions.append(legacy.id, {
      role: 'assistant', result: { reply: 'LEGACY-7391 과거 답변' },
    });
    const tool = makeSessionSearchTool({ ledger, sessions, currentSessionId: null });
    const found = await tool.execute({
      action: 'search', query: 'LEGACY-7391', sessionId: null,
      messageId: null, limit: 5, window: null, includeTools: false,
    });
    assert.equal(found.results[0].sessionId, legacy.id);
    const read = await tool.execute({
      action: 'read', query: null, sessionId: legacy.id,
      messageId: found.results[0].messageId, limit: null, window: 2, includeTools: false,
    });
    assert.ok(read.messages.some((message) => /과거 답변/.test(message.content)));
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('settled Episode는 pointer 목록 뒤 exact Work·Run으로 Conversation과 Run 사실을 회수한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-session-episode-'));
  try {
    const sessions = new ConsoleSessionStore(room); const session = await sessions.create();
    const ledger = new ConversationLedger(join(room, 'conversations')); await ledger.ensure({ sessionId: session.id });
    await addMessage(ledger, session.id, 'episode-source', 'user', '고객 보고서를 완성해줘.');
    const runs = new RunLedger(join(room, 'runs'));
    const run = await runs.start({ sessionId: session.id, request: '고객 보고서' });
    await run.append({ type: 'model_completed', payload: { response: { text: '완료' } } });
    await run.finish('completed');
    const works = new WorkStore(join(room, 'work')); const work = await works.create({
      sessionId: session.id, sourceMessageId: 'episode-source' });
    await works.claimExecution({ workId: work.workId, revision: 1, runId: run.runId });
    await works.settle({ workId: work.workId, revision: 1, outcome: 'achieved', runId: run.runId });
    const tool = makeSessionSearchTool({ ledger, sessions, workStore: works, runLedger: runs });
    const listed = await tool.execute({ action: 'episodes', limit: 5 });
    assert.equal(listed.episodes[0].workId, work.workId); assert.equal(listed.episodes[0].runId, run.runId);
    assert.equal('content' in listed.episodes[0], false);
    const recalled = await tool.execute({ action: 'episode_read', workId: work.workId,
      runId: run.runId, window: 2, includeTools: false });
    assert.equal(recalled.episode.sourceMessageId, 'episode-source');
    assert.equal(recalled.run.status, 'completed'); assert.equal(recalled.run.modelCalls, 1);
    assert.match(recalled.messages[0].content, /고객 보고서/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});
