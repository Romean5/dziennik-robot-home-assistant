import{env}from'cloudflare:workers';import{ensureSchema,json}from'../_lib';
export async function GET(){try{await ensureSchema();await env.DB.prepare('SELECT 1 AS ok').first();return json({ok:true,service:'dziennik-robot',database:'ready'});}catch{return json({ok:false,service:'dziennik-robot',database:'unavailable'},503);}}
