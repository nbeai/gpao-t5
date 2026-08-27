export function makePurposeHistoryTool({adapter}={}){if(!adapter||['search','select','reopen'].some((name)=>typeof adapter[name]!=='function'))
  throw new TypeError('purpose history adapter is required');return{name:'purpose_history',description:'Find a small, privacy-safe set of past T5 work, file metadata, and coarse app activity for the user current purpose, then reopen only selected opaque handles. Use search first, then reopen with the returned queryHandle and chosen handles.',
  parameters:{type:'object',additionalProperties:false,required:['action','query','limit','queryHandle','handles'],properties:{
    action:{type:'string',enum:['search','reopen']},query:{type:['string','null'],maxLength:200},limit:{type:['integer','null'],minimum:1,maximum:8},
    queryHandle:{type:['string','null'],pattern:'^[a-f0-9]{32}$'},handles:{type:'array',maxItems:3,items:{type:'string',pattern:'^[a-f0-9]{32}$'}}}},
  capabilityGroup:'continuity',searchTerms:['past work file app history previous yesterday 지난 작업 파일 앱 기록 지난번 어제'],relatedTools:['session_search'],
  async execute(args={}){if(args.action==='search'){if(typeof args.query!=='string'||args.limit==null||args.queryHandle!==null||args.handles.length)
      throw new Error('purpose history search fields are invalid');return adapter.search({query:args.query,limit:args.limit});}
    if(args.action==='reopen'){if(args.query!==null||args.limit!==null||typeof args.queryHandle!=='string'||!args.handles.length)
      throw new Error('purpose history reopen fields are invalid');await adapter.select({queryHandle:args.queryHandle,handles:args.handles});
      return{schema:'t5.purpose-history-reopened-set.v1',items:await Promise.all(args.handles.map((handle)=>adapter.reopen({queryHandle:args.queryHandle,handle}))),
        writes:0,externalEffects:0};}throw new Error('purpose history action is invalid');}};}
