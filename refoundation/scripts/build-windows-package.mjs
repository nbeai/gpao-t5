#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { makeWindowsIconIco, windowsNativeDependencyPaths, windowsPeArchitecture,
  windowsProductVersion, windowsRuntimeMaterial,
  WINDOWS_INSTALL_SCRIPT, WINDOWS_UNINSTALL_SCRIPT } from './windows-package-contract.mjs';
import { assertFourthCycleDormantSourceExcluded, assertQualificationOnlySourceExcluded,
  removeFourthCycleDormantSource, removeQualificationOnlySource } from './product-source-boundary.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const version = windowsProductVersion(JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')));
const runtimeMaterials = JSON.parse(await readFile(join(repo, 'refoundation', 'config', 'windows-runtime-materials.json'), 'utf8'));
const option = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const architecture = option('--architecture') ?? process.arch;
const run = (program, args, options = {}) => execFileSync(program, args, { encoding: 'utf8', ...options });
const sha256 = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');

async function walk(root) {
  const output=[]; for (const entry of await readdir(root,{withFileTypes:true})) {
    const path=join(root,entry.name); if(entry.isDirectory())output.push(...await walk(path));else if(entry.isFile())output.push(path);
  } return output;
}

async function copyRuntimeApp(target, targetArchitecture) {
  const refoundation=join(target,'refoundation');await mkdir(join(refoundation,'scripts'),{recursive:true});
  for(const file of ['package.json','package-lock.json'])await copyFile(join(repo,'refoundation',file),join(refoundation,file));
  for(const directory of ['src','bin','skills','skill-packages','capabilities','config','ui'])await cp(join(repo,'refoundation',directory),join(refoundation,directory),{recursive:true,dereference:false});
  await removeFourthCycleDormantSource(refoundation);await removeQualificationOnlySource(refoundation);
  await assertFourthCycleDormantSourceExcluded(refoundation);await assertQualificationOnlySourceExcluded(refoundation);
  for(const script of ['start-console.mjs','ensure-local-runtime.mjs','stop-local-runtime.mjs','activate-whole-state-restore.mjs','connect-chatgpt.mjs','prepare-node-pty.mjs','restrict-kordoc-bin.mjs'])await copyFile(join(repo,'refoundation','scripts',script),join(refoundation,'scripts',script));
  run('npm.cmd',['ci','--omit=dev'],{cwd:refoundation,stdio:'inherit',env:{...process.env,
    npm_config_platform:'win32',npm_config_os:'win32',npm_config_arch:targetArchitecture,npm_config_cpu:targetArchitecture}});
  for(const item of ['@huggingface/transformers','onnxruntime-node','onnxruntime-common','adm-zip'])await rm(join(refoundation,'node_modules',item),{recursive:true,force:true});
  for(const relativePath of windowsNativeDependencyPaths(targetArchitecture)){
    const exact=join(refoundation,...relativePath.split('/'));const bytes=await readFile(exact);
    if(windowsPeArchitecture(bytes)!==targetArchitecture)throw new Error(`Windows native dependency architecture mismatch: ${relativePath}`);
  }
}

function compile(source, output, flags=[]) {
  run('cl.exe',['/nologo','/W4','/WX','/O2','/utf-8',`/Fe:${output}`,source,...flags],{stdio:'inherit'});
}

function compileCpp(source, output, libraries = []) {
  run('cl.exe', ['/nologo', '/W4', '/WX', '/O2', '/utf-8', '/EHsc', '/std:c++17',
    `/Fe:${output}`, source, '/link', ...libraries], { stdio: 'inherit' });
}

