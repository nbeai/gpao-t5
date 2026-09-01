import { parseHTML } from 'linkedom';

const MAX_PAGES = 12;
const MAX_FIELDS = 20;
const MAX_RECORDS = 2_000;
const MAX_PAGE_BYTES = 4_000_000;

function compact(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
}

function exactUrl(value) {
  let url;
  try { url = new URL(String(value ?? '')); } catch { throw new TypeError('collection URL is invalid'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new TypeError('collection URL must be an exact public HTTP URL without credentials or fragment');
  }
  return url;
}

export function qualifyWebCollectionSpec(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || input.schema !== 't5.web-collection-spec.v1') throw new TypeError('collection spec is invalid');
  const urls = [...new Set((input.urls ?? []).map((value) => exactUrl(value).href))];
  if (!urls.length || urls.length > MAX_PAGES) throw new TypeError('collection page count is invalid');
  const origin = new URL(urls[0]).origin;
  if (urls.some((value) => new URL(value).origin !== origin)) throw new TypeError('collection URLs must share one exact origin');
  const itemSelector = compact(input.itemSelector);
  if (!itemSelector || itemSelector.length > 300) throw new TypeError('item selector is invalid');
  const fields = (input.fields ?? []).map((field) => {
    const key = compact(field?.key); const selector = compact(field?.selector);
    const source = field?.source ?? 'text'; const attribute = field?.attribute == null ? null : compact(field.attribute);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key) || !selector || selector.length > 300
      || !['text', 'attribute'].includes(source)
      || (source === 'attribute' && !/^[A-Za-z_:][A-Za-z0-9_.:-]{0,63}$/u.test(attribute ?? ''))) {
      throw new TypeError('collection field is invalid');
    }
    return Object.freeze({ key, selector, source, attribute, required: field?.required === true });
  });
  if (!fields.length || fields.length > MAX_FIELDS || new Set(fields.map((field) => field.key)).size !== fields.length) {
    throw new TypeError('collection fields are invalid');
  }
  const uniqueBy = [...new Set((input.uniqueBy ?? []).map(compact))];
  if (uniqueBy.some((key) => !fields.some((field) => field.key === key))) {
    throw new TypeError('collection unique keys are invalid');
  }
  const expected = input.expectedRecords ?? {};
  const minimum = expected.minimum == null ? 0 : Number(expected.minimum);
  const maximum = expected.maximum == null ? MAX_RECORDS : Number(expected.maximum);
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum)
    || minimum < 0 || maximum < Math.max(1, minimum) || maximum > MAX_RECORDS) {
    throw new TypeError('collection expected record range is invalid');
  }
  return Object.freeze({ schema: input.schema, urls: Object.freeze(urls), origin, itemSelector,
    fields: Object.freeze(fields), uniqueBy: Object.freeze(uniqueBy),
    expectedRecords: Object.freeze({ minimum, maximum }) });
}

function valueFrom(item, field) {
  let target;
  try { target = item.querySelector(field.selector); }
  catch { throw new TypeError('collection selector is invalid'); }
  if (!target) return '';
  return compact(field.source === 'attribute'
    ? target.getAttribute(field.attribute) ?? '' : target.textContent ?? '');
}

export async function runBoundedWebCollection({ spec: rawSpec, fetchPage, signal = null } = {}) {
  const spec = qualifyWebCollectionSpec(rawSpec);
  if (typeof fetchPage !== 'function') throw new TypeError('collection fetcher is required');
  const pages = []; const records = []; const missingByField = Object.fromEntries(spec.fields.map((field) => [field.key, 0]));
  for (let pageIndex = 0; pageIndex < spec.urls.length; pageIndex += 1) {
    if (signal?.aborted) return { state: 'cancelled', verified: false, pages, records: [],
      coverage: { requestedPages: spec.urls.length, observedPages: pages.length } };
    const requestedUrl = spec.urls[pageIndex];
    let observed;
    try { observed = await fetchPage({ url: requestedUrl, pageIndex, signal }); }
    catch (error) { observed = { state: 'failed', reason: error?.message ?? String(error) }; }
    const finalUrl = observed?.finalUrl ? exactUrl(observed.finalUrl).href : requestedUrl;
    const bytes = Number(observed?.bytes ?? Buffer.byteLength(String(observed?.html ?? '')));
    const readable = observed?.state === 'read' && typeof observed.html === 'string'
      && bytes >= 0 && bytes <= MAX_PAGE_BYTES && new URL(finalUrl).origin === spec.origin;
    const page = { index: pageIndex + 1, requestedUrl, finalUrl,
      state: readable ? 'read' : 'failed', bytes,
      ...(!readable && observed?.state === 'read' ? { reason: new URL(finalUrl).origin !== spec.origin
        ? 'collection_origin_changed' : 'collection_response_invalid' }
        : observed?.reason ? { reason: String(observed.reason) } : {}) };
    pages.push(page);
    if (!readable) continue;
    const { document } = parseHTML(observed.html); let items;
    try { items = [...document.querySelectorAll(spec.itemSelector)]; }
    catch { throw new TypeError('collection item selector is invalid'); }
    page.itemCount = items.length;
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      if (records.length >= MAX_RECORDS) break;
      const values = {};
      for (const field of spec.fields) {
        values[field.key] = valueFrom(items[itemIndex], field);
        if (!values[field.key]) missingByField[field.key] += 1;
      }
      records.push({ ...values, source: { page: pageIndex + 1, url: finalUrl, item: itemIndex + 1 } });
    }
  }
  const duplicateIndexes = [];
  if (spec.uniqueBy.length) {
    const seen = new Map();
    for (let index = 0; index < records.length; index += 1) {
      const key = JSON.stringify(spec.uniqueBy.map((field) => records[index][field]));
      if (seen.has(key)) duplicateIndexes.push(index); else seen.set(key, index);
    }
  }
  const requiredMissing = spec.fields.filter((field) => field.required)
    .reduce((sum, field) => sum + missingByField[field.key], 0);
  const observedPages = pages.filter((page) => page.state === 'read').length;
  const rangeSatisfied = records.length >= spec.expectedRecords.minimum
    && records.length <= spec.expectedRecords.maximum;
  const verified = observedPages === spec.urls.length && rangeSatisfied
    && requiredMissing === 0 && duplicateIndexes.length === 0;
  return { state: verified ? 'verified_collection' : records.length ? 'partial_collection' : 'collection_failed',
    verified, records, pages, fields: spec.fields.map((field) => field.key),
    coverage: { requestedPages: spec.urls.length, observedPages, complete: observedPages === spec.urls.length,
      expectedRecords: spec.expectedRecords, observedRecords: records.length, rangeSatisfied },
    validation: { missingByField, requiredMissing, duplicateCount: duplicateIndexes.length,
      duplicateIndexes, recordLimitReached: records.length >= MAX_RECORDS },
    network: { origin: spec.origin, requestCount: pages.length, bounded: true },
    trust: 'untrusted_external', instructionAuthority: 'none' };
}
