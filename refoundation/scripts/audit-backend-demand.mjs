#!/usr/bin/env node
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { assessBackendDemand } from '../src/backend-demand.js';
import { RunLedger } from '../src/run-ledger.js';

const stateDir = resolve(process.env.T5_REFOUNDATION_CONSOLE_STATE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'refoundation-console'));
const runs = await new RunLedger(join(stateDir, 'runs')).list();
console.log(JSON.stringify(assessBackendDemand(runs), null, 2));
