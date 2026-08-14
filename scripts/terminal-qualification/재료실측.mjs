// 재료실측 — 회차가 **실제로 본 바이트**를 뜬다. 이것이 채점의 진값이다.
//
// 왜 따로 있나(2026-08-15 · §7-t): 이 수집이 두 곳(그냥써본다.mjs · 요청사슬캡처.mjs)에
// **같은 줄로 복제**돼 있었고, 둘 다 같은 결함을 앓았다:
//
//   `/bin/zsh -c 'find . -type f -exec wc -c {} +'`
//
// 주변 로케일이 C/POSIX 면 BSD find·wc 가 비ASCII 바이트를 `?` 로 바꿔 내보낸다.
// 그래서 원본 75개 중 **36개**의 재료실측 키가 `"./????/????.md"` 로 남았다 —
// **진값이 방 이름을 잃은 것**이고, 그 위에서 채점기가 1위 후보를 만들고 있었다
// (채점기.mjs 의 「알려진 한계 ②」가 이것이다). F-119 와 같은 기전이다.
//
// 원인 정정(감시자 실측 · 내 첫 진술은 틀렸다): `execFile` 에 env 를 **안 넘겨서**가 아니다.
// Node 는 env 를 안 주면 process.env 를 그대로 물려준다. 부모 env 를 넘겨도 부모의
// LANG 이 비어 있으면 그대로 깨진다. 참 원인은 **주변 로케일**이다.
//
// 수리는 로케일 이름을 고르는 것이 아니라 **셸을 안 쓰는 것**이다. 어느 기계에 어떤 로케일이
// 깔려 있는지에 판정이 달리면 안 된다(다른 기계에서 값이 달라지는 계측기는 계측기가 아니다).
// Node 로 직접 걸으면 이름은 언제나 원문이고 크기는 stat.size = wc -c 다.
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

// 방 하나를 걸어 { 상대경로: 바이트 } 를 만든다. 심볼릭 링크는 따라가지 않는다.
export async function 재료실측(방) {
  const 표 = {};
  async function 걷기(자리) {
    for (const 항목 of await readdir(자리, { withFileTypes: true })) {
      const 길 = join(자리, 항목.name);
      if (항목.isDirectory()) { await 걷기(길); continue; }
      if (!항목.isFile()) continue;                       // 링크·특수 파일은 재료가 아니다
      표[`./${relative(방, 길)}`] = (await stat(길)).size;
    }
  }
  await 걷기(방);
  return 표;
}

// 옛 `find|wc` 출력과 같은 모양의 원문(줄당 "바이트 경로"). 요청사슬캡처가 이 모양으로 남긴다.
export function 재료실측원문(표) {
  return Object.entries(표).map(([경로, 바이트]) => `${바이트} ${경로}`).join('\n');
}
