#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const index = process.argv.indexOf('--workspace');
if (index < 0 || !process.argv[index + 1]) throw new TypeError('--workspace is required');
const workspace = resolve(process.argv[index + 1]);
await rm(workspace, { recursive: true, force: true }); await mkdir(workspace, { recursive: true, mode: 0o700 });

const write = async (path, value) => { const target = join(workspace, path); await mkdir(resolve(target, '..'), { recursive: true });
  await writeFile(target, value.endsWith('\n') ? value : `${value}\n`); };

await write('archive/deep/partner/x17.md', '# 파트너 회의 메모\n갱신 조건: 만료 30일 전 서면 합의\n해지 통보 기한: 만료 45일 전\n회의일: 지난주 목요일');
await write('archive/deep/partner/other.md', '# 일반 회의\n다음 회의 일정만 논의');
const svg = Buffer.from('<svg width="800" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="500" fill="#edf2f7"/><rect x="120" y="100" width="560" height="300" rx="30" fill="#1756a9"/><text x="400" y="270" text-anchor="middle" font-size="82" font-family="Arial" fill="white">해솔 731</text></svg>');
await mkdir(join(workspace, 'photos/misc'), { recursive: true }); await sharp(svg).png().toFile(join(workspace, 'photos/misc/IMG_0042.png'));
await sharp(Buffer.from('<svg width="800" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="500" fill="#b7c9a8"/><circle cx="400" cy="250" r="120" fill="#f4ead5"/></svg>')).png().toFile(join(workspace, 'photos/misc/IMG_0099.png'));

await write('자료/청구.csv', '거래번호,거래처,청구금액\nT-001,가람,100000\nT-002,나래,200000\nT-003,다온,300000\nT-004,라온,400000');
await write('자료/입금.csv', '거래번호,입금금액\nT-001,100000\nT-002,150000\nT-004,400000');

const codes = ['E_PARSE', 'E_SCHEMA', 'E_TIMEOUT'];
for (let file = 0; file < 8; file += 1) {
  const rows = Array.from({ length: 30 }, (_, row) => ({ code: codes[(file + row) % 3], file: `src/mod-${(file + row) % 9}.js` }));
  await write(`program-data/log-${file + 1}.json`, JSON.stringify(rows));
}

await write('project-new/회사자료.md', '# 해솔공간\n작은 팀의 사무공간을 진단하고 동선을 개선합니다.\n전화: 02-555-0180\n이메일: hello@haesol.example');
await write('project-new/브랜드.txt', '따뜻하고 차분하게\n짙은 초록과 모래색\n외부 이미지와 외부 폰트 금지');

await write('project-existing/package.json', JSON.stringify({ name: 'hq-onboarding', private: true, type: 'module', scripts: { test: 'node --test', start: 'python3 -m http.server 4187 --bind 127.0.0.1' } }, null, 2));
await write('project-existing/src/onboarding.js', 'export function nextStep(current) {\n  return Math.min(current, 3);\n}');
await write('project-existing/public/app.js', "import { nextStep } from '/project-existing/src/onboarding.js';\nconst s=document.querySelector('[data-step]');document.querySelector('#next').onclick=()=>{const n=nextStep(Number(s.dataset.step));s.dataset.step=String(n);s.textContent=`온보딩 단계 ${n}`};");
await write('project-existing/public/index.html', '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/project-existing/public/theme.css"><h1>팀 시작하기</h1><p data-step="1">온보딩 단계 1</p><button id="next">다음</button><script type="module" src="/project-existing/public/app.js"></script>');
await write('project-existing/public/theme.css', 'body{background:#ffffff;color:#173f35;font-family:sans-serif}');
await write('project-existing/test/onboarding.test.js', "import test from 'node:test';import assert from 'node:assert/strict';import {nextStep} from '../src/onboarding.js';test('advances',()=>{assert.equal(nextStep(1),2);assert.equal(nextStep(3),3)});");
execFileSync('git', ['init', '-q'], { cwd: join(workspace, 'project-existing') });
execFileSync('git', ['add', '.'], { cwd: join(workspace, 'project-existing') });
execFileSync('git', ['-c', 'user.name=T5 Fixture', '-c', 'user.email=t5-fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: join(workspace, 'project-existing') });
await write('project-existing/public/theme.css', 'body{background:#f5e6c8;color:#173f35;font-family:sans-serif}');

for (let file = 0; file < 12; file += 1) {
  const lines = Array.from({ length: 200 }, (_, row) => `${file + 1},${row + 1},${row % 17 === 0 ? 'ERROR' : 'OK'}`);
  await write(`long-data/data-${file + 1}.csv`, `file,row,state\n${lines.join('\n')}`);
}

const plan = JSON.parse(await readFile(new URL('../fixtures/s4-hq-console-wave.json', import.meta.url), 'utf8'));
process.stdout.write(`${JSON.stringify({ workspace, scenarioCount: plan.scenarios.length, fixedAt: plan.fixedAt })}\n`);
