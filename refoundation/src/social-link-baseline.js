import { readFile } from 'node:fs/promises';
import { normalizeWebUrl } from './web-read-tool.js';

const PLATFORMS = new Set(['x', 'threads', 'facebook', 'instagram', 'youtube', 'tiktok']);
const REFERENCES = new Set(['live_reference', 'format_fixture']);
const STATES = new Set(['identified', 'redirect_required', 'not_content']);
const CONTENT_TYPES = new Set(['post', 'thread', 'image', 'video', 'short_video', 'profile']);
const AUTHORITIES = new Set(['official_documentation', 'official_format_documentation', 'manual_public_observation']);
const OBSERVATION_FIELDS = ['identity', 'text', 'caption', 'metrics', 'comments', 'subtitle', 'audio', 'frames', 'ocr'];

function clone(value) { return structuredClone(value); }
function requiredText(value, label) { const text = String(value ?? '').trim(); if (!text) throw new Error(`${label} is required`); return text; }
function date(value) { const parsed = new Date(value); if (!Number.isFinite(parsed.getTime())) throw new Error('ground-truth observedAt is invalid'); return parsed.toISOString(); }

export async function loadSocialLinkBaseline(input) {
  const raw = typeof input === 'string' ? JSON.parse(await readFile(input, 'utf8')) : clone(input);
  if (raw?.schema !== 't5.social-link-baseline.v1' || !Array.isArray(raw.cases)) throw new Error('invalid social baseline schema');
  if (!Array.isArray(raw.platforms) || raw.platforms.length !== PLATFORMS.size || raw.platforms.some((item) => !PLATFORMS.has(item))) throw new Error('social baseline platform list is incomplete');
  if (raw.scope?.purpose !== 'platform_identity_and_observation_truth' || raw.scope?.representativeOfUsers !== false
    || raw.scope?.analysisTargetsComeFrom !== 'current_user_business_taste_goal_and_request') {
    throw new Error('social baseline must not claim to represent user interests');
  }
  const ids = new Set(); const urls = new Set();
  for (const item of raw.cases) {
    item.caseId = requiredText(item.caseId, 'caseId'); if (ids.has(item.caseId)) throw new Error('duplicate social baseline caseId'); ids.add(item.caseId);
    if (!PLATFORMS.has(item.platform) || !REFERENCES.has(item.referenceType)) throw new Error('invalid social baseline case classification');
    item.scenario = requiredText(item.scenario, 'scenario'); item.businessDomain = requiredText(item.businessDomain, 'businessDomain');
    item.inputUrl = normalizeWebUrl(item.inputUrl); if (urls.has(item.inputUrl)) throw new Error('duplicate social baseline input URL'); urls.add(item.inputUrl);
    if (!STATES.has(item.expected?.state) || !CONTENT_TYPES.has(item.expected?.contentType)) throw new Error('invalid social baseline expected state');
    if (item.expected.state === 'identified') {
      item.expected.contentId = requiredText(item.expected.contentId, 'contentId');
      item.expected.canonicalUrl = normalizeWebUrl(item.expected.canonicalUrl);
    } else if (item.expected.contentId != null || item.expected.canonicalUrl != null) throw new Error('unidentified social case cannot claim stable identity');
    if (!AUTHORITIES.has(item.groundTruth?.authority)) throw new Error('invalid social baseline ground-truth authority');
    item.groundTruth.referenceUrl = normalizeWebUrl(item.groundTruth.referenceUrl);
    item.groundTruth.observedAt = date(item.groundTruth.observedAt);
    if (item.referenceType === 'live_reference' && !['official_documentation', 'manual_public_observation'].includes(item.groundTruth.authority)) throw new Error('live reference requires observed public ground truth');
  }
  return Object.freeze({ schema: raw.schema, platforms: Object.freeze([...raw.platforms]), scope: Object.freeze({ ...raw.scope }), cases: Object.freeze(raw.cases.map(Object.freeze)) });
}

