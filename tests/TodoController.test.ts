import { expect, test } from "bun:test";
import { renderDetail } from "../src/todo/detail.js";
import { TodoController, data } from "../src/Todo.js";
const guild="391355330241757205";
function command(overrides:any={}) {const sent:any[]=[];return {guildId:guild,user:{id:"123"},memberPermissions:{has:()=>false},options:{getSubcommand:()=>"list",getString:()=>null},deferred:false,replied:false,reply:async(p:any)=>{sent.push(p);},deferReply:async()=>{},editReply:async(p:any)=>{sent.push(p);},sent,...overrides} as any;}
test("todo developer commands default admin but honor delivered Discord server permission overrides",async()=>{
 const json=data[0].toJSON();expect(json.default_member_permissions).toBe("8");expect(json.name).toBe("todo");expect(data[1].toJSON().name).toBe("Create report");expect(data[1].toJSON().default_member_permissions).toBe("8");
 let lists=0;const controller=new TodoController({list:async()=>{lists++;return {todos:[],labels:[],groups:[]};}} as any);
 const i=command();await controller.command(i);expect(lists).toBe(1);expect(i.sent[0].content).toContain("active todos");
 const foreign=command({guildId:"foreign"});await controller.command(foreign);expect(lists).toBe(1);
});
test("Create report is scripted, captures immutable source and recursive context then persists before confirmation",async()=>{
 let captured:any;const service={repo:{operation:async(action:string,body:any)=>{expect(action).toBe("capture");captured=body;return {id:"report",state:"pending"};}}};
 const original={id:"m",guildId:guild,channelId:"thread",createdTimestamp:1000,author:{id:"sender",username:"alice",globalName:"Alice"},content:"broken",attachments:new Map([["a",{url:"https://cdn.discordapp.com/file",name:"file.png",contentType:"image/png"}]]),reference:null,url:`https://discord.com/channels/${guild}/thread/m`};
 const channel={id:"thread",name:"Bug thread",parentId:"parent",parent:{name:"bugs"},isThread:()=>true,messages:{fetch:async()=>new Map([["m",original]])}};
 const interaction=command({targetMessage:{...original,channel},channel,commandName:"Create report"});
 await new TodoController(service as any).capture(interaction);
 expect(captured.source.sender_name).toBe("Alice");expect(captured.source.created_by).toBe("123");expect(captured.source.thread_name).toBe("Bug thread");expect(captured.source.parent_channel_name).toBe("bugs");expect(captured.source.attachments).toHaveLength(1);expect(captured.context.messages[0].content).toBe("broken");expect(interaction.sent[0].content).toContain("pending");
});
test("human resolve command explicitly submits reviewed decisions without calling the LLM",async()=>{
 let received:any;const controller=new TodoController({resolve:async(...args:any[])=>{received=args;return {id:"r",state:"assessed",todos:["t"]};}} as any);
 const decisions=JSON.stringify({decisions:[{action:"dismiss",confidence:1,reason:"Reviewed"}]});
 const i=command({options:{getSubcommand:()=>"resolve",getString:(key:string)=>key==="report"?"r":decisions}});
 await controller.command(i);expect(received).toEqual(["r","123",guild,JSON.parse(decisions)]);expect(i.sent[0].content).toContain("assessed");
});
test("status command records PR-ready completion through the server transaction",async()=>{
 let payload:any;const controller=new TodoController({repo:{byNumber:async()=>({id:"t"}),operation:async(action:string,body:any)=>{expect(action).toBe("status");payload=body;return {number:42,status:"done"};}}} as any);
 const i=command({options:{getSubcommand:()=>"status",getInteger:()=>42,getString:(key:string)=>({status:"done",pr:"https://github.com/Team/Plugin/pull/42",reason:"Ready",work:"Tests passed"} as any)[key]}});
 await controller.command(i);expect(payload.status).toBe("done");expect(payload.actor).toBe("123");expect(i.sent[0].content).toContain("PR READY");
});
test("manual label slash command uses concrete label and a fresh revision without LLM or Start",async()=>{
 let received:any;const controller=new TodoController({repo:{byNumber:async()=>({id:"t",audit:[{}]}),operation:async(action:string,body:any)=>{received={action,...body};return {number:42,label:"l"};}}} as any);
 const i=command({options:{getSubcommand:()=>"label",getInteger:()=>42,getString:(key:string)=>key==="label"?"label:l":"reason"}});
 await controller.command(i);expect(received).toMatchObject({action:"label",id:"t",label:"l",actor:"123",expected_revision:1});expect(i.sent[0].content).toContain("not moved");
});
test("detail select callbacks persist label and closed with displayed revision, while stale edits fail",async()=>{
 let todo:any={id:"t",number:42,guild_id:guild,label:"a",kind:"bug",priority:"blue",status:"open",title:"Task",description:"Task",audit:[]};const labels=[{id:"a",name:"Alpha"},{id:"b",name:"Beta"}];const calls:any[]=[];
 const repo={todo:async()=>todo,labels:async()=>labels,origins:async()=>[],operation:async(action:string,b:any)=>{if(b.expected_revision!==todo.audit.length)throw new Error("Stale edit");calls.push({action,...b});todo={...todo,[action==="label"?"label":"status"]:b[action==="label"?"label":"status"],audit:[...todo.audit,{}]};return todo;}};
 const controller=new TodoController({repo} as any);const initial=renderDetail(todo,labels,{owner:"123",page:0,filters:{}});
 const interaction=(action:string,value:string,embeds:any)=>command({customId:`todo|123|${action}|t`,values:[value],isStringSelectMenu:()=>true,deferUpdate:async()=>{},client:{user:{id:"bot"}},message:{author:{id:"bot"},embeds}});
 const label=interaction("set-label","b",initial.embeds);await controller.component(label);expect(calls[0]).toMatchObject({action:"label",label:"b",expected_revision:0,actor:"123"});
 const closed=interaction("set-status","closed",label.sent[0].embeds);await controller.component(closed);expect(todo.status).toBe("closed");expect(calls[1].expected_revision).toBe(1);
 const stale=interaction("set-label","a",initial.embeds);await controller.component(stale);expect(calls).toHaveLength(2);expect(stale.sent[0].content).toContain("Stale edit");
});
test("persistent list controls reject forged author and other users before Start",async()=>{
 let starts=0;const controller=new TodoController({start:async()=>{starts++;}} as any);
 for(const [author,user] of [["bot","other"],["forged","123"]]){
 const i=command({customId:"todo|123|start|todo",client:{user:{id:"bot"}},message:{author:{id:author}},user:{id:user}});
 await controller.component(i);expect(i.sent[0].content).toContain("Only");
 }expect(starts).toBe(0);
});
