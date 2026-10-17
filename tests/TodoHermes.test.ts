import { afterEach, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { ChannelType } from "discord.js";
import { assessmentPrompt } from "../src/todo/assessment.js";
import { DefinitiveHandoffError } from "../src/todo/service.js";
import { HermesTodoBridge, configuredTodoTransports } from "../src/todo/hermes.js";
test("production transport wiring requires explicit bridge URL/token and otherwise stays safely unconfigured",()=>{
 expect(configuredTodoTransports({} as any,{})).toEqual({});
 const transports=configuredTodoTransports({} as any,{HERMES_TODO_BRIDGE_URL:"http://127.0.0.1:8091",HERMES_TODO_BRIDGE_TOKEN:"x".repeat(40)});
 expect(transports.assessment).toBeInstanceOf(HermesTodoBridge);expect(transports.conversation).toBe(transports.assessment);
});
const servers:Server[]=[];
for(const [name,prompt] of [["ASCII","a".repeat(60001)],["Unicode code points","😀".repeat(60001)],["serialized JSON bytes","\u0000".repeat(43690)]] as const){
 test(`Start rejects excessive ${name} definitively before any Discord write or bridge request`,async()=>{
  let discordCalls=0,requests=0,persisted=0;
  const url=await server(()=>{requests++;return {status:"accepted",thread_id:"333"};});
  const bridge=new HermesTodoBridge({channels:{fetch:async()=>{discordCalls++;return {type:ChannelType.GuildForum,guildId:"111",threads:{create:async()=>{discordCalls++;return {id:"333",url:"thread"};}}};}}} as any,url,"x".repeat(40));
  await expect(bridge.start({forumId:"1560943737688039474",guildId:"111",prompt,idempotencyKey:"claim",developerId:"222",todoNumber:42,title:"Task",onThreadCreated:async()=>{persisted++;}})).rejects.toBeInstanceOf(DefinitiveHandoffError);
  expect(discordCalls).toBe(0);expect(requests).toBe(0);expect(persisted).toBe(0);
 });
}
for(const character of ["a","😀"]){
 test(`Start accepts exactly 60000 Python characters (${character}) without truncation`,async()=>{
  const prompt=character.repeat(60000);let received:any;
  const url=await server(body=>{received=body;return {status:"accepted",thread_id:"333"};});
  const bridge=new HermesTodoBridge({} as any,url,"x".repeat(40));
  await bridge.start({forumId:"1560943737688039474",guildId:"111",prompt,idempotencyKey:"claim",developerId:"222",todoNumber:42,title:"Task",existingThreadId:"333",onThreadCreated:async()=>{throw new Error("Must reuse thread");}});
  expect(received.context).toBe(prompt);
 });
}
test("assessment uses exact authenticated one-report bridge contract and records actual host guidance version",async()=>{
 let body:any;const url=await server((value,headers,path)=>{body=value;expect(path).toBe("/plugins/discord-todo/v1/assess");return {guidance_version:"1",assessment:{decisions:[{action:"clarify",confidence:0.6,reason:"Need reproduction"}]}};});
 const bridge=new HermesTodoBridge({} as any,url,"x".repeat(40));const value=await bridge.assess(assessmentPrompt("reviewed guidance",{id:"report1",context:"evidence"},[],[]));
 expect(body).toEqual({reports:[{id:"report1",context:{id:"report1",context:"evidence"}}],labels:[],open_todos:[]});
 expect(value).toEqual({decisions:[{action:"clarify",confidence:0.6,reason:"Need reproduction"}]});expect(bridge.guidanceVersion).toBe("hermes-guidance:1");
});
afterEach(()=>{for(const s of servers.splice(0))s.close();});
async function server(handler:(body:any,headers:any,path:string)=>any){const s=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const d of req)chunks.push(Buffer.from(d));const body=Buffer.concat(chunks).toString("utf8");try{const value=handler(JSON.parse(body),req.headers,req.url!);res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(value));}catch{res.writeHead(503);res.end("private provider diagnostic must not leak");}});servers.push(s);await new Promise<void>(r=>s.listen(0,"127.0.0.1",r));return `http://127.0.0.1:${(s.address() as any).port}`;}
test("forum Start creates a genuine fresh forum post, only pings clicking developer and persists thread before canonical bridge injection",async()=>{
 const events:string[]=[];let post:any;let injected:any;
 const url=await server((body,headers,path)=>{events.push("inject");expect(headers.authorization).toBe("Bearer "+"x".repeat(40));expect(path).toBe("/plugins/discord-todo/v1/start");injected=body;return {status:"accepted",completed:false,thread_id:"333"};});
 const forum={type:ChannelType.GuildForum,guildId:"111",threads:{create:async(p:any)=>{events.push("create");post=p;return {id:"333",url:"https://discord.com/channels/111/333"};}}};
 const bridge=new HermesTodoBridge({channels:{fetch:async(id:string)=>{expect(id).toBe("1560943737688039474");return forum;}}} as any,url,"x".repeat(40));
 const prompt="Complete source links and context @everyone "+"evidence".repeat(1000);
 const result=await bridge.start({forumId:"1560943737688039474",guildId:"111",prompt,idempotencyKey:"claim",developerId:"222",todoNumber:42,title:"Inventory crash",onThreadCreated:async thread=>{expect(thread.id).toBe("333");events.push("persist");}});
 expect(events).toEqual(["create","persist","inject"]);expect(post.name).toBe("#42 Inventory crash");expect(post.message.allowedMentions).toEqual({parse:[],users:["222"]});expect(post.message.content).toContain("<@222>");expect(post.message.files[0].attachment.toString()).toBe(prompt);expect(injected).toEqual({thread_id:"333",user_id:"222",context:prompt});expect(result.conversationId).toBe("333");
});
