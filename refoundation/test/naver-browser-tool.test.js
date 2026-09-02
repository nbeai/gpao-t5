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
