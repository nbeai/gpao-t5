import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { makeWindowsIconIco, windowsPeArchitecture, WINDOWS_INSTALL_SCRIPT, WINDOWS_UNINSTALL_SCRIPT } from '../scripts/windows-package-contract.mjs';

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

test('Windows package recipe는 네 native helper와 x64 ARM64 architecture contract를 함께 묶는다', async () => {
  const source=await readFile(new URL('../scripts/build-windows-package.mjs',import.meta.url),'utf8');
  for(const name of ['t5-windows-job-host.c','t5-windows-folder-picker.c','t5-windows-file-activity.c','t5-windows-coarse-app-activity.c','t5-windows-launcher.c'])assert.match(source,new RegExp(name.replaceAll('.','\\.')));
  assert.match(source,/\['x64','arm64'\]/u);assert.match(source,/UNSIGNED_NOT_PHYSICALLY_QUALIFIED/u);
});
