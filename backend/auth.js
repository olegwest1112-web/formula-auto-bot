import {HttpError} from './validation.js';
const authQ=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const authHex=bytes=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
const authBytes=text=>new TextEncoder().encode(text);
export async function digest(value){return authHex(await crypto.subtle.digest('SHA-256',authBytes(value)));}
export async function verifyTelegram(raw,token,at=Date.now()){
 if(typeof raw!=='string'||raw.length>12000||!token)throw new HttpError(401,'Відкрийте панель кнопкою в боті.');
 const params=new URLSearchParams(raw),keys=[...params.keys()];if(new Set(keys).size!==keys.length)throw new HttpError(401,'Некоректний підпис Telegram.');
 const signature=params.get('hash');if(!/^[a-f0-9]{64}$/.test(signature||''))throw new HttpError(401,'Некоректний підпис Telegram.');params.delete('hash');
 const date=Number(params.get('auth_date'));if(!Number.isInteger(date)||date*1000>at+30000||at-date*1000>300000)throw new HttpError(401,'Посилання для входу застаріло. Відкрийте панель з бота ще раз.');
 const baseKey=await crypto.subtle.importKey('raw',authBytes('WebAppData'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const secret=await crypto.subtle.sign('HMAC',baseKey,authBytes(token));const key=await crypto.subtle.importKey('raw',secret,{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const sorted=[...params].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');
 if(!await crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g),s=>parseInt(s,16)),authBytes(sorted)))throw new HttpError(401,'Telegram не підтвердив вхід.');
 let user;try{user=JSON.parse(params.get('user'));}catch{throw new HttpError(401,'Не вдалося визначити користувача Telegram.');}
 if(!user||!Number.isSafeInteger(user.id)||user.id<=0||user.is_bot)throw new HttpError(401,'Некоректний користувач Telegram.');
 return {id:String(user.id),name:[user.first_name,user.last_name].filter(Boolean).join(' ').slice(0,120)||'Працівник',username:String(user.username||'').slice(0,32),claim:signature};
}
export async function identity(req,env){
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'')||req.headers.get('cookie')?.match(/(?:^|;\s*)__Host-formula_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 if(token&&/^[a-f0-9]{64}$/.test(token)){const row=await authQ(env,'SELECT staff.* FROM sessions JOIN staff ON staff.id=sessions.staff_id WHERE sessions.hash=? AND sessions.expires>? AND staff.active=1 AND staff.version=sessions.staff_version',await digest(token),Date.now()).first();if(row)return {id:'tg:'+row.id,telegramId:row.id,name:row.name,username:row.username,role:row.role,provider:'telegram'};}
 const email=req.headers.get('oai-authenticated-user-email')?.toLowerCase();if(email&&(env.ADMIN_EMAILS||'').toLowerCase().split(',').map(s=>s.trim()).includes(email)){const policy=await authQ(env,'SELECT bootstrap FROM access_config WHERE id=1').first();if(!policy||policy.bootstrap)return {id:'chatgpt:'+email,name:email,role:'owner',provider:'chatgpt'};}
 return null;
}
export function requireRole(actor,roles){if(!actor)throw new HttpError(401,'Увійдіть у панель через Telegram.');if(!roles.includes(actor.role))throw new HttpError(403,'Для цієї дії потрібні інші права. Зверніться до власника.');}
export async function telegramLogin(raw,env){
 const user=await verifyTelegram(raw,env.TELEGRAM_BOT_TOKEN),date=new Date().toISOString();
 const claimed=await authQ(env,'INSERT INTO login_claims(hash,expires) VALUES(?,?) ON CONFLICT(hash) DO NOTHING RETURNING hash',user.claim,Date.now()+600000).first();if(!claimed)throw new HttpError(401,'Цей вхід уже використано. Відкрийте панель з бота ще раз.');
 const isOwner=user.id===env.TELEGRAM_OWNER_ID;
 await authQ(env,'INSERT INTO staff(id,name,username,role,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,username=excluded.username',user.id,user.name,user.username,isOwner?'owner':'pending',isOwner?1:0,date,date).run();
 const member=await authQ(env,'SELECT * FROM staff WHERE id=?',user.id).first();
 await authQ(env,'DELETE FROM login_claims WHERE expires<?',Date.now()).run();
 if(!member.active)return {pending:true,revoked:member.role!=='pending',name:member.name,id:member.id};
 const token=authHex(crypto.getRandomValues(new Uint8Array(32)));await authQ(env,'INSERT INTO sessions(hash,staff_id,staff_version,expires) VALUES(?,?,?,?)',await digest(token),member.id,member.version,Date.now()+28800000).run();await authQ(env,'DELETE FROM sessions WHERE expires<?',Date.now()).run();
 return {token,user:{id:'tg:'+member.id,telegramId:member.id,name:member.name,username:member.username,role:member.role,provider:'telegram'}};
}
export async function logout(req,env){const token=req.headers.get('authorization')?.replace(/^Bearer /,'')||req.headers.get('cookie')?.match(/__Host-formula_session=([a-f0-9]{64})/)?.[1];if(token)await authQ(env,'DELETE FROM sessions WHERE hash=?',await digest(token)).run();}
