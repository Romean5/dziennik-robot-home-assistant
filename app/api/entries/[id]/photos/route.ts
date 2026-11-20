import { env } from 'cloudflare:workers';
import { currentUser, json } from '../../../_lib';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await currentUser(request);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const { id } = await params;
    const entry = await env.DB.prepare("SELECT id FROM entries WHERE id=? AND team_id=? AND (user_id=? OR entry_type='worklog')").bind(id, user.teamId, user.id).first();
    if (!entry) return json({ error: 'not_found' }, 404);
    const photos = await env.DB.prepare('SELECT id FROM photos WHERE entry_id=? AND team_id=? ORDER BY created_at,id').bind(id, user.teamId).all();
    return json({ photos: photos.results }, 200, { 'cache-control': 'private, no-store' });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await currentUser(request);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const { id } = await params;
    const entry = await env.DB.prepare("SELECT id,COALESCE(upload_state,'complete') AS uploadState FROM entries WHERE id=? AND team_id=? AND user_id=?")
        .bind(id, user.teamId, user.id).first<{ id: string; uploadState: string }>();
    if (!entry) return json({ error: 'not_found' }, 404);
    if (entry.uploadState !== 'complete') return json({ error: 'entry_upload_pending' }, 409);

    let form: FormData;
    try { form = await request.formData(); }
    catch { return json({ error: 'invalid_form' }, 400); }
    const file = form.get('photo');
    const uploadId = String(form.get('uploadId') ?? '');
    if (!(file instanceof File) || !file.size || !/^[a-zA-Z0-9-]{1,80}$/.test(uploadId)) {
        return json({ error: 'invalid_photo' }, 400);
    }
    if (file.type && (!file.type.startsWith('image/') || file.type === 'image/svg+xml')) {
        return json({ error: 'invalid_photo_type' }, 400);
    }

    // The client reuses this ID after a timeout, so retries cannot duplicate
    // a photo. Separate upload IDs also keep concurrent additions independent.
    const photoId = `${id}:added:${uploadId}`;
    const existing = await env.DB.prepare('SELECT id FROM photos WHERE id=? AND entry_id=? AND team_id=?')
        .bind(photoId, id, user.teamId).first();
    if (!existing) {
        const key = `${user.teamId}/${id}/added/${uploadId}`;
        try {
            await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'image/jpeg' } });
            await env.DB.prepare('INSERT OR IGNORE INTO photos(id,entry_id,team_id,object_key,content_type,created_at) VALUES(?,?,?,?,?,?)')
                .bind(photoId, id, user.teamId, key, file.type || 'image/jpeg', Date.now()).run();
        } catch {
            return json({ error: 'photo_upload_failed' }, 503);
        }
    }
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM photos WHERE entry_id=? AND team_id=?')
        .bind(id, user.teamId).first<{ total: number }>();
    return json({ ok: true, id: photoId, photoCount: Number(count?.total ?? 0) }, 200, { 'cache-control': 'private, no-store' });
}
