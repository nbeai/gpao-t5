import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(here, 'scenarios.json'), 'utf8'));
const args = process.argv.slice(2);
const suite = args[args.indexOf('--suite') + 1] ?? 'smoke';
if (!manifest.suites[suite]) throw new Error(`unknown suite: ${suite}`);

const root = resolve(process.env.T5_HUMAN_USE_DIR ?? join('/private/tmp', `t5-human-use-${randomUUID()}`));
const fixture = join(root, 'fixture');
await mkdir(fixture, { recursive: true });
await mkdir(join(root, 'state'), { recursive: true });
await writeFile(join(fixture, 'brief-v1.txt'), '매출 1200, 비용 700, 신규 8, 이탈 2\n배송비 미포함\n', 'utf8');
await new Promise((r) => setTimeout(r, 5));
await writeFile(join(fixture, 'working-copy.txt'), '매출 1300, 비용 760, 신규 10, 이탈 3\n배송비 포함\n', 'utf8');

const selected = manifest.suites[suite].map((id) => manifest.scenarios.find((s) => s.id === id));
const skeleton = {
  schemaVersion: 1,
  runId: randomUUID(),
  suite,
  manifestVersion: manifest.version,
  actualBrowser: true,
  isolated: true,
  productCommit: null,
  model: null,
  startedAt: null,
  finishedAt: null,
  status: 'not_run',
  environment: { root, stateDir: join(root, 'state'), fixtureDir: fixture },
  scenarios: selected.map((s) => ({
    id: s.id,
    status: 'not_run',
    attribution: null,
    turns: [],
    checks: s.requiredChecks.map((id) => ({ id, pass: null, evidence: null })),
    qualitative: [],
  })),
  consoleErrors: [],
  p0: [],
};
const output = join(root, 'evidence.json');
await writeFile(output, `${JSON.stringify(skeleton, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, suite, root, evidence: output, scenarios: selected.map((s) => s.id) }, null, 2));
