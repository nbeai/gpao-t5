import assert from 'node:assert/strict';
import test from 'node:test';

import { makeNaverBrowserTool, parseNaverMailObservation } from '../src/naver-browser-tool.js';

const mailText = [
  '- textbox "메일 검색" [ref=e10]',
  '- button "검색" [ref=e11]',
  '- checkbox "보낸 사람네이버오전 03:1923.0KB메일 제목새로운 기기에서 로그인 되었습니다." [ref=e20]',
  '  - button "읽은 메일" [ref=e21]',
  '  - button "보낸 사람 네이버" [ref=e22]',
  '  - link "메일 제목 새로운 기기에서 로그인 되었습니다." [ref=e23]',
  '  - button "메일 본문 미리보기 열기" [ref=e24]',
  '- checkbox "보낸 사람세무사09.0112.0KB메일 제목8월 세무 자료" [ref=e30]',
  '  - button "안 읽은 메일" [ref=e31]',
  '  - button "보낸 사람 세무사" [ref=e32]',
  '  - link "메일 제목 8월 세무 자료" [ref=e33]',
  '  - button "메일 본문 미리보기 열기" [ref=e34]',
].join('\n');

function observation(id = 'obs-list', text = mailText, refs = {}) {
  return { observationId: id, text, truncated: false, refs,
    refScope: { observationId: id, tabId: 'tab-mail', targetId: 'target-mail',
      url: 'https://mail.naver.com/v2/folders/0/all' } };
}

test('Naver Mail observation은 목록의 message identity·발신자·시각·read state만 compact 구조화한다', () => {
  const messages = parseNaverMailObservation(observation(), 20);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map(({ subject, sender, receivedAt, readState }) => (
    { subject, sender, receivedAt, readState }
  )), [
    { subject: '새로운 기기에서 로그인 되었습니다.', sender: '네이버', receivedAt: '오전 03:19', readState: 'unread' },
    { subject: '8월 세무 자료', sender: '세무사', receivedAt: '09.01', readState: 'read' },
  ]);
  assert.ok(messages.every((item) => item.messageHandle && !item.messageHandle.includes(item.subject)));
});

test('Naver adapter는 기존 Browser Hand 안에서 list→search를 한 Tool call씩 닫고 raw page 전체를 반환하지 않는다', async () => {
  const calls = [];
  const browser = { async preflight() { return { allowed: true }; }, async execute(args) {
    calls.push(args);
    if (args.action === 'navigate') return { tab: { tabId: 'tab-mail' }, observation: observation('obs-empty', '- link "본문으로 바로가기" [ref=e1]') };
    if (args.action === 'snapshot') return { observation: observation('obs-list', mailText, {
      e10: { role: 'textbox', name: '메일 검색' }, e11: { role: 'button', name: '검색' },
    }) };
    if (args.action === 'fill') return { after: observation('obs-filled', mailText, {
      e10: { role: 'textbox', name: '메일 검색' }, e11: { role: 'button', name: '검색' },
    }) };
    if (args.action === 'submit') return { after: observation('obs-result', mailText) };
    throw new Error(`unexpected ${args.action}`);
  } };
  const tool = makeNaverBrowserTool({ browser });
  const listed = await tool.execute({ action: 'mail_list', query: null, messageHandle: null,
    attachmentHandle: null, limit: 2, effect: { kind: 'observe' } });
  assert.equal(listed.messages.length, 2); assert.equal('observation' in listed, false);
  const searched = await tool.execute({ action: 'mail_search', query: '로그인', messageHandle: null,
    attachmentHandle: null, limit: 2, effect: { kind: 'external_send' } });
  assert.equal(searched.messages.length, 2);
  assert.deepEqual(calls.map((call) => call.action), ['navigate', 'snapshot', 'navigate', 'snapshot', 'fill', 'submit']);
});

