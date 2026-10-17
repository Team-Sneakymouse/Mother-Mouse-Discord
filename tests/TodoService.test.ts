import { expect, test } from "bun:test";
import { TodoService } from "../src/todo/service.js";
const todo={id:"todo",number:1,guild_id:"g",label:"label",title:"Fix",description:"Fix the crash",kind:"bug",priority:"red",status:"open",claim:{}};
const label={id:"label",guild_id:"g",name:"Plugin",description:"Plugin",repo:"https://github.com/Team/Plugin",thread_id:"thread"};
function fixture(){let current:any=structuredClone(todo);const calls:any[]=[];const reports=[{id:"r",source:{url:"https://discord.com/channels/g/c/m",channel_name:"bugs",sender_name:"Alice"},context_text:"### Alice\n"+"context".repeat(4000),context:{complete:false,errors:["history_safety_bound"]},assessment:{reason:"DO NOT HAND OFF THIS"}}];const repo:any={todo:async()=>current,label:async()=>label,reportsFor:async()=>reports,operation:async(action:string,body:any)=>{calls.push({action,body});if(action==="claim"){current={...current,claim:{token:"token",developer:body.actor},status:"in_progress"};return current;}return {...current,claim:{...current.claim,message_id:body.message_id}};}};return {repo,calls,reports};}
test("Start uses the label returned by the atomic claim after a concurrent relabel",async()=>{
 const f=fixture();const operation=f.repo.operation;let claimed=false;const labelReads:string[]=[];let opened:any;
 f.repo.operation=async(action:string,body:any)=>{const result=await operation(action,body);if(action==="claim"){claimed=true;return {...result,label:"new-label"};}return result;};
 f.repo.label=async(id:string)=>{labelReads.push(id);return id==="new-label"?{...label,id,name:"New plugin",repo:"https://github.com/Team/NewPlugin"}:label;};
 f.repo.reportsFor=async()=>claimed?[{...f.reports[0],context_text:"latest report after claim"}]:f.reports;
 await new TodoService(f.repo,undefined,{ready:async()=>{},start:async input=>{opened=input;return {conversationId:"session"};}}).start("todo","dev","g");
 expect(opened.prompt).toContain("Repository configured for label New plugin: https://github.com/Team/NewPlugin");
 expect(opened.prompt).not.toContain("https://github.com/Team/Plugin");expect(opened.prompt).toContain("latest report after claim");expect(labelReads).toEqual(["new-label"]);
});
test("Start carries post-claim label, priority and kind into forum metadata",async()=>{
 const f=fixture();const operation=f.repo.operation;let opened:any;
 f.repo.operation=async(action:string,body:any)=>{const result=await operation(action,body);return action==="claim"?{...result,number:7,title:"Claimed summary",priority:"blue",kind:"feature"}:result;};
 await new TodoService(f.repo,undefined,{ready:async()=>{},start:async input=>{opened=input;return {conversationId:"session"};}}).start("todo","dev","g");
 expect(opened).toMatchObject({labelName:"Plugin",priority:"blue",kind:"feature",todoNumber:7,title:"Claimed summary"});
});
for(const missing of ["repository","label"]){
 test(`Start safely releases a claim when its ${missing} is missing after claim`,async()=>{
  const f=fixture();let started=false;let claimed=false;const operation=f.repo.operation;
  f.repo.operation=async(action:string,body:any)=>{const result=await operation(action,body);if(action==="claim")claimed=true;return result;};
  f.repo.label=async()=>{expect(claimed).toBe(true);if(missing==="label")throw new Error("Label not found");return {...label,repo:""};};
  await expect(new TodoService(f.repo,undefined,{ready:async()=>{},start:async()=>{started=true;return {conversationId:"session"};}}).start("todo","dev","g")).rejects.toThrow(missing==="label"?"Label not found":"repository before Start");
  expect(started).toBe(false);expect(f.calls.map(c=>c.action)).toEqual(["claim","claim-fail"]);expect(f.calls[1].body).toMatchObject({id:"todo",token:"token",definitive:true});
 });
}
test("opening prompt lists every clickable original report above all source context with explicit repository",async()=>{
 const f=fixture();f.reports.push({...f.reports[0],id:"r2",source:{...f.reports[0].source,url:"https://discord.com/channels/g/c/m2"},context_text:"second full context"});let prompt="";
 await new TodoService(f.repo,undefined,{ready:async()=>{},start:async input=>{prompt=input.prompt;return {conversationId:"session"};}}).start("todo","dev","g");
 expect(prompt).toContain("Repository configured for label Plugin: https://github.com/Team/Plugin");
 const contextStart=prompt.indexOf("Source snapshot:");expect(contextStart).toBeGreaterThan(0);
 expect(prompt.slice(0,contextStart)).toContain("[Report 1](https://discord.com/channels/g/c/m)");
 expect(prompt.slice(0,contextStart)).toContain("[Report 2](https://discord.com/channels/g/c/m2)");
 expect(prompt).toContain(f.reports[0].context_text);expect(prompt).toContain("second full context");expect(prompt).not.toContain("DO NOT HAND OFF THIS");
});
test("Start claims atomically then supplies full reports and snapshots without reasoning to designated new conversation",async()=>{
 const {repo,calls}=fixture();let opened:any;
 const transport={ready:async()=>{},start:async(input:any)=>{opened=input;await input.onThreadCreated({id:"999",url:"https://discord.com/channels/g/999"});return {conversationId:"session"};}};
 await new TodoService(repo,undefined,transport).start("todo","dev","g");
 expect(calls.map(c=>c.action)).toEqual(["claim","claim-context","claim-thread","claim-finish"]);
 expect(opened.forumId).toBe("1560943737688039474");expect(opened.idempotencyKey).toBe("token");
 expect(opened.prompt).toContain("https://discord.com/channels/g/c/m");expect(opened.prompt).toContain("context".repeat(4000));expect(opened.prompt).toContain("history_safety_bound");expect(opened.prompt).not.toContain("DO NOT HAND OFF THIS");
});
test("Start returns persisted success when the claim-finish response is lost without admitting another run",async()=>{
 const f=fixture();const operation=f.repo.operation;let persisted:any;let starts=0;
 f.repo.operation=async(action:string,body:any)=>{
  const result=await operation(action,body);
  if(action==="claim-finish"){
   persisted={...result,claim:{...result.claim,phase:"sent"},audit:[{event:"started",message_id:body.message_id}]};
   throw new Error("claim-finish response lost");
  }
  if(action==="claim-fail")return structuredClone(persisted);
  return result;
 };
 const result=await new TodoService(f.repo,undefined,{ready:async()=>{},start:async()=>{starts++;return {conversationId:"session"};}}).start("todo","dev","g");
 expect(result).toEqual(persisted);expect(result.claim).toMatchObject({token:"token",phase:"sent",message_id:"session"});
 expect(starts).toBe(1);expect(f.calls.map(c=>c.action)).toEqual(["claim","claim-context","claim-finish","claim-fail"]);
 expect(f.calls.at(-1).body).toMatchObject({id:"todo",token:"token",definitive:false});
});
for(const outcome of ["uncertain","stale-token","different-session","unavailable"]){
 test(`Start never repeats admission or reports success when finalization reconciliation is ${outcome}`,async()=>{
  const f=fixture();const operation=f.repo.operation;let persisted:any;let starts=0;
  f.repo.operation=async(action:string,body:any)=>{
   const result=await operation(action,body);
   if(action==="claim-finish")throw new Error("finish persistence unavailable");
   if(action==="claim-fail"){
    if(outcome==="unavailable")throw new Error("reconciliation unavailable");
    persisted={...result,status:outcome==="uncertain"?"blocked":"in_progress",claim:{...result.claim,phase:outcome==="uncertain"?"uncertain":"sent",token:outcome==="stale-token"?"other-token":"token",message_id:outcome==="different-session"?"other-session":"session"}};
    return persisted;
   }
   return result;
  };
  await expect(new TodoService(f.repo,undefined,{ready:async()=>{},start:async()=>{starts++;return {conversationId:"session"};}}).start("todo","dev","g")).rejects.toThrow("do not start a duplicate");
  expect(starts).toBe(1);expect(f.calls.map(c=>c.action)).toEqual(["claim","claim-context","claim-finish","claim-fail"]);
  if(outcome==="uncertain")expect(persisted).toMatchObject({status:"blocked",claim:{phase:"uncertain",token:"token"}});
 });
}
test("resume uses persisted thread and exact opening snapshot without creating a second forum post",async()=>{
 const f=fixture();f.repo.todo=async()=>({...todo,status:"blocked",claim:{token:"token",developer:"dev",phase:"uncertain",thread_id:"999",thread_url:"https://discord.com/channels/g/999",prompt:"original snapshot"}});
 let input:any;await new TodoService(f.repo,undefined,{ready:async()=>{},start:async value=>{input=value;return {conversationId:"999"};}}).resume("todo","operator","g");
 expect(input.existingThreadId).toBe("999");expect(input.prompt).toBe("original snapshot");expect(input.developerId).toBe("dev");expect(f.calls.map(c=>c.action)).toEqual(["claim-finish"]);
});
test("unconfigured handoff does not claim and uncertain failure becomes recoverable blocked not false success",async()=>{
 const a=fixture();await expect(new TodoService(a.repo).start("todo","dev","g")).rejects.toThrow("not configured");expect(a.calls).toEqual([]);
 const b=fixture();await expect(new TodoService(b.repo,undefined,{ready:async()=>{},start:async()=>{throw new Error("timeout");}}).start("todo","dev","g")).rejects.toThrow("timeout");
 expect(b.calls.map(c=>c.action)).toEqual(["claim","claim-context","claim-fail"]);expect(b.calls[2].body.definitive).toBe(false);
});
