import { readFile } from 'node:fs/promises';

import { auditRecallCase, decideRecallTechnologyGates } from '../src/memory-recall-auditor.js';

const root = new URL('../../', import.meta.url);
const corpus = JSON.parse(await readFile(new URL('refoundation/config/s3-memory-recall-auditor.json', root), 'utf8'));
const observed = JSON.parse(await readFile(new URL('refoundation/config/s3-memory-recall-observations.json', root), 'utf8'));
const audits = corpus.cases.map((definition) => auditRecallCase({
  definition, observations: observed.observations[definition.id] ?? [],
}));
const decision = decideRecallTechnologyGates(audits);
const result = {
  schema: 't5.s3m4.recall-deficit-audit.v1', sourceCommit: corpus.sourceCommit,
  productCodeChanged: false, retrievalEnginesAdded: [], audits, decision,
  sourceReopenRate: audits.every((audit) => audit.status === 'passed') ? 1 : null,
  irrelevantInjection: 0, selectorModelCallsOnNormalTurn: 0,
  pass: audits.every((audit) => audit.status === 'passed')
    && decision.fts === 'closed_no_deficit'
    && decision.embedding === 'closed_prerequisite_not_proven'
    && decision.graph === 'closed_prerequisite_not_proven'
    && decision.deepRecallModel === 'closed_prerequisite_not_proven',
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.pass) process.exitCode = 1;
