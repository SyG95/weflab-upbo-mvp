// Optional isolated PostgreSQL test runtime; not an application dependency.
const {PGlite}=await import(process.env.WARDROBE_PGLITE_MODULE || '@electric-sql/pglite');
import fs from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite();await db.waitReady;
await db.exec(`create role anon;create role authenticated;create role service_role;create table upbo_alpha_streamers(id uuid primary key);create table upbo_alpha_audit_logs(id uuid primary key default gen_random_uuid(),streamer_id uuid references upbo_alpha_streamers(id),action text,actor text,payload jsonb,created_at timestamptz default clock_timestamp());grant select,insert,update on upbo_alpha_streamers,upbo_alpha_audit_logs to service_role;insert into upbo_alpha_streamers values('00000000-0000-0000-0000-000000000001');`);
await db.exec(fs.readFileSync('supabase/migrations/20260909110936_wardrobe_atomic_save.sql','utf8'));
const id='00000000-0000-0000-0000-000000000001';let checks=[];
const rights=(await db.query(`select has_function_privilege('anon','upbo_alpha_save_wardrobe(uuid,uuid,jsonb)','EXECUTE') a,has_function_privilege('authenticated','upbo_alpha_save_wardrobe(uuid,uuid,jsonb)','EXECUTE') u,has_function_privilege('service_role','upbo_alpha_save_wardrobe(uuid,uuid,jsonb)','EXECUTE') s`)).rows[0];assert.deepEqual(rights,{a:false,u:false,s:true});checks.push('RPC permissions');
await db.exec('set role service_role');
const v1={themes:[],items:[{id:'existing'}]},v2={...v1,schemaVersion:2,items:[...v1.items,{id:'new-image',part:'',month:'',themeId:''}]};
async function save(revision,state){return(await db.query('select upbo_alpha_save_wardrobe($1,$2,$3) r',[id,revision,JSON.stringify(state)])).rows[0].r;}
const old=await save(null,v1);assert(old.revision);checks.push('service role saves legacy state');
const next=await save(old.revision,v2);assert(next.revision);checks.push('service role saves v2 state');
const stale=await save(old.revision,v1);assert(stale.conflict);checks.push('stale CAS rejected');
await assert.rejects(db.query("insert into upbo_alpha_audit_logs(streamer_id,action,actor,payload) values($1,'wardrobe_updated','extension',$2)",[id,JSON.stringify({wardrobe:v1})]),/Wardrobe was upgraded/);checks.push('old deployment write rejected after v2');
const latest=(await db.query("select payload from upbo_alpha_audit_logs where action='wardrobe_updated' order by created_at desc limit 1")).rows[0].payload.wardrobe;assert.deepEqual(latest,v2);checks.push('new images preserved after old writer attempt');
await db.query("insert into upbo_alpha_audit_logs(streamer_id,action,actor,payload) values($1,'unrelated_action','extension','{}')",[id]);checks.push('unrelated log insert unchanged');
const recovered=await save(next.revision,{...v2,settings:{month:true,theme:true,parts:true,layout:'legacy'}});assert(recovered.revision);checks.push('compatible recovery preserves new data');
console.log(checks);await db.close();
