import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import seed from "../pocketbase/todo.catalog.seed.json";
import schema from "../pocketbase/todo.collections.json";
import assignmentField from "../pocketbase/todo.group-assignment-field.json";

test("reviewed seed retains all exact supplied label names, URLs, descriptions and nulls",()=>{
 // Canonical compact JSON of the user's original 37 objects, preserving property and catalog order.
 expect(createHash("sha256").update(JSON.stringify(seed.labels)).digest("hex")).toBe("1e2f5df430b6ad67e3c71064bc56d79ee0d90e73a34b7457ab62b44c98f71dcc");
 expect(seed.labels).toHaveLength(37);expect(new Set(seed.labels.map(l=>l.name)).size).toBe(37);
 expect(seed.labels.find(l=>l.name==="SneakyWantedPosters")).toEqual({name:"SneakyWantedPosters",url:null,explanation:null});
});
test("reviewed groups preserve literal Paper exclusions, shared membership, nested people and supplied user IDs",()=>{
 const groups=Object.fromEntries(seed.groups.map(g=>[g.name,g]));
 expect(Object.keys(groups)).toEqual(["Paper plugins","Velocity plugins","Momo","Dani","Oakley","Bungo","rawb"]);
 expect(groups["Paper plugins"].labels).toEqual(seed.labels.map(l=>l.name).filter(n=>!["Configuration","MagicSpells scripting","Navigation","Resourcepack","SneakyResourcePacks"].includes(n)));
 expect(groups["Velocity plugins"].labels).toEqual(["SneakyCharacterManager"]);
 expect(groups.Momo.labels).toContain("SneakyCharacterManager");expect(groups.Momo.child_groups).toEqual(["Oakley","Bungo"]);
 expect(groups.Bungo.labels).toContain("SneakyCellPhones");
 expect(Object.fromEntries(seed.groups.filter(g=>g.assigned_user_id).map(g=>[g.name,g.assigned_user_id]))).toEqual({Momo:"108296164599734272",Dani:"138345057072840704",Oakley:"132478335530958849",Bungo:"146065389460127745",rawb:"90956966947467264"});
 for(const group of seed.groups){for(const name of group.labels)expect(seed.labels.some(l=>l.name===name)).toBe(true);for(const name of group.child_groups)expect(groups[name]).toBeDefined();}
});
test("group assignment migration adds only optional max-20 text and preserves private collection rules",()=>{
 expect(assignmentField).toEqual({name:"assigned_user_id",type:"text",required:false,max:20});
 const groups=schema.find(c=>c.name==="todo_list_label_groups")!;
 expect(groups.fields.find(f=>f.name==="assigned_user_id")).toEqual(assignmentField);
 expect([groups.listRule,groups.viewRule,groups.createRule,groups.updateRule,groups.deleteRule]).toEqual([null,null,null,null,null]);
});
