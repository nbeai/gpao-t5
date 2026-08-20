import { readFile } from 'node:fs/promises';
import { normalizeWebUrl } from './web-read-tool.js';

const REFERENCES = new Set(['live_reference', 'format_fixture']);
const STATES = new Set(['identified', 'not_content']);
const CONTENT_TYPES = new Set(['video', 'short_video', 'profile']);
const CAPTION_STATES = new Set(['available', 'absent', 'not_measured', 'not_applicable']);
const CAPTION_SOURCES = new Set(['manual', 'automatic']);
const AUTHORITIES = new Set(['manual_public_measurement', 'official_format_documentation']);
const OBSERVATION_FIELDS = [
  'identity', 'title', 'description', 'captionTrack', 'captionText', 'audio', 'frames', 'ocr',
];

function clone(value) { return structuredClone(value); }
function text(value, label) { const result = String(value ?? '').trim(); if (!result) throw new Error(`${label} is required`); return result; }
function isoDate(value) { const result = new Date(value); if (!Number.isFinite(result.getTime())) throw new Error('invalid observedAt'); return result.toISOString(); }

export async function loadVideoTextBaseline(input) {
  const raw = typeof input === 'string' ? JSON.parse(await readFile(input, 'utf8')) : clone(input);
  if (raw?.schema !== 't5.video-text-baseline.v1' || raw.platform !== 'youtube' || !Array.isArray(raw.cases)) {
    throw new Error('invalid video text baseline schema');
  }
  if (raw.scope?.purpose !== 'video_identity_and_caption_truth'
    || raw.scope?.representativeOfUsers !== false
    || raw.scope?.analysisTargetsComeFrom !== 'current_user_business_taste_goal_and_request') {
    throw new Error('video text baseline must not claim to represent user interests');
  }
  const ids = new Set(); const urls = new Set();
  for (const item of raw.cases) {
    item.caseId = text(item.caseId, 'caseId');
    if (ids.has(item.caseId)) throw new Error('duplicate video text caseId');
    ids.add(item.caseId);
    if (!REFERENCES.has(item.referenceType)) throw new Error('invalid video text reference type');
    item.inputUrl = normalizeWebUrl(item.inputUrl);
    if (urls.has(item.inputUrl)) throw new Error('duplicate video text input URL');
    urls.add(item.inputUrl);
    if (!STATES.has(item.expected?.state) || !CONTENT_TYPES.has(item.expected?.contentType)) {
      throw new Error('invalid video text expected state');
    }
    const caption = item.expected.caption;
    if (!caption || !CAPTION_STATES.has(caption.state) || !Array.isArray(caption.sources)
      || caption.sources.some((source) => !CAPTION_SOURCES.has(source))
      || new Set(caption.sources).size !== caption.sources.length) {
      throw new Error('invalid caption expectation');
    }
    if (item.expected.state === 'identified') {
      item.expected.videoId = text(item.expected.videoId, 'videoId');
      item.expected.canonicalUrl = normalizeWebUrl(item.expected.canonicalUrl);
      if (caption.state === 'not_applicable') throw new Error('identified video caption cannot be not_applicable');
    } else if (item.expected.videoId != null || item.expected.canonicalUrl != null
      || caption.state !== 'not_applicable') throw new Error('non-content case cannot claim video identity');
    if (caption.state === 'available') {
      if (!caption.sources.length || !CAPTION_SOURCES.has(caption.preferredSource)
        || !caption.sources.includes(caption.preferredSource)) throw new Error('available caption source is invalid');
      caption.language = text(caption.language, 'caption language');
    } else if (caption.sources.length || caption.preferredSource != null || caption.language != null) {
      throw new Error('unavailable caption cannot claim source or language');
    }
    if (item.referenceType === 'live_reference' && !['available', 'absent'].includes(caption.state)) {
      throw new Error('live video reference must measure caption availability');
    }
    if (!AUTHORITIES.has(item.groundTruth?.authority)) throw new Error('invalid video text ground-truth authority');
    if (item.groundTruth.referenceUrl != null) item.groundTruth.referenceUrl = normalizeWebUrl(item.groundTruth.referenceUrl);
    item.groundTruth.observedAt = isoDate(item.groundTruth.observedAt);
  }
  return Object.freeze({
    schema: raw.schema, platform: raw.platform, scope: Object.freeze({ ...raw.scope }),
    cases: Object.freeze(raw.cases.map(Object.freeze)),
  });
}

