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
  const bridge=new HermesTodoBridge({channels:{fetch:async()=>{discordCalls++;return {type:ChannelType.GuildForum,guildId:"111",availableTags:[{id:"red-tag",name:"Red"},{id:"bug-tag",name:"Bug"}],threads:{create:async()=>{discordCalls++;return {id:"333",url:"thread"};}}};}}} as any,url,"x".repeat(40));
  await expect(bridge.start({forumId:"1560943737688039474",guildId:"111",prompt,idempotencyKey:"claim",developerId:"222",todoNumber:42,labelName:"Plugin",priority:"red",kind:"bug",title:"Task",onThreadCreated:async()=>{persisted++;}})).rejects.toBeInstanceOf(DefinitiveHandoffError);
  expect(discordCalls).toBe(0);expect(requests).toBe(0);expect(persisted).toBe(0);
 });
}
for(const character of ["a","😀"]){
 test(`Start accepts exactly 60000 Python characters (${character}) without truncation`,async()=>{
  const prompt=character.repeat(60000);let received:any;
  const url=await server(body=>{received=body;return {status:"accepted",thread_id:"333"};});
  const discord=recordingDiscord();const bridge=new HermesTodoBridge(discord.client as any,url,"x".repeat(40));
  const input={forumId:"1560943737688039474",guildId:"111",prompt,idempotencyKey:"claim",developerId:"222",todoNumber:42,labelName:"Plugin",priority:"red",kind:"bug",title:"Task",onThreadCreated:async()=>{}};
  await bridge.start(input);
  expect(received.context).toBe(prompt);
  const contents=discord.messages.map(m=>m.content);const prefix="<@222>\n**#42 Plugin — Task**\n";
  expect(contents[0]!.slice(prefix.length)+contents.slice(1).join("")).toBe(prompt);
  for(const content of contents){expect(content.length).toBeLessThanOrEqual(2000);expect(content.isWellFormed()).toBe(true);}
  await bridge.start({...input,existingThreadId:"333",onThreadCreated:async()=>{throw new Error("Must reuse thread");}});
  expect(discord.creates()).toBe(1);expect(received.context).toBe(prompt);
 });
}
test("assessment uses exact authenticated one-report bridge contract and records actual host guidance version",async()=>{
 let body:any;const url=await server((value,headers,path)=>{body=value;expect(path).toBe("/plugins/discord-todo/v1/assess");return {guidance_version:"1",assessment:{decisions:[{action:"clarify",confidence:0.6,reason:"Need reproduction"}]}};});
 const bridge=new HermesTodoBridge({} as any,url,"x".repeat(40));const value=await bridge.assess(assessmentPrompt("reviewed guidance",{id:"report1",context:"evidence"},[],[]));
 expect(body).toEqual({reports:[{id:"report1",context:{id:"report1",context:"evidence"}}],labels:[],open_todos:[]});
 expect(value).toEqual({decisions:[{action:"clarify",confidence:0.6,reason:"Need reproduction"}]});expect(bridge.guidanceVersion).toBe("hermes-guidance:1");
});
test("partial opening display blocks injection and retry reuses saved thread without bypassing display",async()=>{
 let requests=0,creates=0,saved="";const displayed:any[]=[];
 const url=await server(()=>{requests++;return {status:"accepted",thread_id:"333"};});
 const thread={id:"333",url:"https://discord.com/channels/111/333",type:ChannelType.PublicThread,guildId:"111",parentId:"1560943737688039474",fetchStarterMessage:async()=>displayed[0],messages:{fetch:async()=>new Map()},send:async()=>{expect(saved).toBe("333");throw new Error("follow-up failed");}};
 const forum={type:ChannelType.GuildForum,guildId:"111",availableTags:[{id:"red-tag",name:"Red"},{id:"bug-tag",name:"Bug"}],threads:{create:async(p:any)=>{creates++;displayed.push({id:"333",content:p.message.content,author:{id:"999"}});return thread;}}};
 const bridge=new HermesTodoBridge({user:{id:"999"},channels:{fetch:async(id:string)=>id==="333"?thread:forum}} as any,url,"x".repeat(40));
 const input={forumId:"1560943737688039474",guildId:"111",prompt:"Full evidence ".repeat(1000),idempotencyKey:"claim",developerId:"222",todoNumber:42,labelName:"Plugin",priority:"red",kind:"bug",title:"Task",onThreadCreated:async(t:any)=>{saved=t.id;}};
 await expect(bridge.start(input)).rejects.toThrow("follow-up failed");expect(requests).toBe(0);expect(saved).toBe("333");
 await expect(bridge.start({...input,existingThreadId:saved})).rejects.toThrow("opening prompt");expect(requests).toBe(0);expect(creates).toBe(1);
});
test("resume paginates full normal-message opening and refuses edited evidence before reinjection",async()=>{
 const discord=recordingDiscord();let requests=0;
 const url=await server(()=>{requests++;return {status:"accepted",thread_id:"333"};});
 const bridge=new HermesTodoBridge(discord.client as any,url,"x".repeat(40));
 const prompt=("😀".repeat(500)+"\n\n").repeat(119);
 const input={forumId:"1560943737688039474",guildId:"111",prompt,idempotencyKey:"claim",developerId:"222",todoNumber:42,labelName:"Plugin",priority:"red",kind:"bug",title:"Task",onThreadCreated:async()=>{}};
 await bridge.start(input);expect(discord.messages.length).toBeGreaterThan(100);
 expect(discord.messages.slice(1).every(m=>m.content.endsWith("\n\n"))).toBe(true);
 await bridge.start({...input,existingThreadId:"333"});expect(requests).toBe(2);
 discord.messages[1].content="edited evidence";
 await expect(bridge.start({...input,existingThreadId:"333"})).rejects.toThrow("opening prompt");expect(requests).toBe(2);expect(discord.creates()).toBe(1);
});
for(const tags of [undefined,[],[{id:"one",name:"RED"},{id:"two",name:"red"},{id:"kind",name:"Bug"}],[{id:"one",name:"Red"}]]){
 test(`missing or ambiguous forum tags reject before any forum write (${JSON.stringify(tags)})`,async()=>{
  const discord=recordingDiscord();(discord.forum as any).availableTags=tags;let requests=0;
  const url=await server(()=>{requests++;return {status:"accepted",thread_id:"333"};});
  await expect(new HermesTodoBridge(discord.client as any,url,"x".repeat(40)).start({forumId:"1560943737688039474",guildId:"111",prompt:"Full context",idempotencyKey:"claim",developerId:"222",todoNumber:42,labelName:"Plugin",priority:"red",kind:"bug",title:"Task",onThreadCreated:async()=>{throw new Error("Must not persist");}})).rejects.toBeInstanceOf(DefinitiveHandoffError);
  expect(discord.creates()).toBe(0);expect(requests).toBe(0);
 });
}
function recordingDiscord(){
 const messages:any[]=[];let creates=0;
 function record(payload:any){const message={id:String(333+messages.length),content:payload.content,author:{id:"999"},payload};messages.push(message);return message;}
 const thread={id:"333",url:"https://discord.com/channels/111/333",type:ChannelType.PublicThread,guildId:"111",parentId:"1560943737688039474",fetchStarterMessage:async()=>messages[0],messages:{fetch:async(options:any)=>new Map(messages.filter(m=>BigInt(m.id)>BigInt(options.after)).slice(0,options.limit).reverse().map(m=>[m.id,m]))},send:async(payload:any)=>record(payload)};
 const forum={type:ChannelType.GuildForum,guildId:"111",availableTags:[{id:"red-tag",name:"Red"},{id:"bug-tag",name:"Bug"}],threads:{create:async(payload:any)=>{creates++;record(payload.message);return thread;}}};
 return {messages,forum,thread,creates:()=>creates,client:{user:{id:"999"},channels:{fetch:async(id:string)=>id==="333"?thread:forum}}};
}
afterEach(()=>{for(const s of servers.splice(0))s.close();});
async function server(handler:(body:any,headers:any,path:string)=>any){const s=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const d of req)chunks.push(Buffer.from(d));const body=Buffer.concat(chunks).toString("utf8");try{const value=handler(JSON.parse(body),req.headers,req.url!);res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(value));}catch{res.writeHead(503);res.end("private provider diagnostic must not leak");}});servers.push(s);await new Promise<void>(r=>s.listen(0,"127.0.0.1",r));return `http://127.0.0.1:${(s.address() as any).port}`;}
test("forum Start creates a genuine fresh forum post, only pings clicking developer and persists thread before canonical bridge injection",async()=>{
 const events:string[]=[];let post:any;let injected:any;const sent:any[]=[];
 const url=await server((body,headers,path)=>{events.push("inject");expect(headers.authorization).toBe("Bearer "+"x".repeat(40));expect(path).toBe("/plugins/discord-todo/v1/start");injected=body;return {status:"accepted",completed:false,thread_id:"333"};});
 const forum={type:ChannelType.GuildForum,guildId:"111",availableTags:[{id:"red-tag",name:"Red"},{id:"bug-tag",name:"Bug"}],threads:{create:async(p:any)=>{events.push("create");post=p;return {id:"333",url:"https://discord.com/channels/111/333",send:async(message:any)=>{expect(events).toContain("persist");events.push("send");sent.push(message);}};}}};
 const bridge=new HermesTodoBridge({channels:{fetch:async(id:string)=>{expect(id).toBe("1560943737688039474");return forum;}}} as any,url,"x".repeat(40));
 const prompt="Complete source links and context @everyone "+"evidence".repeat(1000);
 const result=await bridge.start({forumId:"1560943737688039474",guildId:"111",prompt,idempotencyKey:"claim",developerId:"222",todoNumber:42,labelName:"Plugin",priority:"red",kind:"bug",title:"Inventory crash",onThreadCreated:async thread=>{expect(thread.id).toBe("333");events.push("persist");}});
 expect(events.slice(0,2)).toEqual(["create","persist"]);expect(events.at(-1)).toBe("inject");expect(sent.length).toBeGreaterThan(0);expect(post.name).toBe("#42 Plugin — Inventory crash");expect(post.appliedTags).toEqual(["red-tag","bug-tag"]);expect(post.message.allowedMentions).toEqual({parse:[],users:["222"]});expect(post.message.content).toStartWith("<@222>\n");
 const prefix="<@222>\n**#42 Plugin — Inventory crash**\n";expect(post.message.content.slice(prefix.length)+sent.map(m=>m.content).join("")).toBe(prompt);
 for(const message of [post.message,...sent]){expect(message.content.length).toBeLessThanOrEqual(2000);expect(message.files).toBeUndefined();}
 for(const message of sent)expect(message.allowedMentions).toEqual({parse:[],users:[],roles:[],repliedUser:false});
 expect(injected).toEqual({thread_id:"333",user_id:"222",context:prompt});expect(result.conversationId).toBe("333");
});
