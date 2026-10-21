import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import {Database} from 'bun:sqlite';
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import PocketBase from "pocketbase";
import {createHash} from 'node:crypto';
const canonical=(v:any):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
import {TodoRetrospective} from '../src/todo/retrospective.js';

const binary = process.env.TODO_PB_BINARY;
const integration = binary ? test : test.skip;
let processPB: ChildProcess; let directory:string; let pb:PocketBase; let label:string; let report:string;
let logs="";
beforeAll(async()=>{
 if(!binary)return;
 directory=await mkdtemp(join(process.env.TMPDIR ?? tmpdir(),"todo-pb-"));
 const admin=spawn(binary,["superuser","create","tests@example.com","test-password-12345","--dir",directory]);
 await new Promise<void>((resolve,reject)=>admin.on("exit",code=>code===0?resolve():reject(new Error("create superuser failed"))));
 const port=18000+Math.floor(Math.random()*10000);
 processPB=spawn(binary,["serve","--http",`127.0.0.1:${port}`,"--dir",directory,"--migrationsDir",join(directory,"migrations"),"--automigrate=false","--hooksDir",resolve("pocketbase/pb_hooks")]);
 processPB.stdout?.on("data",d=>logs+=d);processPB.stderr?.on("data",d=>logs+=d);
 pb=new PocketBase(`http://127.0.0.1:${port}`);pb.autoCancellation(false);
 let ready=false;
 for(let i=0;i<100;i++){try{await pb.health.check();ready=true;break;}catch{if(processPB.exitCode!==null)break;await new Promise(r=>setTimeout(r,50));}}
 if(!ready)throw new Error(`PocketBase did not start: ${logs}`);
 await pb.collection("_superusers").authWithPassword("tests@example.com","test-password-12345");
 await pb.collections.import(JSON.parse(await readFile("pocketbase/todo.collections.json","utf8")),false);
 label=(await pb.collection("todo_list_labels").create({guild_id:"g",name:"Plugin",description:"Plugin",thread_id:"thread",repo:"https://github.com/Team/Plugin"})).id;
},20000);
afterAll(async()=>{processPB?.kill();if(directory)await rm(directory,{recursive:true,force:true});});
async function api(action:string,body:unknown){return pb.send<any>(`/api/shared-todo/${action}`,{method:"POST",body});}
integration("classification atomically freezes original evidence and exact manual fields",async()=>{
 const r=await api("capture",{guild_id:"g",channel_id:"c",message_id:"original",source:{sender_id:"reporter"},context:{complete:true},context_text:"Original source"});
 const a=await api("assess-begin",{id:r.id,actor:"model-invoker"});
 const done=await api("assess-commit",{id:r.id,token:a.token,rules_version:"policy-original",decisions:[{action:"create",label,kind:"bug",priority:"red",title:"Crash",description:"Failure",confidence:1,reason:"Original reasoning"}]});
 expect(await pb.collection("todo_list_manual_changes").getFullList()).toHaveLength(0);
 const changed=await api("classification",{id:done.todos[0],guild_id:"g",actor:"123",kind:"feature",priority:"yellow",reason:"Developer override",expected_revision:1});
 expect(changed.kind).toBe("feature");expect(changed.priority).toBe("yellow");
 const events=await pb.collection("todo_list_manual_changes").getFullList({sort:"sequence"});
 expect(events).toHaveLength(2);expect(events.map(e=>[e.field,e.old_value,e.new_value])).toEqual([["kind","bug","feature"],["priority","red","yellow"]]);
 expect(events[0].actor).toBe("123");expect(events[0].reason).toBe("Developer override");expect(events[0].reports[0].assessment.rules_version).toBe("policy-original");expect(events[0].todo_snapshot.kind).toBe("bug");
});

