import test from 'node:test';
import assert from 'node:assert/strict';

import { absolutePathSegments } from '../src/path-links.js';

test('콘솔 답의 POSIX·Windows 절대경로를 사용자 문장 변경 없이 찾아낸다', () => {
  assert.deepEqual(
    absolutePathSegments('결과: /private/tmp/example/report.md'),
    [{ start: 4, end: 34, path: '/private/tmp/example/report.md' }],
  );
  assert.deepEqual(
    absolutePathSegments('위치: C:\\Users\\person\\Downloads\\report.pdf'),
    [{ start: 4, end: 40, path: 'C:\\Users\\person\\Downloads\\report.pdf' }],
  );
});

test('코드 한 줄에 든 공백 포함 절대경로 전체를 하나의 경로로 본다', () => {
  assert.deepEqual(
    absolutePathSegments('/Users/person/Downloads/My Report.pdf', { wholeLine: true }),
    [{ start: 0, end: 37, path: '/Users/person/Downloads/My Report.pdf' }],
  );
});

test('상대경로와 URL은 파일 탐색기 링크로 오인하지 않는다', () => {
  assert.deepEqual(absolutePathSegments('reports/result.md와 https://example.com/a를 봐'), []);
});
