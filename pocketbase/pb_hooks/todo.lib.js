function fail(message) { throw new BadRequestError(message); }
function json(record, field, fallback) { const value=record.getString(field); return value ? JSON.parse(value) : fallback; }
function find(app, collection, filter, params) { return app.findRecordsByFilter(collection,filter,"",0,0,params||{}); }
function audit(record,event,actor,extra) { const entries=json(record,"audit",[]); entries.push(Object.assign({event,actor,at:new Date().toISOString()},extra||{}));record.set("audit",entries); }
function report(app,id) { return app.findRecordById("todo_list_reports",id); }
function todo(app,id) { return app.findRecordById("todo_list_todos",id); }
function sameGuild(record,guild){ if(record.getString("guild_id")!==guild)fail("Cross-guild reference"); }
function lease(record,token) { const assessment=json(record,"assessment",{}); if(record.getString("state")!=="assessing" || assessment.token!==token)fail("Assessment lease lost"); return assessment; }
function claim(record,token) { const c=json(record,"claim",{}); if(!token || c.token!==token)fail("Claim lost");return c; }
function unresolvedReview(assessment) {
 // Leases/failures wrap the last committed decisions; only a later commit can resolve them.
 for(let a=assessment;a;a=a.previous){
  if(Array.isArray(a.decisions))return a.decisions.some(d=>d.action==="clarify"||d.confidence<0.7);
 }
 return false;
}
function newTodo(app,reportRecord,d,index) {
 const record=new Record(app.findCollectionByNameOrId("todo_list_todos"));
 app.db().newQuery("INSERT INTO todo_list_number_sequence DEFAULT VALUES").execute();
 const row=new DynamicModel({id:0});app.db().newQuery("SELECT last_insert_rowid() AS id").one(row);
 for(const key of ["title","description","label","kind","priority"])record.set(key,d[key]);
 record.set("number",row.id);record.set("guild_id",reportRecord.getString("guild_id"));record.set("origin_key",reportRecord.id+":"+index);record.set("status","open");record.set("claim",{});record.set("work",{});record.set("pr_links",[]);record.set("audit",[]);
 audit(record,"created",json(reportRecord,"assessment",{}).actor,{report:reportRecord.id});app.save(record);return record;
}
exports.execute=function(app,action,b){
 if(action==="capture"){
  for(const key of ["guild_id","channel_id","message_id"])if(typeof b[key]!=="string" || !b[key])fail("Missing source identity");
  const key=b.guild_id+":"+b.channel_id+":"+b.message_id;
  const existing=find(app,"todo_list_reports","source_key = {:key}",{key});if(existing.length)return existing[0];
  const r=new Record(app.findCollectionByNameOrId("todo_list_reports"));r.set("source_key",key);
  for(const field of ["guild_id","channel_id","message_id","source","context","context_text"])r.set(field,b[field]);
  r.set("state","pending");r.set("todos",[]);r.set("assessment",{});app.save(r);return r;
 }
 if(action==="assess-begin"||action==="resolve-begin"){
  const manual=action==="resolve-begin";
  const r=report(app,b.id);const previous=json(r,"assessment",{});
  if(["assessed","dismissed"].indexOf(r.getString("state"))>=0)return {done:true,report:r};
  if(r.getString("state")==="assessing" && Date.now()-previous.started_ms<600000)fail("Already assessing");
  // Partially accepted reports need human decisions, not another model run which could duplicate splits.
  if((r.getString("state")==="needs_clarification"||unresolvedReview(previous))&&!manual)fail("Resolve clarification manually before reassessment");
  const guild=r.getString("guild_id");
  const labels=find(app,"todo_list_labels","guild_id = {:guild}",{guild});
  const todos=find(app,"todo_list_todos","guild_id = {:guild} && (status = 'open' || status = 'in_progress' || status = 'blocked')",{guild});
  const token=$security.randomString(24);
  r.set("state","assessing");r.set("assessment",{token,actor:b.actor,manual,started_ms:Date.now(),previous,labels:labels.map(x=>x.id),todos:todos.map(x=>x.id)});app.save(r);
  return {token,report:r,labels,todos};
 }
 if(action==="assess-fail"){
  const r=report(app,b.id);const a=lease(r,b.token);r.set("state","failed");r.set("assessment",Object.assign(a,{error:String(b.error||"Assessment failed").slice(0,2000),failed_at:new Date().toISOString(),token:null}));app.save(r);return r;
 }
 if(action==="assess-commit"){
  const r=report(app,b.id);const a=lease(r,b.token);const guild=r.getString("guild_id");
  if(!Array.isArray(b.decisions)||!b.decisions.length||b.decisions.length>30||typeof b.rules_version!=="string"||!b.rules_version)fail("Invalid decisions");
  const ids=Array.from(r.getStringSlice("todos"));let clarify=false;
  for(let i=0;i<b.decisions.length;i++){
   const d=b.decisions[i];
   if(typeof d.confidence!=="number"||d.confidence<0||d.confidence>1||typeof d.reason!=="string"||!d.reason||d.reason.length>2000)fail("Invalid confidence or reason");
   if(["create","merge","dismiss","clarify"].indexOf(d.action)<0)fail("Unknown decision");
   if(d.action==="create"){
    if(a.labels.indexOf(d.label)<0)fail("Unknown label candidate");sameGuild(app.findRecordById("todo_list_labels",d.label),guild);
    if(["bug","feature"].indexOf(d.kind)<0||["red","yellow","blue"].indexOf(d.priority)<0||(d.kind==="feature"&&d.priority!=="blue")||typeof d.title!=="string"||!d.title||d.title.length>200||typeof d.description!=="string"||!d.description||d.description.length>20000)fail("Invalid todo");
   }
   if(d.action==="merge"){
    if(a.todos.indexOf(d.todo)<0)fail("Unknown merge candidate");const existing=todo(app,d.todo);sameGuild(existing,guild);
    if(["open","in_progress","blocked"].indexOf(existing.getString("status"))<0)fail("Merge target is closed");
   }
   if(d.confidence<0.7||d.action==="clarify"){clarify=true;continue;}
   if(d.action==="create")ids.push(newTodo(app,r,d,a.manual?"manual:"+a.token+":"+i:i).id);
   if(d.action==="merge")ids.push(d.todo);
  }
  const unique=ids.filter((id,i)=>ids.indexOf(id)===i);
  r.set("todos",unique);r.set("state",clarify?"needs_clarification":unique.length?"assessed":"dismissed");
  r.set("assessment",{actor:a.actor,at:new Date().toISOString(),rules_version:b.rules_version,decisions:b.decisions,previous:a.previous});app.save(r);return r;
 }
 if(action==="claim"){
  const t=todo(app,b.id);if(t.getString("status")!=="open"||json(t,"claim",{}).token)fail("Todo is not available to start");
  const l=app.findRecordById("todo_list_labels",t.getString("label"));sameGuild(l,t.getString("guild_id"));
  if(typeof b.actor!=="string"||!b.actor)fail("Missing developer");
  t.set("claim",{developer:b.actor,token:$security.randomString(24),phase:"preparing",at:new Date().toISOString(),forum_id:"1560943737688039474"});t.set("status","in_progress");audit(t,"start_claimed",b.actor);app.save(t);return t;
 }
 if(action==="claim-context"||action==="claim-thread"){
  const t=todo(app,b.id);const c=claim(t,b.token);
  if(action==="claim-context"){
   if(c.phase!=="preparing"||typeof b.prompt!=="string"||!b.prompt)fail("Cannot replace prepared context");c.prompt=b.prompt;c.phase="creating_thread";
  }else{
   if(c.thread_id&&c.thread_id!==b.thread_id)fail("Attempt already has a forum thread");
   if(!/^[0-9]+$/.test(b.thread_id||""))fail("Invalid forum thread identity");c.thread_id=b.thread_id;c.thread_url=b.thread_url;c.phase="thread_created";
   audit(t,"forum_thread_created",c.developer,{thread_id:b.thread_id,thread_url:b.thread_url,forum_id:c.forum_id});
  }
  t.set("claim",c);app.save(t);return t;
 }
 if(action==="claim-finish"||action==="claim-fail"){
  const t=todo(app,b.id);const c=claim(t,b.token);
  if(action==="claim-finish"){
   if(typeof b.message_id!=="string"||!b.message_id)fail("Missing handoff message");
   c.phase="sent";c.message_id=b.message_id;t.set("claim",c);t.set("status","in_progress");audit(t,"started",c.developer,{message_id:b.message_id});
  }else if(b.definitive===true){ t.set("claim",{});t.set("status","open");audit(t,"start_failed",c.developer,{error:String(b.error||"Send rejected").slice(0,2000)}); }
  else{c.phase="uncertain";t.set("claim",c);t.set("status","blocked");audit(t,"handoff_uncertain",c.developer,{error:String(b.error||"Send outcome unknown").slice(0,2000)});}
  app.save(t);return t;
 }
 if(action==="recover"){
  const t=todo(app,b.id);const c=json(t,"claim",{});
  if(!c.token||c.phase==="sent")fail("No interrupted handoff to recover");
  // Explicit human recovery, never an automatic retry after an uncertain Discord send.
  if(b.message_id){c.phase="sent";c.message_id=b.message_id;t.set("claim",c);t.set("status","in_progress");}
  else if(b.confirm_absent===true){t.set("claim",{});t.set("status","open");}
  else fail("Supply verified handoff message id or confirm absence");
  audit(t,"handoff_recovered",b.actor,{message_id:b.message_id||null,reason:b.reason||""});app.save(t);return t;
 }
 if(action==="status"||action==="label"){
  const t=todo(app,b.id);const old=t.getString(action==="label"?"label":"status");const currentClaim=json(t,"claim",{});
  if(b.expected_revision!==undefined&&b.expected_revision!==json(t,"audit",[]).length)fail("Stale edit; refresh this todo before changing it");
  if(["preparing","creating_thread","thread_created"].indexOf(currentClaim.phase)>=0)fail("Start handoff is in progress; wait for admission or recover an interrupted handoff before editing");
  if(action==="label"){
   const l=app.findRecordById("todo_list_labels",b.label);sameGuild(l,t.getString("guild_id"));t.set("label",l.id);audit(t,"label_changed",b.actor,{old,new:l.id,reason:b.reason||""});app.save(t);return t;
  }
  if(["open","in_progress","blocked","done","closed","cancelled"].indexOf(b.status)<0)fail("Use reopen to restore open status");
  const links=json(t,"pr_links",[]);
  if(b.pr){if(typeof b.pr!=="string"||!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(b.pr))fail("Invalid GitHub PR link");if(links.indexOf(b.pr)<0)links.push(b.pr);}
  if(b.status==="done"&&!links.length)fail("Done means PR READY; provide a PR link");
  t.set("status",b.status);t.set("pr_links",links);
  if(["open","done","closed","cancelled"].indexOf(b.status)>=0)t.set("claim",{});
  if(b.work){const work=json(t,"work",{});if(!Array.isArray(work.entries))work.entries=[];work.entries.push({actor:b.actor,at:new Date().toISOString(),text:String(b.work)});t.set("work",work);}
  audit(t,"status_changed",b.actor,{old,new:b.status,status:b.status,reason:b.reason||"",agent_not_stopped:!!currentClaim.token,previous_claim:currentClaim});app.save(t);return t;
 }
 if(action==="reopen"){
  const list=find(app,"todo_list_todos","number = {:number} && guild_id = {:guild}",{number:b.number,guild:b.guild_id});if(!list.length)fail("Todo not found");const t=list[0];
  if(t.getString("status")==="open")return t;
  if(["done","closed","cancelled"].indexOf(t.getString("status"))<0)fail("Only done, closed or cancelled todos can be reopened");
  t.set("status","open");t.set("claim",{});audit(t,"reopened",b.actor,{reason:b.reason||""});app.save(t);return t;
 }
 fail("Unknown operation");
};
exports.validateGroup=function(app,record){
 const guild=record.getString("guild_id");const visited={};const active={};
 function walk(r){if(active[r.id])fail("Label group cycle");if(visited[r.id])return;sameGuild(r,guild);active[r.id]=true;
  const labels=r.getStringSlice("labels");for(let i=0;i<labels.length;i++)sameGuild(app.findRecordById("todo_list_labels",labels[i]),guild);
  const children=r.getStringSlice("child_groups");for(let i=0;i<children.length;i++)walk(children[i]===record.id?record:app.findRecordById("todo_list_label_groups",children[i]));
  delete active[r.id];visited[r.id]=true;
 }walk(record);
};
