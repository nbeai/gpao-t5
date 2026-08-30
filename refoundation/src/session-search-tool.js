import { episodePointers } from './memory-portfolio.js';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const DEFAULT_WINDOW = 5;
const MAX_WINDOW = 20;
const MAX_QUERY_CHARS = 500;
const MAX_SNIPPET_CHARS = 300;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_RESULT_BYTES = 32 * 1024;

function normalize(value) { return String(value ?? '').normalize('NFKC').toLocaleLowerCase(); }
function queryTokens(value) { return normalize(value).match(/[\p{L}\p{N}_./:-]+/gu) ?? []; }
function bytes(value) { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }

function searchableContent(entry, includeTools) {
  if (entry.message.role === 'user' || entry.message.role === 'assistant') return entry.message.content;
  if (entry.message.role !== 'tool' || !includeTools) return null;
  if (entry.message.name === 'session_search') return null;
  try {
    const receipt = JSON.parse(entry.message.content);
    return JSON.stringify({
      tool: entry.message.name,
      command: receipt?.requestedCall?.args?.command,
      result: receipt?.result,
      outcome: receipt?.outcome,
    });
  } catch {
    return entry.message.content;
  }
}

function matchScore(content, query) {
  const haystack = normalize(content);
  const needle = normalize(query).trim();
  const tokens = [...new Set(queryTokens(query))];
  if (!needle || !tokens.length || !tokens.every((token) => haystack.includes(token))) return null;
  let score = haystack.includes(needle) ? 100 : 0;
  for (const token of tokens) {
    let offset = 0;
    let count = 0;
    while (count < 20) {
      const found = haystack.indexOf(token, offset);
      if (found < 0) break;
      count += 1;
      offset = found + Math.max(1, token.length);
    }
    score += 10 + count;
  }
  return score;
}