async function main(){
  if(process.platform!=='win32')throw new Error('Windows is required to build the Windows package');
  if(!['x64','arm64'].includes(architecture))throw new Error('Windows package architecture must be x64 or arm64');
  const nodeInput=resolve(option('--node-runtime')??process.execPath);const work=await mkdtemp(join(tmpdir(),'t5-windows-package-'));
  const packageRoot=join(work,'package');const payload=join(packageRoot,'payload');const bin=join(payload,'bin');
  try{
    await mkdir(bin,{recursive:true});await copyRuntimeApp(join(payload,'app'),architecture);
    const runtimeMaterial=windowsRuntimeMaterial(runtimeMaterials,architecture);const nodeBytes=await readFile(nodeInput);
    if(windowsPeArchitecture(nodeBytes)!==architecture)throw new Error('Node runtime architecture does not match package architecture');
    if(nodeBytes.length!==runtimeMaterial.bytes||createHash('sha256').update(nodeBytes).digest('hex')!==runtimeMaterial.sha256)throw new Error('Node runtime does not match the pinned official material');
    await copyFile(nodeInput,join(bin,'node.exe'));
    compile(join(repo,'refoundation','native','windows','t5-windows-job-host.c'),join(bin,'t5-windows-job-host.exe'));
    compile(join(repo,'refoundation','native','windows','t5-windows-folder-picker.c'),join(bin,'t5-windows-folder-picker.exe'));
    compile(join(repo,'refoundation','native','windows','t5-windows-file-activity.c'),join(bin,'t5-windows-file-activity.exe'));
    compile(join(repo,'refoundation','native','windows','t5-windows-coarse-app-activity.c'),join(bin,'t5-windows-coarse-app-activity.exe'));
    compileCpp(join(repo,'refoundation','native','windows','t5-windows-image-ocr.cpp'),join(bin,'t5-windows-image-ocr.exe'),['windowsapp.lib']);
    compileCpp(join(repo,'refoundation','native','windows','t5-windows-audio-reality.cpp'),join(bin,'t5-windows-audio-reality.exe'),['mfplat.lib','mfreadwrite.lib','mfuuid.lib','propsys.lib','ole32.lib']);
    compile(join(repo,'refoundation','native','windows','t5-windows-launcher.c'),join(bin,'GPAO-T5.exe'),['/link','/SUBSYSTEM:WINDOWS']);
    for(const name of ['t5-windows-job-host.exe','t5-windows-folder-picker.exe','t5-windows-file-activity.exe','t5-windows-coarse-app-activity.exe','t5-windows-image-ocr.exe','t5-windows-audio-reality.exe','GPAO-T5.exe'])if(windowsPeArchitecture(await readFile(join(bin,name)))!==architecture)throw new Error(`${name} architecture does not match package architecture`);
    const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="54" fill="#171717"/><path d="M62 78h132M62 128h132M62 178h132M88 54v148M168 54v148" stroke="#fff" stroke-width="18" stroke-linecap="round"/></svg>');
    const png=await sharp(svg).resize(256,256).png().toBuffer();await writeFile(join(payload,'GPAO-T5.ico'),makeWindowsIconIco(png));
    await writeFile(join(payload,'uninstall.ps1'),WINDOWS_UNINSTALL_SCRIPT,'utf8');
    const required=[
      ['node_runtime','bin/node.exe'],['job_credential_host','bin/t5-windows-job-host.exe'],['launcher','bin/GPAO-T5.exe'],
      ['console_entry','app/refoundation/scripts/start-console.mjs'],['runtime_attach_entry','app/refoundation/scripts/ensure-local-runtime.mjs'],['runtime_stop_entry','app/refoundation/scripts/stop-local-runtime.mjs'],['file_activity_helper','bin/t5-windows-file-activity.exe'],
      ['app_activity_helper','bin/t5-windows-coarse-app-activity.exe'],['folder_picker_helper','bin/t5-windows-folder-picker.exe'],
      ['image_ocr_helper','bin/t5-windows-image-ocr.exe'],
      ['audio_reality_helper','bin/t5-windows-audio-reality.exe'],
      ['application_icon','GPAO-T5.ico'],['uninstaller','uninstall.ps1'],
    ];
    const roles=Object.fromEntries(required.map(([role,path])=>[role,path.replaceAll('\\','/')]));
    const files=[];for(const exact of await walk(payload)){const path=relative(payload,exact).replaceAll('\\','/');files.push({path,bytes:(await stat(exact)).size,sha256:await sha256(exact)});}files.sort((a,b)=>a.path.localeCompare(b.path));
    const manifest={schema:'t5.windows-product-payload.v1',product:'GPAO-T5',version,architecture,sourceCommit:run('git.exe',['rev-parse','HEAD'],{cwd:repo}).trim(),signed:false,runtimeMaterial,roles,files};
    await writeFile(join(payload,'windows-product-manifest.json'),`${JSON.stringify(manifest,null,2)}\n`);
    await writeFile(join(packageRoot,'install.ps1'),WINDOWS_INSTALL_SCRIPT,'utf8');
    const out=join(repo,'dist');await mkdir(out,{recursive:true});const zip=join(out,`GPAO-T5-${version}-windows-${architecture}-unsigned.zip`);
    run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',`Compress-Archive -Path '${packageRoot.replaceAll("'","''")}\\*' -DestinationPath '${zip.replaceAll("'","''")}' -Force`],{stdio:'inherit'});
    const receipt={schema:'t5.windows-dev-package.v1',status:'UNSIGNED_NOT_PHYSICALLY_QUALIFIED',architecture,package:{path:zip,bytes:(await stat(zip)).size,sha256:await sha256(zip)},payloadManifest:manifest,notClaimed:['signed Windows installer','physical Windows install upgrade rollback','Windows human qualification']};
    await writeFile(join(out,`GPAO-T5-${version}-windows-${architecture}.manifest.json`),`${JSON.stringify(receipt,null,2)}\n`);console.log(JSON.stringify(receipt,null,2));
  }finally{await rm(work,{recursive:true,force:true});}
}
await main();
