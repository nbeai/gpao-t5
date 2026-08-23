#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { makeAttachmentTool } from '../src/attachment-hand.js';
import { AttachmentStore } from '../src/attachment-store.js';
import {
  assessDocumentCompatibilityBaseline, createGeneratedCompatibilityFixtures,
  fetchPinnedCompatibilityFixtures, hashCompatibilityFiles, summarizeCompatibilityObservation,
} from '../src/document-compatibility-baseline.js';

function option(name) {
  const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1];
}

const keep = process.argv.includes('--keep');
const generatedOnly = process.argv.includes('--generated-only');
const evidencePath = option('--evidence') ? resolve(option('--evidence')) : null;
const room = await mkdtemp(join(tmpdir(), 't5-document-compatibility-'));
const corpus = join(room, 'corpus'); const state = join(room, 'state'); const workspace = join(room, 'workspace');
await Promise.all([mkdir(corpus, { recursive: true }), mkdir(state, { recursive: true }), mkdir(workspace, { recursive: true })]);

try {
  const generated = await createGeneratedCompatibilityFixtures(corpus);
  const pinned = generatedOnly ? [] : await fetchPinnedCompatibilityFixtures(corpus);
  const cases = [...generated, ...pinned]; const before = await hashCompatibilityFiles(cases);
  const sessionId = randomUUID(); const store = new AttachmentStore(join(state, 'attachments'));
  const tool = makeAttachmentTool({ store, sessionId, workspace }); const observations = [];

  for (const definition of cases) {
    const record = await store.receive({
      sessionId, originalName: definition.fileName, declaredMime: null,
      bytes: await readFile(definition.path),
    });
    let inspected;
    try {
      inspected = await tool.execute({
        action: 'inspect', attachmentId: record.attachmentId, filePath: null,
        maxChars: 20_000, maxCells: 5_000, maxPages: 20,
      });
    } catch (error) {
      inspected = { state: 'failed', error: String(error?.message ?? error) };
    }
    observations.push({
      ...summarizeCompatibilityObservation(definition, record, inspected),
      ...(inspected.error ? { error: inspected.error } : {}),
    });
  }

  const after = await hashCompatibilityFiles(cases);
  const sourceFilesUnchanged = JSON.stringify(before) === JSON.stringify(after);
  const verdict = assessDocumentCompatibilityBaseline(cases, observations);
  const evidence = {
    schema: 't5.r7-d2-document-compatibility-baseline.v1',
    recordedAt: new Date().toISOString(), actualUserData: false,
    scope: 'current T5 attachment and document hands; no candidate parser enabled',
    corpus: {
      cases: cases.length, generated: generated.length, pinnedPublic: pinned.length,
      licenses: [...new Set(pinned.map((item) => item.license))].sort(),
      sourceCommits: [...new Set(pinned.map((item) => item.sourceCommit))].sort(),
    },
    sourceFilesUnchanged, observations, verdict,
    honestBoundary: {
      doesNotMeasureModelRecoveryViaArbitraryInstalledCli: true,
      doesNotClaimFormatSupportFromIdentificationOnly: true,
      doesNotClaimOcrFromNeedDetection: true,
      doesNotUseProductionCredentialsOrUserDocuments: true,
    },
    room: keep ? room : null,
    passed: sourceFilesUnchanged && verdict.baselineComplete,
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (evidencePath) { await mkdir(dirname(evidencePath), { recursive: true }); await writeFile(evidencePath, serialized, 'utf8'); }
  process.stdout.write(serialized); if (!evidence.passed) process.exitCode = 1;
} finally {
  if (!keep) await rm(room, { recursive: true, force: true });
}
