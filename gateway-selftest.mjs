const base='http://127.0.0.1:8099';
const request=(path,options={})=>fetch(base+path,{...options,signal:AbortSignal.timeout(10000)});
for(let attempt=0;attempt<30;attempt++){
 try{
  const health=await request('/api/health');const body=await health.json();
  if(health.status!==200||body.database!=='ready')throw Error('Database not ready');
  const root=await request('/');const html=await root.text();
  if(root.status!==200||root.headers.has('www-authenticate')||!html.includes('Dziennik'))throw Error('Public login page not ready');
  const checks={};
  for(const [path,status] of [['/api/entries',401],['/api/projects',401],['/api/session',401],['/api/entries/nonexistent/photos',401],['/api/photos/nonexistent',401],['/api/admin/requests',403],['/api/admin/backup',403]]){
   const r=await request(path);if(r.status!==status||r.headers.has('www-authenticate'))throw Error('Session protection failed: '+path);checks[path]=r.status;
  }
  const statuses=[];
  for(let i=0;i<10;i++){const r=await request('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});statuses.push(r.status);}
  if(!statuses.includes(429))throw Error('Login rate limit missing');
  console.log(JSON.stringify({gatewayTest:'passed',publicLoginPage:200,basicAuthPrompt:false,database:body.database,protectedApis:checks,loginRateLimit:429}));process.exit(0);
 }catch(error){if(attempt===29)console.error(String(error));await new Promise(r=>setTimeout(r,2000));}
}
process.exit(1);
