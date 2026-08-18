#!/usr/bin/env node
import { existsSync } from 'node:fs';

const facts = {
  isolated: process.env.T5_REFOUNDATION_ISOLATED === '1',
  home: process.env.HOME,
  data: process.env.T5_REFOUNDATION_DATA_DIR,
  workspace: process.env.T5_REFOUNDATION_WORKSPACE,
  pathsExist: [
    process.env.HOME,
    process.env.T5_REFOUNDATION_DATA_DIR,
    process.env.T5_REFOUNDATION_WORKSPACE,
  ].every((path) => path && existsSync(path)),
  credentialSignals: Object.keys(process.env).filter((name) => (
    /(TOKEN|KEY|SECRET|PASSWORD|PASSCODE|CREDENTIAL|COOKIE|AUTH|SESSION|ACCOUNT)/i.test(name)
  )),
};

console.log(JSON.stringify(facts, null, 2));
if (!facts.isolated || !facts.pathsExist || facts.credentialSignals.length) process.exit(1);
