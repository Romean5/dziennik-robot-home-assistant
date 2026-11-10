import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const fields = ['company','project','full_name','employee_number','machine','machine_number'];
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE timesheet_report_settings (user_id TEXT, week_key TEXT, ${['upper','lower'].flatMap(slot => fields.map(field => `${slot}_${field} TEXT DEFAULT ''`)).join(',')}, header_fields_configured INTEGER DEFAULT 1, updated_at INTEGER, PRIMARY KEY(user_id, week_key))`);
const env = { DB: { prepare(sql) { return { bind(...args) { const stmt = db.prepare(sql); return { first: async () => stmt.get(...args) ?? null, run: async () => stmt.run(...args) }; } }; } } };
const source = readFileSync(new URL('../app/api/report-settings/route.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText.replace(/export /g, '');
const route = new Function('env', 'currentUser', 'json', `${code}; return {GET,POST}`)(env, async () => ({ id: 'owner' }), body => Response.json(body));
const get = async week => (await (await route.GET(new Request(`https://test/api/report-settings?weekKey=${week}`))).json()).settings;
const save = async (week, slot, data) => route.POST(new Request('https://test/api/report-settings', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({weekKey:week,slot,...data})}));

test('fixed data survives weeks, imports latest legacy data and preserves the other slot and other users', async () => {
    db.exec(`INSERT INTO timesheet_report_settings(user_id,week_key,upper_company,lower_company,updated_at) VALUES ('owner','2026-W43','Old','Lower old',1),('owner','2026-W44','Latest','Lower kept',2),('other','2026-W45','Private','Private',99)`);
    assert.equal((await get('2026-W46')).upperCompany, 'Latest');
    assert.equal((await get('2027-W01')).lowerCompany, 'Lower kept');
    assert.equal((await save('2026-W46','upper',{upperCompany:'Changed'})).status,200);
    assert.equal((await get('2027-W01')).upperCompany, 'Changed');
    assert.equal((await get('2026-W43')).lowerCompany, 'Lower kept');
    await save('2027-W01','upper',{upperCompany:''});
    assert.equal((await get('2027-W02')).upperCompany, '');
    assert.equal((await get('2027-W02')).lowerCompany, 'Lower kept');
    assert.equal(db.prepare("SELECT upper_company FROM timesheet_report_settings WHERE user_id='other'").get().upper_company, 'Private');
});
