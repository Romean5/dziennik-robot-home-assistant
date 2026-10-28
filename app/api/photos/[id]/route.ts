import { env } from 'cloudflare:workers';
import { currentUser, json } from '../../_lib';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await currentUser(request);
    if (!user) return new Response('Unauthorized', { status: 401 });
    const { id } = await params;
    const photo = await env.DB.prepare(`SELECT photos.object_key AS objectKey,photos.content_type AS contentType FROM photos JOIN entries ON entries.id=photos.entry_id WHERE photos.id=? AND photos.team_id=? AND (entries.user_id=? OR entries.entry_type='worklog')`).bind(id, user.teamId, user.id).first<{ objectKey: string; contentType: string }>();
    if (!photo) return new Response('Not found', { status: 404 });
    const object = await env.FILES.get(photo.objectKey);
    return object ? new Response(object.body, { headers: { 'content-type': photo.contentType, 'cache-control': 'private, no-store' } }) : new Response('Not found', { status: 404 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await currentUser(request);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const { id } = await params;
    const photo = await env.DB.prepare(`SELECT photos.object_key AS objectKey FROM photos JOIN entries ON entries.id=photos.entry_id WHERE photos.id=? AND photos.team_id=? AND entries.user_id=?`).bind(id, user.teamId, user.id).first<{ objectKey: string }>();
    if (!photo) return json({ error: 'not_found' }, 404);
    try {
        await env.FILES.delete(photo.objectKey);
    } catch {
        return json({ error: 'storage_delete_failed' }, 502);
    }
    await env.DB.prepare('DELETE FROM photos WHERE id=? AND team_id=?').bind(id, user.teamId).run();
    return json({ ok: true, id });
}
