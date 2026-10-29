import { env } from 'cloudflare:workers';
import { currentUser, hashPin, json } from '../../_lib';

function canManageTeam(role: string) {
    return role === 'admin' || role === 'manager';
}

export async function GET(request: Request) {
    const user = await currentUser(request);
    if (!user || !canManageTeam(user.role)) return json({ error: 'forbidden' }, 403);
    const rows = await env.DB.prepare("SELECT id,name,created_at AS createdAt FROM users WHERE team_id=? AND status='pending' ORDER BY created_at").bind(user.teamId).all();
    const users = await env.DB.prepare("SELECT id,name,role,created_at AS createdAt,status FROM users WHERE team_id=? AND status='active' ORDER BY name").bind(user.teamId).all();
    return json({ requests: rows.results, users: users.results });
}

export async function POST(request: Request) {
    const user = await currentUser(request);
    if (!user || !canManageTeam(user.role)) return json({ error: 'forbidden' }, 403);
    const body = await request.json() as { id?: string; action?: string };
    const id = String(body.id ?? '');
    if (body.action === 'approve') await env.DB.prepare("UPDATE users SET status='active' WHERE id=? AND team_id=? AND status='pending'").bind(id, user.teamId).run();
    else if (body.action === 'reject') await env.DB.prepare("DELETE FROM users WHERE id=? AND team_id=? AND status='pending'").bind(id, user.teamId).run();
    else if (body.action === 'resetPin') {
        if (!id || id === user.id) return json({ error: 'invalid_user' }, 400);
        const member = await env.DB.prepare("SELECT id,role FROM users WHERE id=? AND team_id=? AND status='active'").bind(id, user.teamId).first<{ id: string; role: string }>();
        if (!member || member.role === 'admin' || (user.role === 'manager' && member.role === 'manager')) return json({ error: 'invalid_user' }, 404);
        const bytes = crypto.getRandomValues(new Uint8Array(4));
        const value = new DataView(bytes.buffer).getUint32(0) % 100000000;
        const temporaryPin = String(value).padStart(8, '0');
        const salt = crypto.randomUUID();
        const pinHash = await hashPin(temporaryPin, salt);
        await env.DB.prepare('UPDATE users SET pin_salt=?,pin_hash=?,must_change_pin=1,pin_reset_expires_at=? WHERE id=? AND team_id=? AND status=\'active\'').bind(salt, pinHash, Date.now() + 86400000, id, user.teamId).run();
        await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();
        return json({ ok: true, temporaryPin });
    } else if (body.action === 'grantManager' || body.action === 'revokeManager') {
        // Only the main administrator can assign or remove the brigade-manager role.
        if (user.role !== 'admin' || !id || id === user.id) return json({ error: 'forbidden' }, 403);
        const member = await env.DB.prepare("SELECT id,role FROM users WHERE id=? AND team_id=? AND status='active'").bind(id, user.teamId).first<{ id: string; role: string }>();
        if (!member || member.role === 'admin') return json({ error: 'invalid_user' }, 404);
        const role = body.action === 'grantManager' ? 'manager' : 'member';
        await env.DB.prepare("UPDATE users SET role=? WHERE id=? AND team_id=? AND status='active'").bind(role, id, user.teamId).run();
    } else return json({ error: 'invalid' }, 400);
    return json({ ok: true });
}
