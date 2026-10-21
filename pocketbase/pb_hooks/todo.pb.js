// PocketBase JSVM: every mutation uses the transaction's app, never the global app.
routerAdd("POST", "/api/shared-todo/{action}", (e) => {
 const lib = require(__hooks + "/todo.lib.js");
 let result;
 e.app.runInTransaction((tx) => { result = lib.execute(tx, e.request.pathValue("action"), e.requestInfo().body); });
 return e.json(200, result);
}, $apis.requireSuperuserAuth());
onBootstrap((e) => {
 e.next();
 e.app.db().newQuery("CREATE TABLE IF NOT EXISTS todo_list_number_sequence (id INTEGER PRIMARY KEY AUTOINCREMENT)").execute();
 e.app.db().newQuery("CREATE TABLE IF NOT EXISTS todo_list_change_sequence (id INTEGER PRIMARY KEY AUTOINCREMENT)").execute();
});
// Generic API creation cannot bypass server allocation; imports must use the endpoint.
onRecordCreateRequest(() => { throw new BadRequestError("Use the shared-todo assessment endpoint"); }, "todo_list_todos");
// Identity and public numbers are immutable after allocation, including superuser API edits.
onRecordValidate((e) => {
 if(!e.record.isNew()) {
  const original=e.record.original();
  for(const field of ["number","origin_key","guild_id"])if(e.record.getString(field)!==original.getString(field))throw new BadRequestError("Todo identity is immutable");
 }
 e.next();
}, "todo_list_todos");
// Generic HTTP edits cannot supply a trustworthy Discord actor/revision.
onRecordUpdateRequest((e)=>{
 for(const field of ["label","kind","priority"])if(e.record.getString(field)!==e.record.original().getString(field))throw new BadRequestError("Use the shared-todo classification endpoint");
 e.next();
},"todo_list_todos");
for(const collection of ["todo_list_manual_changes","todo_list_assessment_retrospectives"]){
 onRecordCreateRequest(()=>{throw new BadRequestError("Use the shared-todo endpoint");},collection);
 onRecordUpdateRequest(()=>{throw new BadRequestError("Use the shared-todo endpoint; history is immutable");},collection);
 onRecordDeleteRequest(()=>{throw new BadRequestError("History is immutable");},collection);
}
// Reject group cycles and cross-guild relations even for superusers.
onRecordValidate((e) => {
 require(__hooks + "/todo.lib.js").validateGroup(e.app, e.record);
 e.next();
}, "todo_list_label_groups");
