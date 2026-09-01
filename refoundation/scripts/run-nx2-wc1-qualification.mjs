#!/usr/bin/env node
import { createHash } from 'node:crypto';

import { runBoundedWebCollection } from '../test/helpers/nx2-bounded-web-collector.js';

const urls = [1, 2, 3].map((page) => `https://books.toscrape.com/catalogue/page-${page}.html`);
const spec = { schema: 't5.web-collection-spec.v1', urls,
  itemSelector: 'article.product_pod', fields: [
    { key: 'title', selector: 'h3 a', source: 'attribute', attribute: 'title', required: true },
    { key: 'price', selector: '.price_color', source: 'text', attribute: null, required: true },
    { key: 'stock', selector: '.availability', source: 'text', attribute: null, required: true },
  ], uniqueBy: ['title'], expectedRecords: { minimum: 60, maximum: 60 } };

const startedAt = Date.now();
const result = await runBoundedWebCollection({ spec, fetchPage: async ({ url, signal }) => {
  const timeout = AbortSignal.timeout(20_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, { redirect: 'manual', signal: combined,
    headers: { accept: 'text/html', 'user-agent': 'GPAO-T5 WC-1 qualification' } });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { state: response.status === 200 ? 'read' : 'failed', finalUrl: url,
    html: bytes.toString('utf8'), bytes: bytes.length,
    ...(response.status === 200 ? {} : { reason: `http_${response.status}` }) };
} });
const recordDigest = createHash('sha256').update(JSON.stringify(result.records.map((record) => ({
  title: record.title, price: record.price, stock: record.stock, source: record.source,
})))).digest('hex');
const output = { schema: 't5.nx2.wc1-qualification-result.v1',
  status: result.verified ? 'PASS' : 'FAIL', wallMs: Date.now() - startedAt,
  state: result.state, recordDigest, coverage: result.coverage,
  validation: result.validation, network: result.network,
  sourceContentsPersisted: false, productSourceChanged: false };
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!result.verified) process.exitCode = 1;
