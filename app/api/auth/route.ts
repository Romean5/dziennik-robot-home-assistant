import { env } from 'cloudflare:workers';
import { clearFailedLogins, ensureSchema, ensureTranslationSchema, hashPin, json, loginRateLimit, normalize, recordFailedLogin, sessionCookie } from '../_lib';

const TEAM_ID = 'main-work-log';

export async function POST(request: Request) {
    await ensureSchema();
    await ensureTranslationSchema();
    const body = await request.json() as { name?: string; pin?: string; language?: 'pl' | 'da' | 'en' | 'lt' };
    const name = body.name?.trim() ?? '';
    const pin = body.pin?.trim() ?? '';
    const language = ['pl', 'da', 'en', 'lt'].includes(body.language ?? '') ? body.language! : 'pl';
    if (name.length < 2 || !/^\d{4,8}$/.test(pin)) return json({ error: 'invalid' }, 400);
    const now = Date.now();
    const nameKey = normalize(name);
    const retryAfter = await loginRateLimit(nameKey, now);
    if (retryAfter) return json({ error: 'too_many_attempts', retryAfter }, 429, { 'retry-after': String(retryAfter) });
    let team = await env.DB.prepare('SELECT id,name FROM teams WHERE id=?').bind(TEAM_ID).first<{ id: string; name: string }>();
    if (!team) {
        team = { id: TEAM_ID, name: 'Dziennik Robót' };
        await env.DB.prepare('INSERT INTO teams(id,name,name_key,created_at) VALUES(?,?,?,?)').bind(team.id, team.name, 'dziennik-robot-main', now).run();
    }
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM users WHERE team_id=?').bind(TEAM_ID).first<{ total: number }>();
    let user = await env.DB.prepare('SELECT id,name,pin_salt AS pinSalt,pin_hash AS pinHash,role,status,must_change_pin AS mustChangePin,pin_reset_expires_at AS pinResetExpiresAt,language FROM users WHERE team_id=? AND name_key=?').bind(TEAM_ID, nameKey).first<{ id: string; name: string; pinSalt: string; pinHash: string; role: string; status: string; mustChangePin: number; pinResetExpiresAt: number | null; language: 'pl' | 'da' | 'en' | 'lt' }>();
    if (!user) {
        const first = !count?.total;
        const salt = crypto.randomUUID();
        const pinHash = await hashPin(pin, salt);
        const role = first ? 'admin' : 'member';
        const status = first ? 'active' : 'pending';
        user = { id: crypto.randomUUID(), name, pinSalt: salt, pinHash, role, status, mustChangePin: 0, pinResetExpiresAt: null, language };
        await env.DB.prepare('INSERT INTO users(id,team_id,name,name_key,pin_salt,pin_hash,role,status,created_at,language) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(user.id, TEAM_ID, name, nameKey, salt, pinHash, role, status, now, language).run();
    } else if (await hashPin(pin, user.pinSalt) !== user.pinHash) {
        const retryAfter = await recordFailedLogin(nameKey, now);
        return json({ error: retryAfter ? 'too_many_attempts' : 'wrong_pin', ...(retryAfter ? { retryAfter } : {}) }, retryAfter ? 429 : 401, retryAfter ? { 'retry-after': String(retryAfter) } : undefined);
    }
    if (user.status === 'active') await clearFailedLogins(nameKey);
    if (user.mustChangePin && user.pinResetExpiresAt !== null && user.pinResetExpiresAt < now) return json({ error: 'temporary_pin_expired' }, 401);
    if (user.status !== 'active') return json({ pending: true }, 202);
    const token = crypto.randomUUID() + crypto.randomUUID();
    const mustChangePin = Boolean(user.mustChangePin);
    const maxAge = mustChangePin ? 900 : 2592000;
    const expires = now + maxAge * 1000;
    await env.DB.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').bind(token, user.id, expires).run();
    return json({ user: { id: user.id, teamId: TEAM_ID, name: user.name, teamName: team.name, role: user.role, language: user.language ?? language, mustChangePin } }, 200, { 'set-cookie': sessionCookie(token, maxAge, request) });
}
