import assert from 'node:assert/strict';
import test from 'node:test';

import { makeNaverIdentityBroker } from '../src/naver-identity-broker.js';

const observed = (url, text) => ({ state: 'observed', profile: { id: 'default' },
  tab: { url }, observation: { text } });

test('동일 managed profile의 Mail·Blog actual observation만 하나의 authenticated Naver identity를 만든다', async () => {
  const broker = makeNaverIdentityBroker({ now: () => new Date('2026-09-02T00:00:00Z') });
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://mail.naver.com/' },
    result: observed('https://mail.naver.com/v2/folders/0/all', '받은메일함') });
  assert.equal((await broker.inspect()).state, 'needs_connection');
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://blog.naver.com/' },
    result: observed('https://blog.naver.com/', '로그아웃 내 블로그 글쓰기') });
  const ready = await broker.inspect();
  assert.equal(ready.state, 'ready'); assert.deepEqual(ready.capabilities,
    { mail_web: true, blog_web: true, mail_protocol: false });
  assert.equal(ready.naverIdentity.state, 'authenticated');
  assert.doesNotMatch(JSON.stringify(ready), /cookie|localStorage|\/Users\/|password|otp/iu);
});

test('authenticated 뒤 login_required는 expired이고 profile reset은 generation을 올린다', async () => {
  const broker = makeNaverIdentityBroker();
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://mail.naver.com/' },
    result: observed('https://mail.naver.com/v2/folders/0/all', '받은메일함') });
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://blog.naver.com/' },
    result: observed('https://blog.naver.com/', '로그아웃 글쓰기') });
  broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://mail.naver.com/' },
    result: { state: 'login_required', profile: { id: 'default' },
      loginBoundary: { url: 'https://nid.naver.com/nidlogin.login' } } });
  assert.equal((await broker.inspect()).naverIdentity.state, 'expired');
  const reset = broker.resetProfile(); assert.equal(reset.profileGeneration, 2);
  assert.equal(reset.services.mailWeb, 'unknown'); assert.equal(reset.services.blogWeb, 'unknown');
});

test('foreign profile과 비정상 protocol state는 Naver identity를 바꾸지 못한다', () => {
  const broker = makeNaverIdentityBroker({ profileHandle: 'default' });
  assert.throws(() => broker.observeBrowserResult({ args: { action: 'navigate', url: 'https://mail.naver.com/' },
    result: { ...observed('https://mail.naver.com/', '메일'), profile: { id: 'foreign' } } }), /foreign/u);
  assert.throws(() => broker.observeMailProtocol('connected'), /protocol state/u);
});

test('mail protocol만 ready일 때 Browser·Blog까지 준비됐다고 확대하지 않는다', async () => {
  const mailConnection = {
    async inspect() { return { state: 'ready', identity: { accountId: 'owner@naver.com' },
      capabilities: { read: true }, routes: [{ kind: 'official_protocol', label: '네이버 IMAP', state: 'ready', canStart: false }],
      actions: [] }; }, async makeTool() { return { name: 'naver_mail', execute() {} }; },
  };
  const broker = makeNaverIdentityBroker({ profileHandle: null, mailConnection });
  const result = await broker.inspect();
  assert.equal(result.state, 'ready');
  assert.equal(result.capabilities.mail_protocol, true);
  assert.equal(result.capabilities.blog_web, false);
  assert.match(result.userSafeSummary, /블로그 로그인은 아직 확인하지 않았/u);
  assert.equal(result.routes.find((route) => route.kind === 'browser').state, 'needs_connection');
  assert.doesNotMatch(result.userSafeSummary, /메일·블로그를 사용할 준비/u);
});

test('미연결 Naver는 일반 비밀번호가 아닌 app password와 Browser 경계를 분명히 안내한다', async () => {
  const broker = makeNaverIdentityBroker({ profileHandle: null, mailConnection: {
    async inspect() { return { state: 'needs_connection', routes: [], actions: [],
      credentialRequest: { fields: [] } }; },
  } });
  const result = await broker.inspect();
  assert.match(result.userSafeSummary, /일반 비밀번호가 아닌 애플리케이션 비밀번호/u);
  assert.match(result.userSafeSummary, /블로그 로그인은 T5 브라우저/u);
});
