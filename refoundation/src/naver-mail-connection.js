import { createHash } from 'node:crypto';
import { EFFECT_SCHEMA } from './exec-tool.js';

const SECRET_NAME = 'naver-mail-protocol';
const HOST = 'imap.naver.com';

function required(value, label, max = 512) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/u.test(text)) throw new TypeError(`${label} is invalid`);
  return text;
}
function account(value) {
  const text = required(value, 'Naver account', 160).toLowerCase();
  if (!/^[a-z0-9._-]+(?:@naver\.com)?$/u.test(text)) throw new TypeError('Naver account is invalid');
  return text.endsWith('@naver.com') ? text : `${text}@naver.com`;
}
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function connectionFailure(error) {
  if (error?.authenticationFailed === true || ['AUTHENTICATIONFAILED', 'AUTHORIZATIONFAILED']
    .includes(String(error?.serverResponseCode ?? '').toUpperCase())) {
    return Object.assign(new Error('네이버가 메일 인증을 거부했어요. 네이버 메일에서 IMAP/SMTP를 사용함으로 켜고, 일반 로그인 비밀번호가 아닌 2단계 인증용 애플리케이션 비밀번호를 입력해 주세요.'), {
      reason: 'naver_mail_authentication_rejected', retrySafe: true,
    });
  }
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET']
    .includes(String(error?.code ?? '').toUpperCase())) {
    return Object.assign(new Error('네이버 메일 서버에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'), {
      reason: 'naver_mail_transport_failed', retrySafe: true,
    });
  }
  return Object.assign(new Error('네이버 메일 서버의 현재 상태를 확인하지 못했어요. 비밀번호를 반복 입력하지 말고 잠시 뒤 다시 시도해 주세요.'), {
    reason: 'naver_mail_probe_failed', retrySafe: false,
  });
}
function encode(value) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }
function decode(value, kind) {
  try {
    const parsed = JSON.parse(Buffer.from(required(value, `${kind} handle`, 4096), 'base64url').toString('utf8'));
    if (parsed?.v !== 1 || parsed?.kind !== kind) throw new Error('kind');
    return parsed;
  } catch { throw new TypeError(`${kind} handle is invalid`); }
}
function addressList(value) {
  return (Array.isArray(value) ? value : []).slice(0, 32).map((item) => ({
    name: String(item?.name ?? '').slice(0, 200), address: String(item?.address ?? '').slice(0, 320),
  })).filter((item) => item.address);
}
function messagePublic(message, folder, uidValidity) {
  const uid = Number(message?.uid); if (!Number.isInteger(uid) || uid < 1) throw new Error('IMAP message identity is invalid');
  const envelope = message.envelope ?? {};
  return { messageHandle: encode({ v: 1, kind: 'message', folder, uidValidity: String(uidValidity), uid }),
    subject: String(envelope.subject ?? '').slice(0, 2_000), messageId: String(envelope.messageId ?? '').slice(0, 998),
    from: addressList(envelope.from), to: addressList(envelope.to), cc: addressList(envelope.cc),
    date: envelope.date instanceof Date ? envelope.date.toISOString() : null,
    receivedAt: message.internalDate instanceof Date ? message.internalDate.toISOString() : null,
    bytes: Number(message.size ?? 0), unread: !(message.flags instanceof Set && message.flags.has('\\Seen')) };
}
function searchCriteria(args) {
  const criteria = {};
  if (args.query) criteria.body = String(args.query).slice(0, 1_000);
  if (args.from) criteria.from = String(args.from).slice(0, 320);
  if (args.to) criteria.to = String(args.to).slice(0, 320);
  if (args.subject) criteria.subject = String(args.subject).slice(0, 1_000);
  if (args.since) criteria.since = new Date(`${args.since}T00:00:00Z`);
  if (args.before) criteria.before = new Date(`${args.before}T00:00:00Z`);
  if (args.unreadOnly === true) criteria.seen = false;
  return Object.keys(criteria).length ? criteria : { all: true };
}
async function defaultProtocol() {
  const [{ ImapFlow }, { simpleParser }] = await Promise.all([import('imapflow'), import('mailparser')]);
  async function withClient(credentials, work) {
    const client = new ImapFlow({ host: HOST, port: 993, secure: true, logger: false,
      auth: { user: credentials.accountId, pass: credentials.appPassword },
      socketTimeout: 30_000, greetingTimeout: 15_000 });
    try { await client.connect(); return await work(client); }
    finally { await client.logout().catch(() => {}); }
  }
  return {
    async verify(credentials) { return withClient(credentials, async (client) => {
      const folders = await client.list();
      return { accountId: credentials.accountId, folders: folders.length };
    }); },
    async listFolders(credentials) { return withClient(credentials, async (client) => {
      const folders = await client.list({ statusQuery: { messages: true, unseen: true } });
      return folders.slice(0, 200).map((folder) => ({ path: folder.path, name: folder.name,
        specialUse: folder.specialUse ?? null, messages: folder.status?.messages ?? null,
        unseen: folder.status?.unseen ?? null, uidValidity: folder.status?.uidValidity?.toString?.() ?? null }));
    }); },
    async search(credentials, request) { return withClient(credentials, async (client) => {
      const lock = await client.getMailboxLock(request.folder, { readOnly: true });
      try {
        const uidValidity = String(client.mailbox.uidValidity); const uids = await client.search(request.criteria, { uid: true });
        const newest = [...uids].sort((a, b) => b - a); const offset = Number(request.offset ?? 0);
        const page = newest.slice(offset, offset + request.limit);
        const messages = page.length ? await client.fetchAll(page, {
          uid: true, flags: true, envelope: true, internalDate: true, size: true,
        }, { uid: true }) : [];
        const order = new Map(page.map((uid, index) => [uid, index])); messages.sort((a, b) => order.get(a.uid) - order.get(b.uid));
        return { folder: request.folder, uidValidity, totalMatches: newest.length, messages,
          nextOffset: offset + page.length < newest.length ? offset + page.length : null };
      } finally { lock.release(); }
    }); },
    async read(credentials, request) { return withClient(credentials, async (client) => {
      const lock = await client.getMailboxLock(request.folder, { readOnly: true });
      try {
        const uidValidity = String(client.mailbox.uidValidity);
        if (uidValidity !== String(request.uidValidity)) throw Object.assign(new Error('메일함이 변경되어 다시 찾아야 해요.'), { reason: 'stale_mailbox' });
        const before = await client.fetchOne(request.uid, { uid: true, flags: true, envelope: true,
          internalDate: true, size: true, source: true }, { uid: true });
        if (!before) throw Object.assign(new Error('메일을 다시 찾지 못했어요.'), { reason: 'message_missing' });
        const parsed = await simpleParser(before.source, { skipHtmlToText: false, skipTextToHtml: true });
        const after = await client.fetchOne(request.uid, { flags: true }, { uid: true });
        return { folder: request.folder, uidValidity, message: before, parsed: {
          text: String(parsed.text ?? ''), html: Boolean(parsed.html),
          attachments: (parsed.attachments ?? []).slice(0, 100).map((item) => ({ filename: item.filename,
            contentType: item.contentType, size: item.size, content: item.content })),
        }, seenBefore: before.flags?.has('\\Seen') === true, seenAfter: after?.flags?.has('\\Seen') === true };
      } finally { lock.release(); }
    }); },
  };
}

