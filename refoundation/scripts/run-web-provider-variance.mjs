#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeBingSearchProvider } from '../src/bing-search-provider.js';
import { makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';
import { makeDuckDuckGoSearchProvider } from '../src/duckduckgo-search-provider.js';
import { makeNaverSearchProvider } from '../src/naver-search-provider.js';
import { makeStoredOpenAIWebSearchProvider } from '../src/openai-web-search-provider.js';
import { rankedCandidateAgreement } from '../src/web-variance-analysis.js';

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const repeatCount = Number(option('--repeats') ?? 3);
if (!Number.isInteger(repeatCount) || repeatCount < 2 || repeatCount > 5) throw new TypeError('--repeats must be 2 to 5');
const providerFilter = option('--providers')?.split(',').map((value) => value.trim()).filter(Boolean) ?? null;
const taskFilter = option('--tasks')?.split(',').map((value) => value.trim()).filter(Boolean) ?? null;
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const probes = JSON.parse(await readFile(new URL('../config/w9-web-variance-probes.json', import.meta.url), 'utf8'));
const credentialCatalog = makeStoredModelCredentialCatalog({ file: connectionFile });
const providers = [
  makeStoredOpenAIWebSearchProvider({ credentialCatalog }), makeNaverSearchProvider(),
  makeDuckDuckGoSearchProvider(), makeBingSearchProvider(),
].filter((provider) => !providerFilter || providerFilter.includes(provider.id));
const tasks = probes.tasks.filter((task) => !taskFilter || taskFilter.includes(task.id));
const results = [];
for (const provider of providers) {
  const availability = await provider.available().catch((error) => ({ available: false, reason: error?.message ?? String(error) }));
  if (availability?.available !== true) {
    results.push({ provider: provider.id, available: false, reason: availability?.reason ?? 'unavailable', tasks: [] });
    continue;
  }
  const taskResults = [];
  for (const task of tasks) {
    const queries = [];
    for (const query of task.queries) {
      const runs = [];
      for (let repeat = 1; repeat <= repeatCount; repeat += 1) {
        process.stderr.write(`[w9-provider] ${provider.id} ${task.id} ${repeat}/${repeatCount}\n`);
        const startedAt = Date.now();
        try {
          const candidates = await provider.search(query, { limit: 8, domains: [] });
          runs.push({ repeat, wallMs: Date.now() - startedAt, candidates: candidates.map((candidate) => ({
            title: candidate.title, url: candidate.url, snippet: String(candidate.snippet ?? '').slice(0, 300),
          })) });
        } catch (error) {
          runs.push({ repeat, wallMs: Date.now() - startedAt, error: error?.message ?? String(error), candidates: [] });
        }
      }
      queries.push({ query, runs, agreement: rankedCandidateAgreement(runs, 8) });
    }
    taskResults.push({ id: task.id, queries });
  }
  results.push({ provider: provider.id, available: true, tasks: taskResults });
}
const evidence = {
  schema: 't5.w9-web-provider-variance.v1', recordedAt: new Date().toISOString(),
  probes: probes.schema, repeatCount, providers: results,
};
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
