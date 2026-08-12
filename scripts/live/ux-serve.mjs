// 조각 A 반대시험 재측정용 **격리 서버**. 모델 자격은 안 옮긴다(규율) — 이 측정은
// 그리는 방식만 재므로 모델이 필요 없다. 방은 mkdtemp 가 준 자리 하나만 쓰고 그것만 지운다.
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = new URL('../..', import.meta.url).pathname;
const { startLiveServer } = await import(pathToFileURL(join(repo, 'src/surface/server.js')));

const 방 = await mkdtemp(join(tmpdir(), 'a-remeasure-'));
const stateDir = join(방, 'state');
await mkdir(stateDir, { recursive: true });
await mkdir(join(방, 'GPAO-T5'), { recursive: true });

const server = await startLiveServer({
  port: 0,
  processEnv: {
    HOME: 방, GPAO_T5_DATA_DIR: stateDir, GPAO_T5_HOME: 방,
    GPAO_T5_FILE_ROOTS: join(방, 'GPAO-T5'),
  },
});
// **서버가 알려준 포트**를 쓴다 — 박으면 남의 서버와 말한다(착수 점검 §라이브 대본 규율).
console.log(`PORT=${server.address().port}`);
console.log(`ROOM=${방}`);
// process.exit 금지 — 신호로만 내린다(finally 를 건너뛰면 좀비가 남는다).