export function makeNaverMailConnection({ secretStore, protocol = null, observeProtocol = () => {}, now = Date.now } = {}) {
  if (!secretStore?.get || !secretStore?.set || !secretStore?.clear) throw new TypeError('Naver Mail secure store is required');
  let resolvedProtocol = protocol;
  async function adapter() { resolvedProtocol ??= await defaultProtocol(); return resolvedProtocol; }
  async function bundle() { return secretStore.get(SECRET_NAME); }
  async function credential() {
    const current = await bundle();
    if (!current?.verifiedAt || !current?.credentials) throw Object.assign(new Error('네이버 메일 연결이 필요해요.'), { reason: 'not_connected' });
    return structuredClone(current.credentials);
  }
  const connection = {
    id: 'naver-mail', label: '네이버 메일', category: 'workspace', toolName: 'naver_mail',
    async inspect() {
      const current = await bundle(); const ready = Boolean(current?.verifiedAt && current?.identity);
      return { state: ready ? 'ready' : 'needs_connection', reason: ready ? 'verified_official_imap' : 'naver_app_password_required',
        userSafeSummary: ready ? '네이버 메일을 공식 연결로 읽을 준비가 되어 있어요.'
          : '네이버 메일의 IMAP 사용 설정과 애플리케이션 비밀번호가 필요해요.',
        capabilities: { list: ready, search: ready, read: ready, attachment: ready, draft: false, send: false },
        ...(ready ? { identity: structuredClone(current.identity) } : {}),
        credentialRequest: { fields: [{ id: 'accountId', label: '네이버 아이디', secret: false, maxLength: 160 },
          { id: 'appPassword', label: '네이버 애플리케이션 비밀번호', secret: true, maxLength: 512 }] },
        routes: [{ kind: 'official_protocol', label: '네이버 IMAP', state: ready ? 'ready' : 'needs_connection', canStart: !ready }],
        actions: ready ? [{ id: 'disconnect', label: '메일 연결 해제', kind: 'disconnect', endpoint: '/connections/naver/disconnect' }]
          : [{ id: 'connect', label: '메일 연결 정보 입력', kind: 'credentials', endpoint: '/connections/naver/credentials' }],
      };
    },
    async connectCredentials(input) {
      const credentials = { accountId: account(input?.accountId), appPassword: required(input?.appPassword, 'Naver app password', 512) };
      let observed;
      try { observed = await (await adapter()).verify(structuredClone(credentials)); }
      catch (error) { observeProtocol('needs_reauth'); throw connectionFailure(error); }
      const identity = { ownerApplication: 'GPAO-T5', transport: 'official_imap_smtp',
        accountId: account(observed?.accountId ?? credentials.accountId), accountLabel: credentials.accountId,
        permissions: ['mail_read'], resources: [], observed: true };
      await secretStore.set(SECRET_NAME, { version: 1, credentials, identity, verifiedAt: now() });
      observeProtocol('ready'); return { connected: true, ready: true, provider: 'naver',
        account: { id: identity.accountId, label: identity.accountLabel }, userSafeSummary: '네이버 메일을 연결했어요.' };
    },
    async makeTool(context = {}) {
      if ((await this.inspect()).state !== 'ready') return null;
      const tool = makeNaverMailTool({ protocol: await adapter(), credential, ...context });
      return tool;
    },
    async disconnect() { await secretStore.clear(SECRET_NAME); observeProtocol('setup_required');
      return { disconnected: true, userSafeSummary: '네이버 메일 연결을 해제했어요.' }; },
    async close() {},
  };
  return connection;
}

