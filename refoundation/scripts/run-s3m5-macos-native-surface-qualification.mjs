import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

import { makeMacOSMemoryPlatformAdapter } from '../src/macos-memory-platform-adapter.js';
import { makeMacOSSpotlightDriver } from '../src/macos-spotlight-driver.js';
import { deriveNativeSearchProjection, reconcileNativeSearch } from '../src/memory-platform-adapter.js';

if (process.platform !== 'darwin') throw new Error('macOS is required');
const helper = process.env.T5_SPOTLIGHT_HELPER;
if (!helper) throw new Error('T5_SPOTLIGHT_HELPER is required');

const qualificationId = `qualification-${randomUUID()}`;
const identifier = `t5.memory.${qualificationId}`;
const domain = 't5.life-continuity.memory';
const driver = makeMacOSSpotlightDriver({ helper, indexName: 'T5LifeContinuityQualification' });
const adapter = makeMacOSMemoryPlatformAdapter({ search: driver });
const claim = (value, status = 'active', revision = 1, sensitivity = 'normal', suffix = '') => ({
  memoryId: `${qualificationId}${suffix}`, kind: 'fact', subjectKey: 'qualification', value, status,
  subjectRevision: revision, recordedAt: new Date().toISOString(), sensitivity, sources: [],
});

async function settle(state) {
  const started = process.hrtime.bigint(); let result = null; let attempts = 0;
  for (; attempts < 30; attempts += 1) {
    result = await reconcileNativeSearch({ state, adapter });
    if (result.state === 'verified') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { ...result, attempts: attempts + 1,
    durationNs: String(process.hrtime.bigint() - started) };
}

const report = {
  schema: 't5.s3-m5-macos-native-surface-qualification.v1',
  observedAt: new Date().toISOString(), platform: 'macos', helper: basename(helper),
  fixture: { synthetic: true, userData: false, qualificationId },
  coreSpotlight: null,
  eventKit: {
    actualWriteExecuted: false,
    reason: 'EventKit actual write requires the signed installed product, explicit permission, and an isolated non-sync calendar in M7.',
    calendarWrites: 0, reminderWrites: 0,
  },
};

try {
  const available = await driver.available();
  const blockedProjection = deriveNativeSearchProjection({ state: { claims: [
    claim('personal fixture', 'active', 1, 'personal', '-personal'),
    claim('private fixture', 'active', 1, 'private', '-private'),
    claim('secret fixture', 'active', 1, 'secret_ref', '-secret'),
  ] } });
  const add = await settle({ claims: [claim('T5 Spotlight qualification alpha')] });
  const update = await settle({ claims: [claim('T5 Spotlight qualification beta', 'active', 2)] });
  const remove = await settle({ claims: [claim('T5 Spotlight qualification beta', 'retracted', 2)] });
  report.coreSpotlight = {
    available, add, update, remove,
    blocked: blockedProjection.blocked,
    sensitiveValuesEmittedToDriver: 0,
    onDeviceOnly: true,
  };
} finally {
  await driver.delete([identifier], { domain }).catch(() => {});
  let cleanupItems = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    cleanupItems = await driver.list({ domain }).catch(() => null);
    if (cleanupItems && !cleanupItems.some((item) => item.identifier === identifier)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  report.cleanup = { exactIdentifierAbsent: Array.isArray(cleanupItems)
    && !cleanupItems.some((item) => item.identifier === identifier) };
}

report.pass = report.coreSpotlight?.available === true
  && ['add', 'update', 'remove'].every((key) => report.coreSpotlight[key]?.state === 'verified')
  && report.coreSpotlight.blocked.length === 3
  && report.coreSpotlight.sensitiveValuesEmittedToDriver === 0
  && report.cleanup.exactIdentifierAbsent === true
  && report.eventKit.actualWriteExecuted === false;
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
