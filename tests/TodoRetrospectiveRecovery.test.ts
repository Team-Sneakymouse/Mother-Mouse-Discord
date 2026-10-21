import {expect,test} from 'bun:test';
import {TodoRetrospective,renderRetrospective} from '../src/todo/retrospective.js';
import {HermesTodoBridge} from '../src/todo/hermes.js';
import {ChannelType,DiscordAPIError} from 'discord.js';
const hash='a'.repeat(64);
test('real transport open preflight rejects oversize, wrong forum, guild and missing Meta without reservation',async()=>{
 for(const mode of ['size','bytes','forum','guild','meta']){
  const writes:string[]=[];
  const run={id:'r',guild_id:'g',actor:'u'};
  const corrections=[{id:'c',text:mode==='size'?'x'.repeat(60001):mode==='bytes'?'😀'.repeat(26000):'evidence'}];
  const repo={operation:async(a:string)=>{if(a==='retrospective-begin')return {run,corrections,reports:[],labels:[]};writes.push(a);}};
  const forum={type:mode==='forum'?ChannelType.GuildText:ChannelType.GuildForum,guildId:mode==='guild'?'other':'g',availableTags:mode==='meta'?[]:[{id:'meta',name:'Meta'}]};
  const bridge=new HermesTodoBridge({channels:{fetch:async()=>forum}} as any,'http://127.0.0.1:1','t'.repeat(32));
  await expect(new TodoRetrospective(repo as any,bridge).open('g','u')).rejects.toThrow();expect(writes).toEqual([]);
 }
});
test('forum invalidated after reservation releases proven precreation failure',async()=>{
 let fetches=0;let run:any={id:'r',guild_id:'g',actor:'u'};const writes:string[]=[];
 const repo={operation:async(a:string,b:any)=>{if(a==='retrospective-begin')return {run,corrections:[],reports:[],labels:[]};writes.push(a);if(a==='retrospective-stage')run={...run,...b};}};
 const bridge=new HermesTodoBridge({channels:{fetch:async()=>({type:++fetches===1?ChannelType.GuildForum:ChannelType.GuildText,guildId:'g',availableTags:[{name:'Meta',id:'meta'}]})}} as any,'http://127.0.0.1:1','t'.repeat(32));
 await expect(new TodoRetrospective(repo as any,bridge).open('g','u')).rejects.toThrow('Invalid');expect(writes).toContain('retrospective-release-dispatch');
});
test('real Discord 403 releases reservation, network ambiguity retains it and forbids a second creation',async()=>{
 for(const denied of [true,false]){
  let run:any={id:'r',guild_id:'g',actor:'u'};let creates=0;const writes:string[]=[];
  const repo={operation:async(a:string,b:any)=>{if(a==='retrospective-begin')return {run,corrections:[],reports:[],labels:[]};writes.push(a);if(a==='retrospective-stage')run={...run,...b};if(a==='retrospective-release-dispatch')delete run.dispatch_token;}};
  const forum={type:ChannelType.GuildForum,guildId:'g',availableTags:[{id:'meta',name:'Meta'}],threads:{create:async()=>{creates++;if(denied)throw new DiscordAPIError({code:50013,message:'Missing Permissions'},50013,403,'POST','https://discord.com/api/v10/channels/x/threads',{files:[],body:{}});throw Error('connection reset');}}};
  const bridge=new HermesTodoBridge({channels:{fetch:async()=>forum}} as any,'http://127.0.0.1:1','t'.repeat(32));const s=new TodoRetrospective(repo as any,bridge);
  await expect(s.open('g','u')).rejects.toThrow();expect(writes.includes('retrospective-release-dispatch')).toBe(denied);
  if(!denied){await expect(s.open('g','u')).rejects.toThrow('uncertain');expect(creates).toBe(1);}
 }
});
test('prepare wins proposal race before any PB applying write, frozen retry survives PB failure',async()=>{
 const calls:string[]=[];let frozen=false,fail=true;
 const run={id:'r',guild_id:'g',actor:'u',thread_id:'t',baseline_hash:hash};
 const proposal={run_id:'r',state:'approval_pending',proposal_hash:hash,proposal:{summary:'A'},diff:'A'};
 const bridge={ready:async()=>{},status:async()=>proposal,prepareApproval:async()=>{frozen=true;calls.push('freeze');return proposal;},approve:async()=>({run_id:'r',state:'applied',proposal_hash:hash,policy_version:'3',policy_hash:hash})};
 const repo={operation:async(a:string)=>{if(a==='retrospective-begin')return {run};expect(frozen).toBe(true);calls.push(a);if(a==='retrospective-approve-begin'&&fail){fail=false;throw Error('PB down');}}};
 const s=new TodoRetrospective(repo as any,bridge as any);
 await expect(s.approve('g','u','r',hash)).rejects.toThrow('PB down');
 await s.approve('g','u','r',hash);
 expect(calls[0]).toBe('freeze');expect(calls.at(-1)).toBe('retrospective-complete');
 expect(renderRetrospective(proposal,'u').files).toHaveLength(2);
});
test('replacement proposal winning prepare never changes PB approval state',async()=>{
 const writes:string[]=[];const repo={operation:async(a:string)=>{if(a==='retrospective-begin')return {run:{id:'r',guild_id:'g',actor:'u'}};writes.push(a);}};
 const bridge={status:async()=>({run_id:'r',state:'proposed',proposal_hash:hash}),prepareApproval:async()=>{throw Error('stale raced B');}};
 await expect(new TodoRetrospective(repo as any,bridge as any).approve('g','u','r',hash)).rejects.toThrow('stale raced B');expect(writes).toEqual([]);
});
test('confirmed precreation failure releases only its reservation; ambiguous failure retains it',async()=>{
 for(const confirmed of [true,false]){
  const writes:string[]=[];let run:any={id:'r',guild_id:'g',actor:'u'};
  const repo={operation:async(a:string,b:any)=>{if(a==='retrospective-begin')return {run,corrections:[],reports:[],labels:[]};writes.push(a);if(a==='retrospective-stage')run={...run,...b};if(a==='retrospective-release-dispatch'){expect(b.dispatch_token).toBe(run.dispatch_token);delete run.dispatch_token;}}};
  const bridge={ready:async()=>{},preflightRetrospective:async()=>{},startRetrospective:async()=>{throw Object.assign(Error('creation failed'),{confirmedNoThread:confirmed});}};
  await expect(new TodoRetrospective(repo as any,bridge as any).open('g','u')).rejects.toThrow('creation failed');
  expect(writes.includes('retrospective-release-dispatch')).toBe(confirmed);
 }
});
test('revalidation channel GET failure releases reservation and allows a safe retry',async()=>{
 let fetches=0,creates=0;let run:any={id:'r',guild_id:'g',actor:'u'};const writes:string[]=[];
 const repo={operation:async(action:string,body:any)=>{
  if(action==='retrospective-begin')return {run,corrections:[],reports:[],labels:[]};
  writes.push(action);
  if(action==='retrospective-stage')run={...run,...body};
  if(action==='retrospective-release-dispatch'){expect(body.dispatch_token).toBe(run.dispatch_token);delete run.dispatch_token;}
  return run;
 }};
 const forum={type:ChannelType.GuildForum,guildId:'g',availableTags:[{id:'meta',name:'Meta'}],threads:{create:async()=>{creates++;return {id:'t',send:async()=>{}};}}};
 const bridge=new HermesTodoBridge({channels:{fetch:async()=>{if(++fetches===2)throw Error('GET channel connection reset');return forum;}}} as any,'http://127.0.0.1:1','t'.repeat(32));
 (bridge as any).post=async(path:string)=>path.endsWith('/start')?{status:'accepted',run_id:'r',thread_id:'t',baseline_version:'2',baseline_hash:hash}:{run_id:'r',state:'investigating'};
 const service=new TodoRetrospective(repo as any,bridge);
 await expect(service.open('g','u')).rejects.toThrow('GET channel connection reset');
 expect(creates).toBe(0);expect(writes).toContain('retrospective-release-dispatch');expect(run.dispatch_token).toBeUndefined();
 expect((await service.open('g','u')).state).toBe('investigating');expect(creates).toBe(1);
});

test('open preflight failure cannot reserve dispatch',async()=>{
 const writes:string[]=[];const repo={operation:async(a:string)=>{if(a==='retrospective-begin')return {run:{id:'r',guild_id:'g',actor:'u'},corrections:[],reports:[],labels:[]};writes.push(a);}};
 const bridge={ready:async()=>{},preflightRetrospective:async()=>{throw Error('invalid forum');},startRetrospective:async()=>{throw Error('must not start');}};
 await expect(new TodoRetrospective(repo as any,bridge as any).open('g','u')).rejects.toThrow('invalid forum');expect(writes).toEqual([]);
});
