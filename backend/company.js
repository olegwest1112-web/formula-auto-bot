import {HttpError} from './validation.js';
import {requireRole} from './auth.js';
const companyQ=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const companyNow=()=>new Date().toISOString();
const companyJson=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export async function companyRoutes(req,env,actor,path,data){
 if(path==='/api/admin/team'&&req.method==='GET'){requireRole(actor,['owner']);const members=await companyQ(env,'SELECT * FROM staff ORDER BY active DESC,created_at DESC').all();const access=await companyQ(env,'SELECT bootstrap FROM access_config WHERE id=1').first();return companyJson({members:members.results,bootstrap:access?!!access.bootstrap:true,designatedOwner:env.TELEGRAM_OWNER_ID||null});}
 const member=path.match(/^\/api\/admin\/team\/(\d+)$/);
 if(member&&req.method==='PUT'){
  requireRole(actor,['owner']);if(!['owner','manager','editor','revoked'].includes(data.role))throw new HttpError(400,'Оберіть роль працівника.');
  const previous=await companyQ(env,'SELECT * FROM staff WHERE id=?',member[1]).first();if(!previous)throw new HttpError(404,'Працівник має спочатку відкрити панель через бота.');
  const changed=await companyQ(env,"UPDATE staff SET role=?,active=?,version=version+1,updated_at=? WHERE id=? AND version=? AND NOT(role='owner' AND active=1 AND ?<>'owner' AND (SELECT COUNT(*) FROM staff WHERE role='owner' AND active=1)<=1) RETURNING id",data.role,data.role==='revoked'?0:1,companyNow(),member[1],Number(data.version),data.role).first();
  if(!changed)throw new HttpError(409,'Не можна прибрати останнього власника, або запис уже змінено. Оновіть список.');
  await env.DB.batch([companyQ(env,'DELETE FROM sessions WHERE staff_id=?',member[1]),companyQ(env,'INSERT INTO audit(actor,action,entity,created_at) VALUES(?,?,?,?)',actor.id,'team.'+data.role,member[1],companyNow())]);return companyJson({id:member[1]});
 }
 if(path==='/api/admin/handover'&&req.method==='POST'){
  requireRole(actor,['owner']);if(actor.provider!=='telegram')throw new HttpError(403,'Передачу завершує власник, який увійшов через Telegram.');
  if(data.confirm!=='TRANSFER')throw new HttpError(400,'Підтвердьте передачу керування.');
  await companyQ(env,'INSERT INTO access_config(id,bootstrap) VALUES(1,0) ON CONFLICT(id) DO UPDATE SET bootstrap=0').run();await companyQ(env,'INSERT INTO audit(actor,action,entity,created_at) VALUES(?,?,?,?)',actor.id,'company.handover','Telegram owners',companyNow()).run();return companyJson({bootstrap:false});
 }
 if(path==='/api/admin/lead-assignees'&&req.method==='GET'){requireRole(actor,['owner','manager']);return companyJson((await companyQ(env,"SELECT id,name,username FROM staff WHERE active=1 AND role IN ('owner','manager') ORDER BY name").all()).results);}
 const work=path.match(/^\/api\/admin\/leads\/([a-f0-9-]{36})\/work$/);
 if(work&&req.method==='PUT'){
  requireRole(actor,['owner','manager']);if(!await companyQ(env,'SELECT id FROM leads WHERE id=?',work[1]).first())throw new HttpError(404,'Заявку не знайдено.');
  const note=String(data.note||'').trim(),assigned=String(data.assignedTo||''),next=String(data.nextContact||'');if(note.length>3000||next&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(next)||!Number.isFinite(Date.parse(next))))throw new HttpError(400,'Перевірте примітку та дату контакту.');
  if(assigned&&!await companyQ(env,"SELECT id FROM staff WHERE id=? AND active=1 AND role IN ('owner','manager')",assigned).first())throw new HttpError(400,'Цей працівник не може отримувати заявки.');
  const changed=Number(data.version)===0?await companyQ(env,'INSERT INTO lead_work(lead_id,assigned_to,note,next_contact,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(lead_id) DO NOTHING RETURNING version',work[1],assigned,note,next,companyNow()).first():await companyQ(env,'UPDATE lead_work SET assigned_to=?,note=?,next_contact=?,version=version+1,updated_at=? WHERE lead_id=? AND version=? RETURNING version',assigned,note,next,companyNow(),work[1],Number(data.version)).first();
  if(!changed)throw new HttpError(409,'Заявку змінив інший працівник. Оновіть список.');await companyQ(env,'INSERT INTO audit(actor,action,entity,created_at) VALUES(?,?,?,?)',actor.id,'lead.work',work[1],companyNow()).run();return companyJson({version:changed.version});
 }
 if(path==='/api/admin/export'&&req.method==='GET'){
  requireRole(actor,['owner']);const kind=new URL(req.url).searchParams.get('kind');if(!['vehicles','leads'].includes(kind))throw new HttpError(400,'Оберіть дані для експорту.');
  const rows=await companyQ(env,kind==='vehicles'?'SELECT * FROM vehicles ORDER BY id':'SELECT leads.*,lead_work.assigned_to,lead_work.note,lead_work.next_contact FROM leads LEFT JOIN lead_work ON lead_work.lead_id=leads.id ORDER BY leads.created_at').all();
  await companyQ(env,'INSERT INTO audit(actor,action,entity,created_at) VALUES(?,?,?,?)',actor.id,'export.'+kind,rows.results.length,companyNow()).run();
  return new Response(JSON.stringify({format:'formula-backup-v1',createdAt:companyNow(),kind,records:rows.results},null,2),{headers:{'Content-Type':'application/json','Content-Disposition':`attachment; filename="formula-${kind}.json"`,'Cache-Control':'no-store'}});
 }
 return null;
}
