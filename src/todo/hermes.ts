import type { assessmentPrompt, AssessmentTransport } from "./assessment.js";
import { ChannelType, escapeMarkdown, type Client } from "discord.js";
import { DefinitiveHandoffError, TODO_FORUM_ID, type ConversationInput, type ConversationTransport } from "./service.js";
export function configuredTodoTransports(client:Client,env:NodeJS.ProcessEnv=process.env):{assessment?:AssessmentTransport;conversation?:ConversationTransport}{
 if(!env.HERMES_TODO_BRIDGE_URL||!env.HERMES_TODO_BRIDGE_TOKEN)return {};
 const bridge=new HermesTodoBridge(client,env.HERMES_TODO_BRIDGE_URL,env.HERMES_TODO_BRIDGE_TOKEN);return {assessment:bridge,conversation:bridge};
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
 async assess(messages:ReturnType<typeof assessmentPrompt>):Promise<unknown>{
  const supplied=JSON.parse(messages[1].content);
  const id=typeof supplied.untrustedReport?.id==="string"?supplied.untrustedReport.id:"report-context";
  const result=await this.post("/plugins/discord-todo/v1/assess",{reports:[{id,context:supplied.untrustedReport}],labels:supplied.labels,open_todos:supplied.openTodos});
  if(typeof result.guidance_version!=="string"||!result.guidance_version||!result.assessment)throw new Error("Assessment bridge omitted its actual guidance version or assessment");
  this.guidanceVersion=`hermes-guidance:${result.guidance_version}`;
  return result.assessment;
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
   const title=`#${input.todoNumber} ${input.title.replace(/[\r\n]/g," ")}`.slice(0,100);
   const prefix=`<@${input.developerId}>\n**${escapeMarkdown(title)}**\n`;
   const fits=prefix.length+input.prompt.length<=2000;
   let thread;
   try{thread=await forum.threads.create({name:title,reason:`Shared todo #${input.todoNumber}; claim ${input.idempotencyKey}`,message:{content:fits?prefix+input.prompt:prefix+"Complete task description, linked reports and surrounding context are attached. Agent work and follow-ups belong in this forum post.",allowedMentions:{parse:[],users:[input.developerId]},...(fits?{}:{files:[{attachment:Buffer.from(input.prompt),name:`todo-${input.todoNumber}-context.md`}]})}});}catch(error){
    const status=(error as {status?:number}).status;
    if(status&&status>=400&&status<500&&status!==408)throw new DefinitiveHandoffError(`Discord forum creation was rejected (HTTP ${status})`);
    throw new Error("Discord forum creation outcome is uncertain; inspect the forum before recovering this claim");
   }
   threadId=thread.id;
   try{await input.onThreadCreated({id:thread.id,url:thread.url});}catch{throw new Error(`Forum post ${thread.url} was created but persistence failed; recover this existing thread, never blindly create another`);}
  }
  const result=await this.post("/plugins/discord-todo/v1/start",{thread_id:threadId,user_id:input.developerId,context:input.prompt});
  if(result.status!=="accepted"||result.thread_id!==threadId)throw new Error("Hermes bridge did not confirm canonical thread admission");
  return {conversationId:threadId};
 }
}
