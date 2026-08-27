#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

import { makeConsoleServer } from '../src/console-server.js';
import { consoleInstructions } from '../src/console-model-factory.js';
import { makeChatGptResponsesModel } from '../src/chatgpt-responses-model.js';
import { makeOpenAIResponsesModel } from '../src/openai-responses-model.js';
import { makeLocalImageOcr } from '../src/local-image-ocr.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { MessengerCredentialStore } from '../src/messenger-credential-store.js';
import { loadReadOnlyConnectionCredential } from './run-s3m6-reflection-shadow-qualification.mjs';

if (!process.argv.includes('--human-controlled')) throw new Error('--human-controlled is required');
const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const requestedModel = option('--model-id') ?? 'gpt-5.6-terra';
const connectionFile = option('--connection-file')
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
const state = JSON.parse(await readFile(connectionFile, 'utf8'));
const connection = state.connections?.find((item) => item.modelId === requestedModel);
if (!connection) throw new Error('requested model connection is unavailable');
const secretStore = makePlatformSecretStore({ platform: process.platform });
const credential = await loadReadOnlyConnectionCredential({ connection, secretStore });
const room = await mkdtemp(join(tmpdir(), 't5-file-intelligence-human-')); const desktop = join(room, 'Desktop');
const workspace = join(room, 'workspace'); const stateDir = join(room, 'state'); const runtime = join(room, 'runtime');
await Promise.all([desktop, workspace, stateDir, runtime].map((path) => mkdir(path, { recursive: true, mode: 0o700 })));

const svg = (body) => Buffer.from(`<svg width="600" height="800" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="800" fill="#eee"/>${body}</svg>`);
await writeFile(join(desktop, 'KakaoTalk_20260827_193010.png'), await sharp(svg('<rect width="600" height="800" fill="white"/><text x="55" y="130" font-family="sans-serif" font-size="58" font-weight="700">한빛상사</text><text x="55" y="240" font-family="sans-serif" font-size="44">견적 금액 4,780,000원</text>')).png().toBuffer());
await writeFile(join(desktop, 'KakaoTalk_a.png'), await sharp(svg('<rect x="80" y="120" width="440" height="520" fill="#5577aa"/>')).png().toBuffer());
await writeFile(join(desktop, 'KakaoTalk_b.png'), await sharp(svg('<rect width="600" height="800" fill="white"/><ellipse cx="300" cy="300" rx="130" ry="170" fill="#e8b98e"/><path d="M165 260 Q300 65 435 260" fill="#222"/><path d="M100 800 Q130 520 300 520 Q470 520 500 800" fill="#333"/>')).png().toBuffer());
await writeFile(join(desktop, 'KakaoTalk_c.png'), await sharp(svg('<circle cx="300" cy="400" r="220" fill="#55aa66"/>')).png().toBuffer());

const helper = join(runtime, 't5-visual-helper'); const run = promisify(execFile);
await run('xcrun', ['swiftc', '-O', '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'Vision',
  new URL('../native/docx-page-renderer.swift', import.meta.url).pathname, '-o', helper], { timeout: 60_000, maxBuffer: 1024 * 1024 });
const observations = [];
const endpoint = credential.kind === 'api_key' ? 'https://api.openai.com/v1/responses' : 'https://chatgpt.com/backend-api/codex/responses';
const credentialValues = [credential.secret.key, credential.secret.access, credential.secret.accountId].filter(Boolean);
const fetchImpl = async (url, options = {}) => {
  const body = String(options.body ?? ''); if (String(url) !== endpoint || credentialValues.some((value) => body.includes(value))) throw new Error('provider boundary');
  observations.push({ requestBytes: Buffer.byteLength(body) });
  return fetch(url, { ...options, signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(60_000)]) });
};
const instructions = consoleInstructions(workspace, { platform: 'darwin', architecture: process.arch,
  commandFamily: 'posix', commandProgram: '/bin/zsh' });
const model = credential.kind === 'api_key'
  ? makeOpenAIResponsesModel({ apiKey: credential.secret.key, model: credential.modelId, endpoint, fetchImpl, instructions, reasoningEffort: 'medium' })
  : makeChatGptResponsesModel({ model: credential.modelId, endpoint, fetchImpl, maxAttempts: 1, instructions,
    credentials: { async get() { return { access: credential.secret.access, accountId: credential.secret.accountId,
      expiresAt: credential.secret.expiresAt, modelId: credential.modelId }; } } });
const computer = discoverComputerEnvironment({ userHome: room });
const server = makeConsoleServer({ stateDir, workspace, computerEnvironment: computer, computerFileRoots: [desktop],
  fileOcrProbe: makeLocalImageOcr({ platform: 'darwin', helper }), modelFactory: () => model,
  modelStatus: () => ({ connected: true, provider: credential.provider, modelId: credential.modelId }),
  learningReviewMode: 'off', messengerCredentialStore: new MessengerCredentialStore(join(stateDir, 'messenger')),
  onError: (error) => console.error('[file-intelligence-human]', error?.message ?? error) });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(option('--port') ?? 0), '127.0.0.1', resolve); });
const url = `http://127.0.0.1:${server.address().port}`;
console.log(JSON.stringify({ url, model: credential.modelId, fixtureRoot: room, realUserFilesRead: 0, externalWrites: 0,
  prompts: ['바탕화면에서 카카오로 받은 한빛상사 478만원 견적 사진 찾아줘',
    '바탕화면에서 여권사진처럼 보이는 파일 찾아줘. 사람 신원은 추정하지 말고 파일만 골라줘.'] }, null, 2));
if (!process.argv.includes('--no-open')) spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
let stopping = false; const stop = async () => { if (stopping) return; stopping = true; server.closeWakeStreams(); server.closeModelConnections();
  await server.managedProcesses.stopAll('human_console_shutdown').catch(() => {}); await new Promise((resolve) => server.close(resolve));
  if (!process.argv.includes('--keep-fixture')) await rm(room, { recursive: true, force: true }); process.exit(0); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
