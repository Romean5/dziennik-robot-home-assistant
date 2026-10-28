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