test('Naver message open·attachment download은 exact prior handles와 effect 종류 없이는 실행하지 않는다', async () => {
  const calls = [];
  const browser = { async preflight() { return { allowed: true }; }, async execute(args) {
    calls.push(args);
    if (args.action === 'navigate') return { tab: { tabId: 'tab-mail' }, observation: observation('obs-empty', '') };
    if (args.action === 'snapshot') return { observation: observation() };
    if (args.action === 'click') return { after: observation('obs-open', [
      '- heading "8월 세무 자료" [ref=e40]', '- paragraph "첨부한 자료를 확인해 주세요."',
      '- link "첨부파일 tax.xlsx 다운로드" [ref=e41]',
    ].join('\n')) };
    if (args.action === 'download') return { state: 'acted', file: { bytes: 4, sha256: 'a'.repeat(64) },
      artifact: { attachmentId: 'artifact-1' } };
    throw new Error(`unexpected ${args.action}`);
  } };
  const tool = makeNaverBrowserTool({ browser });
  const listed = await tool.execute({ action: 'mail_list', query: null, messageHandle: null,
    attachmentHandle: null, limit: 2, effect: { kind: 'observe' } });
  assert.equal((await tool.preflight({ action: 'mail_open', effect: { kind: 'observe' } })).allowed, false);
  const opened = await tool.execute({ action: 'mail_open', query: null,
    messageHandle: listed.messages[1].messageHandle, attachmentHandle: null, limit: 1,
    effect: { kind: 'external_change' } });
  assert.equal(opened.readStateEffect, 'may_have_changed'); assert.equal(opened.attachments.length, 1);
  assert.equal((await tool.preflight({ action: 'mail_download_attachment', effect: { kind: 'observe' } })).allowed, false);
  const downloaded = await tool.execute({ action: 'mail_download_attachment', query: null,
    messageHandle: null, attachmentHandle: opened.attachments[0].attachmentHandle, limit: 1,
    effect: { kind: 'local_change' } });
  assert.equal(downloaded.artifact.attachmentId, 'artifact-1');
  assert.deepEqual(calls.map((call) => call.action), ['navigate', 'snapshot', 'click', 'download']);
});

test('Naver Mail draft는 exact fields를 저장하고 send는 terminal 결과 뒤 같은 draft를 재전송하지 않는다', async () => {
  const calls = [];
  const compose = (id, text = '메일 쓰기 임시저장') => observation(id, text, {
    recipient: { role: 'textbox', name: '받는 사람' }, subject: { role: 'textbox', name: '제목' },
    attach: { role: 'button', name: '파일 첨부' }, save: { role: 'button', name: '임시저장' },
    send: { role: 'button', name: '보내기' },
  });
  const browser = { async preflight() { return { allowed: true }; }, async execute(args) {
    calls.push(args);
    if (args.action === 'navigate') return { tab: { tabId: 'tab-mail' },
      observation: observation('list', '- link "메일 쓰기" [ref=write]', { write: { role: 'link', name: '메일 쓰기' } }) };
    if (args.action === 'snapshot') return { observation: observation('list-full',
      '- link "메일 쓰기" [ref=write]', { write: { role: 'link', name: '메일 쓰기' } }) };
    if (args.action === 'click' && args.ref === 'write') return { after: { ...compose('compose'),
      editables: [{ editableId: 'body', kind: 'body', textChars: 0 }] } };
    if (args.action === 'fill') return { after: { ...compose(`fill-${args.ref}`),
      editables: [{ editableId: 'body', kind: 'body', textChars: 0 }] } };
    if (args.action === 'fill_editable') return { after: { ...compose('body-filled'),
      editables: [{ editableId: 'body', kind: 'body', textChars: args.text.length }] } };
    if (args.action === 'upload') return { after: compose('uploaded', '파일 첨부 완료 임시저장') };
    if (args.action === 'click' && args.ref === 'save') return { after: compose('saved', '임시저장 완료') };
    if (args.action === 'submit' && args.ref === 'send') return { after: compose('sent', '메일을 보냈습니다') };
    throw new Error(`unexpected ${args.action}:${args.ref ?? ''}`);
  } };
  const tool = makeNaverBrowserTool({ browser });
  const draft = await tool.execute({ action: 'mail_create_draft', query: null, messageHandle: null,
    attachmentHandle: null, draftHandle: null, recipients: ['new@example.com'], subject: '자료 전달',
    body: '요청하신 자료를 전달합니다.', attachmentIds: ['attachment-1'], limit: 1, effect: { kind: 'external_change' } });
  assert.equal(draft.state, 'draft_saved'); assert.equal(draft.bodyChars, '요청하신 자료를 전달합니다.'.length);
  assert.equal(draft.attachmentCount, 1);
  const sent = await tool.execute({ action: 'mail_send', query: null, messageHandle: null,
    attachmentHandle: null, draftHandle: draft.draftHandle, recipients: null, subject: null,
    body: null, attachmentIds: null, limit: 1, effect: { kind: 'external_send' } });
  assert.equal(sent.state, 'sent'); assert.equal(sent.retrySafe, false);
  const repeated = await tool.execute({ action: 'mail_send', query: null, messageHandle: null,
    attachmentHandle: null, draftHandle: draft.draftHandle, recipients: null, subject: null,
    body: null, attachmentIds: null, limit: 1, effect: { kind: 'external_send' } });
  assert.equal(repeated.state, 'already_sent');
  assert.equal(calls.filter((call) => call.action === 'submit').length, 1);
  assert.equal(calls.filter((call) => call.action === 'upload').length, 1);
});

