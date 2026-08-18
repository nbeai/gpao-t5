import { relative } from 'node:path';

export function scoreFileDiscoveryAnswer({ answer, expectedPath, workspace, execCalls } = {}) {
  const text = String(answer ?? '');
  if (expectedPath) {
    const expectedRelative = relative(workspace, expectedPath);
    return {
      passed: text.includes(expectedPath) || text.includes(expectedRelative),
      absolutePathReported: text.includes(expectedPath),
    };
  }
  return {
    passed: /찾지 못|없(?:습니다|음|어요)|0개|not found/i.test(text) && execCalls <= 2,
    absolutePathReported: null,
  };
}
