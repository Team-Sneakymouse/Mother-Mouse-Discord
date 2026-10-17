import { escapeMarkdown, type Message, type MessageEditOptions } from "discord.js";
import type { Todo } from "./assessment.js";
export interface Group {id:string;name:string;labels:string[];child_groups:string[]}
export interface ListFilters {label?:string;kind?:string;priority?:string}
export interface ListState {owner:string;page:number;filters:ListFilters}
export function expandGroup(id:string,groups:Group[]):Set<string>{
 const labels=new Set<string>(),visited=new Set<string>(),active=new Set<string>();
 function visit(key:string){if(active.has(key))throw new Error("Label group cycle");if(visited.has(key))return;const g=groups.find(g=>g.id===key);if(!g)throw new Error("Unknown label group");active.add(key);for(const l of g.labels)labels.add(l);for(const c of g.child_groups)visit(c);active.delete(key);visited.add(key);}
 visit(id);return labels;
}
export function filterTodos(todos:Todo[],labels:{id:string;name:string}[],groups:Group[],filters:ListFilters):Todo[]{
 let selected:Set<string>|undefined;
 if(filters.label){const [type,id]=filters.label.split(":");if(type==="label"&&labels.some(l=>l.id===id))selected=new Set([id]);else if(type==="group")selected=expandGroup(id,groups);else throw new Error("Unknown label filter");}
 const rank:Record<string,number>={red:0,yellow:1,blue:2};const name=(id:string)=>labels.find(l=>l.id===id)?.name??"Untriaged";
 return todos.filter(t=>["open","in_progress","blocked"].includes(t.status)&&(!selected||selected.has(t.label))&&(!filters.kind||t.kind===filters.kind)&&(!filters.priority||t.priority===filters.priority))
 .sort((a,b)=>name(a.label).localeCompare(name(b.label))||(rank[a.priority]??3)-(rank[b.priority]??3)||(a.number??0)-(b.number??0));
}
export interface ReportOrigin {guild_id:string;channel_id:string;message_id:string;todos:string[]}
export type TodoView=Todo & {reportLinks?:string[]};
export function attachReportLinks(todos:Todo[],reports:ReportOrigin[]):TodoView[]{
 return todos.map(todo=>({...todo,reportLinks:[...new Set(reports.filter(r=>r.todos.includes(todo.id)).map(r=>{
  if(![r.guild_id,r.channel_id,r.message_id].every(id=>/^\d+$/.test(id)))throw new Error("Invalid Discord report source identity");
  return `https://discord.com/channels/${r.guild_id}/${r.channel_id}/${r.message_id}`;
 }))]}));
}
const PAGE_SIZE=2;
export function renderList(todos:TodoView[],labels:{id:string;name:string}[],requested:ListState){
 const page=Math.max(0,Math.min(requested.page,Math.max(0,Math.ceil(todos.length/PAGE_SIZE)-1)));const state={...requested,page};
 const visible=todos.slice(page*PAGE_SIZE,page*PAGE_SIZE+PAGE_SIZE);
 const components:{type:1;components:{type:2;style:1|2;label:string;custom_id:string;disabled?:boolean}[]}[]=[];
 const overflow:string[]=[];
 const reportFields=(t:TodoView)=>{
  const links=(t.reportLinks??[]).map((url,i)=>`[Report ${i+1}](${url})`);
  let value=links.join(" · ")||"No originating report links are available.";
  if(value.length>950){overflow.push(`#${t.number}: ${t.title}\n${(t.reportLinks??[]).map((url,i)=>`Report ${i+1}: ${url}`).join("\n")}`);value=`${links.length} originating reports — ALL direct links are attached in todo-report-links.txt.`;}
  return {name:"Reports",value};
 };
 const embeds=visible.map(t=>{
  const controls:{type:2;style:1|2;label:string;custom_id:string}[]=[{type:2,style:2,label:"Edit",custom_id:`todo|${state.owner}|edit|${t.id}`}];
  if(t.status==="open"&&!t.claim?.token&&!t.claim?.developer)controls.unshift({type:2,style:1,label:"Start",custom_id:`todo|${state.owner}|start|${t.id}`});
  components.push({type:1,components:controls});
  return {title:`#${t.number} · ${escapeMarkdown(t.title)}`.slice(0,256),description:escapeMarkdown(t.description.length>600?t.description.slice(0,600)+"… (preview)":t.description),color:({red:0xed4245,yellow:0xfee75c,blue:0x5865f2} as Record<string,number>)[t.priority],fields:[{name:"Label",value:escapeMarkdown(labels.find(l=>l.id===t.label)?.name??"Untriaged"),inline:true},{name:"Kind / Priority / Status",value:`${t.kind} / ${t.priority} / ${t.status}`,inline:true},reportFields(t)]};
 });
 if(!embeds.length)embeds.push({title:"No matching active todos",description:"Try different filters.",color:0x5865f2,fields:[]});
 const withState=embeds.map((e,i)=>({...e,...(i===0?{footer:{text:`todo-state:${JSON.stringify(state)}`}}:{})}));
 components.push({type:1,components:[{type:2,style:2,label:"Previous",custom_id:`todo|${state.owner}|previous`,disabled:page===0},{type:2,style:2,label:"Next",custom_id:`todo|${state.owner}|next`,disabled:(page+1)*PAGE_SIZE>=todos.length},{type:2,style:2,label:"Refresh",custom_id:`todo|${state.owner}|refresh`}]});
 return {content:`${todos.length} active todos · Page ${page+1}/${Math.max(1,Math.ceil(todos.length/PAGE_SIZE))}`,embeds:withState,components,attachments:[],files:overflow.length?[{attachment:Buffer.from(overflow.join("\n\n")),name:"todo-report-links.txt"}]:[],allowedMentions:{parse:[] as []}};
}
export function readListState(message:Pick<Message,"embeds">):ListState{
 const footer=message.embeds[0]?.footer?.text;if(!footer?.startsWith("todo-state:"))throw new Error("List state missing; run /todo list again");
 const value=JSON.parse(footer.slice(11)) as ListState;
 if(!/^\d+$/.test(value.owner)||!Number.isInteger(value.page)||value.page<0||!value.filters)throw new Error("Invalid list state");return value;
}
