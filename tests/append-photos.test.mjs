import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const source = readFileSync(new URL('../app/api/entries/[id]/photos/route.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText.replace(/export /g, '');

test('append photos preserves earlier batches and retries safely, including storage and database failures', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE entries(id TEXT PRIMARY KEY,team_id TEXT,user_id TEXT,entry_type TEXT,upload_state TEXT);
        CREATE TABLE photos(id TEXT PRIMARY KEY,entry_id TEXT,team_id TEXT,object_key TEXT,content_type TEXT,created_at INTEGER);
        INSERT INTO entries VALUES ('entry','team','owner','worklog','complete'),('pending','team','owner','worklog','pending');
        INSERT INTO photos VALUES ('entry:0','entry','team','original','image/jpeg',1);`);
    let user = { id: 'owner', teamId: 'team' };
    let failStorage = false;
    let failDatabase = false;
    const objects = new Map([['original', 'original photo']]);
    const env = {
        DB: { prepare(sql) {
            return { bind(...args) {
                const statement = db.prepare(sql);
                return {
                    first: async () => statement.get(...args) ?? null,
                    run: async () => {
                        if (failDatabase && sql.startsWith('INSERT')) { failDatabase = false; throw new Error('db failure'); }
                        return statement.run(...args);
                    },
                    all: async () => ({ results: statement.all(...args) })
                };
            } };
        } },
        FILES: { async put(key, body) {
            if (failStorage) { failStorage = false; throw new Error('storage failure'); }
            objects.set(key, await new Response(body).text());
        } }
    };
    const route = new Function('env', 'currentUser', 'json', `${code};return {GET,POST}`)(env, async () => user, (body,status=200,headers={}) => Response.json(body,{status,headers}));
    async function add(uploadId, content='new photo', entry='entry', type='image/jpeg') {
        const form = new FormData();
        form.set('uploadId',uploadId);
        form.set('photo',new File([content],'photo.jpg',{type}));
        return route.POST(new Request('https://test/api/entries/entry/photos',{method:'POST',body:form}),{params:Promise.resolve({id:entry})});
    }
    assert.equal((await add('first')).status,200);
    assert.equal((await add('second')).status,200);
    assert.equal((await add('first')).status,200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM photos').get().n,3);
    assert.equal(objects.get('original'),'original photo');
    assert.equal(objects.get('team/entry/added/first'),'new photo');

    const concurrent = await Promise.all(Array.from({length:10},(_,i)=>add('batch-'+i,'photo '+i)));
    assert.ok(concurrent.every(response=>response.status===200));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM photos').get().n,13);
    assert.equal(objects.size,13);

    failStorage=true;
    assert.equal((await add('retry-storage')).status,503);
    assert.equal((await add('retry-storage')).status,200);
    failDatabase=true;
    assert.equal((await add('retry-database')).status,503);
    assert.equal((await add('retry-database')).status,200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM photos').get().n,15);
    assert.equal(objects.size,15);

    assert.equal((await add('pending-photo','test','pending')).status,409);
    assert.equal((await add('svg','test','entry','image/svg+xml')).status,400);
    user={id:'other',teamId:'team'};
    assert.equal((await add('not-owner')).status,404);
    user={id:'owner',teamId:'other-team'};
    assert.equal((await add('not-team')).status,404);
    user=null;
    assert.equal((await add('not-authenticated')).status,401);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM photos').get().n,15);
    db.close();
});
