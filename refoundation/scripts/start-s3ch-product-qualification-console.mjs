#!/usr/bin/env node
import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

import { CoarseAppActivityLedger } from '../src/coarse-app-activity-ledger.js';
import { makeCoarseAppActivityService } from '../src/coarse-app-activity-service.js';
import { makeMacOSCoarseAppAdapter } from '../src/coarse-app-activity-platform-adapters.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makeMacOSFSEventsAdapter } from '../src/file-activity-platform-adapters.js';
import { ScopedFileActivityLedger } from '../src/scoped-file-activity-ledger.js';
import { makeScopedFileActivityService } from '../src/scoped-file-activity-service.js';

function required(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required`);
  return resolve(value);
}

const stateDir = required('T5_CH_QUALIFICATION_STATE');
const workspace = required('T5_CH_QUALIFICATION_WORKSPACE');
const selectedRoot = required('T5_CH_QUALIFICATION_FILE_ROOT');
const fileHelper = required('T5_CH_QUALIFICATION_FILE_HELPER');
const appHelper = process.env.T5_CH_QUALIFICATION_APP_HELPER
  ? resolve(process.env.T5_CH_QUALIFICATION_APP_HELPER) : null;
const portFile = process.env.T5_CH_QUALIFICATION_PORT_FILE
  ? resolve(process.env.T5_CH_QUALIFICATION_PORT_FILE) : null;
await Promise.all([stateDir, workspace, selectedRoot].map((path) => mkdir(path, { recursive: true })));
await access(fileHelper, constants.X_OK); if (appHelper) await access(appHelper, constants.X_OK);

const fileLedger = new ScopedFileActivityLedger(resolve(stateDir, 'file-activity'));
const fileService = makeScopedFileActivityService({ ledger: fileLedger,
  adapterFactory: async () => makeMacOSFSEventsAdapter({ helper: fileHelper, ledger: fileLedger }) });
const appLedger = new CoarseAppActivityLedger(resolve(stateDir, 'app-activity'));
const appService = makeCoarseAppActivityService({ ledger: appLedger,
  adapterFactory: appHelper ? async () => makeMacOSCoarseAppAdapter({ helper: appHelper, ledger: appLedger }) : null });

const server = makeConsoleServer({ stateDir, workspace, learningReviewMode: 'off',
  modelFactory: () => ({ async respond() { return { type: 'reply', text: 'qualification only' }; } }),
  fileActivityService: fileService, fileActivityRootSelector: async () => selectedRoot,
  appActivityService: appService,
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
});
const state = { schema: 't5.s3ch.product-qualification-console.v1', port: server.address().port,
  pid: process.pid, selectedRoot, appAvailable: Boolean(appHelper) };
if (portFile) await writeFile(portFile, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
process.stdout.write(`${JSON.stringify(state)}\n`);

let stopping = false;
async function stop() {
  if (stopping) return; stopping = true; server.closeWakeStreams();
  await Promise.all([server.closeFileActivity(), server.closeAppActivity(), server.managedProcesses.stopAll('qualification_shutdown')]);
  await new Promise((resolveClose) => server.close(resolveClose)); process.exit(0);
}
process.once('SIGINT', stop); process.once('SIGTERM', stop);
