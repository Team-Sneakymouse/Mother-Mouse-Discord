import { expect, test } from "bun:test";
import { renderDetail } from "../src/todo/detail.js";
import { expandGroup, filterTodos, renderList, readListState, attachReportLinks } from "../src/todo/list.js";
const groups=[{id:"root",name:"All",labels:["a"],child_groups:["child","other"]},{id:"child",name:"Child",labels:["a","b"],child_groups:[]},{id:"other",name:"Other",labels:["b"],child_groups:["child"]}];
const labels=[{id:"a",name:"Alpha"},{id:"b",name:"Beta"}];
const todo=(id:string,label:string,priority:string,status="open",kind="bug")=>({id,number:Number(id),label,priority,status,kind,title:"Title @everyone",description:"Description",claim:{}});
test("label groups dedupe descendants, reject cycles and filters AND kind, label, priority and active state",()=>{
 expect([...expandGroup("root",groups)].sort()).toEqual(["a","b"]);
 expect(()=>expandGroup("root",[...groups,{id:"cycle",name:"Cycle",labels:[],child_groups:["cycle"]}].map(g=>g.id==="root"?{...g,child_groups:["cycle"]}:g))).toThrow("cycle");
 const todos=[todo("1","a","blue"),todo("2","a","red"),todo("3","b","yellow","blocked"),todo("4","a","red","done"),todo("5","a","red","open","feature")];
 expect(filterTodos(todos,labels,groups,{}).map(t=>t.id)).toEqual(["2","5","1","3"]);
 expect(filterTodos(todos,labels,groups,{label:"group:root",kind:"bug",priority:"red"}).map(t=>t.id)).toEqual(["2"]);
 expect(filterTodos(todos,labels,groups,{label:"label:b"}).map(t=>t.id)).toEqual(["3"]);
});
test("me unions every invoking-user group recursively, ANDs filters and never broadens unassigned users",()=>{
 const assigned=groups.map(g=>({...g,assigned_user_id:g.id==="root"?"123":"456"}));
 const todos=[todo("1","a","red"),todo("2","b","blue"),todo("3","b","red")];
 expect(filterTodos(todos,labels,assigned,{label:"me",userId:"123",priority:"red"}).map(t=>t.id)).toEqual(["1","3"]);
 expect(filterTodos(todos,labels,assigned,{label:"me",userId:"999"})).toEqual([]);
 expect(filterTodos(todos,labels,assigned,{label:"me"})).toEqual([]);
});
test("ephemeral list cards paginate with owner-bound state and only unclaimed open todos have Start",()=>{
 const todos=Array.from({length:9},(_,i)=>todo(String(i+1),"a","red"));todos[1].status="blocked";todos[2].claim={developer:"dev"} as any;
 const state={owner:"123",page:0,filters:{label:"group:root",kind:"bug"}};
 const rendered=renderList(todos,labels,state);
 expect(rendered.embeds).toHaveLength(2);
 expect(rendered.components.flatMap((r:any)=>r.components).filter((b:any)=>b.label==="Start")).toHaveLength(1);
 expect(readListState({embeds:rendered.embeds} as any)).toEqual(state);
 expect(rendered.allowedMentions).toEqual({parse:[]});
 const last=renderList(todos,labels,{...state,page:99});expect(last.embeds[0].title).toContain("#9");
});
test("todo cards link every originating report, dedupe source IDs and retain shared split report on both todos with accessible overflow",()=>{
 const origin=(message_id:string,todos:string[])=>({guild_id:"111",channel_id:"222",message_id,todos});
 const items=attachReportLinks([todo("1","a","red"),todo("2","a","red")],[origin("333",["1","2"]),origin("444",["1"]),origin("333",["1"])]);
 expect(items[0].reportLinks).toEqual(["https://discord.com/channels/111/222/333","https://discord.com/channels/111/222/444"]);
 expect(items[1].reportLinks).toEqual(["https://discord.com/channels/111/222/333"]);
 const view=renderList(items,labels,{owner:"123",page:0,filters:{}});
 expect(JSON.stringify(view.embeds[0])).toContain("[Report 2](https://discord.com/channels/111/222/444)");
 const many=attachReportLinks([todo("1","a","red")],Array.from({length:100},(_,i)=>origin(String(1000+i),["1"])));
 const overflow=renderList(many,labels,{owner:"123",page:0,filters:{}});
 expect(overflow.embeds[0].fields.find(f=>f.name==="Reports")?.value).toContain("attached");
 expect(overflow.files[0].attachment.toString()).toContain("https://discord.com/channels/111/222/1099");
 expect(overflow.embeds[0].fields.every(f=>f.value.length<=1024)).toBe(true);
});
test("paginated cards keep aggregate embed text under Discord's 6000-character budget for escaped report text",()=>{
 const items=Array.from({length:4},(_,i)=>({...todo(String(i+1),"a","red"),title:"*".repeat(200),description:"*".repeat(600),reportLinks:Array.from({length:12},()=>"https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333")}));
 const view=renderList(items,[{id:"a",name:"*".repeat(100)}],{owner:"123",page:0,filters:{}});
 const total=view.embeds.reduce((n,e)=>n+e.title.length+e.description.length+e.fields.reduce((n,f)=>n+f.name.length+f.value.length,0)+(e.footer?.text.length??0),0);
 expect(total).toBeLessThanOrEqual(6000);
});
test("every list card exposes Edit and detail UI has paginated concrete labels and every manual status including closed",()=>{
 const t={...todo("1","a","red"),audit:[{}],reportLinks:["https://discord.com/channels/111/222/333"]};
 const state={owner:"123",page:0,filters:{}};
 const list=renderList([t],labels,state);expect(list.components[0].components.some(c=>c.label==="Edit")).toBe(true);
 const detail=renderDetail(t,Array.from({length:30},(_,i)=>({id:String(i),name:`Label ${i}`})),state,0);
 expect(detail.components).toHaveLength(5);
 expect(detail.components[2].components[0].options.map((o:any)=>o.value)).toEqual(["bug","feature"]);
 expect(detail.components[3].components[0].options.map((o:any)=>o.value)).toEqual(["red","yellow","blue"]);expect(detail.components[0].components[0].options).toHaveLength(25);
 expect(detail.components[1].components[0].options.map((o:any)=>o.value)).toContain("closed");
 expect(JSON.stringify(detail.embeds)).toContain("https://discord.com/channels/111/222/333");
 expect(detail.embeds[0].footer.text).toContain('"revision":1');
});
