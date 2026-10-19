import { expect,test } from "bun:test";
import { TodoRetrospective,renderRetrospective } from "../src/todo/retrospective.js";
const hash="a".repeat(64);
test("retrospective freezes displayed hash before approval and completes only matching durable receipt",async()=>{
 const calls:any[]=[];const run={id:"run",guild_id:"guild",actor:"123",state:"proposed",thread_id:"thread",baseline_hash:"a".repeat(64),baseline_version:"2",correction_ids:["c"]};
 const repo={operation:async(a:string,b:any)=>{calls.push([a,b]);return a==="retrospective-begin"?{run,corrections:[],reports:[],labels:[]}:run;}};
 const bridge={ready:async()=>{},status:async()=>({run_id:"run",thread_id:"thread",baseline_hash:"a".repeat(64),baseline_version:"2",state:"proposed",proposal_hash:hash,proposal:{summary:"Lesson"},diff:"+ complete lesson"}),approve:async()=>{calls.push(["bridge-approve"]);return {run_id:"run",state:"applied",proposal_hash:hash,policy_version:"3",policy_hash:"b".repeat(64)};}};
 (bridge as any).prepareApproval=async(_id:string,_actor:string,h:string)=>{const s=await bridge.status();if(s.proposal_hash!==h)throw Error("Stale");return {...s,state:s.state==="applied"?"applied":"approval_pending",proposal:{rules:[],memory:[],summary:"Lesson"},diff:"lesson"};};
 const service=new TodoRetrospective(repo as any,bridge as any);const view=await service.open("guild","123");
 expect(calls.some(c=>c[0]==="retrospective-complete")).toBe(false);const rendered=renderRetrospective(view,"123");expect(rendered.files[0].attachment.toString()).toContain("+ complete lesson");expect(JSON.parse(rendered.files[1].attachment.toString()).proposal.summary).toBe("Lesson");
 await expect(service.approve("guild","123","run","c".repeat(64))).rejects.toThrow("Stale");
 await service.approve("guild","123","run",hash);
 expect(calls.slice(-3).map(c=>c[0])).toEqual(["retrospective-approve-begin","bridge-approve","retrospective-complete"]);
 expect(calls.at(-1)[1]).toMatchObject({proposal_hash:hash,policy_version:"3",policy_hash:"b".repeat(64)});
});
test("investigating and failed bridge responses never consume correction coverage",async()=>{
 for(const status of [{run_id:"run",state:"investigating"},null,new Error("no response")]){
  const calls:string[]=[];const run={id:"run",guild_id:"guild",actor:"123",thread_id:"thread",baseline_hash:"a".repeat(64),baseline_version:"2",state:"investigating"};
  const repo={operation:async(a:string)=>{calls.push(a);return {run,corrections:[],reports:[],labels:[]};}};
  const bridge={ready:async()=>{},status:async()=>{if(status instanceof Error)throw status;return status;}};
  try{await new TodoRetrospective(repo as any,bridge as any).open("guild","123");}catch{}
  expect(calls).not.toContain("retrospective-complete");expect(calls).not.toContain("retrospective-approve-begin");
 }
});
test("uncertain approval reconciles durable receipt and PB completion without a second policy write",async()=>{
 const calls:string[]=[];const run={id:"run",guild_id:"guild",actor:"123",thread_id:"thread",baseline_hash:"a".repeat(64),baseline_version:"2",state:"proposed",proposal_hash:hash};let applied=false,failCompletion=true;
 const receipt={run_id:"run",state:"applied",proposal_hash:hash,policy_version:"3",policy_hash:"b".repeat(64)};
 const repo={operation:async(a:string)=>{calls.push(a);if(a==="retrospective-begin")return {run,corrections:[],reports:[],labels:[]};if(a==="retrospective-complete"&&failCompletion){failCompletion=false;throw new Error("PB unavailable");}return run;}};
 const bridge={ready:async()=>{},status:async()=>applied?receipt:{run_id:"run",state:"proposed",proposal_hash:hash},approve:async()=>{calls.push("policy-write");applied=true;throw new Error("response lost");}};
 (bridge as any).prepareApproval=async(_id:string,_actor:string,h:string)=>{const s=await bridge.status();if(s.proposal_hash!==h)throw Error("Stale");return {...s,state:s.state==="applied"?"applied":"approval_pending",proposal:{rules:[],memory:[],summary:"Lesson"},diff:"lesson"};};
 const service=new TodoRetrospective(repo as any,bridge as any);await expect(service.approve("guild","123","run",hash)).rejects.toThrow("PB unavailable");await service.open("guild","123");
 expect(calls.filter(c=>c==="policy-write")).toHaveLength(1);expect(calls.filter(c=>c==="retrospective-complete")).toHaveLength(2);
});
test("empty policy version cannot falsely complete a batch",async()=>{
 const calls:string[]=[];const run={id:"run",guild_id:"guild",actor:"123",thread_id:"thread",baseline_hash:"a".repeat(64),baseline_version:"2",state:"applying",proposal_hash:hash};
 const repo={operation:async(a:string)=>{calls.push(a);return {run,corrections:[],reports:[],labels:[]};}};
 const bridge={ready:async()=>{},status:async()=>({run_id:"run",state:"applied",proposal_hash:hash,policy_version:"",policy_hash:"b".repeat(64)})};
 await expect(new TodoRetrospective(repo as any,bridge as any).open("guild","123")).rejects.toThrow("receipt");expect(calls).not.toContain("retrospective-complete");
});