function snippet(content, query) {
  const text = String(content ?? '').replaceAll(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '').normalize('NFKC');
  const lowered = text.toLocaleLowerCase();
  const candidates = [normalize(query).trim(), ...queryTokens(query)].filter(Boolean);
  let found = -1;
  for (const candidate of candidates) {
    const index = lowered.indexOf(candidate);
    if (index >= 0 && (found < 0 || index < found)) found = index;
  }
  if (found < 0) found = 0;
  const radius = Math.floor(MAX_SNIPPET_CHARS / 2);
  const start = Math.max(0, found - radius);
  const end = Math.min(text.length, start + MAX_SNIPPET_CHARS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function boundedMessages(entries, anchorIndex, window, includeTools) {
  const selected = [];
  let used = 2;
  const start = Math.max(0, anchorIndex - window);
  const end = Math.min(entries.length, anchorIndex + window + 1);
  for (let index = start; index < end; index += 1) {
    const entry = entries[index];
    if (entry.message.role === 'tool' && !includeTools) continue;
    const raw = entry.message.content;
    const content = raw.length > MAX_MESSAGE_CHARS ? `${raw.slice(0, MAX_MESSAGE_CHARS)}…` : raw;
    const item = {
      messageId: entry.messageId, runId: entry.runId, role: entry.message.role,
      content, recordedAt: entry.recordedAt ?? null,
      ...(entry.message.name ? { toolName: entry.message.name } : {}),
      ...(index === anchorIndex ? { anchor: true } : {}),
      ...(raw.length > MAX_MESSAGE_CHARS ? { contentTruncated: true, originalChars: raw.length } : {}),
    };
    const size = bytes(item) + (selected.length ? 1 : 0);
    if (used + size > MAX_RESULT_BYTES) break;
    selected.push(item);
    used += size;
  }
  return { messages: selected, truncated: selected.length < end - start };
}

async function visibleSessions(sessions) {
  const state = await sessions.read();
  return state.sessions.filter((session) => !session.deletedAt);
}

function legacyEntries(session) {
  let sequence = 0;
  return (session.transcript ?? []).flatMap((entry) => {
    let message = null;
    if (entry.role === 'user' && typeof entry.text === 'string') {
      message = { role: 'user', content: entry.text };
    } else if (entry.role === 'assistant' && typeof entry.result?.reply === 'string') {
      message = { role: 'assistant', content: entry.result.reply };
    }
    if (!message) return [];
    sequence += 1;
    return [{
      messageId: `legacy:${sequence}`, runId: entry.runId ?? null,
      turn: null, recordedAt: null, message,
    }];
  });
}

async function conversationView(ledger, session) {
  try { return await ledger.read(session.id); }
  catch (error) {
    if (error?.status !== 404) throw error;
    return { entries: legacyEntries(session), checkpoints: [] };
  }
}

export function makeSessionSearchTool({ ledger, sessions, workStore = null, runLedger = null,
  currentSessionId = null } = {}) {
  if (!ledger || !sessions) throw new TypeError('conversation ledger and session store are required');
  return {
    name: 'session_search',
    executionMode: 'parallel',
    searchTerms: [
      'past conversation history prior decision transcript',
      '과거 대화 원문 이전 결정 기록',
    ],
    description: 'Search or read canonical past T5 conversations and settled Episode pointers. Use search for exact words or prior work, then read for surrounding canonical context. Use episodes to list settled Work·Run·Message pointers without transcript content, then episode_read with exact workId and runId to recover its bounded source conversation and Run outcome facts. Use browse only when the user names no topic. Session history says what was observed then, not current external reality or current durable memory. When T5 supplies a recoverable forget pointer, never use old conversation text to reconstruct a value for a question about the current remembered fact, preference, or decision; only read it when the user explicitly asks what was said in that past conversation. Do not claim no prior conversation or Episode before searching.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['search', 'read', 'browse', 'episodes', 'episode_read'] },
        query: { type: ['string', 'null'], maxLength: MAX_QUERY_CHARS },
        sessionId: { type: ['string', 'null'] },
        messageId: { type: ['string', 'null'] },
        limit: { type: ['integer', 'null'], minimum: 1, maximum: MAX_LIMIT },
        window: { type: ['integer', 'null'], minimum: 1, maximum: MAX_WINDOW },
        includeTools: { type: ['boolean', 'null'] },
        workId: { type: ['string', 'null'] },
        runId: { type: ['string', 'null'] },
      },
      required: ['action', 'query', 'sessionId', 'messageId', 'limit', 'window', 'includeTools', 'workId', 'runId'],
    },
    async execute({ action, query, sessionId, messageId, limit, window, includeTools, workId, runId }) {
      const available = await visibleSessions(sessions);
      const byId = new Map(available.map((session) => [session.id, session]));
      if (action === 'episodes' || action === 'episode_read') {
        if (!workStore || !runLedger) throw new Error('episode retrieval is unavailable');
        const pointers = episodePointers(await workStore.read());
        if (action === 'episodes') return { state: 'episodes',
          episodes: pointers.filter((pointer) => byId.has(pointer.sessionId))
            .sort((left, right) => String(right.recordedAt).localeCompare(String(left.recordedAt)))
            .slice(0, Number.isInteger(limit) ? limit : DEFAULT_LIMIT) };
        const pointer = pointers.find((item) => item.workId === String(workId ?? '')
          && item.runId === String(runId ?? ''));
        if (!pointer || !byId.has(pointer.sessionId)) throw new Error('episode not found');
        const session = byId.get(pointer.sessionId); const conversation = await conversationView(ledger, session);
        const anchorIndex = conversation.entries.findIndex((entry) => entry.messageId === pointer.sourceMessageId);
        const bounded = anchorIndex < 0 ? { messages: [], truncated: false }
          : boundedMessages(conversation.entries, anchorIndex,
            Number.isInteger(window) ? window : DEFAULT_WINDOW, includeTools === true);
        const run = await runLedger.read(pointer.runId);
        return { state: 'episode_read', episode: pointer, ...bounded,
          run: { runId: run.runId, status: run.status, startedAt: run.startedAt, endedAt: run.endedAt,
            modelCalls: run.events.filter((event) => event.type === 'model_completed').length,
            toolCalls: run.events.filter((event) => event.type === 'tool_completed').length } };
      }
      if (action === 'browse') {
        const count = Number.isInteger(limit) ? limit : DEFAULT_LIMIT;
        return {
          state: 'browsed',
          sessions: available.sort((left, right) => right.updatedAt - left.updatedAt)
            .slice(0, count).map((session) => ({
              sessionId: session.id, title: session.title, updatedAt: session.updatedAt,
              archived: Boolean(session.archivedAt), turns: session.transcript.length,
              current: session.id === currentSessionId,
            })),
        };
      }
      if (action === 'read') {
        const id = String(sessionId ?? '');
        const ref = String(messageId ?? '');
        const session = byId.get(id);
        if (!session) throw new Error('session not found');
        const conversation = await conversationView(ledger, session);
        const anchorIndex = conversation.entries.findIndex((entry) => entry.messageId === ref);
        if (anchorIndex < 0) throw new Error('session message not found');
        if (conversation.entries[anchorIndex].message.role === 'tool' && includeTools !== true) {
          throw new Error('tool message read requires includeTools=true');
        }
        const radius = Number.isInteger(window) ? window : DEFAULT_WINDOW;
        const bounded = boundedMessages(conversation.entries, anchorIndex, radius, includeTools === true);
        return {
          state: 'read', sessionId: id, title: session.title, anchorMessageId: ref,
          ...bounded,
          messagesBefore: anchorIndex,
          messagesAfter: conversation.entries.length - anchorIndex - 1,
        };
      }
      if (action !== 'search') throw new Error(`Unknown session search action: ${action}`);
      const needle = String(query ?? '').trim();
      if (!needle) throw new TypeError('session search query is required');
      if (needle.length > MAX_QUERY_CHARS) throw new TypeError('session search query is too long');
      const requestedId = sessionId == null ? null : String(sessionId);
      if (requestedId && !byId.has(requestedId)) throw new Error('session not found');
      const hits = [];
      for (const session of available) {
        if (requestedId && session.id !== requestedId) continue;
        const conversation = await conversationView(ledger, session);
        let searchableEntries = conversation.entries;
        if (session.id === currentSessionId) {
          const checkpoint = conversation.checkpoints.at(-1);
          if (!checkpoint) searchableEntries = [];
          else {
            const coveredIndex = conversation.entries.findIndex((entry) => (
              entry.messageId === checkpoint.coversThroughMessageId
            ));
            searchableEntries = coveredIndex < 0 ? [] : conversation.entries.slice(0, coveredIndex + 1);
          }
        }
        let best = null;
        let matchCount = 0;
        for (const entry of searchableEntries) {
          const content = searchableContent(entry, includeTools === true);
          if (content == null) continue;
          const score = matchScore(content, needle);
          if (score == null) continue;
          matchCount += 1;
          const candidate = {
            sessionId: session.id, title: session.title, messageId: entry.messageId,
            runId: entry.runId, role: entry.message.role, snippet: snippet(content, needle),
            score, recordedAt: entry.recordedAt ?? null, updatedAt: session.updatedAt,
            archived: Boolean(session.archivedAt), current: session.id === currentSessionId,
          };
          if (!best || candidate.score > best.score
            || (candidate.score === best.score && String(candidate.recordedAt) > String(best.recordedAt))) {
            best = candidate;
          }
        }
        if (best) hits.push({ ...best, matchCount });
      }
      hits.sort((left, right) => (right.score - left.score)
        || (right.updatedAt - left.updatedAt) || left.sessionId.localeCompare(right.sessionId));
      const count = Number.isInteger(limit) ? limit : DEFAULT_LIMIT;
      const results = [];
      let used = 2;
      let truncated = hits.length > count;
      for (const hit of hits.slice(0, count)) {
        const size = bytes(hit) + (results.length ? 1 : 0);
        if (used + size > MAX_RESULT_BYTES) { truncated = true; break; }
        results.push(hit);
        used += size;
      }
      return { state: 'found', query: needle, results, truncated };
    },
  };
}
