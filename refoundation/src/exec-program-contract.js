import { createHash } from 'node:crypto';
import { validateRecordReference } from './record-reference.js';

const CONTRACTS=new WeakSet();const LANGUAGES=new Set(['javascript','python']);const sha256=v=>createHash('sha256').update(v).digest('hex');
function exact(v,keys,label){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==[...keys].sort().join(','))throw new TypeError(`${label} fields invalid`);return v;}
function text(v,label,max){if(typeof v!=='string'||!v||v.length>max||v.trim()!==v)throw new TypeError(`${label} invalid`);return v;}
function relativePath(v){const p=text(v,'program output path',1000).replaceAll('\\','/');if(p.startsWith('/')||/^[A-Za-z]:\//u.test(p)||p.split('/').some(x=>!x||x==='.'||x==='..'))throw new TypeError('program output escaped');return p;}

export function admitExecProgramContract(input){
  exact(input,['workId','revision','temporary','sourceLanguage','source','inputs','outputs','requirements','interpreter'],'exec program contract');
  const workId=text(input.workId,'workId',256);if(!Number.isSafeInteger(input.revision)||input.revision<1||input.temporary!==true)throw new TypeError('temporary program identity invalid');
  if(!LANGUAGES.has(input.sourceLanguage))throw new TypeError('program language unsupported');const source=text(input.source,'program source',1024*1024);
  if(!Array.isArray(input.inputs)||!input.inputs.length||input.inputs.length>64)throw new TypeError('program inputs invalid');const inputs=input.inputs.map(validateRecordReference);
  for(const ref of inputs){if(ref.availability!=='available'||ref.sha256==null||ref.sourceRevision==null||['secret_ref','never_store'].includes(ref.sensitivity)||ref.scope.workId!==workId)throw new TypeError('program input is not exact current Work evidence');}
  if(new Set(inputs.map(x=>x.recordId)).size!==inputs.length)throw new TypeError('program inputs duplicated');
  if(!Array.isArray(input.outputs)||!input.outputs.length||input.outputs.length>32)throw new TypeError('program outputs invalid');const outputs=input.outputs.map(v=>{exact(v,['relativePath','kind'],'program output');return{relativePath:relativePath(v.relativePath),kind:text(v.kind,'program output kind',128)};});
  if(new Set(outputs.map(x=>x.relativePath)).size!==outputs.length)throw new TypeError('program outputs duplicated');
  exact(input.requirements,['filesystem','network','childProcess','packages'],'program requirements');for(const v of Object.values(input.requirements))if(typeof v!=='boolean')throw new TypeError('program requirement must be boolean');
  const interpreter=input.interpreter==null?null:text(input.interpreter,'program interpreter',512);
  if(input.sourceLanguage==='python'&&!interpreter)throw new TypeError('Python interpreter identity required');
  const contract=Object.freeze({schema:'t5.exec-program-contract.v1',workId,revision:input.revision,temporary:true,sourceLanguage:input.sourceLanguage,source,sourceSha256:sha256(source),inputs,outputs,requirements:{...input.requirements},interpreter,state:'admitted'});CONTRACTS.add(contract);return contract;
}

export function selectExecProgramBackend(value,{quickJsQualified=true}={}){if(!CONTRACTS.has(value))throw new TypeError('admitted exec program contract required');const pure=Object.values(value.requirements).every(v=>v===false);
  if(value.sourceLanguage==='javascript'&&pure&&quickJsQualified)return{backend:'quickjs',sourceLanguage:'javascript',translated:false};
  return{backend:'terminal_same_language',sourceLanguage:value.sourceLanguage,interpreter:value.interpreter,translated:false};}

export function assertExecProgramContract(value){if(!CONTRACTS.has(value))throw new TypeError('admitted exec program contract required');return value;}