function makeNaverMailTool({ protocol, credential, attachments, sessionId, runId } = {}) {
  return { name: 'naver_mail', completionProposalOptional: true,
    description: 'Read the connected Naver Mail account through official IMAP without exposing credentials. List folders, search exact mail, read one observed message without marking it read, and download one observed attachment into the current conversation. Use returned opaque handles; never invent them. This read Hand cannot draft or send mail.',
    searchTerms: ['naver mail email imap inbox attachment 네이버 메일 받은메일 첨부 검색 읽기'],
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['list_folders', 'search', 'read', 'download_attachment'] },
      folder: { type: ['string', 'null'], maxLength: 512 }, query: { type: ['string', 'null'], maxLength: 1000 },
      from: { type: ['string', 'null'], maxLength: 320 }, to: { type: ['string', 'null'], maxLength: 320 },
      subject: { type: ['string', 'null'], maxLength: 1000 }, since: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      before: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, unreadOnly: { type: ['boolean', 'null'] },
      messageHandle: { type: ['string', 'null'], maxLength: 4096 }, attachmentHandle: { type: ['string', 'null'], maxLength: 4096 },
      cursor: { type: ['string', 'null'], maxLength: 4096 }, limit: { type: 'integer', minimum: 1, maximum: 50 },
      effect: { anyOf: [EFFECT_SCHEMA, { type: 'null' }] },
    }, required: ['action', 'folder', 'query', 'from', 'to', 'subject', 'since', 'before', 'unreadOnly',
      'messageHandle', 'attachmentHandle', 'cursor', 'limit', 'effect'] },
    async preflight(args = {}) {
      if (args.effect?.kind !== 'observe') return { allowed: false, outcome: 'not_executed',
        result: { state: 'observe_effect_required' } };
      if (args.action === 'read' && !args.messageHandle) return { allowed: false, outcome: 'not_executed',
        result: { state: 'message_identity_required' } };
      if (args.action === 'download_attachment' && !args.attachmentHandle) return { allowed: false,
        outcome: 'not_executed', result: { state: 'attachment_identity_required' } };
      return { allowed: true };
    },
    async execute(args) {
      const credentials = await credential();
      if (args.action === 'list_folders') return { state: 'observed', folders: await protocol.listFolders(credentials), effect: 'none' };
      if (args.action === 'search') {
        const folder = required(args.folder ?? 'INBOX', 'mail folder', 512); const criteria = searchCriteria(args);
        const criteriaDigest = digest(JSON.stringify({ folder, criteria })); let offset = 0;
        if (args.cursor) { const cursor = decode(args.cursor, 'cursor'); if (cursor.criteriaDigest !== criteriaDigest) throw new Error('메일 검색 조건이 바뀌어 cursor를 재사용할 수 없어요.'); offset = cursor.offset; }
        const result = await protocol.search(credentials, { folder, criteria, offset, limit: args.limit });
        return { state: 'observed', folder: result.folder, messages: result.messages.map((item) => messagePublic(item, result.folder, result.uidValidity)),
          coverage: result.coverage ?? { state: result.nextOffset == null ? 'complete' : 'partial', returned: result.messages.length,
            totalMatches: result.totalMatches }, nextCursor: result.nextCursor ?? (result.nextOffset == null ? null
            : encode({ v: 1, kind: 'cursor', criteriaDigest, offset: result.nextOffset })), effect: 'none' };
      }
      const encodedHandle = args.action === 'read' ? args.messageHandle : decode(args.attachmentHandle, 'attachment').messageHandle;
      const handle = decode(encodedHandle, 'message');
      const result = await protocol.read(credentials, handle); const publicMessage = messagePublic(result.message, result.folder, result.uidValidity);
      if (args.action === 'read') {
        let offset = 0;
        if (args.cursor) {
          const cursor = decode(args.cursor, 'body_cursor');
          if (cursor.messageHandle !== publicMessage.messageHandle) throw new Error('다른 메일의 본문 cursor를 재사용할 수 없어요.');
          offset = Number(cursor.offset);
        }
        const totalChars = result.parsed.text.length; const maxChars = 50_000;
        const text = result.parsed.text.slice(offset, offset + maxChars); const nextOffset = offset + text.length;
        return { state: 'observed', message: publicMessage,
          body: { text, htmlAvailable: result.parsed.html },
          unreadStateEffect: result.seenBefore === result.seenAfter ? 'unchanged' : 'changed',
          attachments: result.parsed.attachments.map((item, index) => ({ filename: String(item.filename ?? `attachment-${index + 1}`),
            contentType: String(item.contentType ?? 'application/octet-stream'), bytes: item.content.length,
            attachmentHandle: encode({ v: 1, kind: 'attachment', messageHandle: publicMessage.messageHandle,
              index, sha256: digest(item.content) }) })),
          coverage: { state: nextOffset >= totalChars ? 'complete' : 'partial', sourceBytes: result.message.source?.length ?? null,
            bodyCharsReturned: text.length, bodyCharsTotal: totalChars, bodyStart: offset },
          nextCursor: nextOffset >= totalChars ? null
            : encode({ v: 1, kind: 'body_cursor', messageHandle: publicMessage.messageHandle, offset: nextOffset }), effect: 'none' };
      }
      const attachment = decode(args.attachmentHandle, 'attachment'); const item = result.parsed.attachments[attachment.index];
      if (!item || digest(item.content) !== attachment.sha256) throw new Error('첨부파일 identity가 바뀌어 다시 읽어야 해요.');
      if (!attachments?.receive) throw new Error('첨부파일 결과 저장소를 사용할 수 없어요.');
      const artifact = await attachments.receive({ sessionId, runId, originalName: String(item.filename ?? `attachment-${attachment.index + 1}`),
        bytes: item.content, direction: 'input', source: { kind: 'naver_mail', messageHandle: publicMessage.messageHandle } });
      return { state: 'downloaded', artifact, message: publicMessage, effect: 'none' };
    },
  };
}
