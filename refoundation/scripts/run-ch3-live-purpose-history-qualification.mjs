import { createHash } from'node:crypto';import{mkdir,mkdtemp,rm}from'node:fs/promises';import{homedir,tmpdir}from'node:os';import{join}from'node:path';
import{makeConsoleServer}from'../src/console-server.js';import{ScopedFileActivityLedger}from'../src/scoped-file-activity-ledger.js';import{makeScopedFileActivityService}from'../src/scoped-file-activity-service.js';
import{CoarseAppActivityLedger}from'../src/coarse-app-activity-ledger.js';import{makeCoarseAppActivityService}from'../src/coarse-app-activity-service.js';
import{makeOpenAIResponsesModel}from'../src/openai-responses-model.js';import{makeChatGptResponsesModel}from'../src/chatgpt-responses-model.js';
import{consoleInstructions}from'../src/console-model-factory.js';import{makePlatformSecretStore}from'../src/platform-secret-store.js';
import{loadReadOnlyConnectionCredential}from'./run-s3m6-reflection-shadow-qualification.mjs';
const ENDPOINTS={api_key:'https://api.openai.com/v1/responses',chatgpt_oauth:'https://chatgpt.com/backend-api/codex/responses'};
const hash=(value)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
function strict(schema){if(!schema||typeof schema!=='object')return;const object=schema.type==='object'||(Array.isArray(schema.type)&&schema.type.includes('object'));
  if(object&&schema.additionalProperties===false&&JSON.stringify(Object.keys(schema.properties??{}).sort())!==JSON.stringify([...(schema.required??[])].sort()))
    throw new Error('strict_schema_boundary');for(const child of Object.values(schema.properties??{}))strict(child);if(schema.items)strict(schema.items);}
function modelFor(credential,workspace,observations){const endpoint=ENDPOINTS[credential.kind];const secrets=[credential.secret.key,credential.secret.access,credential.secret.accountId].filter(Boolean);
  const fetchImpl=async(url,options={})=>{if(String(url)!==endpoint||options.method!=='POST')throw new Error('provider_endpoint_boundary');const bodyText=String(options.body??'');
    if(secrets.some((secret)=>bodyText.includes(secret)))throw new Error('provider_body_secret');const body=JSON.parse(bodyText);if(body.store!==false||body.model!==credential.modelId
      ||!options.headers?.authorization||!Array.isArray(body.tools))throw new Error('provider_request_boundary');for(const tool of body.tools){if(tool.type!=='function'||tool.strict!==true)throw new Error('provider_tool_boundary');strict(tool.parameters);}
    observations.push({requestBytes:Buffer.byteLength(bodyText),toolCount:body.tools.length,toolNames:body.tools.map((item)=>item.name).sort()});
    return fetch(url,{...options,signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(30000)])});};
  const instructions=consoleInstructions(workspace,{platform:process.platform,architecture:process.arch,commandFamily:'posix',commandProgram:'/bin/zsh'});
  return credential.kind==='api_key'?makeOpenAIResponsesModel({apiKey:credential.secret.key,model:credential.modelId,endpoint,fetchImpl,instructions,reasoningEffort:'medium'})
    :makeChatGptResponsesModel({model:credential.modelId,endpoint,fetchImpl,maxAttempts:1,instructions,credentials:{async get(){return{access:credential.secret.access,
      accountId:credential.secret.accountId,expiresAt:credential.secret.expiresAt,modelId:credential.modelId};}}});}
