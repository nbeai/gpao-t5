import { createHash } from 'node:crypto';
import { EFFECT_SCHEMA } from './exec-tool.js';

const ACTIONS = ['mail_list', 'mail_search', 'mail_open', 'mail_download_attachment'];
const nullArgs = { url: null, tabId: null, full: null, maxChars: null, fullPage: null,
  observationId: null, ref: null, editableId: null, modalIntent: null, text: null,
  textFilePath: null, textFileStartLine: null, filePath: null, attachmentId: null, effect: null };

function hash(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function encode(value) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }
function decode(value, kind) {
  try { const parsed = JSON.parse(Buffer.from(String(value ?? ''), 'base64url').toString('utf8'));
    if (parsed?.v !== 1 || parsed?.kind !== kind) throw new Error('kind'); return parsed; }
  catch { throw new TypeError(`${kind} handle is invalid`); }
}
function lineFact(line, pattern) { const match = String(line).match(pattern);
  return match ? { name: match[1], ref: match[2] } : null; }
function receivedAt(text) {
  return String(text).match(/(?:오전|오후)\s*\d{1,2}:\d{2}|\d{2}\.\d{2}(?:\s+\d{2}:\d{2})?/u)?.[0] ?? null;
}
export function parseNaverMailObservation(observation, limit = 20) {
  const lines = String(observation?.text ?? '').split('\n'); const rows = []; let row = null;
  const flush = () => {
    if (!row?.subject || !row?.sender || !row?.titleRef) { row = null; return; }
    const messageHandle = encode({ v: 1, kind: 'naver_message', observationId: observation.observationId,
      tabId: observation.refScope?.tabId, pageUrl: observation.refScope?.url, titleRef: row.titleRef,
      previewRef: row.previewRef, identityDigest: hash(`${row.subject}\n${row.sender}\n${row.receivedAt ?? ''}`) });
    rows.push({ messageHandle, subject: row.subject, sender: row.sender,
      receivedAt: row.receivedAt, readState: row.readState ?? 'unknown' }); row = null;
  };
  for (const line of lines) {
    if (/^- checkbox "보낸 사람/u.test(line)) { flush(); row = { receivedAt: receivedAt(line) }; continue; }
    if (!row) continue;
    const sender = lineFact(line, /- button "보낸 사람\s+([^"]+)" \[ref=([^\]]+)\]/u);
    if (sender) { row.sender = sender.name; continue; }
    const subject = lineFact(line, /- link "메일 제목\s+([^"]+)" \[ref=([^\]]+)\]/u);
    if (subject) { row.subject = subject.name; row.titleRef = subject.ref; continue; }
    const preview = lineFact(line, /- button "(메일 본문 미리보기 열기)" \[ref=([^\]]+)\]/u);
    if (preview) { row.previewRef = preview.ref; continue; }
    if (/- button "읽은 메일"/u.test(line)) row.readState = 'unread';
    else if (/- button "안 읽은 메일"/u.test(line)) row.readState = 'read';
  }
  flush(); return rows.slice(0, Math.max(1, Math.min(50, Number(limit) || 20)));
}
function attachmentsFrom(observation, messageHandle) {
  return String(observation?.text ?? '').split('\n').flatMap((line) => {
    const fact = lineFact(line, /- (?:link|button) "([^"]+)" \[ref=([^\]]+)\]/u);
    if (!fact || !/첨부|다운로드/u.test(fact.name) || /메일 본문 미리보기/u.test(fact.name)) return [];
    return [{ name: fact.name.slice(0, 300), attachmentHandle: encode({ v: 1, kind: 'naver_attachment',
      messageHandle, observationId: observation.observationId, tabId: observation.refScope?.tabId,
      pageUrl: observation.refScope?.url, ref: fact.ref }) }];
  }).slice(0, 50);
}
function effectKind(args) { return args?.effect?.kind ?? null; }

