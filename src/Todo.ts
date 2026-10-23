import { ApplicationCommandType, ContextMenuCommandBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction, type Client, type Message, type MessageComponentInteraction, type MessageContextMenuCommandInteraction } from "discord.js";
import { TodoRetrospective, renderRetrospective, type RetrospectiveTransport } from "./todo/retrospective.js";
import type PocketBase from "pocketbase";
import { configuredTodoTransports, splitOpeningPrompt } from "./todo/hermes.js";
import { collectContext, type ContextMessage } from "./todo/context.js";
import { TodoManagement } from "./todo/management.js";
import { readDetailState, renderDetail } from "./todo/detail.js";
import { attachReportLinks, readListState, renderList, type ListFilters, type ListState } from "./todo/list.js";
import { TodoRepository, TodoService, type ConversationTransport } from "./todo/service.js";
import type { AssessmentTransport } from "./todo/assessment.js";
const RAWBTV="391355330241757205";
export const data=[
 new SlashCommandBuilder().setName("todo").setDescription("Shared developer todo list").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
 .addSubcommand(c=>c.setName("list").setDescription("Browse active todos")
  .addStringOption(o=>o.setName("label").setDescription("Label or group; omitted means all").setAutocomplete(true))
  .addStringOption(o=>o.setName("kind").setDescription("Omitted means bugs and features").addChoices({name:"Bug",value:"bug"},{name:"Feature",value:"feature"}))
  .addStringOption(o=>o.setName("priority").setDescription("Omitted means all priorities").addChoices(...["red","yellow","blue"].map(value=>({name:value,value})))))
 .addSubcommand(c=>c.setName("retrospective").setDescription("Investigate corrections; review proposed policy diff before approval"))
 .addSubcommand(c=>c.setName("manage").setDescription("Graphically manage labels, nested groups and user assignments"))
 .addSubcommand(c=>c.setName("assess").setDescription("Manually assess pending or failed reports")
  .addStringOption(o=>o.setName("report").setDescription("Report record ID; omitted processes pending/failed reports")))
 .addSubcommand(c=>c.setName("resolve").setDescription("Manually resolve a report after human clarification; never calls the model")
  .addStringOption(o=>o.setName("report").setDescription("Report record ID").setRequired(true))
  .addStringOption(o=>o.setName("decisions").setDescription("Reviewed JSON {decisions:[...]}; see docs/shared-todos.md").setRequired(true)))
 .addSubcommand(c=>c.setName("reopen").setDescription("Reopen a PR-ready, closed or cancelled todo")
  .addIntegerOption(o=>o.setName("id").setDescription("Public todo number").setMinValue(1).setRequired(true))
  .addStringOption(o=>o.setName("reason").setDescription("Why it needs reopening")))
 .addSubcommand(c=>c.setName("label").setDescription("Manually change a todo's primary plugin label")
  .addIntegerOption(o=>o.setName("id").setDescription("Public todo number").setMinValue(1).setRequired(true))
  .addStringOption(o=>o.setName("label").setDescription("Concrete plugin label").setAutocomplete(true).setRequired(true))
  .addStringOption(o=>o.setName("reason").setDescription("Reason for relabeling")))
 .addSubcommand(c=>c.setName("kind").setDescription("Manually correct todo kind")
  .addIntegerOption(o=>o.setName("id").setDescription("Todo number").setRequired(true).setMinValue(1))
  .addStringOption(o=>o.setName("kind").setDescription("Kind").setRequired(true).addChoices({name:"Bug",value:"bug"},{name:"Feature",value:"feature"}))
  .addStringOption(o=>o.setName("reason").setDescription("Optional correction reason")))
 .addSubcommand(c=>c.setName("priority").setDescription("Manually override todo priority")
  .addIntegerOption(o=>o.setName("id").setDescription("Todo number").setRequired(true).setMinValue(1))
  .addStringOption(o=>o.setName("priority").setDescription("Priority").setRequired(true).addChoices(...["red","yellow","blue"].map(value=>({name:value,value}))))
  .addStringOption(o=>o.setName("reason").setDescription("Optional correction reason")))
 .addSubcommand(c=>c.setName("resume").setDescription("Resume admission in an already-created forum post, without creating another")
  .addIntegerOption(o=>o.setName("id").setDescription("Public todo number").setMinValue(1).setRequired(true)))
 .addSubcommand(c=>c.setName("status").setDescription("Record progress; done means PR READY")
  .addIntegerOption(o=>o.setName("id").setDescription("Public todo number").setMinValue(1).setRequired(true))
  .addStringOption(o=>o.setName("status").setDescription("New state").setRequired(true).addChoices(...["open","in_progress","blocked","done","closed","cancelled"].map(value=>({name:value,value}))))
  .addStringOption(o=>o.setName("reason").setDescription("Reason for status change"))
  .addStringOption(o=>o.setName("pr").setDescription("Ready GitHub pull request URL"))
  .addStringOption(o=>o.setName("work").setDescription("Work or verification notes to append")))
 .addSubcommand(c=>c.setName("recover").setDescription("Recover an interrupted conversation handoff after checking the destination")
  .addIntegerOption(o=>o.setName("id").setDescription("Public todo number").setMinValue(1).setRequired(true))
  .addStringOption(o=>o.setName("conversation").setDescription("Existing conversation identifier, if started"))
  .addBooleanOption(o=>o.setName("confirm_absent").setDescription("I verified that no conversation started; release claim"))
  .addStringOption(o=>o.setName("reason").setDescription("Recovery evidence"))),
 new ContextMenuCommandBuilder().setName("Create report").setType(ApplicationCommandType.Message).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];
