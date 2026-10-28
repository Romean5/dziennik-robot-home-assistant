import { env } from 'cloudflare:workers';
import { currentUser, json } from '../_lib';

async function finishPhotos(entryId: string, teamId: string, files: File[], expected: number, now: number) {
    if (files.length != expected) return false;
    for (const [index, file] of files.entries()) {
        const photoId = `${entryId}:${index}`;
        const key = `${teamId}/${entryId}/${index}`;
        await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'image/jpeg' } });
        await env.DB.prepare('INSERT OR IGNORE INTO photos(id,entry_id,team_id,object_key,content_type,created_at) VALUES(?,?,?,?,?,?)').bind(photoId, entryId, teamId, key, file.type || 'image/jpeg', now).run();
    }
    const after = await env.DB.prepare('SELECT COUNT(*) AS total FROM photos WHERE entry_id=? AND team_id=?').bind(entryId, teamId).first<{ total: number }>();
    const complete = Number(after?.total ?? 0) >= expected;
    await env.DB.prepare("UPDATE entries SET upload_state=? WHERE id=? AND team_id=?").bind(complete ? 'complete' : 'pending', entryId, teamId).run();
    return complete;
}

export async function GET(request: Request) {
    const user = await currentUser(request);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const rows = await env.DB.prepare(`SELECT entries.id,entries.entry_type AS entryType,entries.company,entries.project,entries.description,entries.hours,entries.kilometers,entries.report_slot AS reportSlot,entries.work_date AS workDate,entries.latitude,entries.longitude,entries.created_at AS createdAt,COALESCE(NULLIF(entries.source_language,''),users.language,'pl') AS sourceLanguage,users.name AS author,COUNT(photos.id) AS photoCount FROM entries JOIN users ON users.id=entries.user_id LEFT JOIN photos ON photos.entry_id=entries.id WHERE entries.team_id=? AND (entries.user_id=? OR entries.entry_type='worklog') GROUP BY entries.id ORDER BY entries.created_at DESC LIMIT 200`).bind(user.teamId, user.id).all();
    return json({ entries: rows.results });
}

export async function POST(request: Request) {
    const user = await currentUser(request);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const form = await request.formData();
    const requestedId = String(form.get('id') ?? '').trim();
    const entryType = String(form.get('entryType') ?? 'worklog');
    const company = String(form.get('company') ?? '').trim();
    const project = String(form.get('project') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const hours = String(form.get('hours') ?? '').trim();
    const kilometers = String(form.get('kilometers') ?? '').trim();
    const workDate = String(form.get('workDate') ?? '');
    const reportSlot = String(form.get('reportSlot') ?? 'auto');
    const sourceLanguage = ['pl', 'da', 'en', 'lt'].includes(String(form.get('sourceLanguage') ?? '')) ? String(form.get('sourceLanguage')) : user.language;
    const claimedOwner = String(form.get('owner') ?? '');
    if (claimedOwner && claimedOwner !== `${user.teamId}:${user.id}` && claimedOwner !== `${user.teamName}:${user.name}`) return json({ error: 'account_changed' }, 403);
    if (requestedId && !/^[a-zA-Z0-9-]{1,80}$/.test(requestedId)) return json({ error: 'invalid_id' }, 400);
    const files = form.getAll('photos').filter((value): value is File => value instanceof File && value.size > 0).slice(0, 8);
    if (!project || !workDate || !['auto', 'upper', 'lower'].includes(reportSlot) || (entryType === 'worklog' && !description) || (entryType === 'timesheet' && !hours && !kilometers)) return json({ error: 'invalid' }, 400);
    const now = Date.now();
    if (requestedId) {
        const sameId = await env.DB.prepare('SELECT id,team_id AS teamId,user_id AS userId,COALESCE(upload_state,\'complete\') AS uploadState,COALESCE(expected_photos,0) AS expectedPhotos FROM entries WHERE id=?').bind(requestedId).first<{ id: string; teamId: string; userId: string; uploadState: string; expectedPhotos: number }>();
        if (sameId) {
            if (sameId.teamId !== user.teamId || sameId.userId !== user.id) return json({ error: 'id_collision' }, 409);
            if (sameId.uploadState === 'pending') {
                const complete = await finishPhotos(requestedId, user.teamId, files, Number(sameId.expectedPhotos), now);
                return json({ ok: complete, id: requestedId, existing: true, complete }, complete ? 200 : 503);
            }
            return json({ ok: true, id: requestedId, existing: true, complete: true });
        }
    }
    if (entryType === 'timesheet') {
        const existing = await env.DB.prepare('SELECT id,hours,kilometers FROM entries WHERE team_id=? AND user_id=? AND entry_type=? AND company=? AND project=? AND work_date=? AND report_slot=? ORDER BY created_at DESC LIMIT 1').bind(user.teamId, user.id, entryType, company, project, workDate, reportSlot).first<{ id: string; hours: string; kilometers: string }>();
        if (existing) {
            // Correct an existing day only within the report slot it was originally assigned to.
            // Choosing another slot creates a separate entry instead of moving this one.
            await env.DB.prepare('UPDATE entries SET hours=?,kilometers=?,created_at=? WHERE id=? AND team_id=? AND user_id=?').bind(hours || existing.hours || '0', kilometers || existing.kilometers || '0', now, existing.id, user.teamId, user.id).run();
            return json({ ok: true, id: existing.id, updated: true });
        }
    }
    const entryId = requestedId || crypto.randomUUID();
    await env.DB.prepare('INSERT OR IGNORE INTO entries(id,team_id,user_id,entry_type,company,project,description,hours,kilometers,report_slot,work_date,latitude,longitude,created_at,upload_state,expected_photos,source_language) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(entryId, user.teamId, user.id, entryType, company, project, description, hours || '0', kilometers || '0', reportSlot, workDate, String(form.get('latitude') ?? '') || null, String(form.get('longitude') ?? '') || null, now, files.length ? 'pending' : 'complete', files.length, sourceLanguage).run();
    const saved = await env.DB.prepare('SELECT user_id AS userId,team_id AS teamId,expected_photos AS expectedPhotos FROM entries WHERE id=?').bind(entryId).first<{userId:string;teamId:string;expectedPhotos:number}>();
    if (!saved || saved.userId !== user.id || saved.teamId !== user.teamId) return json({ error: 'id_collision' }, 409);
    const complete = await finishPhotos(entryId, user.teamId, files, Number(saved.expectedPhotos), now);
    return json({ ok: complete, id: entryId, complete }, complete ? 200 : 503);
}

export async function DELETE(request: Request) {
    const user = await currentUser(request);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const id = new URL(request.url).searchParams.get('id') || '';
    if (!id) return json({ error: 'invalid' }, 400);
    const row = await env.DB.prepare('SELECT id FROM entries WHERE id=? AND team_id=? AND user_id=?').bind(id, user.teamId, user.id).first();
    if (!row) return json({ error: 'not_found' }, 404);
    const photos = await env.DB.prepare('SELECT object_key AS objectKey FROM photos WHERE entry_id=? AND team_id=?').bind(id, user.teamId).all<{ objectKey: string }>();
    try {
        await Promise.all(photos.results.map(photo => env.FILES.delete(photo.objectKey)));
    } catch {
        return json({ error: 'photo_delete_failed' }, 502);
    }
    await env.DB.prepare('DELETE FROM photos WHERE entry_id=? AND team_id=?').bind(id, user.teamId).run();
    await env.DB.prepare('DELETE FROM entries WHERE id=? AND team_id=? AND user_id=?').bind(id, user.teamId, user.id).run();
    return json({ ok: true, id });
}
