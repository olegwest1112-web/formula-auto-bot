import {HttpError} from './validation.js';
export async function botUpdate(req,env){
 const supplied=req.headers.get('X-Telegram-Bot-Api-Secret-Token');if(!env.WEBHOOK_SECRET||supplied!==env.WEBHOOK_SECRET)throw new HttpError(403,'Forbidden');
 const text=await req.text();if(text.length>65536)throw new HttpError(413,'Too large');let update;try{update=JSON.parse(text);}catch{throw new HttpError(400,'Invalid update');}
 if(!Number.isSafeInteger(update.update_id))return new Response('ok');
 const m=update.message;if(!m||m.chat?.type!=='private'||!m.text)return new Response('ok');
 const cmd=m.text.trim();if(!/^\/(start|admin)(?:@\w+)?(?:\s|$)/.test(cmd))return new Response('ok');
 const claimed=await env.DB.prepare('INSERT INTO webhook_updates(id,created_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING RETURNING id').bind(update.update_id,Date.now()).first();if(!claimed)return new Response('ok');
 const admin=/^\/admin|^\/start(?:@\w+)?\s+admin/.test(cmd),origin=new URL(req.url).origin;
 const payload={chat_id:m.chat.id,text:admin?'Formula • Панель команди\n\nВідкрийте панель кнопкою нижче. Telegram підтвердить ваш акаунт; доступ надає власник компанії.':'Автосалон Formula\n\nОберіть автомобіль у каталозі або залиште заявку менеджеру. Для працівників — команда /admin.',reply_markup:{inline_keyboard:[[{text:admin?'Відкрити панель Formula':'Відкрити каталог',web_app:{url:admin?origin+'/admin':'https://olegwest1112-web.github.io/formula-auto-bot/'}}]]}};
 try{const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!(await r.json()).ok)throw Error();}catch{await env.DB.prepare('DELETE FROM webhook_updates WHERE id=?').bind(update.update_id).run();throw new HttpError(503,'Retry later');}
 await env.DB.prepare('DELETE FROM webhook_updates WHERE created_at<?').bind(Date.now()-604800000).run();return new Response('ok');
}