integration("no-op, stale, invalid and cross-guild edits never append; generic writes cannot bypass logging",async()=>{
 const t=(await pb.collection("todo_list_todos").getFullList())[0];const before=await pb.collection("todo_list_manual_changes").getFullList();
 expect((await api("classification",{id:t.id,actor:"123",kind:t.kind,priority:t.priority})).audit).toEqual(t.audit);
 for(const body of [{kind:"bug",expected_revision:0},{priority:"pink"},{kind:"bug",guild_id:"other"},{label:"invalid"}])await expect(api("classification",{id:t.id,actor:"123",...body})).rejects.toThrow();
 await expect(pb.collection("todo_list_todos").update(t.id,{kind:"bug"})).rejects.toThrow("classification endpoint");
 await expect(pb.collection("todo_list_manual_changes").update(before[0].id,{reason:"rewrite"})).rejects.toThrow();
 await expect(pb.collection("todo_list_manual_changes").delete(before[0].id)).rejects.toThrow();
 await expect(pb.collection("todo_list_manual_changes").create({...before[0],id:undefined})).rejects.toThrow();
 expect(await pb.collection("todo_list_manual_changes").getFullList()).toEqual(before);
});

integration("a logging persistence failure rolls back all todo fields and sequence",async()=>{
 const t=(await pb.collection("todo_list_todos").getFullList())[0];
 const collection=await pb.collections.getOne("todo_list_manual_changes");
 await pb.collections.update(collection.id,{fields:collection.fields.map((f:any)=>f.name==="reason"?{...f,max:3}:f)});
 await expect(api("classification",{id:t.id,actor:"123",kind:"bug",priority:"red",reason:"Too long for storage"})).rejects.toThrow();
 expect(await pb.collection("todo_list_todos").getOne(t.id)).toEqual(t);
 expect(await pb.collection("todo_list_manual_changes").getFullList()).toHaveLength(2);
 await pb.collections.update(collection.id,{fields:collection.fields});
 const changed=await api("classification",{id:t.id,actor:"123",priority:"red"});expect(changed.priority).toBe("red");
 expect((await pb.collection("todo_list_manual_changes").getFullList({sort:"sequence"})).map(e=>e.sequence)).toEqual([1,2,3]);
});

integration("begin atomically claims stable evidence and reuses one owner-bound active run",async()=>{
 const [a,b]=await Promise.all([api("retrospective-begin",{guild_id:"g",actor:"123"}),api("retrospective-begin",{guild_id:"g",actor:"123"})]);
 expect(a.run.id).toBe(b.run.id);expect(a.run).toMatchObject({guild_id:"g",actor:"123",state:"investigating"});expect(a.run.correction_ids).toHaveLength(3);expect(a.corrections).toHaveLength(3);expect(a.reports[0].assessment.rules_version).toBe("policy-original");
 await expect(api("retrospective-begin",{guild_id:"g",actor:"456"})).rejects.toThrow();
 const t=(await pb.collection("todo_list_todos").getFullList())[0];await api("classification",{id:t.id,actor:"123",priority:"blue"});
 const replay=await api("retrospective-begin",{guild_id:"g",actor:"123"});expect(replay).toEqual(a);
 expect(await api("retrospective-begin",{guild_id:"empty",actor:"123"})).toEqual({run:null,corrections:[],reports:[],labels:[]});
});

integration("dispatch release fences exact owner token and refuses recorded threads",async()=>{
 const {run}=await api("retrospective-begin",{guild_id:"g",actor:"123"});const base={id:run.id,actor:"123",dispatch_token:"a".repeat(32)};
 await api("retrospective-stage",base);
 for(const extra of [{actor:"456"},{dispatch_token:"b".repeat(32)}])await expect(api("retrospective-release-dispatch",{...base,...extra})).rejects.toThrow();
 expect((await api("retrospective-release-dispatch",base)).dispatch_token).toBeFalsy();
 await api("retrospective-stage",base);await api("retrospective-stage",{id:run.id,actor:"123",thread_id:"123456"});
 await expect(api("retrospective-release-dispatch",base)).rejects.toThrow();
 expect((await pb.collection("todo_list_assessment_retrospectives").getOne(run.id)).dispatch_token).toBe(base.dispatch_token);
});

