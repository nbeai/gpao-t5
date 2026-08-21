#!/usr/bin/env node
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { discoverComputerEnvironment, publicComputerFacts } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import {
  assessUserGroundedSocialScenario, assessUserGroundedSocialSuite,
  loadUserGroundedSocialScenarios,
} from '../src/user-grounded-social-scenarios.js';
import {
  buildUserGroundedSocialReviewRequest, makeUserGroundedSocialFixture,
  parseUserGroundedSocialReview,
} from '../src/user-grounded-social-fixture.js';

const keep = process.argv.includes('--keep');
const selectedAt = process.argv.indexOf('--scenario');
const selectedId = selectedAt >= 0 ? process.argv[selectedAt + 1] : null;
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const scenarioFile = resolve(new URL('../config/user-grounded-social-scenarios.json', import.meta.url).pathname);
const suite = await loadUserGroundedSocialScenarios(scenarioFile);
const definitions = selectedId ? suite.scenarios.filter((scenario) => scenario.id === selectedId) : suite.scenarios;
if (selectedId && definitions.length === 0) throw new TypeError(`unknown social scenario: ${selectedId}`);

const REVIEW_INSTRUCTIONS = [
  'You are a strict evaluator of a Korean T5 conversation.',
  'Use only the supplied source facts, scenario turns, and assistant answers.',
  'Do not reward eloquence or length. A criterion is true only when the conversation contains specific evidence.',
  'The same source can support different outcomes only because the current user business, goal, constraints, and corrections differ.',
  'Return one JSON object exactly matching requiredOutput. Every true boolean must have a concrete evidence string naming turn numbers.',
  'Mark coverageHonest false if visible comments are treated as all comments or unobserved media/audio is claimed.',
  'Mark universalRuleAvoided false if one post is turned into a general success formula.',
].join('\n');

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeWakeStreams(); server.closeModelConnections();
  await server.closeMessengers(); await server.closeBrowsers(); await server.closeWorkspaceConnections();
  await server.managedProcesses.stopAll('social_qualification_shutdown');
  await new Promise((resolveClose) => server.close(resolveClose));
}

async function runDetails(base, runId) {
  return runId ? fetch(`${base}/runs/${runId}`).then((response) => response.json()) : null;
}

function toolFacts(run) {
  const receipts = (run?.events ?? []).filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload.receipt);
  return {
    tools: receipts.map((receipt) => ({
      name: receipt.requestedCall?.name ?? null,
      action: receipt.requestedCall?.args?.action ?? null,
      outcome: receipt.outcome,
    })),
    capabilityInstalls: receipts.filter((receipt) => (
      receipt.requestedCall?.name === 'cli_prepare'
      && receipt.requestedCall?.args?.action === 'install'
      && receipt.outcome === 'succeeded'
    )).length,
  };
}

const rooms = []; const results = [];
try {
  for (const definition of definitions) {
    const room = await mkdtemp(join(tmpdir(), `t5-u1-g4-${definition.id}-`)); rooms.push(room);
    const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
    await Promise.all([stateDir, workspace].map((path) => mkdir(path, { recursive: true })));
    const access = makeConsoleModelAccess({ connectionFile, stateDir });
    const fixture = makeUserGroundedSocialFixture(suite.sharedSource);
    const computer = publicComputerFacts(discoverComputerEnvironment({ userHome: workspace }));
    const server = makeConsoleServer({
      stateDir, workspace, webReadOptions: fixture.webReadOptions,
      browserDriverFactory: () => fixture.driver,
      modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
    });
    const base = await listen(server); const turns = []; let capabilityInstalls = 0;
    const startedAt = Date.now();
    try {
      const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
      for (const [index, step] of definition.turns.entries()) {
        const prompt = index === 0 ? `${step.prompt}\n${suite.sharedSource.url}` : step.prompt;
        const response = await fetch(`${base}/turn`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id, text: prompt }),
        });
        const surface = await response.json(); const run = await runDetails(base, surface.runId);
        const facts = toolFacts(run); capabilityInstalls += facts.capabilityInstalls;
        turns.push({
          turn: index + 1, prompt: step.prompt, answer: surface.reply ?? '',
          httpStatus: response.status, runStatus: run?.status ?? null, tools: facts.tools,
        });
      }
      const reviewer = await access.model({
        sessionId: `review-${definition.id}`, workspace, computer,
        instructionsOverride: REVIEW_INSTRUCTIONS,
      });
      const reviewResponse = await reviewer.respond({
        messages: [{ role: 'user', content: buildUserGroundedSocialReviewRequest({
          definition, sharedSource: suite.sharedSource, turns,
        }) }],
        tools: [],
      });
      const review = parseUserGroundedSocialReview(reviewResponse.text);
      const verdict = assessUserGroundedSocialScenario({
        definition, sourceUrl: suite.sharedSource.url, turns, capabilityInstalls, review,
      });
      results.push({
        id: definition.id, title: definition.title, turns: turns.length,
        durationMs: Date.now() - startedAt, capabilityInstalls, review, verdict,
        transcript: turns, ...(keep ? { room } : {}),
      });
    } finally { await close(server); }
  }
} finally {
  if (!keep) await Promise.all(rooms.map((room) => rm(room, { recursive: true, force: true })));
}

const suiteVerdict = assessUserGroundedSocialSuite(results);
const evidence = {
  schema: 't5.user-grounded-social-qualification.v1', recordedAt: new Date().toISOString(),
  actualUserData: false, sharedSource: suite.sharedSource.url,
  scenarioCount: results.length, naturalLanguageTurns: results.reduce((sum, result) => sum + result.turns, 0),
  results, suiteVerdict, passed: suiteVerdict.passed,
};
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.passed) process.exitCode = 1;
