import { env } from 'cloudflare:workers';
import { currentUser, json } from '../_lib';

const WEEK_KEY = /^\d{4}-W\d{2}$/;

export async function GET(request: Request) {
    const user = await currentUser(request);
    if (!user) return json({ error: 'unauthorized' }, 401);

    const weekKey = new URL(request.url).searchParams.get('weekKey') ?? '';
    if (!WEEK_KEY.test(weekKey)) return json({ error: 'invalid_week' }, 400);

    const settings = await env.DB.prepare(`SELECT upper_company AS upperCompany, upper_project AS upperProject,
        upper_full_name AS upperFullName, upper_employee_number AS upperEmployeeNumber,
        upper_machine AS upperMachine, upper_machine_number AS upperMachineNumber,
        lower_company AS lowerCompany, lower_project AS lowerProject,
        lower_full_name AS lowerFullName, lower_employee_number AS lowerEmployeeNumber,
        lower_machine AS lowerMachine, lower_machine_number AS lowerMachineNumber,
        header_fields_configured AS headerFieldsConfigured
        FROM timesheet_report_settings WHERE user_id=? AND week_key=?`).bind(user.id, weekKey).first();
    return json({ settings: settings ?? null });
}

export async function POST(request: Request) {
    const user = await currentUser(request);
    if (!user) return json({ error: 'unauthorized' }, 401);

    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return json({ error: 'invalid_json' }, 400); }

    const weekKey = String(body.weekKey ?? '');
    if (!WEEK_KEY.test(weekKey)) return json({ error: 'invalid_week' }, 400);
    const slot = body.slot;
    if (slot !== undefined && slot !== 'upper' && slot !== 'lower') return json({ error: 'invalid_slot' }, 400);
    const fields = [
        'upperCompany', 'upperProject', 'upperFullName', 'upperEmployeeNumber', 'upperMachine', 'upperMachineNumber',
        'lowerCompany', 'lowerProject', 'lowerFullName', 'lowerEmployeeNumber', 'lowerMachine', 'lowerMachineNumber'
    ] as const;
    const values = fields.map(field => String(body[field] ?? '').trim());
    if (values.some(value => value.length > 100)) return json({ error: 'value_too_long' }, 400);

    // Once the per-slot fields have been initialized, a save changes only the
    // selected blank's header. This protects the other report's independent data.
    const existing = await env.DB.prepare(`SELECT header_fields_configured AS configured
        FROM timesheet_report_settings WHERE user_id=? AND week_key=?`).bind(user.id, weekKey).first<{ configured: number }>();
    if (slot && existing?.configured) {
        const offset = slot === 'upper' ? 0 : 6;
        const columns = slot === 'upper'
            ? ['upper_company', 'upper_project', 'upper_full_name', 'upper_employee_number', 'upper_machine', 'upper_machine_number']
            : ['lower_company', 'lower_project', 'lower_full_name', 'lower_employee_number', 'lower_machine', 'lower_machine_number'];
        await env.DB.prepare(`UPDATE timesheet_report_settings SET ${columns.map(column => `${column}=?`).join(', ')}, updated_at=? WHERE user_id=? AND week_key=?`)
            .bind(...values.slice(offset, offset + 6), Date.now(), user.id, weekKey).run();
        return json({ ok: true, weekKey, slot });
    }

    await env.DB.prepare(`INSERT INTO timesheet_report_settings
        (user_id, week_key, upper_company, upper_project, upper_full_name, upper_employee_number, upper_machine, upper_machine_number,
         lower_company, lower_project, lower_full_name, lower_employee_number, lower_machine, lower_machine_number,
         header_fields_configured, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(user_id, week_key) DO UPDATE SET upper_company=excluded.upper_company, upper_project=excluded.upper_project,
        upper_full_name=excluded.upper_full_name, upper_employee_number=excluded.upper_employee_number,
        upper_machine=excluded.upper_machine, upper_machine_number=excluded.upper_machine_number,
        lower_company=excluded.lower_company, lower_project=excluded.lower_project,
        lower_full_name=excluded.lower_full_name, lower_employee_number=excluded.lower_employee_number,
        lower_machine=excluded.lower_machine, lower_machine_number=excluded.lower_machine_number,
        header_fields_configured=1, updated_at=excluded.updated_at`)
        .bind(user.id, weekKey, ...values, Date.now()).run();

    return json({ ok: true, weekKey });
}
