import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { makeWindowsIconIco, windowsPeArchitecture, windowsProductVersion, windowsRuntimeMaterial,
  WINDOWS_INSTALL_SCRIPT, WINDOWS_UNINSTALL_SCRIPT } from '../scripts/windows-package-contract.mjs';

test('Windows package version은 sealed root 제품 version을 사용하고 잘못된 값을 거부한다', async () => {
  const product = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(windowsProductVersion(product), '6.0.0');
  for (const version of ['', '6.0', 'v6.0.0', '../6.0.0']) {
    assert.throws(() => windowsProductVersion({ version }), /version is invalid/u);
  }
  const source = await readFile(new URL('../scripts/build-windows-package.mjs', import.meta.url), 'utf8');
  assert.match(source, /windowsProductVersion\(JSON\.parse\(await readFile\(join\(repo, 'package\.json'/u);
  assert.doesNotMatch(source, /const version = '0\.3\.1'/u);
});

test('Windows Node runtime은 공식 x64 ARM64 source·bytes·SHA에 고정된다', async () => {
  const materials = JSON.parse(await readFile(new URL('../config/windows-runtime-materials.json', import.meta.url), 'utf8'));
  assert.deepEqual(windowsRuntimeMaterial(materials, 'x64'), {
    version: '24.14.0', architecture: 'x64',
    url: 'https://nodejs.org/dist/v24.14.0/win-x64/node.exe', bytes: 91380224,
    sha256: '63c259c81e5d472b5f11c8d506070130cb04a1ecf84b80377a34ed6ec9048088',
    source: 'https://nodejs.org/dist/v24.14.0/SHASUMS256.txt',
  });
  assert.equal(windowsRuntimeMaterial(materials, 'arm64').sha256,
    '8c5fd45a4a1fd3cc4a6f07da8803b05194108906cb6fb7d962448a12582a5922');
  assert.throws(() => windowsRuntimeMaterial({ ...materials, architectures: { x64: {
    ...materials.architectures.x64, url: 'https://example.com/node.exe',
  } } }, 'x64'), /material is invalid/u);
});

test('Windows installer는 incoming 검증 뒤 교체하고 실패하면 이전 설치만 복원한다', () => {
  assert.match(WINDOWS_INSTALL_SCRIPT,/\.GPAO-T5\.incoming/u);assert.match(WINDOWS_INSTALL_SCRIPT,/Get-FileHash/u);
  assert.match(WINDOWS_INSTALL_SCRIPT,/\.GPAO-T5\.rollback/u);assert.match(WINDOWS_INSTALL_SCRIPT,/Move-Item[\s\S]*Rollback[\s\S]*InstallRoot/u);
  assert.match(WINDOWS_INSTALL_SCRIPT,/Start Menu\\Programs/u);assert.match(WINDOWS_INSTALL_SCRIPT,/GPAO-T5\.ico/u);
  assert.doesNotMatch(WINDOWS_INSTALL_SCRIPT,/Remove-Item[^\n]*(?:state|credentials)/iu);
});

test('Windows uninstall은 앱과 shortcut만 지우고 LOCALAPPDATA 사용자 상태를 보존한다', () => {
  assert.match(WINDOWS_UNINSTALL_SCRIPT,/GPAO-T5\.lnk/u);assert.match(WINDOWS_UNINSTALL_SCRIPT,/InstallRoot/u);
  assert.doesNotMatch(WINDOWS_UNINSTALL_SCRIPT,/GPAO-T5['"]?\s*,?\s*['"]?(?:state|credentials)/iu);
  assert.match(WINDOWS_UNINSTALL_SCRIPT,/대화와 기억은 그대로/u);
});

test('Windows icon builder는 PNG를 단일 256px ICO payload로 감싼다', () => {
  const png=Buffer.concat([Buffer.from([0x89]),Buffer.from('PNG'),Buffer.alloc(12)]);const ico=makeWindowsIconIco(png);
  assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),1);assert.equal(ico.readUInt32LE(18),22);
  assert.deepEqual(ico.subarray(22),png);
});

test('Windows package는 PE machine을 x64와 ARM64로 구분하고 다른 runtime을 거부할 근거를 가진다',()=>{
  const pe=(machine)=>{const body=Buffer.alloc(128);body.write('MZ');body.writeUInt32LE(64,0x3c);body.write('PE\0\0',64);body.writeUInt16LE(machine,68);return body;};
  assert.equal(windowsPeArchitecture(pe(0x8664)),'x64');assert.equal(windowsPeArchitecture(pe(0xaa64)),'arm64');
  assert.equal(windowsPeArchitecture(Buffer.from('MZ invalid')),null);
});

test('Windows package recipe는 native helper와 x64 ARM64 architecture contract를 함께 묶는다', async () => {
  const source=await readFile(new URL('../scripts/build-windows-package.mjs',import.meta.url),'utf8');
  for(const name of ['t5-windows-job-host.c','t5-windows-folder-picker.c','t5-windows-file-activity.c','t5-windows-coarse-app-activity.c','t5-windows-image-ocr.cpp','t5-windows-launcher.c'])assert.match(source,new RegExp(name.replaceAll('.','\\.')));
  assert.match(source,/\['x64','arm64'\]/u);assert.match(source,/UNSIGNED_NOT_PHYSICALLY_QUALIFIED/u);
});
