#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  buildChatGptAuthorizeUrl, createPkce, exchangeChatGptCode,
  saveChatGptOAuthConnection, startChatGptCallback,
} from '../src/chatgpt-oauth-login.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const port = 1455;
const modelId = option('--model') ?? 'gpt-5.5';
const file = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
const pkce = createPkce();
const callback = startChatGptCallback({ state: pkce.state, port });
await callback.listening;
const authorizeUrl = buildChatGptAuthorizeUrl({ ...pkce, port });

try {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [authorizeUrl], {
    stdio: 'ignore', detached: true, shell: process.platform === 'win32',
  }).unref();
  console.log('브라우저에서 ChatGPT 로그인과 연결 승인을 완료해 주세요.');
  const code = await callback.waitForCode;
  const credential = await exchangeChatGptCode({ code, verifier: pkce.verifier, port });
  const status = await saveChatGptOAuthConnection({ file, credential, modelId });
  console.log(JSON.stringify(status, null, 2));
} catch (error) {
  console.error(`ChatGPT 연결을 완료하지 못했습니다: ${error?.message ?? error}`);
  process.exitCode = 1;
} finally {
  callback.cancel();
}
