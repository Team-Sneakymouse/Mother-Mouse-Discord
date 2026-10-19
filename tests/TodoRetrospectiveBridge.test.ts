import { expect, test } from "bun:test";
import { HermesTodoBridge } from "../src/todo/hermes.js";
import { ChannelType } from "discord.js";
const guild="391355330241757205",actor="123456789012345678",threadId="456789012345678901";
// Contract fixtures, not live Discord/model results. The loopback fetch and JSON parsing are real.
test("retrospective uses loopback JSON, native Meta and complete normal-message evidence before dispatch",async()=>{
 const requests:any[]=[],writes:any[]=[],messages:any[]=[];
 const context="Evidence\n".repeat(400);
 const server=Bun.serve({port:0,fetch:async request=>{
  const body=await request.json();requests.push({path:new URL(request.url).pathname,body,auth:request.headers.get("authorization")});
  expect(messages.map(m=>m.content).join("").endsWith(context)).toBe(true);
  return Response.json({status:"accepted",run_id:"run",thread_id:threadId,baseline_version:"2",baseline_hash:"a".repeat(64)});
 }});
 const record=(content:string)=>{const message={id:String(1000+messages.length),author:{id:"bot"},content};messages.push(message);return message;};
 const thread={id:threadId,type:ChannelType.PublicThread,guildId:guild,parentId:"1560943737688039474",send:async(p:any)=>{writes.push(p);return record(p.content);},fetchStarterMessage:async()=>messages[0],messages:{fetch:async({after}:any)=>new Map(messages.filter(m=>BigInt(m.id)>BigInt(after)).map(m=>[m.id,m]))}};
 const forum={type:ChannelType.GuildForum,guildId:guild,availableTags:[{id:"meta",name:"Meta"}],threads:{create:async(p:any)=>{writes.push(p);record(p.message.content);return thread;}}};
 try{
  const bridge=new HermesTodoBridge({user:{id:"bot"},channels:{fetch:async(id:string)=>id===threadId?thread:forum}} as any,`http://127.0.0.1:${server.port}`,"t".repeat(32));let persisted=false;
  const input={run:{id:"run",guild_id:guild,actor},corrections:[{id:"c"}],context,onThread:async()=>{persisted=true;}};
  const result=await bridge.startRetrospective(input);
  expect(persisted).toBe(true);expect(writes[0].appliedTags).toEqual(["meta"]);expect(writes[0].name).toContain("Assessment retrospective");expect(writes.length).toBeGreaterThan(1);expect(result.baseline_version).toBe("2");
  expect(requests[0]).toMatchObject({path:"/plugins/discord-todo/v1/retrospective/start",body:{run_id:"run",thread_id:threadId,user_id:actor,guild_id:guild,corrections:[{id:"c"}]},auth:`Bearer ${"t".repeat(32)}`});
  const count=writes.length;await bridge.startRetrospective({...input,run:{...input.run,thread_id:threadId},onThread:async()=>{throw new Error("must not create another thread");}});expect(writes).toHaveLength(count);
  messages[1].content="edited evidence";
  await expect(bridge.startRetrospective({...input,run:{...input.run,thread_id:threadId}})).rejects.toThrow("not verifiably displayed");expect(requests).toHaveLength(2);
 }finally{server.stop(true);}
});
test("retrospective bridge enforces actual 200000-byte evidence bound before Discord creation",async()=>{
 let writes=0;const bridge=new HermesTodoBridge({channels:{fetch:async()=>{writes++;throw new Error("unexpected Discord fetch");}}} as any,"http://127.0.0.1:1","t".repeat(32));
 await expect(bridge.startRetrospective({run:{id:"run",guild_id:guild,actor},corrections:[{id:"c",snapshot:"x".repeat(201000)}],context:"Evidence",onThread:async()=>{}})).rejects.toThrow("bounds");expect(writes).toBe(0);
});
test("status and approval transmit exact owner and full hash through independent authenticated HTTP endpoints",async()=>{
 const requests:any[]=[];const hash="a".repeat(64);let applied=false;
 const receipt={run_id:"run",state:"applied",proposal_hash:hash,policy_version:"3",policy_hash:"b".repeat(64)};
 const server=Bun.serve({port:0,fetch:async request=>{const path=new URL(request.url).pathname;requests.push({path,body:await request.json(),authorization:request.headers.get("authorization")});if(path.endsWith("/approve"))applied=true;return Response.json(applied?receipt:{run_id:"run",state:"proposed",proposal_hash:hash,diff:"+ Lesson",proposal:{rules:[],memory:[],summary:"Reviewed"},thread_id:threadId});}});
 try{const bridge=new HermesTodoBridge({} as any,`http://127.0.0.1:${server.port}`,"t".repeat(32));expect((await bridge.status("run",actor)).state).toBe("proposed");expect(await bridge.approve("run",actor,hash)).toEqual(receipt);expect(await bridge.status("run",actor)).toEqual(receipt);
 expect(requests.map(r=>r.path)).toEqual(["/plugins/discord-todo/v1/retrospective/status","/plugins/discord-todo/v1/retrospective/approve","/plugins/discord-todo/v1/retrospective/status"]);expect(requests[1].body).toEqual({run_id:"run",user_id:actor,proposal_hash:hash});expect(requests.every(r=>r.authorization===`Bearer ${"t".repeat(32)}`)).toBe(true);
 }finally{server.stop(true);}
});
