import type { RetrospectiveTransport } from "./retrospective.js";
import type { assessmentPrompt, AssessmentTransport } from "./assessment.js";
import { ChannelType, DiscordAPIError, escapeMarkdown, type Client } from "discord.js";
import { DefinitiveHandoffError, TODO_FORUM_ID, type ConversationInput, type ConversationTransport } from "./service.js";
export function configuredTodoTransports(client:Client,env:NodeJS.ProcessEnv=process.env):{assessment?:AssessmentTransport;conversation?:ConversationTransport;retrospective?:RetrospectiveTransport}{
 if(!env.HERMES_TODO_BRIDGE_URL||!env.HERMES_TODO_BRIDGE_TOKEN)return {};
 const bridge=new HermesTodoBridge(client,env.HERMES_TODO_BRIDGE_URL,env.HERMES_TODO_BRIDGE_TOKEN);return {assessment:bridge,conversation:bridge,retrospective:bridge};
}
/** Lossless Discord-sized slices; prefer paragraph/line boundaries without tiny fragments. */
export function splitOpeningPrompt(prompt:string,firstLimit:number):string[]{
 const chunks:string[]=[];let remaining=prompt;let limit=firstLimit;
 do{
  let end=Math.min(limit,remaining.length);
  if(end<remaining.length){
   const paragraph=remaining.lastIndexOf("\n\n",end-2)+2;
   const line=remaining.lastIndexOf("\n",end-1)+1;
   if(paragraph>limit/2)end=paragraph;else if(line>limit/2)end=line;
   const previous=remaining.charCodeAt(end-1);if(previous>=0xD800&&previous<=0xDBFF)end--;
  }
  chunks.push(remaining.slice(0,end));remaining=remaining.slice(end);limit=2000;
 }while(remaining.length);
 return chunks;
}
/** Supported directory-plugin contract; this is not a built-in Hermes REST endpoint. */
export class HermesTodoBridge implements ConversationTransport,AssessmentTransport {
 guidanceVersion?:string;
 private base:URL;
 constructor(private client:Client,url:string,private token:string){
  this.base=new URL(url);if(!["http:","https:"].includes(this.base.protocol)||this.base.username||this.base.password||this.base.search||this.base.hash)throw new Error("Invalid Hermes todo bridge URL");
 }
 async ready():Promise<void>{if(this.token.length<32)throw new Error("Hermes todo bridge token is not configured (minimum 32 characters)");}
 private async post(path:string,payload:unknown):Promise<any>{
  await this.ready();const body=JSON.stringify(payload);
  if(Buffer.byteLength(body)>256*1024)throw new Error("Full context exceeds the Hermes bridge 256 KiB safety bound; no content was silently truncated");
  let response:Response;
  try{response=await fetch(new URL(path,this.base),{method:"POST",headers:{Authorization:`Bearer ${this.token}`,"Content-Type":"application/json"},body,redirect:"error",signal:AbortSignal.timeout(110000)});}catch{throw new Error("Hermes todo bridge transport failed; outcome may be uncertain");}
  if(!response.ok)throw new Error(`Hermes todo bridge rejected request (HTTP ${response.status}); inspect its operator logs`);
  let value:unknown;try{value=await response.json();}catch{throw new Error("Hermes todo bridge returned invalid JSON");}return value;
 }
 async status(run_id:string,user_id:string):Promise<any>{return this.post("/plugins/discord-todo/v1/retrospective/status",{run_id,user_id});}
 async prepareApproval(run_id:string,user_id:string,proposal_hash:string):Promise<any>{return this.post("/plugins/discord-todo/v1/retrospective/prepare-approval",{run_id,user_id,proposal_hash});}
 async preflightRetrospective(input:{run:any;corrections:any[];context:string}):Promise<void>{
  await this.ready();const {run,context,corrections}=input;
  const payload={run_id:run.id,thread_id:run.thread_id??"0".repeat(20),user_id:run.actor,guild_id:run.guild_id,corrections,context};
  if(Array.from(context).length>60000||Buffer.byteLength(JSON.stringify(payload))>200000)throw Object.assign(new Error("Retrospective evidence exceeds bridge bounds; nothing truncated"),{confirmedNoThread:true});
  if(!run.thread_id){
   const forum=await this.client.channels.fetch(TODO_FORUM_ID);
   if(!forum||forum.type!==ChannelType.GuildForum||forum.guildId!==run.guild_id)throw Object.assign(new Error("Invalid retrospective guild forum"),{confirmedNoThread:true});
   if(forum.availableTags.filter(t=>t.name.toLowerCase()==="meta").length!==1)throw Object.assign(new Error("Retrospective requires exactly one native Meta forum tag"),{confirmedNoThread:true});
  }
 }
 async approve(run_id:string,user_id:string,proposal_hash:string):Promise<any>{return this.post("/plugins/discord-todo/v1/retrospective/approve",{run_id,user_id,proposal_hash});}
 async startRetrospective(input:{run:any;corrections:any[];context:string;onThread:(id:string)=>Promise<void>}):Promise<any>{
  await this.ready();const {run,context,corrections}=input;
  const payload={run_id:run.id,thread_id:run.thread_id??"0".repeat(20),user_id:run.actor,guild_id:run.guild_id,corrections,context};
  if(Array.from(context).length>60000||Buffer.byteLength(JSON.stringify(payload))>200000)throw Object.assign(new Error("Retrospective evidence exceeds bridge bounds; nothing truncated"),{confirmedNoThread:true});
  let threadId=run.thread_id;
  if(!threadId){
   // This GET cannot create a thread; its failure is safe to release even after reservation.
   const forum=await this.client.channels.fetch(TODO_FORUM_ID).catch(error=>{throw Object.assign(new Error(error instanceof Error?error.message:"Could not read retrospective forum"),{confirmedNoThread:true});});
   if(!forum||forum.type!==ChannelType.GuildForum||forum.guildId!==run.guild_id)throw Object.assign(new Error("Invalid retrospective guild forum"),{confirmedNoThread:true});
   const tags=forum.availableTags.filter(t=>t.name.toLowerCase()==="meta");if(tags.length!==1)throw Object.assign(new Error("Retrospective requires exactly one native Meta forum tag"),{confirmedNoThread:true});
   const title=`Assessment retrospective — ${run.id}`;const prefix=`<@${run.actor}>\n**${escapeMarkdown(title)}**\n`;const chunks=splitOpeningPrompt(context,2000-prefix.length);
   let thread;
   try{thread=await forum.threads.create({name:title.slice(0,100),appliedTags:[tags[0]!.id],message:{content:prefix+chunks[0],allowedMentions:{parse:[],users:[run.actor]}},reason:`Assessment retrospective ${run.id}`});}
   catch(error){if(error instanceof DiscordAPIError&&error.status===403)Object.assign(error as object,{confirmedNoThread:true});throw error;}
   threadId=thread.id;await input.onThread(threadId);
   for(const content of chunks.slice(1))await thread.send({content,allowedMentions:{parse:[],users:[],roles:[],repliedUser:false}});
  }else await this.verifyOpeningDisplay({existingThreadId:threadId,guildId:run.guild_id,developerId:run.actor,prompt:context} as ConversationInput);
  const result=await this.post("/plugins/discord-todo/v1/retrospective/start",{...payload,thread_id:threadId});
  if(result.status!=="accepted"||result.run_id!==run.id||result.thread_id!==threadId||typeof result.baseline_hash!=="string"||!/^[a-f0-9]{64}$/.test(result.baseline_hash)||result.baseline_version===undefined)throw new Error("Bridge omitted durable retrospective admission/baseline");
  return result;
 }
 async assess(messages:ReturnType<typeof assessmentPrompt>):Promise<unknown>{
  const supplied=JSON.parse(messages[1].content);
  const id=typeof supplied.untrustedReport?.id==="string"?supplied.untrustedReport.id:"report-context";
  const result=await this.post("/plugins/discord-todo/v1/assess",{reports:[{id,context:supplied.untrustedReport}],labels:supplied.labels,open_todos:supplied.openTodos});
  if(typeof result.guidance_version!=="string"||!result.guidance_version||!result.assessment)throw new Error("Assessment bridge omitted its actual guidance version or assessment");
  this.guidanceVersion=`hermes-guidance:${result.guidance_version}`;
  return result.assessment;
 }
 private async verifyOpeningDisplay(input:ConversationInput):Promise<void>{
  // No write or reinjection on a partial/uncertain display. Operators must restore the exact
  // missing messages in the saved thread before resume; never create a replacement thread.
  const fail=()=>new Error("Full opening prompt is not verifiably displayed in the saved forum thread; restore its exact normal messages before resume");
  const thread=await this.client.channels.fetch(input.existingThreadId!);
  if(!thread||thread.type!==ChannelType.PublicThread||thread.guildId!==input.guildId||thread.parentId!==TODO_FORUM_ID)throw fail();
  const starter=await thread.fetchStarterMessage({force:true});
  if(!starter||starter.author.id!==this.client.user?.id)throw fail();
  const prefix=starter.content.match(/^<@\d+>\n\*\*[^\n]*\*\*\n/)?.[0];
  if(!prefix?.startsWith(`<@${input.developerId}>\n`))throw fail();
  let displayed=starter.content.slice(prefix.length),cursor=starter.id;
  if(!input.prompt.startsWith(displayed))throw fail();
  while(displayed.length<input.prompt.length){
   const page=await thread.messages.fetch({after:cursor,limit:100});
   const messages=[...page.values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);
   if(!messages.length)throw fail();
   for(const message of messages){
    if(BigInt(message.id)<=BigInt(cursor)||message.author.id!==this.client.user?.id||!message.content)throw fail();
    displayed+=message.content;cursor=message.id;
    if(!input.prompt.startsWith(displayed))throw fail();
    if(displayed===input.prompt)return;
   }
  }
 }
 async start(input:ConversationInput):Promise<{conversationId:string}>{
  await this.ready();
  if(input.forumId!==TODO_FORUM_ID||!/^\d+$/.test(input.developerId))throw new DefinitiveHandoffError("Invalid todo forum or developer identity");
  // Python's len(context) counts Unicode code points, not UTF-16 code units.
  if(Array.from(input.prompt).length>60000)throw new DefinitiveHandoffError("Full opening context exceeds the bridge 60000 character limit; no forum post created and no context truncated");
  // Check the full serialized request size before the first irreversible Discord write.
  if(Buffer.byteLength(JSON.stringify({thread_id:input.existingThreadId??"0".repeat(20),user_id:input.developerId,context:input.prompt}))>256*1024)throw new DefinitiveHandoffError("Full opening context exceeds the bridge 256 KiB limit; no forum post created and no context truncated");
  let threadId=input.existingThreadId;
  if(!threadId){
   const forum=await this.client.channels.fetch(TODO_FORUM_ID);
   if(!forum||forum.type!==ChannelType.GuildForum||forum.guildId!==input.guildId)throw new DefinitiveHandoffError("Configured destination is not the expected guild forum");
   const tag=(name:string)=>{const matches=(forum.availableTags??[]).filter(t=>t.name.toLowerCase()===name.toLowerCase());if(matches.length!==1)throw new DefinitiveHandoffError(`Forum needs exactly one ${name} tag before Start; no forum post created`);return matches[0]!.id;};
   if(!["red","yellow","blue"].includes(input.priority)||!["bug","feature"].includes(input.kind)||!input.labelName.trim())throw new DefinitiveHandoffError("Todo requires a valid priority, kind and label before forum creation");
   const appliedTags=[tag(input.priority),tag(input.kind)];
   const title=Array.from(`#${input.todoNumber} ${input.labelName} — ${input.title}`.replace(/[\r\n]/g," ")).slice(0,100).join("");
   const prefix=`<@${input.developerId}>\n**${escapeMarkdown(title)}**\n`;
   const chunks=splitOpeningPrompt(input.prompt,2000-prefix.length);
   let thread;
   try{thread=await forum.threads.create({name:title,appliedTags,reason:`Shared todo #${input.todoNumber}; claim ${input.idempotencyKey}`,message:{content:prefix+chunks[0],allowedMentions:{parse:[],users:[input.developerId]}}});}catch(error){
    const status=(error as {status?:number}).status;
    if(status&&status>=400&&status<500&&status!==408)throw new DefinitiveHandoffError(`Discord forum creation was rejected (HTTP ${status})`);
    throw new Error("Discord forum creation outcome is uncertain; inspect the forum before recovering this claim");
   }
   threadId=thread.id;
   try{await input.onThreadCreated({id:thread.id,url:thread.url});}catch{throw new Error(`Forum post ${thread.url} was created but persistence failed; recover this existing thread, never blindly create another`);}
   for(const content of chunks.slice(1))await thread.send({content,allowedMentions:{parse:[],users:[],roles:[],repliedUser:false}});
  }else await this.verifyOpeningDisplay(input);
  const result=await this.post("/plugins/discord-todo/v1/start",{thread_id:threadId,user_id:input.developerId,context:input.prompt});
  if(result.status!=="accepted"||result.thread_id!==threadId)throw new Error("Hermes bridge did not confirm canonical thread admission");
  return {conversationId:threadId};
 }
}