integration("stage freezes baseline and conversation identity across owner/guild/stale replays",async()=>{
 const {run}=await api("retrospective-begin",{guild_id:"g",actor:"123"});
 const body={id:run.id,actor:"123",thread_id:"123456",baseline_version:"policy-original",baseline_hash:"a".repeat(64)};
 const staged=await api("retrospective-stage",body);expect(staged.thread_id).toBe(body.thread_id);
 expect(await api("retrospective-stage",body)).toEqual(staged);
 for(const extra of [{thread_id:"789"},{baseline_hash:"b".repeat(64)},{actor:"456"},{guild_id:"foreign"}])await expect(api("retrospective-stage",{...body,...extra})).rejects.toThrow();
 expect((await pb.collection("todo_list_assessment_retrospectives").getOne(run.id)).baseline_hash).toBe(body.baseline_hash);
});

integration("proposal binds a full hash and evidence before explicit approval freezes it",async()=>{
 const {run}=await api("retrospective-begin",{guild_id:"g",actor:"123"});const base={id:run.id,actor:"123"};const hash="c".repeat(64);
 await expect(api("retrospective-complete",{...base,proposal_hash:hash,policy_version:"v2",policy_hash:hash})).rejects.toThrow();
 await expect(api("retrospective-approve-begin",{...base,proposal_hash:hash})).rejects.toThrow();
 await expect(api("retrospective-proposal",{...base,proposal_hash:"short",proposal:{rules:[],memory:[],summary:"No change"}})).rejects.toThrow();
 await expect(api("retrospective-proposal",{...base,proposal_hash:hash,proposal:{rules:[{text:"Invented",evidence_ids:["unknown"]}],memory:[],summary:"New rule"}})).rejects.toThrow();
 const proposal={rules:[{text:"Example",evidence_ids:[run.correction_ids[0]]}],memory:[],summary:"Learn routing"};
 const proposed=await api("retrospective-proposal",{...base,proposal_hash:hash,proposal});expect(proposed.state).toBe("proposed");
 const approved=await api("retrospective-approve-begin",{...base,proposal_hash:hash});expect(approved.state).toBe("applying");expect(await api("retrospective-approve-begin",{...base,proposal_hash:hash})).toEqual(approved);
 await expect(api("retrospective-proposal",{...base,proposal_hash:"d".repeat(64),proposal})).rejects.toThrow();
 await expect(api("retrospective-approve-begin",{...base,proposal_hash:"d".repeat(64)})).rejects.toThrow();
 await expect(api("retrospective-approve-begin",{...base,actor:"456",proposal_hash:hash})).rejects.toThrow();
 expect((await api("retrospective-begin",{guild_id:"g",actor:"123"})).run.correction_ids).toEqual(run.correction_ids);
});

integration("completion requires approval and exact receipt replay; only frozen batch becomes covered",async()=>{
 const {run}=await api("retrospective-begin",{guild_id:"g",actor:"123"});const receipt={id:run.id,actor:"123",proposal_hash:"c".repeat(64),policy_version:"v2",policy_hash:"e".repeat(64)};
 await expect(api("retrospective-complete",{...receipt,proposal_hash:"d".repeat(64)})).rejects.toThrow();
 await expect(api("retrospective-complete",{...receipt,policy_hash:"invalid"})).rejects.toThrow();
 const done=await api("retrospective-complete",receipt);expect(done.state).toBe("completed");expect(done.policy_hash).toBe(receipt.policy_hash);
 expect(await api("retrospective-complete",receipt)).toEqual(done);
 await expect(api("retrospective-complete",{...receipt,policy_version:"v3"})).rejects.toThrow();
 expect(await api("retrospective-fail",{id:run.id,actor:"123",error:"Lost response"})).toEqual(done);
 const next=await api("retrospective-begin",{guild_id:"g",actor:"123"});expect(next.run.id).not.toBe(run.id);expect(next.corrections).toHaveLength(1);expect(next.corrections[0].sequence).toBe(4);
});

