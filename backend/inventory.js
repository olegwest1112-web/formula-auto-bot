import {HttpError,validateVehicle,publicVehicle} from './validation.js';
const invQ=(env,sql,...args)=>env.DB.prepare(sql).bind(...args),invNow=()=>new Date().toISOString();
export async function sourcePhoto(url){
 if(!/^cdn\d+\.telesco\.pe$/.test(new URL(url).hostname))throw new HttpError(400,'Недозволене джерело фото.');
 for(let attempt=0;attempt<3;attempt++){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(r.ok)return await r.arrayBuffer();await r.body?.cancel();if([400,404,410].includes(r.status))break;}catch{}
  if(attempt<2)await new Promise(resolve=>setTimeout(resolve,400*(attempt+1)));
 }
 throw new HttpError(502,'Фото в джерелі недоступне після повторних спроб. Уже додані картки збережено.');
}
export async function storePhoto(bytes,env){
 if(bytes.byteLength>8388608)throw new HttpError(413,'Фото має бути до 8 МБ.');const b=new Uint8Array(bytes);let mime='';
 if(b[0]===255&&b[1]===216&&b[2]===255)mime='image/jpeg';else if(b.slice(0,8).join(',')==='137,80,78,71,13,10,26,10')mime='image/png';else if(new TextDecoder().decode(b.slice(0,4))==='RIFF'&&new TextDecoder().decode(b.slice(8,12))==='WEBP')mime='image/webp';if(!mime)throw new HttpError(400,'Оберіть JPG, PNG або WebP.');
 const id=crypto.randomUUID();await env.BUCKET.put(id,b,{httpMetadata:{contentType:mime}});try{await invQ(env,'INSERT INTO media(id,mime,size,created_at) VALUES(?,?,?,?)',id,mime,b.length,invNow()).run();}catch(e){await env.BUCKET.delete(id);throw e;}return '/media/'+id;
}
export async function checkCar(car,env,except=-1){
 const duplicate=await invQ(env,"SELECT id FROM vehicles WHERE id<>? AND ((?<>' ' AND ?<>'' AND UPPER(json_extract(payload,'$.vin'))=UPPER(?)) OR (?<>'' AND json_extract(payload,'$.source')=?)) LIMIT 1",except,car.vin,car.vin,car.vin,car.source,car.source).first();
 if(duplicate)throw new HttpError(409,'Автомобіль із цим VIN або оголошенням уже є в базі (№ '+duplicate.id+').');
 for(const image of car.images.filter(p=>p.startsWith('/media/')))if(!await invQ(env,'SELECT id FROM media WHERE id=?',image.slice(7)).first())throw new HttpError(400,'Одне з фото більше недоступне. Завантажте його повторно.');
}
export async function createVehicle(data,env,actor,operationId){
 if(!/^[a-f0-9-]{36}$/.test(operationId||''))throw new HttpError(400,'Оновіть форму створення.');
 const existing=await invQ(env,"SELECT entity_id FROM operations WHERE id=? AND kind='vehicle.create'",operationId).first();if(existing)return {id:existing.entity_id,repeated:true};
 const {internalNote,version,...car}=validateVehicle(data);await checkCar(car,env);
 const insert=invQ(env,"INSERT INTO vehicles(payload,status,published,internal_note,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT id FROM vehicles WHERE (?<>'' AND UPPER(json_extract(payload,'$.vin'))=UPPER(?)) OR (?<>'' AND json_extract(payload,'$.source')=?)) RETURNING id",JSON.stringify(car),car.status,+car.published,internalNote,invNow(),invNow(),car.vin,car.vin,car.source,car.source);
 try{
 const results=await env.DB.batch([insert,invQ(env,"INSERT INTO operations(id,entity_id,kind,created_at) SELECT ?,last_insert_rowid(),'vehicle.create',? WHERE changes()>0",operationId,invNow())]);
 const id=results[0].results?.[0]?.id;if(id===undefined)throw new HttpError(409,'Це оголошення або VIN уже додано.');
 await invQ(env,'INSERT INTO audit(actor,action,entity,created_at) VALUES(?,?,?,?)',actor.id,'vehicle.create',String(id),invNow()).run();return {id};
 }catch(e){const repeated=await invQ(env,"SELECT entity_id FROM operations WHERE id=? AND kind='vehicle.create'",operationId).first();if(repeated)return {id:repeated.entity_id,repeated:true};throw e;}
}
export async function sourceInventory(env){const source=typeof SOURCE_CATALOG!=='undefined'?SOURCE_CATALOG:[];const rows=await invQ(env,'SELECT payload FROM vehicles').all();const imported=new Set(rows.results.map(r=>JSON.parse(r.payload).source));return source.map(c=>({sourceId:c.sourceId,name:c.name,year:c.year,price:c.price,status:c.status,source:c.source,photo:c.sourceImages[0],photos:c.sourceImages.length,imported:imported.has(c.source)}));}
export async function importSource(id,env,actor){
 const source=typeof SOURCE_CATALOG!=='undefined'?SOURCE_CATALOG:[],item=source.find(c=>c.sourceId===id);if(!item)throw new HttpError(404,'Оголошення не знайдено в підготовленій добірці.');
 const existing=await invQ(env,"SELECT id FROM vehicles WHERE json_extract(payload,'$.source')=?",item.source).first();if(existing)return {id:existing.id,skipped:true};
 const images=[];try{for(const url of item.sourceImages)images.push(await storePhoto(await sourcePhoto(url),env));
 return await createVehicle({...item,images},env,actor,crypto.randomUUID());
 }catch(e){for(const path of images){const used=await invQ(env,"SELECT vehicles.id FROM vehicles,json_each(vehicles.payload,'$.images') AS photo WHERE photo.value=? LIMIT 1",path).first();if(!used){await env.BUCKET.delete(path.slice(7));await invQ(env,'DELETE FROM media WHERE id=?',path.slice(7)).run();}}throw e;}
}
