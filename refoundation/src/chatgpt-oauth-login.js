import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname } from 'node:path';

import {
  CHATGPT_OAUTH_CLIENT_ID, CHATGPT_OAUTH_SCOPE, CHATGPT_OAUTH_TOKEN_URL,
  modelCredentialSecretName,
} from './chatgpt-oauth-credential.js';

const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const CALLBACK_PATH = '/auth/callback';

const redirectUri = (port) => `http://localhost:${port}${CALLBACK_PATH}`;

export function createPkce(random = randomBytes) {
  const verifier = random(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, state: random(16).toString('base64url') };
}

export function buildChatGptAuthorizeUrl({ challenge, state, port = 1455 }) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CHATGPT_OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri(port));
  url.searchParams.set('scope', CHATGPT_OAUTH_SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  return url.toString();
}

function accountIdFrom(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
    return payload?.['https://api.openai.com/auth']?.chatgpt_account_id ?? undefined;
  } catch { return undefined; }
}

export async function exchangeChatGptCode({ code, verifier, port = 1455 }, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? Date.now;
  const response = await fetchImpl(CHATGPT_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(port),
      client_id: CHATGPT_OAUTH_CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.access_token) {
    throw Object.assign(new Error('ChatGPT OAuth code exchange failed'), { status: response.status });
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expiresAt: now() + (Number(json.expires_in ?? 3600) - 60) * 1000,
    accountId: accountIdFrom(json.id_token),
  };
}

async function readExisting(file) {
  let raw;
  try { raw = await readFile(file, 'utf8'); }
  catch (error) {
    if (error?.code === 'ENOENT') return { version: 2, connections: [], activeId: null, roleBindings: {} };
    throw error;
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('unsupported existing model connection format'); }
  if (parsed?.version !== 2 || !Array.isArray(parsed.connections)) {
    throw new Error('unsupported existing model connection format');
  }
  return parsed;
}

export async function saveChatGptOAuthConnection({ file, credential, modelId, secretStore = null }) {
  if (!file || !credential?.access || !modelId) throw new TypeError('file, credential, and modelId are required');
  const state = await readExisting(file);
  const id = `chatgpt_oauth:${modelId}`;
  const secretRef = secretStore ? modelCredentialSecretName(id) : null;
  if (secretStore) await secretStore.set(secretRef, { credential });
  const record = {
    id, kind: 'chatgpt_oauth', provider: 'chatgpt_oauth', modelId,
    ...(secretStore ? { secretRef } : { credential }),
  };
  const index = state.connections.findIndex((connection) => connection.id === id);
  if (index >= 0) state.connections[index] = { ...state.connections[index], ...record };
  else state.connections.push(record);
  state.activeId = id;
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.oauth-${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
  return { connected: true, id, modelId, connectionCount: state.connections.length };
}

export function startChatGptCallback({ state, port = 1455, timeoutMs = 300_000 } = {}) {
  let resolveCode;
  let rejectCode;
  let settled = false;
  const waitForCode = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  waitForCode.catch(() => {});
  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    fn(value);
    server.close();
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://localhost:${port}`);
    if (url.pathname !== CALLBACK_PATH) { response.writeHead(404); response.end(); return; }
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (!code || returnedState !== state) {
      response.end('<h3>로그인을 완료하지 못했어요. 이 창을 닫고 다시 시도해 주세요.</h3>');
      finish(rejectCode, new Error('OAuth callback state mismatch'));
      return;
    }
    response.end('<h3>연결됐어요. 이 창을 닫고 T5로 돌아가세요.</h3>');
    finish(resolveCode, code);
  });
  const timer = setTimeout(() => finish(rejectCode, new Error('OAuth login timed out')), timeoutMs);
  timer.unref?.();
  const listening = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    listening,
    waitForCode,
    cancel() { finish(rejectCode, new Error('OAuth login cancelled')); },
  };
}