integration("failure retries the same batch, no-change still requires approval, applying failures preserve approval",async()=>{
 const {run}=await api("retrospective-begin",{guild_id:"g",actor:"123"});const base={id:run.id,actor:"123"};
 const failed=await api("retrospective-fail",{...base,error:"Provider unavailable"});expect(failed.state).toBe("failed");
 const resumed=await api("retrospective-begin",{guild_id:"g",actor:"123"});expect(resumed.run.id).toBe(run.id);expect(resumed.run.correction_ids).toEqual(run.correction_ids);expect(resumed.run.state).toBe("investigating");
 await api("retrospective-stage",{...base,thread_id:"6789",baseline_version:"v2",baseline_hash:"e".repeat(64)});
 const proposal={rules:[],memory:[],summary:"Explicit no-change conclusion"},proposal_hash="f".repeat(64);
 const proposed=await api("retrospective-proposal",{...base,proposal_hash,proposal});
 expect((await api("retrospective-proposal",{...base,proposal_hash,proposal})).proposal).toEqual(proposed.proposal);
 const receipt={...base,proposal_hash,policy_version:"v2",policy_hash:"e".repeat(64)};
 await expect(api("retrospective-complete",receipt)).rejects.toThrow();
 await api("retrospective-approve-begin",{...base,proposal_hash});
 await api("retrospective-fail",{...base,error:"Bridge response uncertain"});
 expect((await api("retrospective-begin",{guild_id:"g",actor:"123"})).run.state).toBe("applying");
 await expect(api("retrospective-proposal",{...base,proposal_hash:"a".repeat(64),proposal})).rejects.toThrow();
 await api("retrospective-complete",receipt);
 expect((await api("retrospective-begin",{guild_id:"g",actor:"123"})).run).toBeNull();
});

integration("labels retain names and original evidence after later catalog/report edits; collections stay private",async()=>{
 const t=(await pb.collection("todo_list_todos").getFullList())[0];
 const other=await pb.collection("todo_list_labels").create({guild_id:"g",name:"Other plugin"});
 await api("label",{id:t.id,label:other.id,actor:"123",reason:"Correct routing"});
 const event=(await pb.collection("todo_list_manual_changes").getFullList({sort:"-sequence"}))[0];
 expect(event).toMatchObject({old_value:label,new_value:other.id,old_name:"Plugin",new_name:"Other plugin"});
 await pb.collection("todo_list_labels").update(other.id,{name:"Renamed later"});
 await pb.collection("todo_list_reports").update(event.reports[0].id,{context_text:"Later evidence",assessment:{rules_version:"later"}});
 expect(await pb.collection("todo_list_manual_changes").getOne(event.id)).toEqual(event);
 const guest=new PocketBase(pb.baseURL);
 for(const collection of ["todo_list_manual_changes","todo_list_assessment_retrospectives"])await expect(guest.collection(collection).getList()).rejects.toThrow();
 await expect(guest.send("/api/shared-todo/retrospective-begin",{method:"POST",body:{guild_id:"g",actor:"123"}})).rejects.toThrow();
});
integration("a run survives a real PocketBase restart with stable frozen batch and owner",async()=>{
 const before=await api("retrospective-begin",{guild_id:"g",actor:"123"});
 const stopped=new Promise<void>(resolve=>processPB.once("exit",()=>resolve()));processPB.kill();await stopped;
 processPB=spawn(binary!,["serve","--http",new URL(pb.baseURL).host,"--dir",directory,"--migrationsDir",join(directory,"migrations"),"--automigrate=false","--hooksDir",resolve("pocketbase/pb_hooks")]);
 processPB.stdout?.on("data",d=>logs+=d);processPB.stderr?.on("data",d=>logs+=d);
 for(let i=0;i<100;i++){try{await pb.health.check();break;}catch{await new Promise(r=>setTimeout(r,50));}}
 const after=await api("retrospective-begin",{guild_id:"g",actor:"123"});expect(after).toEqual(before);
});

