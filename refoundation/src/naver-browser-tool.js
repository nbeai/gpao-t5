import { createHash } from 'node:crypto';
import { EFFECT_SCHEMA } from './exec-tool.js';

const ACTIONS = ['mail_list', 'mail_search', 'mail_open', 'mail_download_attachment',
  'mail_create_draft', 'mail_reply_draft', 'mail_send', 'blog_create_draft', 'blog_inspect_draft'];
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
function exactRecipients(value) {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new TypeError('mail recipients are required');
  return [...new Set(value.map((item) => String(item ?? '').trim().toLowerCase()))].map((item) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(item) || item.length > 320) throw new TypeError('mail recipient is invalid');
    return item;
  });
}
function exactText(value, label, max) { const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new TypeError(`${label} is invalid`); return text; }
function refBy(observation, role, names) {
  return Object.entries(observation?.refs ?? {}).find(([, fact]) => fact.role === role
    && names.some((name) => typeof name === 'string' ? fact.name === name : name.test(fact.name ?? '')));
}

export function makeNaverBrowserTool({ browser, authorizeEffect = null, attachments = null, sessionId = null } = {}) {
  if (!browser?.execute) throw new TypeError('Naver Browser adapter requires the existing Browser Hand');
  const call = async (args) => {
    if (browser.preflight) { const gate = await browser.preflight(args, {});
      if (gate?.allowed === false) return gate.result; }
    return browser.execute(args, {});
  };
  const drafts = new Map(); const blogDrafts = new Map(); const terminalSends = new Set();
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
      draftHandle: { type: ['string', 'null'], maxLength: 4096 },
      blogDraftHandle: { type: ['string', 'null'], maxLength: 4096 },
      recipients: { type: ['array', 'null'], items: { type: 'string', maxLength: 320 }, maxItems: 20 },
      subject: { type: ['string', 'null'], maxLength: 2000 }, title: { type: ['string', 'null'], maxLength: 2000 },
      body: { type: ['string', 'null'], maxLength: 20_000 },
      attachmentIds: { type: ['array', 'null'], items: { type: 'string', maxLength: 200 }, maxItems: 20 },
      sourceAttachmentId: { type: ['string', 'null'], maxLength: 200 },
      category: { type: ['string', 'null'], maxLength: 200 },
      tags: { type: ['array', 'null'], items: { type: 'string', maxLength: 100 }, maxItems: 30 },
      limit: { type: 'integer', minimum: 1, maximum: 50 }, effect: { anyOf: [EFFECT_SCHEMA, { type: 'null' }] },
    }, required: ['action', 'query', 'messageHandle', 'attachmentHandle', 'draftHandle', 'blogDraftHandle',
      'recipients', 'subject', 'title', 'body', 'attachmentIds', 'sourceAttachmentId', 'category', 'tags', 'limit', 'effect'] },
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
      if (['mail_create_draft', 'mail_reply_draft'].includes(args.action)
        && effectKind(args) !== 'external_change') return { allowed: false,
        outcome: 'not_executed', result: { state: 'mail_draft_external_change_required' } };
      if (args.action === 'mail_send' && effectKind(args) !== 'external_send') return { allowed: false,
        outcome: 'not_executed', result: { state: 'mail_send_external_effect_required' } };
      if (args.action === 'blog_create_draft' && effectKind(args) !== 'external_change') return { allowed: false,
        outcome: 'not_executed', result: { state: 'blog_draft_external_change_required' } };
      if (args.action === 'blog_inspect_draft' && effectKind(args) !== 'observe') return { allowed: false,
        outcome: 'not_executed', result: { state: 'observe_effect_required' } };
      if (['mail_search', 'mail_open', 'mail_download_attachment', 'mail_create_draft',
        'mail_reply_draft', 'mail_send', 'blog_create_draft'].includes(args.action)
        && typeof authorizeEffect === 'function') {
        return authorizeEffect(args, {});
      }
      return { allowed: true };
    },
    async execute(args = {}) {
      if (args.action === 'blog_inspect_draft') {
        const decodedDraft = decode(args.blogDraftHandle, 'naver_blog_draft');
        const draft = blogDrafts.get(decodedDraft.digest);
        if (!draft || draft.handle !== args.blogDraftHandle) throw new Error('Naver Blog draft is unavailable or stale');
        return { state: 'draft_observed', blogDraftHandle: draft.handle, title: draft.title,
          bodyChars: draft.bodyChars, category: draft.category, tags: draft.tags,
          source: draft.source, editorUrl: draft.observation.refScope?.url, effect: 'none' };
      }
      if (args.action === 'blog_create_draft') {
        const title = exactText(args.title, 'blog title', 2000); let body = String(args.body ?? '');
        let source = { kind: 'model_text', sha256: hash(body), bytes: Buffer.byteLength(body) };
        if (args.sourceAttachmentId) {
          if (!attachments?.readContent || !sessionId) throw new Error('Naver Blog source attachment is unavailable');
          const read = await attachments.readContent({ sessionId, attachmentId: args.sourceAttachmentId });
          if (read.bytes.length > 200_000 || !/^(?:text\/|application\/(?:json|xml))/u.test(read.record.mimeType ?? '')) {
            throw new Error('Naver Blog source attachment must be bounded text');
          }
          body = read.bytes.toString('utf8'); source = { kind: 'attachment', attachmentId: args.sourceAttachmentId,
            sha256: read.record.sha256, bytes: read.bytes.length };
        }
        body = exactText(body, 'blog body', 200_000); const tags = [...new Set((args.tags ?? [])
          .map((item) => String(item).trim()).filter(Boolean))].slice(0, 30);
        const category = args.category == null ? null : exactText(args.category, 'blog category', 200);
        const home = await call({ ...nullArgs, action: 'navigate', url: 'https://blog.naver.com/', maxChars: 12_000 });
        let observation = home.observation; let write = refBy(observation, 'link', ['글쓰기'])
          ?? refBy(observation, 'button', ['글쓰기']);
        if (!write && home.tab?.tabId) { const full = await call({ ...nullArgs, action: 'snapshot',
          tabId: home.tab.tabId, full: true, maxChars: 64_000 }); observation = full.observation;
          write = refBy(observation, 'link', ['글쓰기']) ?? refBy(observation, 'button', ['글쓰기']); }
        if (!write) throw new Error('Naver Blog editor entry is unavailable');
        observation = (await call({ ...nullArgs, action: 'click', tabId: observation.refScope.tabId,
          observationId: observation.observationId, ref: write[0], effect: args.effect })).after;
        const titleEditable = (observation.editables ?? []).find((item) => item.kind === 'title');
        const bodyEditable = (observation.editables ?? []).find((item) => item.kind === 'body');
        if (!titleEditable || !bodyEditable) throw new Error('Naver Blog exact title/body editors are unavailable');
        observation = (await call({ ...nullArgs, action: 'fill_editable', tabId: observation.refScope.tabId,
          observationId: observation.observationId, editableId: titleEditable.editableId,
          text: title, effect: args.effect })).after;
        const currentBody = (observation.editables ?? []).find((item) => item.kind === 'body') ?? bodyEditable;
        observation = (await call({ ...nullArgs, action: 'fill_editable', tabId: observation.refScope.tabId,
          observationId: observation.observationId, editableId: currentBody.editableId,
          text: body, effect: args.effect })).after;
        if (category) { const field = refBy(observation, 'textbox', [/카테고리/u]);
          if (!field) throw new Error('Naver Blog category control is unavailable');
          observation = (await call({ ...nullArgs, action: 'fill', tabId: observation.refScope.tabId,
            observationId: observation.observationId, ref: field[0], text: category, effect: args.effect })).after; }
        if (tags.length) { const field = refBy(observation, 'textbox', [/태그/u]);
          if (!field) throw new Error('Naver Blog tag control is unavailable');
          observation = (await call({ ...nullArgs, action: 'fill', tabId: observation.refScope.tabId,
            observationId: observation.observationId, ref: field[0], text: tags.join(', '), effect: args.effect })).after; }
        const digest = hash(JSON.stringify({ source, title, body: hash(body), category, tags }));
        const handle = encode({ v: 1, kind: 'naver_blog_draft', digest });
        blogDrafts.set(digest, { handle, source, title, bodyChars: body.length, category, tags, observation });
        return { state: 'draft_prepared', blogDraftHandle: handle, source, title, bodyChars: body.length,
          category, tags, readback: { titleChars: title.length, bodyChars: body.length }, effect: 'external_change' };
      }
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
      if (args.action === 'mail_download_attachment') {
        const handle = decode(args.attachmentHandle, 'naver_attachment');
        const downloaded = await call({ ...nullArgs, action: 'download', tabId: handle.tabId,
          observationId: handle.observationId, ref: handle.ref, effect: args.effect });
        return { state: downloaded.state, messageHandle: handle.messageHandle,
          file: downloaded.file ?? null, artifact: downloaded.artifact ?? null, effect: 'local_change' };
      }
      if (args.action === 'mail_send') {
        const decodedDraft = decode(args.draftHandle, 'naver_draft'); const draft = drafts.get(decodedDraft.digest);
        if (!draft || draft.handle !== args.draftHandle) throw new Error('Naver draft is unavailable or stale');
        if (terminalSends.has(decodedDraft.digest)) return { state: 'already_sent', retrySafe: false,
          draftHandle: args.draftHandle, effect: 'not_executed' };
        const submit = refBy(draft.observation, 'button', ['보내기', /메일 보내기/u]);
        if (!submit) throw new Error('Naver Mail send control is unavailable');
        terminalSends.add(decodedDraft.digest);
        const sent = await call({ ...nullArgs, action: 'submit', tabId: draft.observation.refScope.tabId,
          observationId: draft.observation.observationId, ref: submit[0], effect: args.effect });
        const text = String(sent.after?.text ?? ''); const confirmed = /메일을 보냈|발송.*완료|보낸메일함/u.test(text);
        return { state: confirmed ? 'sent' : 'delivery_unknown', draftHandle: args.draftHandle,
          recipientCount: draft.recipients.length, contentDigest: decodedDraft.digest,
          providerAcceptance: confirmed ? 'observed' : 'unknown', recipientDelivery: 'unknown',
          effectUnknown: !confirmed, retrySafe: false, effect: 'external_send' };
      }
      const recipients = args.action === 'mail_create_draft' ? exactRecipients(args.recipients) : null;
      const subject = args.action === 'mail_create_draft' ? exactText(args.subject, 'mail subject', 2000) : null;
      const body = exactText(args.body, 'mail body', 20_000);
      let observation;
      if (args.action === 'mail_reply_draft') {
        const message = decode(args.messageHandle, 'naver_message');
        const opened = await call({ ...nullArgs, action: 'click', tabId: message.tabId,
          observationId: message.observationId, ref: message.titleRef, effect: args.effect });
        const reply = refBy(opened.after, 'button', ['답장']);
        if (!reply) throw new Error('Naver Mail reply control is unavailable');
        observation = (await call({ ...nullArgs, action: 'click', tabId: opened.after.refScope.tabId,
          observationId: opened.after.observationId, ref: reply[0], effect: args.effect })).after;
      } else {
        const list = await observeList(1); const write = refBy(list.observation, 'link', ['메일 쓰기']);
        if (!write) throw new Error('Naver Mail compose control is unavailable');
        observation = (await call({ ...nullArgs, action: 'click', tabId: list.observation.refScope.tabId,
          observationId: list.observation.observationId, ref: write[0], effect: args.effect })).after;
      }
      const fillOne = async (current, role, names, text) => {
        const target = refBy(current, role, names); if (!target) throw new Error('Naver Mail draft field is unavailable');
        const filled = await call({ ...nullArgs, action: 'fill', tabId: current.refScope.tabId,
          observationId: current.observationId, ref: target[0], text, effect: args.effect });
        return filled.after;
      };
      if (recipients) observation = await fillOne(observation, 'textbox', [/받는 사람|수신자/u], recipients.join(', '));
      if (subject) observation = await fillOne(observation, 'textbox', ['제목', /메일 제목/u], subject);
      const editable = (observation.editables ?? []).find((item) => item.kind === 'body')
        ?? (observation.editables ?? [])[0];
      if (editable) observation = (await call({ ...nullArgs, action: 'fill_editable',
        tabId: observation.refScope.tabId, observationId: observation.observationId,
        editableId: editable.editableId, text: body, effect: args.effect })).after;
      else observation = await fillOne(observation, 'textbox', [/본문|내용/u], body);
      for (const attachmentId of args.attachmentIds ?? []) {
        const upload = refBy(observation, 'button', [/파일 첨부|첨부/u])
          ?? refBy(observation, 'textbox', [/파일 첨부|첨부/u]);
        if (!upload) throw new Error('Naver Mail attachment control is unavailable');
        observation = (await call({ ...nullArgs, action: 'upload', tabId: observation.refScope.tabId,
          observationId: observation.observationId, ref: upload[0], attachmentId, effect: args.effect })).after;
      }
      const save = refBy(observation, 'button', [/임시저장|저장/u]);
      if (!save) throw new Error('Naver Mail draft save control is unavailable');
      const saved = await call({ ...nullArgs, action: 'click', tabId: observation.refScope.tabId,
        observationId: observation.observationId, ref: save[0], effect: args.effect });
      observation = saved.after; const digest = hash(JSON.stringify({ recipients, subject, body,
        attachmentIds: args.attachmentIds ?? [], replyTo: args.messageHandle ?? null }));
      const handle = encode({ v: 1, kind: 'naver_draft', digest });
      drafts.set(digest, { handle, recipients: recipients ?? [], subject, bodyChars: body.length,
        attachmentIds: [...(args.attachmentIds ?? [])], observation });
      return { state: 'draft_saved', draftHandle: handle, recipients: recipients ?? 'reply_thread',
        subject, bodyChars: body.length, attachmentCount: (args.attachmentIds ?? []).length,
        readback: { saveObserved: /임시저장|저장/u.test(String(observation?.text ?? '')) }, effect: 'external_change' };
    },
  };
}