async function one(connection,credential){const room=await mkdtemp(join(tmpdir(),'t5-ch3-live-'));const workspace=join(room,'workspace');await mkdir(workspace);let server;
  const files=new ScopedFileActivityLedger(join(room,'file-state'));await files.configure({roots:[workspace],platform:'darwin',recordedAt:'2026-08-27T00:00:00.000Z'});
  await files.setEnabled({enabled:true,recordedAt:'2026-08-27T00:00:01.000Z'});await files.ingest({source:'fixture',journal:{kind:'fixture',volume:'v',journalId:'j'},cursor:'1',
    recordedAt:'2026-08-27T00:00:02.000Z',events:[{kind:'modified',path:join(workspace,'견적서.xlsx'),occurredAt:'2026-08-27T00:00:02.000Z',sourceEventId:'1',identity:null,availability:'available'}]});
  const apps=new CoarseAppActivityLedger(join(room,'app-state'));await apps.configure({platform:'darwin',recordedAt:'2026-08-27T00:00:00.000Z'});await apps.setEnabled({enabled:true,recordedAt:'2026-08-27T00:00:01.000Z'});
  await apps.ingest({source:'fixture',policyGeneration:2,recordedAt:'2026-08-27T00:00:06.000Z',segments:[{segmentId:'a1',appId:'com.apple.Numbers',appLabel:'Numbers',
    startedAt:'2026-08-27T00:00:02.000Z',endedAt:'2026-08-27T00:00:06.000Z',durationMs:4000,afk:'active',workBinding:null}]});
  const fileService=makeScopedFileActivityService({ledger:files});const appService=makeCoarseAppActivityService({ledger:apps});const observations=[];
  try{const rawModel=modelFor(credential,workspace,observations);let modelCalls=0;const model={async respond(input){modelCalls+=1;if(modelCalls>5)throw new Error('model_call_boundary');return rawModel.respond(input);}};
    server=makeConsoleServer({stateDir:join(room,'state'),workspace,learningReviewMode:'off',fileActivityService:fileService,
    appActivityService:appService,modelFactory:()=>model,modelStatus:()=>({connected:true,provider:credential.provider,modelId:credential.modelId})});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}`;const session=await fetch(`${base}/sessions`,{method:'POST'}).then((response)=>response.json());const response=await fetch(`${base}/turn`,{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:session.id,text:'지난번 견적서 파일 기록과 그때 사용한 Numbers 앱 기록을 찾아서, 실제로 선택한 기록만 다시 확인한 뒤 짧게 알려줘.'})});
    const result=await response.json();const runs=await server.runLedger.list({sessionId:session.id});const run=runs.at(-1);const toolNames=run?.events.filter((event)=>event.type==='tool_completed')
      .map((event)=>event.payload?.receipt?.actualCall?.name).filter(Boolean)??[];const usage=run?.events.filter((event)=>event.type==='model_completed').map((event)=>event.payload?.response?.usage).filter(Boolean)??[];
    const reply=String(result.reply??'');return{connection:connection.id,model:credential.modelId,httpStatus:response.status,providerRequests:observations.length,modelCalls,toolNames,
      requestToolCounts:observations.map((item)=>item.toolCount),usage,replyDigest:reply?hash(reply):null,mentionsFile:/견적서/u.test(reply),mentionsApp:/Numbers/u.test(reply),
      privateLeak:/(?:\/private\/|\/Users\/|com\.apple\.Numbers|[0-9a-f]{32,})/u.test(reply),fileEvents:(await files.status()).eventCount,appSegments:(await apps.status()).segmentCount,
      passed:response.status===200&&observations.length>=3&&observations.length<=5&&!toolNames.includes('session_search')&&toolNames.filter((name)=>name==='purpose_history').length>=2
        &&/견적서/u.test(reply)&&/Numbers/u.test(reply)&&!/(?:\/private\/|\/Users\/|com\.apple\.Numbers|[0-9a-f]{32,})/u.test(reply)};
  }finally{if(server){server.closeWakeStreams();await server.managedProcesses.stopAll('qualification_shutdown');await new Promise((resolve)=>server.close(resolve));}
    await fileService.close();await appService.close();await rm(room,{recursive:true,force:true});}}
async function main(){if(!process.argv.includes('--human-controlled'))throw new Error('human_control_required');const connectionFile=process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ??join(homedir(),'.local','state','gpao-t5','sessions','model-connection.json');const state=JSON.parse(await(await import('node:fs/promises')).readFile(connectionFile,'utf8'));
  const secretStore=makePlatformSecretStore({platform:process.platform});const ids=['api_key:openai:gpt-5.6-terra','chatgpt_oauth:gpt-5.5'];const results=[];
  for(const id of ids){const connection=state.connections?.find((item)=>item.id===id);if(!connection)throw new Error('connection_boundary');const credential=await loadReadOnlyConnectionCredential({connection,secretStore});
    try{results.push(await one(connection,credential));}catch(error){results.push({connection:id,model:credential.modelId,passed:false,failure:/abort|timeout/iu.test(error?.message??'')?'provider_timeout':'product_or_model_boundary'});}}
  const report={schema:'t5.ch3.live-purpose-history-qualification.v1',priorAttemptTimedOutAndWasAborted:true,results,providerRequests:results.reduce((sum,item)=>sum+(item.providerRequests??0),0),
    externalWrites:0,credentialWrites:0,realUserHistoryReads:0,passed:results.length===2&&results.every((item)=>item.passed)};process.stdout.write(`${JSON.stringify(report,null,2)}\n`);if(!report.passed)process.exitCode=1;}
main().catch((error)=>{process.stdout.write(`${JSON.stringify({schema:'t5.ch3.live-purpose-history-qualification.v1',passed:false,failure:/credential|connection/u.test(error?.message??'')?'credential_boundary':'product_or_provider_boundary'})}\n`);process.exitCode=1;});
