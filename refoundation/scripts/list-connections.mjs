#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';

import { makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';

const file = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
try {
  const connections = await makeStoredModelCredentialCatalog({ file }).list();
  console.log(JSON.stringify({ available: connections.length > 0, connections }, null, 2));
} catch (error) {
  console.error(`연결 상태를 읽지 못했습니다: ${error?.message ?? error}`);
  process.exit(1);
}
