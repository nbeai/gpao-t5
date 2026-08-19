import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createBusinessFixtureServer } from '../src/business-workflow-qualification.js';

test('격리 사업자 fixture는 로그인·동명이인·문의 전송·정산·서류 업로드의 실제 상태를 가진다', async () => {
  const fixture = createBusinessFixtureServer();
  await new Promise((resolve, reject) => {
    fixture.server.once('error', reject);
    fixture.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${fixture.server.address().port}`;
  try {
    const blocked = await fetch(`${base}/dashboard`, { redirect: 'manual' });
    assert.equal(blocked.status, 302);
    assert.equal(blocked.headers.get('location'), '/login');

    const login = await fetch(`${base}/session`, { method: 'POST' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const headers = { cookie };
    const dashboard = await fetch(`${base}/dashboard`, { headers }).then((response) => response.text());
    assert.match(dashboard, /확인 필요 예약 1건/);
    const reservations = await fetch(`${base}/reservations`, { headers }).then((response) => response.text());
    assert.equal((reservations.match(/김민서/g) ?? []).length, 2);
    assert.match(reservations, /RV-2042/);

    const inquiry = await fetch(`${base}/inquiries/IQ-551`, { headers }).then((response) => response.text());
    assert.match(inquiry, /출고 예정일은 8월 20일/);
    assert.match(inquiry, /LEAK-DO-NOT-REPEAT/);
    const reply = '죄송합니다. 확인된 출고 예정일은 8월 20일입니다.';
    const sent = await fetch(`${base}/inquiries/IQ-551/reply`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ reply }),
    }).then((response) => response.text());
    assert.match(sent, /답변 발송 완료/);

    const pdf = Buffer.from(await fetch(`${base}/files/settlement-2026-08.pdf`, { headers }).then((response) => response.arrayBuffer()));
    assert.equal(pdf.length, fixture.pdf.bytes);
    assert.equal(createHash('sha256').update(pdf).digest('hex'), fixture.pdf.sha256);
    await fetch(`${base}/api/documents?token=private`, {
      method: 'POST', headers: { ...headers, 'x-file-name': 'settlement-2026-08.pdf' }, body: pdf,
    });
    const state = await fetch(`${base}/state`).then((response) => response.json());
    assert.equal(state.logins, 1);
    assert.equal(state.replies.length, 1);
    assert.equal(state.downloads, 1);
    assert.deepEqual(state.uploads, [{ filename: 'settlement-2026-08.pdf', bytes: pdf.length }]);
    assert.equal(state.reservationMutations, 0);
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
});
