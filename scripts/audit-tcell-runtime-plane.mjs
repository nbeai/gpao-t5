#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function text(path) {
  return readFile(join(ROOT, path), 'utf8');
}

async function jsFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await jsFiles(path));
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(path);
  }
  return out;
}

function countCalls(source, name) {
  const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
  return [...source.matchAll(pattern)].length;
}

export function inspectSources({
  turn,
  admission,
  server,
  productionSources,
}) {
  const sourceWithoutDefinitions = productionSources
    .filter(({ path }) => !path.endsWith('tcell-replay-engine.js')
      && !path.endsWith('tcell-replay.js')
      && !path.endsWith('tcell-store.js'))
    .map(({ source }) => source)
    .join('\n');

  const foregroundBuildsSnapshot = /\bbuildAdmissionSnapshot\s*\(/.test(turn);
  const snapshotReadsDurableStores = /\bsources\.registry\?\.load\?\.\(/.test(admission)
    || /\bsources\.observer\?\.getByRefs\?\.\(/.test(admission)
    || /\bconfirmationStore\s*=\s*await/.test(admission)
    || /\bgrantStore\s*=\s*await/.test(admission);
  const extractionDetached = /queueMicrotask\s*\(\s*\(\)\s*=>\s*\{?\s*원리후보추출/.test(server)
    || /관찰만\s*\(\s*\(\)\s*=>[\s\S]*?\.then\s*\(\s*async[\s\S]*?원리후보추출/.test(server);
  const perSessionExtractionLane = /(?:추출상태|extractionState)\s*=\s*new Map\s*\(/.test(server);
  const globalExtractionLock = /let\s+(?:추출중|extractionRunning)\s*=\s*false/.test(server);
  const rawUserTextInBundle = /activeTarget\s*:\s*input\.text/.test(server)
    || /userText\s*:\s*input\.text/.test(server);

  return {
    foreground: {
      buildsSnapshot: foregroundBuildsSnapshot,
      durableStoreReads: snapshotReadsDurableStores,
      passes: !foregroundBuildsSnapshot && !snapshotReadsDurableStores,
    },
    backgroundExtraction: {
      detachedFromResponse: extractionDetached,
      perSessionLane: perSessionExtractionLane,
      globalLock: globalExtractionLock,
      rawUserTextInBundle,
      passes: extractionDetached && perSessionExtractionLane
        && !globalExtractionLock && !rawUserTextInBundle,
    },
    lifecycle: {
      transitionConsumers: countCalls(sourceWithoutDefinitions, 'transitionCell'),
      replayCaseConsumers: countCalls(sourceWithoutDefinitions, 'makeReplayCase'),
      legacyImportConsumers: countCalls(sourceWithoutDefinitions, 'importLegacyMemory'),
      passes: countCalls(sourceWithoutDefinitions, 'transitionCell') > 0
        && countCalls(sourceWithoutDefinitions, 'makeReplayCase') > 0,
    },
  };
}

export async function inspectRepository() {
  const files = await jsFiles(join(ROOT, 'src'));
  const productionSources = await Promise.all(files.map(async (path) => ({
    path: relative(ROOT, path),
    source: await readFile(path, 'utf8'),
  })));
  return inspectSources({
    turn: await text('src/kernel/turn.js'),
    admission: await text('src/kernel/l1-intent/tcell-admission.js'),
    server: await text('src/surface/server.js'),
    productionSources,
  });
}

function format(report) {
  const rows = [
    ['foreground_no_durable_io', report.foreground.passes,
      `snapshot=${report.foreground.buildsSnapshot} storeReads=${report.foreground.durableStoreReads}`],
    ['background_per_session_lane', report.backgroundExtraction.passes,
      `detached=${report.backgroundExtraction.detachedFromResponse} perSession=${report.backgroundExtraction.perSessionLane} globalLock=${report.backgroundExtraction.globalLock} rawUserText=${report.backgroundExtraction.rawUserTextInBundle}`],
    ['m1_replay_m2_production_lifecycle', report.lifecycle.passes,
      `transitionConsumers=${report.lifecycle.transitionConsumers} replayCaseConsumers=${report.lifecycle.replayCaseConsumers} legacyImportConsumers=${report.lifecycle.legacyImportConsumers}`],
  ];
  return rows.map(([name, pass, detail]) => `${pass ? 'PASS' : 'GAP '} ${name} · ${detail}`).join('\n');
}

if (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))) {
  const report = await inspectRepository();
  process.stdout.write(`${format(report)}\n`);
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (process.argv.includes('--strict')
    && (!report.foreground.passes || !report.backgroundExtraction.passes || !report.lifecycle.passes)) {
    process.exitCode = 1;
  }
}
