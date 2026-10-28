import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
const root=resolve(process.env.DZIENNIK_DATA_DIR || '/data/native');
const db=new DatabaseSync(resolve(root,'dziennik-robot.sqlite'),{readOnly:true});
const digest=createHash('sha256');
const counts={};
for(const table of ['teams','users','projects','entries','photos']) {
  const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name).filter(name=>!['upload_state','expected_photos','must_change_pin','pin_reset_expires_at'].includes(name));
  const rows=db.prepare(`SELECT ${columns.map(name=>'"'+name+'"').join(',')} FROM ${table} ORDER BY id`).all();
  counts[table]=rows.length;
  digest.update(JSON.stringify({table,rows}));
}
for(const row of db.prepare('SELECT object_key FROM photos ORDER BY id').all()) {
  const path=resolve(root,'files',row.object_key), fileRoot=resolve(root,'files')+sep;
  if(!path.startsWith(fileRoot)) throw new Error('Invalid stored photo path');
  digest.update(readFileSync(path));
}
db.close();
console.log(JSON.stringify({dataAudit:process.argv[2]||'check',counts,sha256:digest.digest('hex')}));
