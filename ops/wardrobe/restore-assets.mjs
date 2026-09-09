// Default: read-only plan. --apply uploads only missing currently referenced
// objects with verified backup bytes. Never deletes or overwrites objects.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const args=process.argv.slice(2);
const arg=name=>args[args.indexOf(name)+1];
for(const key of ['--snapshot','--manifest','--backup-dir','--origin']) assert(args.includes(key),`Missing ${key}`);
const origin=new URL(arg('--origin')).origin;
assert(new URL(origin).protocol==='https:' || ['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Remote HTTP is forbidden');
const snapshot=JSON.parse(fs.readFileSync(arg('--snapshot'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(arg('--manifest'),'utf8'));
const prefix=origin+'/storage/v1/object/public/upbo-alpha-assets/';
const entries=new Map(manifest.map(x=>[x.path,x]));
const references=new Set((snapshot.streamers??snapshot).flatMap(s=>(s.wardrobe?.items??[]).flatMap(i=>[i.url,i.thumbUrl].filter(Boolean))));
const plan=[];let errors=[];
for(const url of references){
 if(!url.startsWith(prefix)){errors.push('Unexpected storage origin or bucket');continue;}
 const name=url.slice(prefix.length);
 if(!name.startsWith('wardrobe/')||name.includes('..')){errors.push('Unsafe object path');continue;}
 const response=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(15000)});
 if(response.status===200)continue;
 if(response.status!==404){errors.push(`Object lookup returned ${response.status}: ${name}`);continue;}
 const entry=entries.get(name);
 if(!entry){errors.push(`No backup for missing object: ${name}`);continue;}
 const file=path.resolve(arg('--backup-dir'),name);
 const root=path.resolve(arg('--backup-dir'))+path.sep;
 if(!file.startsWith(root)||!fs.existsSync(file)){errors.push(`Backup file unavailable: ${name}`);continue;}
 const bytes=fs.readFileSync(file);
 if(bytes.length!==entry.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256){errors.push(`Backup checksum mismatch: ${name}`);continue;}
 plan.push({name,file,sha256:entry.sha256});
}
console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'plan',referenced:references.size,missingRecoverable:plan.map(x=>x.name),errors},null,2));
assert.equal(errors.length,0,'Resolve all errors before restoring any files');
if(args.includes('--apply')){
 assert(process.env.WARDROBE_RESTORE_SERVICE_KEY,'Missing restore service key');
 assert(process.env.WARDROBE_WRITES_FROZEN==='1','Operator must confirm database freeze using status.sql first');
 for(const x of plan){
  const bytes=fs.readFileSync(x.file);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),x.sha256,'Backup changed after planning');
  const type=x.name.endsWith('.png')?'image/png':/\.jpe?g$/i.test(x.name)?'image/jpeg':'image/webp';
  const response=await fetch(origin+'/storage/v1/object/upbo-alpha-assets/'+x.name,{method:'POST',headers:{apikey:process.env.WARDROBE_RESTORE_SERVICE_KEY,authorization:'Bearer '+process.env.WARDROBE_RESTORE_SERVICE_KEY,'content-type':type,'x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(30000)});
  assert(response.ok,`Restore failed (${response.status}); stop and re-plan`);
  const check=await fetch(prefix+x.name,{signal:AbortSignal.timeout(30000)});
  assert(check.ok,'Restored file cannot be read');
  assert.equal(crypto.createHash('sha256').update(Buffer.from(await check.arrayBuffer())).digest('hex'),x.sha256,'Restored file checksum mismatch');
 }
 console.log(`Verified restored files: ${plan.length}`);
}
