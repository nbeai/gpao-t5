import test from 'node:test';
import assert from 'node:assert/strict';

import { absolutePathSegments, fileReferenceSegments, resolveRelativeReference } from '../src/path-links.js';

test('Runtime file reference는 답 안의 파일 제목 자체만 exact reveal link 후보로 만든다', () => {
  const reference = { name: '주간보고.pdf', path: '~/Downloads/주간보고.pdf', bytes: 42,
    modifiedAt: '2026-08-30T00:00:00.000Z' };
  assert.deepEqual(fileReferenceSegments('찾은 파일은 **주간보고.pdf**입니다.', [reference]), [{
    start: 9, end: 17, reference,
  }]);
});

test('분해형 Runtime filename과 조합형 모델 표시는 같은 exact file reference로 결속된다', () => {
  const reference = { name: '권혁수 코칭.pdf', path: '~/iCloud/권혁수 코칭.pdf' };
  const text = '권혁수 코칭.pdf를 찾았습니다.';
  assert.deepEqual(fileReferenceSegments(text, [reference]), [{ start: 0, end: 10, reference }]);
});

test('코드 파일명의 한 글자 오타는 같은 확장자의 Runtime exact title에만 결속된다', () => {
  const reference = { name: '250403 코칭 사전자료 디자인웁스 권혁수.pdf', path: '~/iCloud/exact.pdf' };
  const visible = '250403 코칭 사전자료 디자인업스 권혁수.pdf';
  assert.deepEqual(fileReferenceSegments(visible, [reference]), [{ start: 0, end: visible.length, reference }]);
  assert.deepEqual(fileReferenceSegments('다른 파일입니다', [reference]), []);
});

test('콘솔 답의 POSIX·Windows 절대경로를 사용자 문장 변경 없이 찾아낸다', () => {
  assert.deepEqual(
    absolutePathSegments('결과: /private/tmp/example/report.md'),
    [{ start: 4, end: 34, path: '/private/tmp/example/report.md' }],
  );
  assert.deepEqual(
    absolutePathSegments('위치: C:\\Users\\person\\Downloads\\report.pdf'),
    [{ start: 4, end: 40, path: 'C:\\Users\\person\\Downloads\\report.pdf' }],
  );
  assert.deepEqual(
    absolutePathSegments('공유: \\\\server\\share\\보고서.pdf'),
    [{ start: 4, end: 26, path: '\\\\server\\share\\보고서.pdf' }],
  );
});

test('코드 한 줄에 든 공백 포함 절대경로 전체를 하나의 경로로 본다', () => {
  assert.deepEqual(
    absolutePathSegments('/Users/person/Downloads/My Report.pdf', { wholeLine: true }),
    [{ start: 0, end: 37, path: '/Users/person/Downloads/My Report.pdf' }],
  );
  assert.deepEqual(
    absolutePathSegments('~/Downloads/My Report.pdf', { wholeLine: true }),
    [{ start: 0, end: 25, path: '~/Downloads/My Report.pdf' }],
  );
});

test('사용자 홈 축약 경로도 현재 컴퓨터에서 결정 가능한 탐색기 링크로 본다', () => {
  assert.deepEqual(
    absolutePathSegments('위치: ~/Downloads/report.pdf'),
    [{ start: 4, end: 26, path: '~/Downloads/report.pdf' }],
  );
});

test('상대경로와 URL은 파일 탐색기 링크로 오인하지 않는다', () => {
  assert.deepEqual(absolutePathSegments('reports/result.md와 https://example.com/a를 봐'), []);
  assert.equal(resolveRelativeReference('\\\\server\\share\\report.txt', [
    'C:\\Users\\person\\report.txt',
  ]), null);
});

test('대화에서 이미 관측된 절대경로와 유일하게 대응하는 상대경로만 해결한다', () => {
  const known = [
    '/private/tmp/run/inbox/alpha.txt',
    '/private/tmp/run/archive/aurora-backup.txt',
    '/private/tmp/run/reports/aurora-summary.md',
  ];
  assert.equal(resolveRelativeReference('archive/aurora-backup.txt', known), known[1]);
  assert.equal(resolveRelativeReference('reports', known), '/private/tmp/run/reports');
  assert.equal(resolveRelativeReference('missing/file.txt', known), null);
  assert.equal(resolveRelativeReference('alpha.txt', [
    '/tmp/one/alpha.txt', '/tmp/two/alpha.txt',
  ]), null);
});
