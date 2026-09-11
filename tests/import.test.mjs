import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourcePhoto} from '../backend/inventory.js';
test('source photo retries temporary failures and stops at removed photos',async()=>{const original=globalThis.fetch;let calls=0;try{globalThis.fetch=async()=>++calls===1?new Response('Temporary',{status:503}):new Response(new Uint8Array([1,2,3]));assert.equal((await sourcePhoto('https://cdn4.telesco.pe/file/test')).byteLength,3);assert.equal(calls,2);calls=0;globalThis.fetch=async()=>{calls++;return new Response('Removed',{status:404});};await assert.rejects(()=>sourcePhoto('https://cdn4.telesco.pe/file/test'));assert.equal(calls,1);await assert.rejects(()=>sourcePhoto('https://untrusted.example/file'));assert.equal(calls,1);}finally{globalThis.fetch=original;}});
