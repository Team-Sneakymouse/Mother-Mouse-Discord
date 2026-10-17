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
for(const missing of ["repository","label"]){
 test(`Start safely releases a claim when its ${missing} is missing after claim`,async()=>{
  const f=fixture();let started=false;let claimed=false;const operation=f.repo.operation;
  f.repo.operation=async(action:string,body:any)=>{const result=await operation(action,body);if(action==="claim")claimed=true;return result;};
  f.repo.label=async()=>{expect(claimed).toBe(true);if(missing==="label")throw new Error("Label not found");return {...label,repo:""};};
  await expect(new TodoService(f.repo,undefined,{ready:async()=>{},start:async()=>{started=true;return {conversationId:"session"};}}).start("todo","dev","g")).rejects.toThrow(missing==="label"?"Label not found":"repository before Start");
  expect(started).toBe(false);expect(f.calls.map(c=>c.action)).toEqual(["claim","claim-fail"]);expect(f.calls[1].body).toMatchObject({id:"todo",token:"token",definitive:true});
 });
}
test("Start claims atomically then supplies full reports and snapshots without reasoning to designated new conversation",async()=>{
 const {repo,calls}=fixture();let opened:any;
 const transport={ready:async()=>{},start:async(input:any)=>{opened=input;await input.onThreadCreated({id:"999",url:"https://discord.com/channels/g/999"});return {conversationId:"session"};}};
 await new TodoService(repo,undefined,transport).start("todo","dev","g");
 expect(calls.map(c=>c.action)).toEqual(["claim","claim-context","claim-thread","claim-finish"]);
 expect(opened.forumId).toBe("1560943737688039474");expect(opened.idempotencyKey).toBe("token");
 expect(opened.prompt).toContain("https://discord.com/channels/g/c/m");expect(opened.prompt).toContain("context".repeat(4000));expect(opened.prompt).toContain("history_safety_bound");expect(opened.prompt).not.toContain("DO NOT HAND OFF THIS");
});
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
