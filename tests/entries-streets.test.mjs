import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const source = readFileSync(new URL('../app/api/entries/route.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText.replace(/export /g, '');

test('zapis dwóch ulic tego samego dnia zachowuje ten sam raport i oba wpisy', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE entries (id TEXT PRIMARY KEY,team_id TEXT,user_id TEXT,entry_type TEXT,company TEXT,project TEXT,description TEXT,hours TEXT,kilometers TEXT,start_time TEXT,end_time TEXT,break_minutes TEXT,report_slot TEXT,report_week_key TEXT,work_date TEXT,latitude TEXT,longitude TEXT,created_at INTEGER,upload_state TEXT,expected_photos INTEGER,source_language TEXT);
        CREATE TABLE photos (id TEXT PRIMARY KEY,entry_id TEXT,team_id TEXT);`);
    const env = { DB: { prepare(sql) { return { bind(...args) { const stmt = db.prepare(sql); return { first: async () => stmt.get(...args) ?? null, run: async () => stmt.run(...args) }; } }; } } };
    const route = new Function('env', 'currentUser', 'json', `${code}; return {POST}`)(env, async () => ({id:'owner',teamId:'team',language:'pl'}), (body,status=200) => Response.json(body,{status}));
    async function save(project, hours, slot, company) {
        const form = new FormData();
        for (const [key,value] of Object.entries({entryType:'timesheet',company,project,hours,workDate:'2026-11-10',reportWeekKey:'2026-W46',reportSlot:slot})) form.set(key,value);
        const response = await route.POST(new Request('https://test/api/entries',{method:'POST',body:form}));
        assert.equal(response.status,200);
    }
    for (const slot of ['upper','lower']) {
        for (const company of ['', 'Firma A']) {
            await save(`Ulica A ${slot} ${company}`, '4', slot, company);
            await save(`Ulica B ${slot} ${company}`, '3', slot, company);
            const rows = db.prepare('SELECT project,hours,report_slot FROM entries WHERE report_slot=? AND company=? ORDER BY project').all(slot,company);
            assert.equal(rows.length,2);
            assert.deepEqual(rows.map(row => row.hours),['4','3']);
            assert.ok(rows.every(row => row.report_slot===slot));
        }
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM entries').get().count,8);
});