export function videoTextBaselineReadiness(baseline) {
  const live = baseline.cases.filter((item) => item.referenceType === 'live_reference');
  const liveAvailable = live.filter((item) => item.expected.caption.state === 'available').length;
  const liveAbsent = live.filter((item) => item.expected.caption.state === 'absent').length;
  const sources = new Set(live.flatMap((item) => item.expected.caption.sources));
  const gaps = [];
  if (liveAvailable < 1) gaps.push('no live caption-available reference');
  if (liveAbsent < 1) gaps.push('no live caption-absent reference');
  if (!sources.has('manual')) gaps.push('no manual caption reference');
  if (!sources.has('automatic')) gaps.push('no automatic caption reference');
  if (!baseline.cases.some((item) => new URL(item.inputUrl).hostname === 'youtu.be')) gaps.push('no short-link fixture');
  if (!baseline.cases.some((item) => new URL(item.inputUrl).pathname.startsWith('/shorts/'))) gaps.push('no Shorts URL fixture');
  if (!baseline.cases.some((item) => item.expected.state === 'not_content')) gaps.push('no not-content boundary');
  return {
    schema: 't5.video-text-baseline-readiness.v1', ready: gaps.length === 0,
    cases: baseline.cases.length, liveAvailable, liveAbsent,
    manualAvailable: sources.has('manual'), automaticAvailable: sources.has('automatic'),
    userRepresentativenessClaimed: false, gaps,
  };
}

export function assessVideoTextObservations(baseline, observations = []) {
  const byId = new Map(observations.map((item) => [item.caseId, item]));
  const rows = baseline.cases.map((expected) => {
    const actual = byId.get(expected.caseId);
    const observed = Array.isArray(actual?.observed) ? actual.observed : [];
    const missing = Array.isArray(actual?.missing) ? actual.missing : [];
    const captionExpected = expected.expected.caption;
    const captionTruth = captionExpected.state === 'available'
      ? ['identity', 'captionTrack', 'captionText'].every((field) => observed.includes(field))
      : captionExpected.state === 'absent'
        ? observed.includes('identity') && !observed.some((field) => ['captionTrack', 'captionText'].includes(field))
          && ['captionTrack', 'captionText'].every((field) => missing.includes(field))
        : true;
    const checks = {
      observed: Boolean(actual),
      state: actual?.state === expected.expected.state,
      contentType: actual?.contentType === expected.expected.contentType,
      videoId: (actual?.videoId ?? null) === expected.expected.videoId,
      canonicalUrl: (actual?.canonicalUrl ?? null) === expected.expected.canonicalUrl,
      captionState: actual?.captionState === captionExpected.state,
      selectedSource: (actual?.selectedSource ?? null) === captionExpected.preferredSource,
      language: (actual?.language ?? null) === captionExpected.language,
      coverageDisjoint: Array.isArray(actual?.observed) && Array.isArray(actual?.missing)
        && !observed.some((field) => missing.includes(field)),
      noUnsupportedClaims: observed.every((field) => OBSERVATION_FIELDS.includes(field)),
      captionTruth,
    };
    return { caseId: expected.caseId, checks, passed: Object.values(checks).every(Boolean) };
  });
  return {
    schema: 't5.video-text-baseline-assessment.v1', rows,
    passed: rows.every((row) => row.passed),
    missingCaseIds: baseline.cases.filter((item) => !byId.has(item.caseId)).map((item) => item.caseId),
  };
}