export function socialBaselineReadiness(baseline) {
  const byPlatform = Object.fromEntries(baseline.platforms.map((platform) => [platform, { total: 0, fixtures: 0, liveReferences: 0, liveIdentifiedContent: 0, states: new Set() }]));
  const domains = new Set();
  for (const item of baseline.cases) {
    const row = byPlatform[item.platform]; row.total += 1; row.states.add(item.expected.state); domains.add(item.businessDomain);
    if (item.referenceType === 'format_fixture') row.fixtures += 1;
    else { row.liveReferences += 1; if (item.expected.state === 'identified') row.liveIdentifiedContent += 1; }
  }
  const gaps = [];
  for (const [platform, row] of Object.entries(byPlatform)) {
    if (row.total < 3) gaps.push(`${platform}: fewer than 3 identity cases`);
    if (!row.states.has('identified')) gaps.push(`${platform}: no identified content case`);
    if (!row.states.has('not_content') && !row.states.has('redirect_required')) gaps.push(`${platform}: no boundary case`);
    if (row.liveIdentifiedContent < 1) gaps.push(`${platform}: no live identified content reference`);
  }
  return {
    schema: 't5.social-link-baseline-readiness.v1', ready: gaps.length === 0,
    cases: baseline.cases.length, byPlatform: Object.fromEntries(Object.entries(byPlatform).map(([key, row]) => [key, { ...row, states: [...row.states].sort() }])),
    sampledContextTags: [...domains].sort(), userRepresentativenessClaimed: false, gaps,
  };
}

export function assessSocialLinkObservations(baseline, observations = []) {
  const byId = new Map(observations.map((item) => [item.caseId, item]));
  const rows = baseline.cases.map((expected) => {
    const actual = byId.get(expected.caseId); const checks = {
      observed: Boolean(actual),
      state: actual?.state === expected.expected.state,
      platform: actual?.platform === expected.platform,
      contentType: actual?.contentType === expected.expected.contentType,
      contentId: (actual?.contentId ?? null) === expected.expected.contentId,
      canonicalUrl: (actual?.canonicalUrl ?? null) === expected.expected.canonicalUrl,
      coverageDisjoint: Array.isArray(actual?.observed) && Array.isArray(actual?.missing)
        && !actual.observed.some((field) => actual.missing.includes(field)),
      noUnsupportedClaims: !Array.isArray(actual?.observed) || actual.observed.every((field) => OBSERVATION_FIELDS.includes(field)),
    };
    return { caseId: expected.caseId, platform: expected.platform, checks, passed: Object.values(checks).every(Boolean) };
  });
  return { schema: 't5.social-link-baseline-assessment.v1', rows, passed: rows.every((row) => row.passed), missingCaseIds: baseline.cases.filter((item) => !byId.has(item.caseId)).map((item) => item.caseId) };
}

export function summarizeSocialWebRead(expected, result = {}) {
  if (!expected || expected.expected?.state !== 'identified') throw new TypeError('identified social baseline case is required');
  const status = Number(result.source?.status);
  const responseReached = Number.isInteger(status) && status >= 200 && status < 300
    && !['failed', 'cancelled', 'blocked', 'login_required', 'rate_limited'].includes(result.state);
  const identityUrls = [result.source?.canonicalUrl, result.source?.finalUrl]
    .filter((value) => typeof value === 'string');
  const identityObserved = responseReached && identityUrls.some((value) => {
    try { return decodeURIComponent(new URL(value).href).includes(expected.expected.contentId); } catch { return false; }
  });
  const textObserved = typeof result.content?.text === 'string' && result.content.text.trim().length > 0;
  const observed = [];
  if (identityObserved) observed.push('identity');
  if (textObserved) observed.push('text');
  return {
    caseId: expected.caseId,
    platform: expected.platform,
    webReadState: String(result.state ?? 'unknown'),
    reason: result.reason == null ? null : String(result.reason),
    status: Number.isInteger(status) ? status : null,
    finalUrl: typeof result.source?.finalUrl === 'string' ? result.source.finalUrl : null,
    canonicalUrl: typeof result.source?.canonicalUrl === 'string' ? result.source.canonicalUrl : null,
    title: typeof result.source?.title === 'string' ? result.source.title : null,
    coverageKind: typeof result.source?.coverage?.kind === 'string' ? result.source.coverage.kind : null,
    observedChars: textObserved ? Number(result.content.totalChars ?? result.content.text.length) : 0,
    outputTruncated: Boolean(result.content?.truncated),
    identityObserved,
    observed,
    missing: OBSERVATION_FIELDS.filter((field) => !observed.includes(field)),
  };
}