function snapshot(message:Message):ContextMessage{return {id:message.id,channelId:message.channelId,senderId:message.author.id,senderName:message.author.globalName??message.author.username,timestamp:message.createdTimestamp,content:message.content,attachments:[...message.attachments.values()].map(a=>({url:a.url,name:a.name,contentType:a.contentType})),replyTo:message.reference?.messageId};}
type ReplyInteraction=ChatInputCommandInteraction|MessageContextMenuCommandInteraction|MessageComponentInteraction;
export class TodoController {
 constructor(private service:TodoService,private retrospective?:TodoRetrospective){}
 private async allowed(i:ReplyInteraction):Promise<boolean>{
  // As /plugins update: Discord authorizes slash delivery, including server overrides.
  if(i.guildId===RAWBTV)return true;
  await i.reply({content:"This command is only available in the RAWBTV server.",flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});return false;
 }
 private async error(i:ReplyInteraction,error:unknown){const p={content:`Todo operation failed: ${error instanceof Error?error.message:"Unexpected error"}`.slice(0,1900),allowedMentions:{parse:[] as []}};if(i.deferred||i.replied)await i.editReply(p);else await i.reply({...p,flags:MessageFlags.Ephemeral});}
 async capture(i:MessageContextMenuCommandInteraction):Promise<void>{
  if(!await this.allowed(i))return;await i.deferReply({flags:MessageFlags.Ephemeral});
  try{
   const original=i.targetMessage;const channel=original.channel;
   if(!("messages" in channel)||!original.guildId)throw new Error("Message channel history is unavailable");
   const context=await collectContext(snapshot(original),async before=>[...(await channel.messages.fetch({limit:100,...(before?{before}:{}),cache:false})).values()].map(snapshot));
   const thread=channel.isThread();
   const source={guild_id:original.guildId,channel_id:original.channelId,thread_id:thread?channel.id:null,parent_channel_id:thread?channel.parentId:null,channel_name:"name" in channel?channel.name:null,thread_name:thread?channel.name:null,parent_channel_name:thread?channel.parent?.name??null:null,message_id:original.id,sender_id:original.author.id,sender_name:original.author.globalName??original.author.username,content:original.content,attachments:snapshot(original).attachments,created_by:i.user.id,created_by_name:i.user.globalName??i.user.username,created_at:new Date().toISOString(),url:original.url};
   const report=await this.service.repo.operation("capture",{guild_id:original.guildId,channel_id:original.channelId,message_id:original.id,source,context,context_text:context.text});
   await i.editReply({content:`Report ${report.id} · ${report.state}.${context.complete?"":" Context is INCOMPLETE: "+context.errors.join(", ")+". Human review required."}`,allowedMentions:{parse:[]}});
  }catch(error){await this.error(i,error);}
 }
 async command(i:ChatInputCommandInteraction):Promise<void>{
  if(!await this.allowed(i))return;await i.deferReply({flags:MessageFlags.Ephemeral});
  try{
   const action=i.options.getSubcommand();
   if(action==="retrospective"){if(!this.retrospective)throw new Error("Retrospective bridge is not configured");await i.editReply(renderRetrospective(await this.retrospective.open(i.guildId!,i.user.id),i.user.id));return;}
   if(action==="manage"){await i.editReply(await new TodoManagement(this.service.repo).open(i.guildId!,i.user.id));return;}
   if(action==="list"){
    const filters:ListFilters={};for(const key of ["label","kind","priority"] as const){const value=i.options.getString(key);if(value)filters[key]=value;}
    if(filters.label==="me")filters.userId=i.user.id;
    const {todos,labels}=await this.service.list(i.guildId!,filters);await i.editReply(renderList(todos,labels,{owner:i.user.id,page:0,filters}));return;
   }
   if(action==="assess"){
    const id=i.options.getString("report");const reports=id?[await this.service.repo.report(id)]:await this.service.repo.reports(i.guildId!);
    const summary:string[]=[];for(const report of reports){try{const result=await this.service.assess(report.id,i.user.id,i.guildId!);summary.push(`${report.id}: ${result.state}`);}catch(error){summary.push(`${report.id}: failed (${error instanceof Error?error.message:"error"})`);}}
    const text=summary.join("\n")||"No pending or failed reports.";
    if(text.length>1900)await i.editReply({content:"Assessment batch finished; complete results attached.",files:[{attachment:Buffer.from(text),name:"assessment-results.txt"}],allowedMentions:{parse:[]}});else await i.editReply({content:text,allowedMentions:{parse:[]}});return;
   }
   if(action==="resolve"){
    const report=await this.service.resolve(i.options.getString("report",true),i.user.id,i.guildId!,JSON.parse(i.options.getString("decisions",true)));
    await i.editReply({content:`Report ${report.id}: ${report.state}; ${report.todos.length} linked todos. Human review saved.`,allowedMentions:{parse:[]}});return;
   }
   if(action==="reopen"){
    const todo=await this.service.repo.operation("reopen",{number:i.options.getInteger("id",true),guild_id:i.guildId,actor:i.user.id,reason:i.options.getString("reason")??""});
    await i.editReply({content:`Todo #${todo.number}: ${todo.status}. Context, work, PR links and history preserved.`,allowedMentions:{parse:[]}});return;
   }
   if(action==="kind"||action==="priority"){
    const todo=await this.service.repo.byNumber(i.options.getInteger("id",true),i.guildId!);
    const value=i.options.getString(action,true);
    if(!(action==="kind"?["bug","feature"]:["red","yellow","blue"]).includes(value))throw new Error("Invalid classification");
    await this.service.repo.operation("classification",{id:todo.id,guild_id:i.guildId,actor:i.user.id,[action]:value,reason:i.options.getString("reason")??"",expected_revision:todo.audit?.length??0});
    await i.editReply({content:`Todo #${todo.number}: ${action} updated.`,allowedMentions:{parse:[]}});return;
   }
   if(action==="label"){
    const todo=await this.service.repo.byNumber(i.options.getInteger("id",true),i.guildId!);const value=i.options.getString("label",true);
    if(!value.startsWith("label:"))throw new Error("Choose a concrete label, not a group");
    await this.service.repo.operation("label",{id:todo.id,label:value.slice(6),actor:i.user.id,reason:i.options.getString("reason")??"",expected_revision:todo.audit?.length??0});
    await i.editReply({content:`Todo #${todo.number}: label updated. Existing working forum thread was not moved.`,allowedMentions:{parse:[]}});return;
   }
   if(action==="resume"){
    const todo=await this.service.repo.byNumber(i.options.getInteger("id",true),i.guildId!);const result=await this.service.resume(todo.id,i.user.id,i.guildId!);
    await i.editReply({content:`Todo #${result.number}: canonical forum conversation admission accepted. This is not confirmation of completed work or Discord delivery.`,allowedMentions:{parse:[]}});return;
   }
   if(action==="status"){
    const todo=await this.service.repo.byNumber(i.options.getInteger("id",true),i.guildId!);
    const result=await this.service.repo.operation("status",{id:todo.id,actor:i.user.id,status:i.options.getString("status",true),expected_revision:todo.audit?.length??0,reason:i.options.getString("reason")??"",pr:i.options.getString("pr"),work:i.options.getString("work")});
    await i.editReply({content:`Todo #${result.number}: ${result.status}${result.status==="done"?" (PR READY)":""}. History saved. Manual changes do NOT stop or cancel any running agent.`,allowedMentions:{parse:[]}});return;
   }
   if(action==="recover"){
    const todo=await this.service.repo.byNumber(i.options.getInteger("id",true),i.guildId!);
    const result=await this.service.repo.operation("recover",{id:todo.id,actor:i.user.id,message_id:i.options.getString("conversation"),confirm_absent:i.options.getBoolean("confirm_absent")===true,reason:i.options.getString("reason")??""});
    await i.editReply({content:`Todo #${result.number}: ${result.status}. Recovery recorded.`,allowedMentions:{parse:[]}});return;
   }
   throw new Error("Unknown todo command");
  }catch(error){await this.error(i,error);}
 }
 async autocomplete(i:AutocompleteInteraction):Promise<void>{
  if(i.guildId!==RAWBTV){await i.respond([]);return;}
  try{const [labels,groups]=await Promise.all([this.service.repo.labels(i.guildId),this.service.repo.groups(i.guildId)]);const query=String(i.options.getFocused()).toLowerCase();await i.respond([...(i.options.getSubcommand()==="list"?[{name:"me — my assigned label groups",value:"me"}]:[]),...labels.map(l=>({name:l.name,value:`label:${l.id}`})),...(i.options.getSubcommand()==="label"?[]:groups.map(g=>({name:`${g.name} (group)`,value:`group:${g.id}`})))].filter(c=>c.name.toLowerCase().includes(query)).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,25).map(c=>({...c,name:c.name.slice(0,100)})));}catch{await i.respond([]);}
 }
 async component(i:MessageComponentInteraction):Promise<void>{
  const [prefix,owner,action,id]=i.customId.split("|");if(prefix!=="todo"&&prefix!=="todo-retro")return;
  if(i.guildId!==RAWBTV||i.message.author.id!==i.client.user.id||owner!==i.user.id){await i.reply({content:"Only the developer who opened this list can use its controls in RAWBTV.",flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});return;}
  try{
   if(prefix==="todo-retro"){
    if(!this.retrospective)throw new Error("Retrospective bridge is not configured");
    const footer=i.message.embeds[0]?.footer?.text;if(!footer?.startsWith("todo-retro:"))throw new Error("Retrospective view missing");
    const view=JSON.parse(footer.slice(11));if(view.owner!==owner||view.id!==id)throw new Error("Retrospective view mismatch");
    await i.deferUpdate();
    if(action!=="approve"&&action!=="refresh")throw new Error("Invalid retrospective control");
    const status=action==="approve"?await this.retrospective.approve(i.guildId!,i.user.id,id,view.hash):await this.retrospective.open(i.guildId!,i.user.id);
    await i.editReply(renderRetrospective(status,i.user.id));return;
   }
   const detailMode=i.message.embeds[0]?.footer?.text?.startsWith("todo-detail:");
   const detail=detailMode?readDetailState(i.message):undefined;
   const state=detail?.list??readListState(i.message);if(state.owner!==owner||detail&&detail.owner!==owner)throw new Error("List ownership mismatch");
   if(detail&&detail.todoId!==id)throw new Error("Todo detail mismatch");
   if(action==="prompt"){
    await i.deferReply({flags:MessageFlags.Ephemeral});
    const chunks=splitOpeningPrompt(await this.service.previewPrompt(id,i.guildId!),2000);
    const allowedMentions={parse:[] as [],repliedUser:false};
    await i.editReply({content:chunks[0],allowedMentions});
    try{
     for(const content of chunks.slice(1))await i.followUp({content,flags:MessageFlags.Ephemeral,allowedMentions});
    }catch{
     // Never overwrite already-delivered prompt text on a partial send.
     await i.followUp({content:"Prompt delivery is incomplete because a continuation failed. Use Show prompt again to retry; previous chunks are preserved.",flags:MessageFlags.Ephemeral,allowedMentions}).catch(()=>{});
    }
    return;
   }
   await i.deferUpdate();
   if(["edit","set-label","set-status","set-kind","set-priority","labels-next","labels-previous"].includes(action)){
    if((action==="set-label"||action==="set-status"||action==="set-kind"||action==="set-priority")){
     if(!detail||!i.isStringSelectMenu()||i.values.length!==1)throw new Error("Invalid edit control");
     const todo=await this.service.repo.todo(id);if(todo.guild_id!==i.guildId)throw new Error("Todo is outside this server");
     const field=action.slice(4);
     if(field==="kind"&&!["bug","feature"].includes(i.values[0])||field==="priority"&&!["red","yellow","blue"].includes(i.values[0]))throw new Error("Invalid classification");
     await this.service.repo.operation(field==="label"?"label":field==="status"?"status":"classification",{id,guild_id:i.guildId,actor:i.user.id,[field]:i.values[0],reason:"",expected_revision:detail.revision});
    }
    const [todo,labels,origins]=await Promise.all([this.service.repo.todo(id),this.service.repo.labels(i.guildId!),this.service.repo.origins(i.guildId!)]);
    if(todo.guild_id!==i.guildId)throw new Error("Todo is outside this server");
    const page=(detail?.labelPage??0)+(action==="labels-next"?1:action==="labels-previous"?-1:0);
    await i.editReply(renderDetail(attachReportLinks([todo],origins)[0],labels,state,page));return;
   }
   if(action==="back"){
    const {todos,labels}=await this.service.list(i.guildId!,{...state.filters,...(state.filters.label==="me"?{userId:i.user.id}:{})});await i.editReply(renderList(todos,labels,state));return;
   }
   if(action==="start"){
    const todo=await this.service.start(id,i.user.id,i.guildId!);
    const {todos,labels}=await this.service.list(i.guildId!,{...state.filters,...(state.filters.label==="me"?{userId:i.user.id}:{})});
    const rendered=renderList(todos,labels,state);rendered.content=`Forum conversation admission accepted for #${todo.number}. This is not confirmation of completed work or message delivery.\n${rendered.content}`;await i.editReply(rendered);return;
   }
   if(action==="next")state.page++;else if(action==="previous")state.page=Math.max(0,state.page-1);else if(action!=="refresh")throw new Error("Unknown list control");
   const {todos,labels}=await this.service.list(i.guildId!,{...state.filters,...(state.filters.label==="me"?{userId:i.user.id}:{})});await i.editReply(renderList(todos,labels,state));
  }catch(error){await this.error(i,error);}
 }
}
export default function TodoList(client:Client,pb:PocketBase,transports:{assessment?:AssessmentTransport;conversation?:ConversationTransport;retrospective?:RetrospectiveTransport}=configuredTodoTransports(client)):void{
 const controllerRepo=new TodoRepository(pb);
 const controller=new TodoController(new TodoService(controllerRepo,transports.assessment,transports.conversation),new TodoRetrospective(controllerRepo,transports.retrospective));
 client.on("interactionCreate",async i=>{
  try{if(i.isMessageContextMenuCommand()&&i.commandName==="Create report")await controller.capture(i);
  else if(i.isChatInputCommand()&&i.commandName==="todo")await controller.command(i);
  else if(i.isAutocomplete()&&i.commandName==="todo")await controller.autocomplete(i);
  else if(i.isMessageComponent()&&i.customId.startsWith("todo-manage|"))await new TodoManagement(controllerRepo).component(i);
  else if(i.isModalSubmit()&&i.customId.startsWith("todo-manage|"))await new TodoManagement(controllerRepo).modal(i);
  else if(i.isMessageComponent()&&(i.customId.startsWith("todo|")||i.customId.startsWith("todo-retro|")))await controller.component(i);
  }catch{console.error("Todo: interaction response failed");}
 });
}