integration("explicit batches cap at 50 without skipping newer corrections",async()=>{
 const l=await pb.collection("todo_list_labels").create({guild_id:"batch",name:"Batch"});
 const r=await api("capture",{guild_id:"batch",channel_id:"c",message_id:"batch",source:{},context:{complete:true},context_text:"Batch source"});const a=await api("assess-begin",{id:r.id,actor:"123"});
 const done=await api("assess-commit",{id:r.id,token:a.token,rules_version:"v1",decisions:[{action:"create",label:l.id,kind:"bug",priority:"red",title:"Batch",description:"Issue",confidence:1,reason:"Evidence"}]});
 for(let i=0;i<51;i++)await api("classification",{id:done.todos[0],actor:"123",priority:i%2?"red":"yellow"});
 const first=await api("retrospective-begin",{guild_id:"batch",actor:"123"});expect(first.corrections).toHaveLength(50);expect(first.run.upper_sequence).toBe(first.corrections.at(-1).sequence);
 expect(Array.from(first.opening_context).length).toBeLessThanOrEqual(60000);
 expect(Buffer.byteLength(JSON.stringify({run_id:first.run.id,thread_id:'0'.repeat(20),user_id:'123',guild_id:'batch',corrections:first.corrections,context:first.opening_context}))).toBeLessThanOrEqual(200000);
 expect(first.corrections.every((c:any)=>c.evidence_ref?.id===c.id)).toBe(true);
 const base={id:first.run.id,actor:"123"},proposal_hash="1".repeat(64);
 await api("retrospective-stage",{...base,thread_id:"123",baseline_version:"v1",baseline_hash:"2".repeat(64)});
 await api("retrospective-proposal",{...base,proposal_hash,proposal:{rules:[],memory:[],summary:"No change"}});
 await api("retrospective-approve-begin",{...base,proposal_hash});await api("retrospective-complete",{...base,proposal_hash,policy_version:"v1",policy_hash:"2".repeat(64)});
 const next=await api("retrospective-begin",{guild_id:"batch",actor:"123"});expect(next.corrections).toHaveLength(1);expect(next.corrections[0].sequence).toBe(first.run.upper_sequence+1);
},30000);

integration("unchanged prior learned entries retain historical evidence while new lessons require this frozen batch",async()=>{
 const {run}=await api("retrospective-begin",{guild_id:"g",actor:"123"});const base={id:run.id,actor:"123"};
 const original=(await pb.collection("todo_list_manual_changes").getFullList({sort:"sequence"}))[0];
 await api("retrospective-stage",{...base,thread_id:"456",baseline_version:"v2",baseline_hash:"e".repeat(64)});
 const item={text:"Example",evidence_ids:[original.id]};
 const result=await api("retrospective-proposal",{...base,proposal_hash:"3".repeat(64),proposal:{rules:[item],memory:[],summary:"Keep previous learned rule"}});expect(result.state).toBe("proposed");
 await expect(api("retrospective-proposal",{...base,proposal_hash:"4".repeat(64),proposal:{rules:[{...item,text:"New unsupported lesson"}],memory:[],summary:"New rule"}})).rejects.toThrow();
});

integration("original model decision and policy survive report reassessment before a manual correction",async()=>{
 const r=await api("capture",{guild_id:"g",channel_id:"c",message_id:"origin-proof",source:{sender_id:"original"},context:{complete:true},context_text:"Original immutable evidence"});
 const a=await api("assess-begin",{id:r.id,actor:"123"});const decision={action:"create",label,kind:"bug",priority:"red",title:"Original",description:"Original",confidence:1,reason:"Original model reason"};
 const done=await api("assess-commit",{id:r.id,token:a.token,rules_version:"origin-policy",decisions:[decision]});
 await pb.collection("todo_list_reports").update(r.id,{assessment:{rules_version:"replacement"},context_text:"Replacement report"});
 await api("classification",{id:done.todos[0],actor:"123",priority:"yellow"});
 const event=(await pb.collection("todo_list_manual_changes").getFullList({sort:"-sequence"}))[0];
 expect(event.todo_snapshot.audit[0].assessment_snapshot).toMatchObject({rules_version:"origin-policy",decision,report:{context_text:"Original immutable evidence"}});
});