test('Naver Mail send는 새 수신자 authority를 기존 Effect 경계에 위임하고 ACK unknown을 재시도하지 않는다', async () => {
  const decisions = [];
  const tool = makeNaverBrowserTool({ browser: { async execute() { throw new Error('not reached'); } },
    authorizeEffect: async (args) => { decisions.push(args.effect);
      return args.effect?.recipientNew ? { allowed: false, outcome: 'not_executed',
        result: { state: 'approval_required' } } : { allowed: true }; } });
  const blocked = await tool.preflight({ action: 'mail_send', effect: {
    kind: 'external_send', recipientNew: true, targets: ['new@example.com'],
  } });
  assert.equal(blocked.allowed, false); assert.equal(blocked.result.state, 'approval_required');
  assert.equal(decisions.length, 1);
});

test('Naver reply draft는 prior message handle의 exact thread에서만 답장과 저장을 연다', async () => {
  const calls = [];
  const replyCompose = (id, text = '답장 임시저장') => ({ ...observation(id, text, {
    save: { role: 'button', name: '임시저장' }, send: { role: 'button', name: '보내기' },
  }), editables: [{ editableId: 'reply-body', kind: 'body', textChars: 0 }] });
  const browser = { async preflight() { return { allowed: true }; }, async execute(args) {
    calls.push(args);
    if (args.action === 'navigate') return { tab: { tabId: 'tab-mail' }, observation: observation('list', mailText) };
    if (args.action === 'click' && args.ref === 'e33') return { after: observation('opened',
      '- button "답장" [ref=reply]', { reply: { role: 'button', name: '답장' } }) };
    if (args.action === 'click' && args.ref === 'reply') return { after: replyCompose('reply-compose') };
    if (args.action === 'fill_editable') return { after: replyCompose('reply-filled') };
    if (args.action === 'click' && args.ref === 'save') return { after: replyCompose('reply-saved', '임시저장 완료') };
    throw new Error(`unexpected ${args.action}:${args.ref ?? ''}`);
  } };
  const tool = makeNaverBrowserTool({ browser });
  const listed = await tool.execute({ action: 'mail_list', query: null, messageHandle: null,
    attachmentHandle: null, draftHandle: null, recipients: null, subject: null, body: null,
    attachmentIds: null, limit: 2, effect: { kind: 'observe' } });
  const draft = await tool.execute({ action: 'mail_reply_draft', query: null,
    messageHandle: listed.messages[1].messageHandle, attachmentHandle: null, draftHandle: null,
    recipients: null, subject: null, body: '확인했습니다.', attachmentIds: [], limit: 1,
    effect: { kind: 'external_change' } });
  assert.equal(draft.state, 'draft_saved'); assert.equal(draft.recipients, 'reply_thread');
  assert.deepEqual(calls.map((call) => `${call.action}:${call.ref ?? ''}`), [
    'navigate:', 'click:e33', 'click:reply', 'fill_editable:', 'click:save',
  ]);
});

