import {HttpError,validateVehicle,publicVehicle,validateLead,validateSettings,defaultSettings} from './validation.js';
import {identity,requireRole,telegramLogin,logout,digest} from './auth.js';
import {companyRoutes} from './company.js';
import {botUpdate} from './bot.js';
import {storePhoto,checkCar,createVehicle,sourceInventory,importSource} from './inventory.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const now=()=>new Date().toISOString();
const q=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
async function boundedBytes(req,max){if(Number(req.headers.get('content-length'))>max)throw new HttpError(413,'Забагато даних.');const reader=req.body?.getReader();if(!reader)return new Uint8Array();const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new HttpError(413,'Забагато даних.');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;}
async function body(req){const text=new TextDecoder().decode(await boundedBytes(req,50000));try{const data=JSON.parse(text);if(!data||Array.isArray(data)||typeof data!=='object')throw Error();return data;}catch{throw new HttpError(400,'Некоректні дані.');}}
async function settings(env){const row=await q(env,'SELECT * FROM settings WHERE id=1').first();return row?{...JSON.parse(row.payload),version:row.version}:{...defaultSettings,version:0};}
async function audit(env,actor,action,entity){await q(env,'INSERT INTO audit(actor,action,entity,created_at) VALUES(?,?,?,?)',actor.id,action,String(entity),now()).run();}
async function notify(env,id,payload){
 if(!env.MANAGER_CHAT_ID||!env.TELEGRAM_BOT_TOKEN)return false;
 await q(env,'UPDATE leads SET notified=0 WHERE id=? AND notified=-1 AND updated_at<?',id,new Date(Date.now()-120000).toISOString()).run();
 const claimed=await q(env,'UPDATE leads SET notified=-1,updated_at=? WHERE id=? AND notified=0 RETURNING id',now(),id).first();if(!claimed)return (await q(env,'SELECT notified FROM leads WHERE id=?',id).first())?.notified===1;
 const intents={consultation:'Консультація',viewing:'Перегляд / тест-драйв',tradein:'Обмін',import:'Підбір авто',finance:'Фінансування'};
 try{const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:env.MANAGER_CHAT_ID,text:`FORMULA • ${payload.testMode?'Тестова заявка':'Нова заявка'}\n№ ${id.slice(0,8)}\n${payload.name}\n${payload.phone}\n${intents[payload.intent]}\nАвто: ${payload.carName||'Підбір'}\n${payload.comment||''}\n${payload.ownCar||''}`}),signal:AbortSignal.timeout(15000)});if(!(await r.json()).ok)throw Error();await q(env,'UPDATE leads SET notified=1 WHERE id=?',id).run();return true;}catch{await q(env,'UPDATE leads SET notified=0 WHERE id=?',id).run();return false;}
}
function adminAsset(path){const asset=typeof ADMIN_ASSETS!=='undefined'&&ADMIN_ASSETS[path];if(!asset)return null;return new Response(asset.body,{headers:{'Content-Type':asset.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' https://olegwest1112-web.github.io https://*.telesco.pe blob:; style-src 'self'; script-src 'self' https://telegram.org; connect-src 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org; base-uri 'none'; form-action 'self'"}});}
async function route(req,env){
 const url=new URL(req.url),path=url.pathname.replace(/\/$/,'')||'/',method=req.method;
 if(path==='/api/telegram/webhook'&&method==='POST')return botUpdate(req,env);
 if(path.startsWith('/admin')){const response=adminAsset(path);if(response&&method==='GET')return response;throw new HttpError(404,'Сторінку не знайдено.');}
 if(path.startsWith('/api/admin')||path.startsWith('/api/auth')){if(!['GET','HEAD','OPTIONS'].includes(method)&&req.headers.get('origin')!==url.origin)throw new HttpError(403,'Оновіть сторінку та повторіть дію.');}
 if(path==='/api/auth/telegram'&&method==='POST'){const data=await body(req),result=await telegramLogin(data.initData,env),response=json(result);if(result.token)response.headers.set('Set-Cookie',`__Host-formula_session=${result.token}; Secure; HttpOnly; Path=/; SameSite=None; Partitioned; Max-Age=28800`);return response;}
 if(path==='/api/auth/logout'&&method==='POST'){await logout(req,env);const response=json({ok:true});response.headers.set('Set-Cookie','__Host-formula_session=; Secure; HttpOnly; Path=/; SameSite=None; Partitioned; Max-Age=0');return response;}
 if(path==='/'&&method==='GET')return Response.redirect('https://olegwest1112-web.github.io/formula-auto-bot/',302);
 if(path==='/api/catalog'&&method==='GET'){const rows=await q(env,'SELECT * FROM vehicles WHERE published=1 AND archived=0 ORDER BY updated_at DESC,id DESC').all();return json({cars:rows.results.map(publicVehicle),settings:await settings(env)});}
 if(path.startsWith('/media/')&&method==='GET'){
  const id=path.slice(7);if(!/^[a-f0-9-]{36}$/.test(id))throw new HttpError(404,'Фото не знайдено.');
  const used=await q(env,"SELECT vehicles.id FROM vehicles,json_each(vehicles.payload,'$.images') AS image WHERE published=1 AND archived=0 AND image.value=? LIMIT 1",path).first();if(!used){const actor=await identity(req,env);requireRole(actor,['owner','editor']);}
  const object=await env.BUCKET.get(id);if(!object)throw new HttpError(404,'Фото не знайдено.');return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }
 if(path==='/api/leads'&&method==='POST'){
  const data=await body(req);if(data.website)throw new HttpError(400,'Не вдалося прийняти заявку.');const payload=validateLead(data),id=req.headers.get('Idempotency-Key');if(!/^[a-f0-9-]{36}$/.test(id||''))throw new HttpError(400,'Оновіть форму.');
  if(await q(env,'SELECT id FROM leads WHERE id=?',id).first())return json({id,stored:true});
  const ip=req.headers.get('cf-connecting-ip')||'unknown',bucket=Math.floor(Date.now()/900000),key=await digest((env.RATE_LIMIT_SALT||'formula')+ip)+bucket;
  const limit=await q(env,'INSERT INTO rate_limits(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count',key,(bucket+1)*900000).first();if(limit.count>5)throw new HttpError(429,'Забагато спроб. Повторіть через 15 хвилин або напишіть менеджеру.');
  if(payload.carId!==null){const car=await q(env,"SELECT * FROM vehicles WHERE id=? AND published=1 AND archived=0 AND status IN ('stock','road','reserved')",payload.carId).first();if(!car)throw new HttpError(409,'Авто більше недоступне. Оновіть каталог.');payload.carName=JSON.parse(car.payload).name;}
  payload.testMode=(await settings(env)).testMode;const inserted=await q(env,'INSERT INTO leads(id,payload,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING id',id,JSON.stringify(payload),now(),now()).first();if(!inserted)return json({id,stored:true});
  const notified=await notify(env,id,payload);await q(env,'DELETE FROM rate_limits WHERE expires<?',Date.now()).run();return json({id,stored:true,notified},201);
 }
 if(!path.startsWith('/api/admin'))throw new HttpError(404,'Сторінку не знайдено.');
 const actor=await identity(req,env);requireRole(actor,['owner','manager','editor']);
 if(path==='/api/admin/me'&&method==='GET')return json({...actor,notificationsConfigured:!!(env.MANAGER_CHAT_ID&&env.TELEGRAM_BOT_TOKEN)});
 let data;if(['PUT','POST'].includes(method)&&path!=='/api/admin/media')data=await body(req);
 if(method==='PUT'&&!path.endsWith('/retry')&&(!Number.isSafeInteger(Number(data.version))||Number(data.version)<0))throw new HttpError(400,'Оновіть запис перед збереженням.');
 const company=await companyRoutes(req,env,actor,path,data);if(company)return company;
 if(path==='/api/admin/dashboard'&&method==='GET'){
  const inv=await q(env,'SELECT status,published,archived,COUNT(*) AS count FROM vehicles GROUP BY status,published,archived').all();let leads=[];if(['owner','manager'].includes(actor.role))leads=(await q(env,'SELECT status,COUNT(*) AS count FROM leads GROUP BY status').all()).results;
  return json({inventory:inv.results,leads});
 }
 if(path==='/api/admin/source'&&method==='GET'){requireRole(actor,['owner','editor']);return json(await sourceInventory(env));}
 const source=path.match(/^\/api\/admin\/source\/(\d+)$/);if(source&&method==='POST'){requireRole(actor,['owner','editor']);return json(await importSource(Number(source[1]),env,actor));}
 if(path==='/api/admin/vehicles'&&method==='GET'){requireRole(actor,['owner','editor']);const rows=await q(env,'SELECT * FROM vehicles ORDER BY updated_at DESC,id DESC').all();return json(rows.results.map(r=>({...publicVehicle(r),published:!!r.published,archived:!!r.archived,internalNote:r.internal_note})));}
 if(path==='/api/admin/vehicles'&&method==='POST'){requireRole(actor,['owner','editor']);return json(await createVehicle(data,env,actor,req.headers.get('Idempotency-Key')),201);}
 const vehicle=path.match(/^\/api\/admin\/vehicles\/(\d+)(?:\/(archive|restore))?$/);
 if(vehicle&&method==='PUT'){
  requireRole(actor,['owner','editor']);const id=Number(vehicle[1]);let changed;
  if(vehicle[2])changed=await q(env,"UPDATE vehicles SET archived=?,published=0,status=CASE WHEN ?='restore' THEN 'draft' ELSE status END,version=version+1,updated_at=? WHERE id=? AND version=? RETURNING id",vehicle[2]==='archive'?1:0,vehicle[2],now(),id,Number(data.version)).first();
  else{const {internalNote,version,...car}=validateVehicle(data);await checkCar(car,env,id);changed=await q(env,"UPDATE vehicles SET payload=?,status=?,published=?,internal_note=?,version=version+1,updated_at=? WHERE id=? AND version=? AND archived=0 AND NOT EXISTS(SELECT id FROM vehicles WHERE id<>? AND ((?<>'' AND UPPER(json_extract(payload,'$.vin'))=UPPER(?)) OR (?<>'' AND json_extract(payload,'$.source')=?))) RETURNING id",JSON.stringify(car),car.status,+car.published,internalNote,now(),id,Number(version),id,car.vin,car.vin,car.source,car.source).first();}
  if(!changed)throw new HttpError(409,'Запис змінився або знайдено дублікат VIN. Ваші поля залишено у формі; звірте останню версію.');await audit(env,actor,'vehicle.'+(vehicle[2]||'update'),id);return json({id});
 }
 if(path==='/api/admin/media'&&method==='POST'){requireRole(actor,['owner','editor']);return json({url:await storePhoto(await boundedBytes(req,8388608),env)},201);}
 if(path==='/api/admin/settings'&&method==='GET'){requireRole(actor,['owner']);return json(await settings(env));}
 if(path==='/api/admin/settings'&&method==='PUT'){requireRole(actor,['owner']);const payload=validateSettings(data);const row=Number(data.version)===0?await q(env,'INSERT INTO settings(id,payload,version) VALUES(1,?,1) ON CONFLICT(id) DO NOTHING RETURNING version',JSON.stringify(payload)).first():await q(env,'UPDATE settings SET payload=?,version=version+1 WHERE id=1 AND version=? RETURNING version',JSON.stringify(payload),Number(data.version)).first();if(!row)throw new HttpError(409,'Налаштування вже змінилися. Оновіть сторінку.');await audit(env,actor,'settings.update',1);return json({version:row.version});}
 if(path==='/api/admin/leads'&&method==='GET'){
  requireRole(actor,['owner','manager']);const page=Math.max(1,Math.min(100000,Math.floor(Number(url.searchParams.get('page')))||1)),search=(url.searchParams.get('q')||'').slice(0,100),status=url.searchParams.get('status')||'',assignee=url.searchParams.get('assignee')||'',like='%'+search+'%';
  const where="(?='' OR leads.status=?) AND (?='' OR json_extract(leads.payload,'$.name') LIKE ? OR json_extract(leads.payload,'$.phone') LIKE ? OR json_extract(leads.payload,'$.carName') LIKE ?) AND (?='' OR COALESCE(lead_work.assigned_to,'')=?)";
  const args=[status,status,search,like,like,like,assignee,assignee];const total=await q(env,'SELECT COUNT(*) AS n FROM leads LEFT JOIN lead_work ON lead_work.lead_id=leads.id WHERE '+where,...args).first();const rows=await q(env,'SELECT leads.*,lead_work.assigned_to,lead_work.note,lead_work.next_contact,lead_work.version AS work_version FROM leads LEFT JOIN lead_work ON lead_work.lead_id=leads.id WHERE '+where+' ORDER BY leads.created_at DESC LIMIT 30 OFFSET ?',...args,(page-1)*30).all();
  return json({total:total.n,page,pageSize:30,rows:rows.results.map(r=>({...JSON.parse(r.payload),id:r.id,status:r.status,notified:r.notified===1,version:r.version,createdAt:r.created_at,assignedTo:r.assigned_to||'',note:r.note||'',nextContact:r.next_contact||'',workVersion:r.work_version||0}))});
 }
 const lead=path.match(/^\/api\/admin\/leads\/([a-f0-9-]{36})(?:\/(retry))?$/);
 if(lead&&method==='PUT'){requireRole(actor,['owner','manager']);const row=await q(env,'SELECT * FROM leads WHERE id=?',lead[1]).first();if(!row)throw new HttpError(404,'Заявку не знайдено.');if(lead[2])return json({notified:row.notified===1||await notify(env,row.id,JSON.parse(row.payload))});if(!['new','contacted','viewing','won','lost','closed'].includes(data.status))throw new HttpError(400,'Невідомий статус.');const changed=await q(env,'UPDATE leads SET status=?,version=version+1,updated_at=? WHERE id=? AND version=? RETURNING id',data.status,now(),row.id,Number(data.version)).first();if(!changed)throw new HttpError(409,'Заявка вже змінилася. Оновіть список.');await audit(env,actor,'lead.'+data.status,row.id);return json({id:row.id});}
 if(path==='/api/admin/audit'&&method==='GET'){requireRole(actor,['owner']);const page=Math.max(1,Math.min(100000,Math.floor(Number(url.searchParams.get('page')))||1));const rows=await q(env,'SELECT * FROM audit ORDER BY id DESC LIMIT 50 OFFSET ?',(page-1)*50).all();return json({rows:rows.results,page,total:(await q(env,'SELECT COUNT(*) AS n FROM audit').first()).n});}
 throw new HttpError(404,'Сторінку не знайдено.');
}
export default {async fetch(req,env){const origin=req.headers.get('origin'),url=new URL(req.url),publicPath=['/api/catalog','/api/leads'].includes(url.pathname),allowed=origin===url.origin||(publicPath&&origin==='https://olegwest1112-web.github.io');let response;if(req.method==='OPTIONS')response=new Response(null,{status:204});else try{response=await route(req,env);}catch(e){response=json({error:e instanceof HttpError?e.message:'Тимчасова помилка сервера. Зміни у формі залишено — повторіть спробу.'},e instanceof HttpError?e.status:500);}const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');if(allowed){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');headers.set('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');headers.set('Access-Control-Allow-Headers','Content-Type,Idempotency-Key,Authorization');}return new Response(response.body,{status:response.status,headers});}};