export function makeNaverBrowserTool({ browser } = {}) {
  if (!browser?.execute) throw new TypeError('Naver Browser adapter requires the existing Browser Hand');
  const call = async (args) => {
    if (browser.preflight) { const gate = await browser.preflight(args, {});
      if (gate?.allowed === false) return gate.result; }
    return browser.execute(args, {});
  };
  const observeList = async (limit) => {
    const opened = await call({ ...nullArgs, action: 'navigate', url: 'https://mail.naver.com/', maxChars: 12_000 });
    let observation = opened.observation; let messages = parseNaverMailObservation(observation, limit);
    if (!messages.length && opened.tab?.tabId) {
      const snapshot = await call({ ...nullArgs, action: 'snapshot', tabId: opened.tab.tabId,
        full: true, maxChars: 64_000 });
      observation = snapshot.observation; messages = parseNaverMailObservation(observation, limit);
    }
    return { observation, messages };
  };
  return { name: 'naver', completionProposalOptional: true,
    description: 'Use the connected Naver identity through the existing managed Browser. This adapter returns compact physical Mail facts and exact handles; the model still decides what the user means. It never receives passwords or cookies. Current actions list/search Mail without opening it, open one exact observed message with an explicit account-change effect, and download one exact observed attachment.',
    searchTerms: ['naver mail blog 네이버 메일 블로그 받은메일 첨부 답장'],
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ACTIONS }, query: { type: ['string', 'null'], maxLength: 500 },
      messageHandle: { type: ['string', 'null'], maxLength: 4096 },
      attachmentHandle: { type: ['string', 'null'], maxLength: 4096 },
      limit: { type: 'integer', minimum: 1, maximum: 50 }, effect: { anyOf: [EFFECT_SCHEMA, { type: 'null' }] },
    }, required: ['action', 'query', 'messageHandle', 'attachmentHandle', 'limit', 'effect'] },
    async preflight(args = {}) {
      if (!ACTIONS.includes(args.action)) throw new TypeError('unsupported Naver action');
      if (['mail_list'].includes(args.action) && effectKind(args) !== 'observe') return { allowed: false,
        outcome: 'not_executed', result: { state: 'observe_effect_required' } };
      if (args.action === 'mail_search' && effectKind(args) !== 'external_send') return { allowed: false,
        outcome: 'not_executed', result: { state: 'search_transmission_effect_required' } };
      if (args.action === 'mail_open' && effectKind(args) !== 'external_change') return { allowed: false,
        outcome: 'not_executed', result: { state: 'mail_read_state_effect_required' } };
      if (args.action === 'mail_download_attachment' && effectKind(args) !== 'local_change') return { allowed: false,
        outcome: 'not_executed', result: { state: 'attachment_local_change_required' } };
      return { allowed: true };
    },
    async execute(args = {}) {
      if (args.action === 'mail_list') { const result = await observeList(args.limit);
        return { state: 'listed', messages: result.messages, coverage: {
          state: result.observation?.truncated ? 'partial' : 'observed_page', returned: result.messages.length,
        }, effect: 'none' }; }
      if (args.action === 'mail_search') {
        if (!String(args.query ?? '').trim()) throw new TypeError('Naver Mail search query is required');
        const current = await observeList(50); const search = Object.entries(current.observation?.refs ?? {})
          .find(([, fact]) => fact.role === 'textbox' && fact.name === '메일 검색');
        if (!search) throw new Error('Naver Mail search control is unavailable');
        const filled = await call({ ...nullArgs, action: 'fill', tabId: current.observation.refScope.tabId,
          observationId: current.observation.observationId, ref: search[0], text: String(args.query).trim(), effect: args.effect });
        const after = filled.after; const submit = Object.entries(after?.refs ?? {})
          .find(([, fact]) => fact.role === 'button' && fact.name === '검색');
        if (!submit) throw new Error('Naver Mail search submit control is unavailable');
        const searched = await call({ ...nullArgs, action: 'submit', tabId: after.refScope.tabId,
          observationId: after.observationId, ref: submit[0], effect: args.effect });
        const observation = searched.after; return { state: 'searched', query: String(args.query).trim(),
          messages: parseNaverMailObservation(observation, args.limit), coverage: {
            state: observation?.truncated ? 'partial' : 'observed_page' }, effect: 'external_send' };
      }
      if (args.action === 'mail_open') {
        const handle = decode(args.messageHandle, 'naver_message');
        const opened = await call({ ...nullArgs, action: 'click', tabId: handle.tabId,
          observationId: handle.observationId, ref: handle.titleRef, effect: args.effect });
        const observation = opened.after; return { state: 'opened', messageHandle: args.messageHandle,
          readStateEffect: 'may_have_changed', body: String(observation?.text ?? '').slice(0, 50_000),
          bodyCoverage: observation?.truncated ? 'partial' : 'observed_page',
          attachments: attachmentsFrom(observation, args.messageHandle), effect: 'external_change' };
      }
      const handle = decode(args.attachmentHandle, 'naver_attachment');
      const downloaded = await call({ ...nullArgs, action: 'download', tabId: handle.tabId,
        observationId: handle.observationId, ref: handle.ref, effect: args.effect });
      return { state: downloaded.state, messageHandle: handle.messageHandle,
        file: downloaded.file ?? null, artifact: downloaded.artifact ?? null, effect: 'local_change' };
    },
  };
}
