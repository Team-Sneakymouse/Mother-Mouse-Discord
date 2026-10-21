import type { Message } from "discord.js";
import { renderList, type ListState, type TodoView } from "./list.js";
export interface DetailState {owner:string;todoId:string;revision:number;labelPage:number;list:ListState}
export const TODO_STATUSES=["open","in_progress","blocked","done","closed","cancelled"] as const;
export function renderDetail(todo:TodoView,labels:{id:string;name:string}[],list:ListState,labelPage=0){
 const sorted=[...labels].sort((a,b)=>a.name.localeCompare(b.name));const page=Math.max(0,Math.min(labelPage,Math.max(0,Math.ceil(labels.length/25)-1)));
 const detail:DetailState={owner:list.owner,todoId:todo.id,revision:todo.audit?.length??0,labelPage:page,list};
 const rendered=renderList([todo],labels,{...list,page:0});
 const route=(action:string)=>`todo|${list.owner}|${action}|${todo.id}`;
 const components:any[]=[];
 if(labels.length)components.push({type:1,components:[{type:3,custom_id:route("set-label"),placeholder:"Change primary label",min_values:1,max_values:1,options:sorted.slice(page*25,page*25+25).map(l=>({label:l.name.slice(0,100),value:l.id,default:l.id===todo.label}))}]});
 components.push({type:1,components:[{type:3,custom_id:route("set-status"),placeholder:"Change status (manual; does not stop agents)",min_values:1,max_values:1,options:TODO_STATUSES.map(status=>({label:status==="done"?"done — PR READY":status==="closed"?"closed — manually complete":status,value:status,default:status===todo.status}))}]});
 for(const [field,values] of [["kind",["bug","feature"]],["priority",["red","yellow","blue"]]] as const)components.push({type:1,components:[{type:3,custom_id:route(`set-${field}`),placeholder:`Change ${field}`,min_values:1,max_values:1,options:values.map(value=>({label:value,value,default:value===todo[field]}))}]});
 components.push({type:1,components:[{type:2,style:2,label:"Previous labels",custom_id:route("labels-previous"),disabled:page===0},{type:2,style:2,label:"Next labels",custom_id:route("labels-next"),disabled:(page+1)*25>=labels.length},{type:2,style:2,label:"Back to list",custom_id:route("back")}]});
 return {...rendered,content:`Editing #${todo.number}. Changes are saved immediately; optional reasons can be supplied with /todo label, /todo kind, /todo priority or /todo status. Manual edits do NOT stop a running agent or move its forum thread.`,embeds:rendered.embeds.map((e,i)=>({...e,...(i===0?{footer:{text:`todo-detail:${JSON.stringify(detail)}`}}:{})})),components};
}
export function readDetailState(message:Pick<Message,"embeds">):DetailState{
 const text=message.embeds[0]?.footer?.text;if(!text?.startsWith("todo-detail:"))throw new Error("Detail state missing; reopen this todo");const state=JSON.parse(text.slice(12)) as DetailState;
 if(!/^\d+$/.test(state.owner)||!state.todoId||!Number.isInteger(state.revision)||state.revision<0||!state.list)throw new Error("Invalid todo detail state");return state;
}
