import {mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const SITE='https://southern-style-construction.ktenterprises8720.chatgpt.site';
export const BACKEND='https://vfckrwukboptqsjgwofn.supabase.co';
const verification='google0fba0ef554e01bef.html';

function publicKey(key){
 if(typeof key!=='string')return false;
 if(/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))return true;
 try{return JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role==='anon';}catch{return false;}
}

// GET only, fixed destinations, no redirects, no user sessions or provider secrets.
export async function checkProduction({key,fetchImpl=fetch,timeoutMs=12000}={}){
 if(!publicKey(key))throw new Error('A public Supabase publishable/anon key is required. Privileged keys are refused.');
 const checks=[
  {name:'website',path:'/',kind:'page'},
  {name:'office',path:'/office/',kind:'portal'},
  {name:'construction',path:'/app/',kind:'portal'},
  {name:'robots',path:'/robots.txt',kind:'robots'},
  {name:'sitemap',path:'/sitemap.xml',kind:'sitemap'},
  {name:'google-verification',path:'/'+verification,kind:'verification'},
  {name:'authentication',path:'/auth/v1/health',backend:true,kind:'health'},
  {name:'published-content',path:'/rest/v1/site_content?select=key&state=eq.published&limit=100',backend:true,kind:'public'},
  {name:'private-projects',path:'/rest/v1/projects?select=id&limit=1',backend:true,kind:'denied'},
  {name:'private-invoices',path:'/rest/v1/office_invoices?select=id&limit=1',backend:true,kind:'denied'}
 ];
 const results=await Promise.all(checks.map(async check=>{
  const start=Date.now();let status=null;
  try{
   const options={method:'GET',redirect:check.kind==='verification'?'manual':'error',headers:check.backend?{apikey:key,Accept:'application/json'}:{Accept:'text/html, application/xml, text/plain'},signal:AbortSignal.timeout(timeoutMs)};
   let response=await fetchImpl((check.backend?BACKEND:SITE)+check.path,options);
   // Sites canonicalizes this public HTML asset. Permit only that exact local redirect.
   if(check.kind==='verification'&&[301,302,307,308].includes(response.status)){
    if(response.headers.get('location')!=='/'+verification.replace(/\.html$/,''))return {name:check.name,ok:false,status:response.status,durationMs:Date.now()-start,failure:'UNEXPECTED_REDIRECT'};
    response=await fetchImpl(SITE+'/'+verification.replace(/\.html$/,''),{...options,redirect:'error'});
   }
   status=response.status;
   // Never persist bodies: a broken access rule could return confidential records.
   if(check.kind==='denied')return {name:check.name,ok:[401,403].includes(status),status,durationMs:Date.now()-start,...(![401,403].includes(status)?{failure:'ACCESS_BOUNDARY_CHANGED'}:{})};
   if(!response.ok)return {name:check.name,ok:false,status,durationMs:Date.now()-start,failure:'HTTP_UNAVAILABLE'};
   const body=await response.text();let ok=false;
   switch(check.kind){
    case 'page':ok=/Southern Style Construction/i.test(body)&&body.includes('rel="canonical" href="'+SITE+'/"');break;
    case 'portal':ok=/<meta\s+name="robots"\s+content="noindex,nofollow"/i.test(body)&&/Southern Style/i.test(body);break;
    case 'robots':ok=body.includes('Sitemap: '+SITE+'/sitemap.xml')&&body.includes('Disallow: /app/')&&body.includes('Disallow: /office/');break;
    case 'sitemap':{const urls=[...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>new URL(match[1]));ok=urls.length>0&&urls.every(url=>url.origin===SITE&&!/^\/(app|office)(\/|$)/.test(url.pathname));break;}
    case 'verification':ok=body.trim()==='google-site-verification: '+verification;break;
    case 'health':ok=typeof JSON.parse(body)==='object';break;
    case 'public':{const rows=JSON.parse(body);ok=Array.isArray(rows)&&rows.every(row=>typeof row.key==='string'&&row.key!=='billing');break;}
   }
   return {name:check.name,ok,status,durationMs:Date.now()-start,...(!ok?{failure:'CONTENT_CONTRACT_CHANGED'}:{})};
  }catch{return {name:check.name,ok:false,status,durationMs:Date.now()-start,failure:'REQUEST_OR_CONTENT_FAILED'};}
 }));
 return {checkedAt:new Date().toISOString(),ok:results.every(result=>result.ok),checks:results};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);
 if(args.length&&!(args.length===2&&args[0]==='--output'))throw new Error('Usage: node --env-file=.env.local scripts/monitor-production.mjs [--output report.json]');
 const report=await checkProduction({key:process.env.VITE_SUPABASE_PUBLISHABLE_KEY});
 if(args.length){const output=resolve(args[1]);await mkdir(dirname(output),{recursive:true});await writeFile(output+'.tmp',JSON.stringify(report,null,2)+'\n');await rename(output+'.tmp',output);}
 console.log(JSON.stringify(report,null,2));process.exitCode=report.ok?0:1;
}