test('Naver Blog draft는 exact source attachment와 title/body/category/tags를 editor readback에 결속한다', async () => {
  const calls = []; const craftCalls = []; const sourceBytes = Buffer.from('# 원고\n\n사용자의 목적을 실제 결과로 이어줍니다.');
  const editor = (id, text = '블로그 편집기') => ({ ...observation(id, text, {
    category: { role: 'textbox', name: '카테고리' }, tags: { role: 'textbox', name: '태그' },
  }), refScope: { observationId: id, tabId: 'tab-blog', targetId: 'blog-target',
    url: 'https://blog.naver.com/PostWriteForm.naver' },
  editables: [{ editableId: 'blog-title', kind: 'title', textChars: 0 },
    { editableId: 'blog-body', kind: 'body', textChars: 0 }] });
  const browser = { async preflight() { return { allowed: true }; }, async execute(args) {
    calls.push(args);
    if (args.action === 'navigate') return { tab: { tabId: 'tab-blog' },
      observation: { ...observation('blog-home', '- link "글쓰기" [ref=write]',
        { write: { role: 'link', name: '글쓰기' } }), refScope: { observationId: 'blog-home',
        tabId: 'tab-blog', targetId: 'blog-home', url: 'https://section.blog.naver.com/BlogHome.naver' } } };
    if (args.action === 'click' && args.ref === 'write') return { after: editor('editor-open') };
    if (args.action === 'fill_editable') return { after: editor(`editable-${args.editableId}`) };
    if (args.action === 'fill') return { after: editor(`field-${args.ref}`) };
    throw new Error(`unexpected ${args.action}:${args.ref ?? ''}`);
  } };
  const tool = makeNaverBrowserTool({ browser, sessionId: 'session-1', blogCraft: {
    async applyFormat(input) { craftCalls.push(['format', input]); return { state: 'verified', kind: input.kind }; },
    async insertImages(input) { craftCalls.push(['images', input]); return { state: 'verified', files: input.files.length,
      captionsApplied: input.captions.length }; },
    async preview(input) { craftCalls.push(['preview', input]); return { state: 'observed', url: 'https://blog.naver.com/preview',
      textChars: 120, textDigest: 'c'.repeat(64) }; },
  }, attachments: {
    async readContent({ sessionId, attachmentId }) { assert.equal(sessionId, 'session-1');
      assert.equal(attachmentId, 'source-md'); return { record: { mimeType: 'text/markdown',
        sha256: 'b'.repeat(64) }, bytes: sourceBytes }; },
    async prepareForUpload({ sessionId, attachmentId }) { assert.equal(sessionId, 'session-1');
      return { path: `/managed/${attachmentId}.png`, attachmentId, sha256: 'd'.repeat(64) }; },
  } });
  const draft = await tool.execute({ action: 'blog_create_draft', query: null, messageHandle: null,
    attachmentHandle: null, draftHandle: null, blogDraftHandle: null, recipients: null,
    subject: null, title: 'T5가 일을 끝내는 방식', body: null, attachmentIds: null,
    sourceAttachmentId: 'source-md', category: 'AI', tags: ['T5', '업무'], limit: 1,
    effect: { kind: 'external_change' } });
  assert.equal(draft.state, 'draft_prepared'); assert.equal(draft.source.attachmentId, 'source-md');
  assert.equal(draft.bodyChars, sourceBytes.toString('utf8').length); assert.deepEqual(draft.tags, ['T5', '업무']);
  const observedDraft = await tool.execute({ action: 'blog_inspect_draft', query: null,
    messageHandle: null, attachmentHandle: null, draftHandle: null, blogDraftHandle: draft.blogDraftHandle,
    recipients: null, subject: null, title: null, body: null, attachmentIds: null,
    sourceAttachmentId: null, category: null, tags: null, limit: 1, effect: { kind: 'observe' } });
  assert.equal(observedDraft.title, 'T5가 일을 끝내는 방식'); assert.equal(observedDraft.source.sha256, 'b'.repeat(64));
  assert.deepEqual(calls.map((call) => call.action), ['navigate', 'click', 'fill_editable', 'fill_editable', 'fill', 'fill']);
  const formatted = await tool.execute({ action: 'blog_apply_format', query: null, messageHandle: null,
    attachmentHandle: null, draftHandle: null, blogDraftHandle: draft.blogDraftHandle, recipients: null,
    subject: null, title: null, body: null, attachmentIds: null, sourceAttachmentId: null,
    category: null, tags: null, targetText: '사용자의 목적', occurrence: 0, formatKind: 'bold',
    formatValue: null, captions: null, limit: 1, effect: { kind: 'external_change' } });
  assert.equal(formatted.state, 'format_verified');
  assert.equal((await tool.preflight({ action: 'blog_insert_images', effect: { kind: 'external_change' } })).allowed, false);
  const images = await tool.execute({ action: 'blog_insert_images', query: null, messageHandle: null,
    attachmentHandle: null, draftHandle: null, blogDraftHandle: draft.blogDraftHandle, recipients: null,
    subject: null, title: null, body: null, attachmentIds: ['image-1'], sourceAttachmentId: null,
    category: null, tags: null, targetText: null, occurrence: null, formatKind: null,
    formatValue: null, captions: ['설명'], limit: 1, effect: { kind: 'external_send' } });
  assert.equal(images.state, 'images_verified');
  const preview = await tool.execute({ action: 'blog_preview', query: null, messageHandle: null,
    attachmentHandle: null, draftHandle: null, blogDraftHandle: draft.blogDraftHandle, recipients: null,
    subject: null, title: null, body: null, attachmentIds: null, sourceAttachmentId: null,
    category: null, tags: null, targetText: null, occurrence: null, formatKind: null,
    formatValue: null, captions: null, limit: 1, effect: { kind: 'observe' } });
  assert.equal(preview.state, 'preview_observed');
  assert.deepEqual(craftCalls.map((item) => item[0]), ['format', 'images', 'preview']);
});

