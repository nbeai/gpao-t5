import test from 'node:test';
import assert from 'node:assert/strict';

import { makeNativeFolderSelector } from '../src/native-folder-selector.js';

test('macOS 폴더 선택기는 directory-only native panel 결과만 내부 절대경로로 돌린다', async () => {
  const calls=[];const selector=makeNativeFolderSelector({platform:'darwin',run:async(...args)=>{
    calls.push(args);return{stdout:'{"selected":true,"path":"/private/tmp/t5-ch1-selected/"}\n'};}});
  assert.equal(await selector(),'/private/tmp/t5-ch1-selected');
  assert.equal(calls[0][0],'/usr/bin/osascript');assert.deepEqual(calls[0][1].slice(0,2),['-l','JavaScript']);
  assert.match(calls[0][1][3],/setCanChooseDirectories\(true\)/u);
  assert.match(calls[0][1][3],/setCanChooseFiles\(false\)/u);assert.match(calls[0][1][3],/setPrompt\('선택'\)/u);
});

test('취소는 null이고 non-macOS는 실제 선택 기능을 꾸미지 않는다', async () => {
  assert.equal(makeNativeFolderSelector({platform:'win32'}),null);
  const cancelled=makeNativeFolderSelector({platform:'darwin',run:async()=>({stdout:'{"selected":false}\n'})});
  assert.equal(await cancelled(),null);
});

test('Windows folder picker는 packaged helper의 exact 절대경로만 받는다', async () => {
  const calls=[];const selector=makeNativeFolderSelector({platform:'win32',windowsHelper:'C:\\T5\\picker.exe',run:async(program,args)=>{
    calls.push({program,args});return{stdout:'{"selected":true,"path":"C:\\\\Users\\\\person\\\\Documents"}\n'};}});
  assert.equal(await selector(),'C:\\Users\\person\\Documents');
  assert.deepEqual(calls,[{program:'C:\\T5\\picker.exe',args:[]}]);
});
