import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import PocketBase from "pocketbase";
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
 processPB=spawn(binary,["serve","--http",`127.0.0.1:${port}`,"--dir",directory,"--hooksDir",resolve("pocketbase/pb_hooks")]);
 processPB.stdout?.on("data",d=>logs+=d);processPB.stderr?.on("data",d=>logs+=d);
 pb=new PocketBase(`http://127.0.0.1:${port}`);pb.autoCancellation(false);
 for(let i=0;i<100;i++){try{await pb.health.check();break;}catch{await new Promise(r=>setTimeout(r,50));}}
 await pb.collection("_superusers").authWithPassword("tests@example.com","test-password-12345");
 await pb.collections.import(JSON.parse(await readFile("pocketbase/todo.collections.json","utf8")),false);
 label=(await pb.collection("todo_list_labels").create({guild_id:"g",name:"Plugin",description:"Plugin",thread_id:"thread",repo:"https://github.com/Team/Plugin"})).id;
},20000);
afterAll(async()=>{processPB?.kill();if(directory)await rm(directory,{recursive:true,force:true});});
async function api(action:string,body:unknown){return pb.send<any>(`/api/shared-todo/${action}`,{method:"POST",body});}
integration("private report capture is idempotent and stores complete source snapshots",async()=>{
 const body={guild_id:"g",channel_id:"c",message_id:"m",source:{url:"https://discord.com/channels/g/c/m",sender_id:"u",created_by:"a"},context:{complete:true,messages:[]},context_text:"context"};
 const [a,b]=await Promise.all([api("capture",body),api("capture",body)]);
 expect(a.id).toBe(b.id);report=a.id;
 expect((await pb.collection("todo_list_reports").getOne(a.id)).source.created_by).toBe("a");
 const guest=new PocketBase(pb.baseURL);
 await expect(guest.collection("todo_list_reports").getOne(a.id)).rejects.toThrow();
});
integration("assessment atomically splits and merges, allocates monotonic numbers across concurrent requests; rollback is retry safe",async()=>{
 const begin=await api("assess-begin",{id:report,actor:"a"});
 const create={action:"create",label,kind:"bug",priority:"red",title:"Crash",description:"Cannot play",confidence:0.9,reason:"Crash"};
 await expect(api("assess-commit",{id:report,token:begin.token,rules_version:"v1",decisions:[create,{...create,label:"invalid"}]})).rejects.toThrow();
 expect((await pb.collection("todo_list_todos").getFullList()).length).toBe(0);
 const done=await api("assess-commit",{id:report,token:begin.token,rules_version:"v1",decisions:[create,{...create,title:"Other"},{...create,confidence:0.69}]});
 expect(done.state).toBe("needs_clarification");expect(done.todos).toHaveLength(2);
 const todos=await pb.collection("todo_list_todos").getFullList({sort:"number"});
 expect(todos.map(t=>t.number)).toEqual([1,2]);
 await expect(api("assess-commit",{id:report,token:begin.token,rules_version:"v1",decisions:[create]})).rejects.toThrow();
 const captures=await Promise.all(["m2","m3"].map(message_id=>api("capture",{guild_id:"g",channel_id:"c",message_id,source:{},context:{complete:true},context_text:"x"})));
 await Promise.all(captures.map(async(r,i)=>{const b=await api("assess-begin",{id:r.id,actor:"a"});return api("assess-commit",{id:r.id,token:b.token,rules_version:"v1",decisions:[i===0?create:{action:"merge",todo:todos[0].id,confidence:0.9,reason:"Same"}]});}));
 expect((await pb.collection("todo_list_todos").getFullList({sort:"number"})).map(t=>t.number)).toEqual([1,2,3]);
});
integration("atomic claims prevent double start across clients; reopen clears claim but preserves work and audit",async()=>{
 const todo=(await pb.collection("todo_list_todos").getFullList({sort:"number"}))[0];
 const results=await Promise.allSettled([api("claim",{id:todo.id,actor:"dev1"}),api("claim",{id:todo.id,actor:"dev2"})]);
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 const success=results.find(r=>r.status==="fulfilled") as PromiseFulfilledResult<any>;
 await api("claim-finish",{id:todo.id,token:success.value.claim.token,message_id:"handoff"});
 await pb.collection("todo_list_todos").update(todo.id,{status:"done",work:{notes:"kept"},pr_links:["https://github.com/t/r/pull/1"]});
 const reopened=await api("reopen",{number:todo.number,guild_id:"g",actor:"dev",reason:"Regression"});
 expect(reopened.status).toBe("open");expect(reopened.claim).toEqual({});expect(reopened.work).toEqual({notes:"kept"});expect(reopened.pr_links).toHaveLength(1);
 expect(reopened.audit.at(-1).actor).toBe("dev");
 const noop=await api("reopen",{number:todo.number,guild_id:"g",actor:"dev"});expect(noop.audit).toEqual(reopened.audit);
});
integration("server rejects label group cycles and cross-guild descendants",async()=>{
 const a=await pb.collection("todo_list_label_groups").create({guild_id:"g",name:"Root",labels:[label],child_groups:[]});
 const b=await pb.collection("todo_list_label_groups").create({guild_id:"g",name:"Child",labels:[label],child_groups:[a.id]});
 await expect(pb.collection("todo_list_label_groups").update(a.id,{child_groups:[b.id]})).rejects.toThrow();
 const foreign=await pb.collection("todo_list_label_groups").create({guild_id:"foreign",name:"Foreign",labels:[],child_groups:[]});
 await expect(pb.collection("todo_list_label_groups").update(a.id,{child_groups:[foreign.id]})).rejects.toThrow();
});
integration("public numbers cannot be edited or reused after deleting highest numbered todo",async()=>{
 const todos=await pb.collection("todo_list_todos").getFullList({sort:"number"});
 await expect(pb.collection("todo_list_todos").update(todos[0].id,{number:999})).rejects.toThrow();
 await pb.collection("todo_list_todos").delete(todos.at(-1)!.id);
 const r=await api("capture",{guild_id:"g",channel_id:"c",message_id:"m-next",source:{},context:{complete:true},context_text:"x"});
 const begin=await api("assess-begin",{id:r.id,actor:"dev"});
 const done=await api("assess-commit",{id:r.id,token:begin.token,rules_version:"v1",decisions:[{action:"create",label,kind:"feature",priority:"blue",title:"Feature",description:"New thing",confidence:1,reason:"Explicit request"}]});
 expect((await pb.collection("todo_list_todos").getOne(done.todos[0])).number).toBe(4);
});
integration("human clarification preserves accepted split associations and adds only reviewed decisions",async()=>{
 const r=(await pb.collection("todo_list_reports").getFullList({filter:"state='needs_clarification'"}))[0];
 const previous=[...r.todos];const begin=await api("resolve-begin",{id:r.id,actor:"reviewer"});
 const resolved=await api("assess-commit",{id:r.id,token:begin.token,rules_version:"manual",decisions:[{action:"create",label,kind:"feature",priority:"blue",title:"Reviewed feature",description:"Reviewed request",confidence:1,reason:"Confirmed with reporter"}]});
 expect(resolved.state).toBe("assessed");expect(resolved.todos).toHaveLength(previous.length+1);expect(resolved.todos).toEqual(expect.arrayContaining(previous));expect(resolved.assessment.previous.decisions).toHaveLength(3);
});
for(const interruption of ["failure","expiry"]){
 integration(`human resolution ${interruption} blocks automatic reassessment and preserves accepted splits on manual retry`,async()=>{
  const r=await api("capture",{guild_id:"g",channel_id:"c",message_id:`resolution-${interruption}`,source:{},context:{complete:true},context_text:"two issues"});
  const create={action:"create",label,kind:"bug",priority:"yellow",title:`Accepted ${interruption}`,description:"Already accepted issue",confidence:1,reason:"Confirmed evidence"};
  const initial=await api("assess-begin",{id:r.id,actor:"dev"});
  const partial=await api("assess-commit",{id:r.id,token:initial.token,rules_version:"v1",decisions:[create,{action:"clarify",confidence:0.4,reason:"Need reporter input"}]});
  const accepted=await pb.collection("todo_list_todos").getOne(partial.todos[0]);
  const before=(await pb.collection("todo_list_todos").getFullList()).map(t=>t.id).sort();
  const resolving=await api("resolve-begin",{id:r.id,actor:"reviewer"});
  if(interruption==="failure")await api("assess-fail",{id:r.id,token:resolving.token,error:"Interrupted persistence"});
  else await pb.collection("todo_list_reports").update(r.id,{assessment:{...resolving.report.assessment,started_ms:Date.now()-600001}});
  await expect(api("assess-begin",{id:r.id,actor:"automatic"})).rejects.toThrow("Resolve clarification manually");
  expect((await pb.collection("todo_list_reports").getOne(r.id)).todos).toEqual(partial.todos);
  const retry=await api("resolve-begin",{id:r.id,actor:"reviewer"});
  expect(retry.token).not.toBe(resolving.token);
  await expect(api("assess-commit",{id:r.id,token:resolving.token,rules_version:"manual",decisions:[create]})).rejects.toThrow();
  const resolved=await api("assess-commit",{id:r.id,token:retry.token,rules_version:"manual",decisions:[{action:"dismiss",confidence:1,reason:"Unresolved issue is expected gameplay"}]});
  expect(resolved.state).toBe("assessed");expect(resolved.todos).toEqual(partial.todos);
  expect(await pb.collection("todo_list_todos").getOne(accepted.id)).toEqual(accepted);
  expect((await pb.collection("todo_list_todos").getFullList()).map(t=>t.id).sort()).toEqual(before);
  expect((await pb.collection("todo_list_reports").getOne(r.id)).todos).toEqual(partial.todos);
 });
}
integration("done means PR ready and status changes preserve accumulated work and links",async()=>{
 const t=(await pb.collection("todo_list_todos").getFullList({filter:"status='open'"})).find(t=>!t.pr_links?.length)!;
 await expect(api("status",{id:t.id,actor:"dev",status:"done",reason:"Ready"})).rejects.toThrow();
 const ready=await api("status",{id:t.id,actor:"dev",status:"done",reason:"PR ready for review",pr:"https://github.com/Team/Plugin/pull/42",work:"Verified tests"});
 expect(ready.status).toBe("done");expect(ready.pr_links).toContain("https://github.com/Team/Plugin/pull/42");expect(ready.audit.at(-1).reason).toBe("PR ready for review");
});
integration("Start forum claim no longer requires a label developer thread and persists attempt context and new forum thread",async()=>{
 const l=await pb.collection("todo_list_labels").create({guild_id:"g",name:"No old thread",description:"Plugin",repo:"https://github.com/Team/Plugin",thread_id:""});
 const r=await api("capture",{guild_id:"g",channel_id:"c",message_id:"forum-report",source:{},context:{complete:true},context_text:"full context"});
 const begin=await api("assess-begin",{id:r.id,actor:"dev"});const assessed=await api("assess-commit",{id:r.id,token:begin.token,rules_version:"v1",decisions:[{action:"create",label:l.id,kind:"feature",priority:"blue",title:"Forum task",description:"Feature",confidence:1,reason:"Explicit"}]});
 const claimed=await api("claim",{id:assessed.todos[0],actor:"dev"});
 const prepared=await api("claim-context",{id:claimed.id,token:claimed.claim.token,prompt:"complete opening prompt"});expect(prepared.claim.prompt).toBe("complete opening prompt");
 const posted=await api("claim-thread",{id:claimed.id,token:claimed.claim.token,thread_id:"123456789",thread_url:"https://discord.com/channels/g/123456789"});
 expect(posted.claim.thread_id).toBe("123456789");expect(posted.claim.forum_id).toBe("1560943737688039474");expect(posted.audit.at(-1).thread_id).toBe("123456789");
});
integration("manual relabel and closed status audit old/new/reason and reject stale edits without requiring Hermes",async()=>{
 const t=(await pb.collection("todo_list_todos").getFullList({filter:"status='open'"}))[0];
 const other=await pb.collection("todo_list_labels").create({guild_id:"g",name:"Other plugin",description:"Other",repo:"https://github.com/Team/Other"});
 const revision=t.audit.length;
 const changed=await api("label",{id:t.id,label:other.id,actor:"dev",reason:"Correct plugin",expected_revision:revision});
 expect(changed.label).toBe(other.id);expect(changed.audit.at(-1)).toMatchObject({event:"label_changed",old:t.label,new:other.id,actor:"dev",reason:"Correct plugin"});
 await expect(api("status",{id:t.id,status:"closed",actor:"dev",expected_revision:revision})).rejects.toThrow();
 const closed=await api("status",{id:t.id,status:"closed",actor:"dev",reason:"Fixed manually",expected_revision:changed.audit.length});expect(closed.status).toBe("closed");expect(closed.claim).toEqual({});
 expect((await api("reopen",{number:t.number,guild_id:"g",actor:"dev"})).status).toBe("open");
 const claimed=await api("claim",{id:t.id,actor:"dev"});
 await expect(api("status",{id:t.id,status:"closed",actor:"other",expected_revision:claimed.audit.length})).rejects.toThrow();
});
integration("failed assessment is retryable; ambiguous handoff is blocked with audited human recovery",async()=>{
 const r=await api("capture",{guild_id:"g",channel_id:"c",message_id:"m-fail",source:{},context:{complete:true},context_text:"x"});
 const b=await api("assess-begin",{id:r.id,actor:"dev"});await api("assess-fail",{id:r.id,token:b.token,error:"Transport failed"});
 const retry=await api("assess-begin",{id:r.id,actor:"dev"});expect(retry.token).not.toBe(b.token);
 const done=await api("assess-commit",{id:r.id,token:retry.token,rules_version:"v1",decisions:[{action:"dismiss",confidence:1,reason:"Not actionable"}]});expect(done.state).toBe("dismissed");
 const t=(await pb.collection("todo_list_todos").getFullList({filter:"status='open'"}))[0];const claimed=await api("claim",{id:t.id,actor:"dev"});
 const blocked=await api("claim-fail",{id:t.id,token:claimed.claim.token,definitive:false,error:"Timeout"});expect(blocked.status).toBe("blocked");
 await expect(api("claim",{id:t.id,actor:"other"})).rejects.toThrow();
 const recovered=await api("recover",{id:t.id,actor:"dev",message_id:"existing-session",reason:"Verified destination"});expect(recovered.status).toBe("in_progress");expect(recovered.claim.message_id).toBe("existing-session");
});