integration("dispatch reservation and thread persist before bridge admission without allowing replacements",async()=>{
 const {run}=await api("retrospective-begin",{guild_id:"batch",actor:"123"});const base={id:run.id,actor:"123"},dispatch_token="9".repeat(32);
 const reserved=await api("retrospective-stage",{...base,dispatch_token});expect(reserved.dispatch_token).toBe(dispatch_token);expect(reserved.thread_id).toBe("");
 expect(await api("retrospective-stage",{...base,dispatch_token})).toEqual(reserved);
 await expect(api("retrospective-stage",{...base,dispatch_token:"8".repeat(32)})).rejects.toThrow();
 const threaded=await api("retrospective-stage",{...base,thread_id:"654321"});expect(threaded.thread_id).toBe("654321");expect(threaded.baseline_hash).toBe("");
 await expect(api("retrospective-stage",{...base,thread_id:"456"})).rejects.toThrow();
 await expect(api("retrospective-proposal",{...base,proposal_hash:"b".repeat(64),proposal:{rules:[],memory:[],summary:"Too soon"}})).rejects.toThrow();
 const staged=await api("retrospective-stage",{...base,thread_id:"654321",baseline_hash:"a".repeat(64),baseline_version:"v1"});expect(staged.baseline_version).toBe("v1");
});
integration('service approval race and frozen retry recover against real PB without replacing applying hash',async()=>{
 const {run}=await api('retrospective-begin',{guild_id:'batch',actor:'123'});
 const A='a'.repeat(64),B='b'.repeat(64);let frozen=false,fail=true,failApproval=true,writes=0;
 const proposal={rules:[],memory:[],summary:'Explicit no change'};
 await api('retrospective-proposal',{id:run.id,actor:'123',proposal_hash:A,proposal});
 let status:any={run_id:run.id,state:'proposed',proposal_hash:B,proposal,diff:'No change'};
 const bridge={ready:async()=>{},status:async()=>status,prepareApproval:async(_id:string,_actor:string,h:string)=>{if(h!==status.proposal_hash)throw Error('Stale raced proposal');frozen=true;status={...status,state:'approval_pending'};return status;},approve:async()=>{expect(frozen).toBe(true);if(failApproval){failApproval=false;throw Error('bridge temporarily unavailable');}writes++;status={run_id:run.id,state:'applied',proposal_hash:B,policy_version:'v1',policy_hash:A};throw Error('lost approval response');}};
 const repo={operation:async(a:string,b:any)=>{if(a==='retrospective-approve-begin'&&fail){fail=false;throw Error('PB network failure');}return api(a,b);}};
 const service=new TodoRetrospective(repo as any,bridge as any);
 await expect(service.approve('batch','123',run.id,A)).rejects.toThrow('Stale raced');
 expect((await pb.collection('todo_list_assessment_retrospectives').getOne(run.id)).state).toBe('proposed');
 await expect(service.approve('batch','123',run.id,B)).rejects.toThrow('PB network failure');
 expect(status.state).toBe('approval_pending');expect(writes).toBe(0);
 await service.open('batch','123');expect(writes).toBe(0);
 await expect(service.approve('batch','123',run.id,B)).rejects.toThrow('bridge temporarily unavailable');
 expect((await pb.collection('todo_list_assessment_retrospectives').getOne(run.id)).state).toBe('applying');
 await service.open('batch','123');expect(writes).toBe(0);
 await service.approve('batch','123',run.id,B);
 const done=await pb.collection('todo_list_assessment_retrospectives').getOne(run.id);expect(done.state).toBe('completed');expect(done.proposal_hash).toBe(B);expect(writes).toBe(1);
});
 integration("huge Unicode single-event evidence fits before freeze with exact immutable retrieval",async()=>{
 const guild_id="huge-wire";
 const l=await pb.collection("todo_list_labels").create({guild_id,name:"Huge"});
 const text="🧀漢\"".repeat(150000);
 const r=await api("capture",{guild_id,channel_id:"c",message_id:"huge",source:{},context:{complete:true},context_text:text});
 const a=await api("assess-begin",{id:r.id,actor:"123"});
 const d=await api("assess-commit",{id:r.id,token:a.token,rules_version:"v1",decisions:[{action:"create",label:l.id,kind:"bug",priority:"red",title:"Huge",description:"Issue",confidence:1,reason:"Original"}]});
 await api("classification",{id:d.todos[0],actor:"123",priority:"yellow",reason:"Exact reason"});
 const batch=await api("retrospective-begin",{guild_id,actor:"123"});
 expect(batch.corrections).toHaveLength(1);
 expect(batch.opening_context).toContain("PocketBase");
 expect(Array.from(batch.opening_context).length).toBeLessThanOrEqual(60000);
 expect(Buffer.byteLength(JSON.stringify({run_id:batch.run.id,thread_id:"0".repeat(20),user_id:"123",guild_id,corrections:batch.corrections,context:batch.opening_context}))).toBeLessThanOrEqual(200000);
 const ref=batch.corrections[0].evidence_ref;
 const original=await pb.collection(ref.collection).getOne(ref.id);
 expect(original.reports[0].context_text).toBe(text);
 expect(original.reason).toBe("Exact reason");
 expect(createHash('sha256').update(canonical(original)).digest('hex')).toBe(ref.sha256);
 expect(batch.run.correction_ids).toEqual([original.id]);
 // Local SQLite fixture reproduces a legacy full-evidence freeze; never weakens API guards.
 const legacy=()=>{const db=new Database(join(directory,'data.db'));db.query("UPDATE todo_list_assessment_retrospectives SET corrections=(SELECT json_array(json_object('id',id,'reports',json(reports),'todo_snapshot',json(todo_snapshot))) FROM todo_list_manual_changes WHERE id=?) WHERE id=?").run(original.id,batch.run.id);db.close();};
 legacy();
 const recovered=await api('retrospective-begin',{guild_id,actor:'123'});
 expect(recovered.run.id).toBe(batch.run.id);expect(recovered.run.correction_ids).toEqual(batch.run.correction_ids);
 expect(recovered.run.error).toContain('preserved correction IDs');
 expect(recovered.corrections).toEqual(batch.corrections);
 let preflight=false,started=false;
 const service=new TodoRetrospective({operation:api} as any,{
 ready:async()=>{},preflightRetrospective:async(input:any)=>{expect((await pb.collection('todo_list_assessment_retrospectives').getOne(input.run.id)).dispatch_token).toBe('');expect(Array.from(input.context).length).toBeLessThanOrEqual(60000);preflight=true;},
 startRetrospective:async(input:any)=>{expect(preflight).toBe(true);started=true;await input.onThread('123456');return {thread_id:'123456',baseline_version:'v1',baseline_hash:'a'.repeat(64)};},status:async()=>({run_id:batch.run.id,state:'investigating'})
 } as any);
 await service.open(guild_id,'123');expect(started).toBe(true);
 legacy();const bound=await pb.collection('todo_list_assessment_retrospectives').getOne(batch.run.id);
 await expect(api('retrospective-begin',{guild_id,actor:'123'})).rejects.toThrow('operator recovery');
 expect(await pb.collection('todo_list_assessment_retrospectives').getOne(batch.run.id)).toEqual(bound);
 const db=new Database(join(directory,'data.db'));db.query("UPDATE todo_list_assessment_retrospectives SET state='applying', proposal_hash=?, proposal=? WHERE id=?").run('b'.repeat(64),JSON.stringify({rules:[],memory:[],summary:'Frozen approval'}),batch.run.id);db.close();
 const approved=await pb.collection('todo_list_assessment_retrospectives').getOne(batch.run.id);
 await expect(api('retrospective-begin',{guild_id,actor:'123'})).rejects.toThrow('operator recovery');
 expect(await pb.collection('todo_list_assessment_retrospectives').getOne(batch.run.id)).toEqual(approved);
 },30000);