test('Naver Blog craft는 format·image·Preview 일부 실패를 전체 성공으로 합치지 않는다', async () => {
  const browser = { async preflight() { return { allowed: true }; }, async execute(args) {
    if (args.action === 'navigate') return { tab: { tabId: 'blog' }, observation: { ...observation('home',
      '- link "글쓰기" [ref=write]', { write: { role: 'link', name: '글쓰기' } }),
      refScope: { observationId: 'home', tabId: 'blog', targetId: 'target', url: 'https://blog.naver.com/' } } };
    if (args.action === 'click') return { after: { ...observation('editor'), refScope: {
      observationId: 'editor', tabId: 'blog', targetId: 'target', url: 'https://blog.naver.com/editor' },
      editables: [{ editableId: 'title', kind: 'title' }, { editableId: 'body', kind: 'body' }] } };
    if (args.action === 'fill_editable') return { after: { ...observation(`fill-${args.editableId}`), refScope: {
      observationId: `fill-${args.editableId}`, tabId: 'blog', targetId: 'target', url: 'https://blog.naver.com/editor' },
      editables: [{ editableId: 'title', kind: 'title' }, { editableId: 'body', kind: 'body' }] } };
    throw new Error(`unexpected ${args.action}`);
  } };
  const tool = makeNaverBrowserTool({ browser, sessionId: 's', attachments: { async prepareForUpload() {
    return { path: '/managed/image.png' }; } }, blogCraft: {
    async applyFormat() { return { state: 'unverified' }; },
    async insertImages() { return { state: 'partial', files: 1, imagesAfter: 0 }; },
    async preview() { return { state: 'unknown', textChars: 0 }; },
  } });
  const draft = await tool.execute({ action: 'blog_create_draft', title: '제목', body: '본문',
    sourceAttachmentId: null, category: null, tags: null, query: null, messageHandle: null,
    attachmentHandle: null, draftHandle: null, blogDraftHandle: null, recipients: null, subject: null,
    attachmentIds: null, targetText: null, occurrence: null, formatKind: null, formatValue: null,
    captions: null, limit: 1, effect: { kind: 'external_change' } });
  const common = { query: null, messageHandle: null, attachmentHandle: null, draftHandle: null,
    blogDraftHandle: draft.blogDraftHandle, recipients: null, subject: null, title: null, body: null,
    sourceAttachmentId: null, category: null, tags: null, limit: 1 };
  const format = await tool.execute({ ...common, action: 'blog_apply_format', attachmentIds: null,
    targetText: '본문', occurrence: 0, formatKind: 'bold', formatValue: null, captions: null,
    effect: { kind: 'external_change' } });
  assert.equal(format.state, 'format_unverified');
  const images = await tool.execute({ ...common, action: 'blog_insert_images', attachmentIds: ['image'],
    targetText: null, occurrence: null, formatKind: null, formatValue: null, captions: [],
    effect: { kind: 'external_send' } });
  assert.equal(images.state, 'images_partial');
  const preview = await tool.execute({ ...common, action: 'blog_preview', attachmentIds: null,
    targetText: null, occurrence: null, formatKind: null, formatValue: null, captions: null,
    effect: { kind: 'observe' } });
  assert.equal(preview.state, 'preview_unknown');
});
