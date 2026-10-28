import { env } from 'cloudflare:workers';
import { currentUser, ensureTranslationSchema, json } from '../_lib';

type TranslationEnvironment = typeof env & { TRANSLATOR_URL?: string };

function toHex(bytes: Uint8Array) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string) {
    return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

export async function POST(request: Request) {
    const user = await currentUser(request);
    if (!user) return json({ error: 'unauthorized' }, 401);
    await ensureTranslationSchema();

    const body = await request.json().catch(() => null) as { entryId?: string } | null;
    const entryId = String(body?.entryId ?? '').trim();
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(entryId)) return json({ error: 'invalid_entry' }, 400);

    const entry = await env.DB.prepare(`SELECT entries.id,entries.description,COALESCE(NULLIF(entries.source_language,''),author.language,'pl') AS sourceLanguage FROM entries JOIN users AS author ON author.id=entries.user_id WHERE entries.id=? AND entries.team_id=? AND entries.entry_type='worklog' AND entries.upload_state='complete'`).bind(entryId, user.teamId).first<{ id: string; description: string; sourceLanguage: string }>();
    if (!entry) return json({ error: 'not_found' }, 404);
    const original = String(entry.description ?? '').trim();
    if (!original || original.length > 5000) return json({ error: 'invalid_text' }, 400);
    const sourceLanguage = ['pl', 'da', 'en', 'lt'].includes(entry.sourceLanguage) ? entry.sourceLanguage : 'pl';
    if (sourceLanguage === 'en') return json({ translation: original, cached: true, sourceLanguage, targetLanguage: 'en' });

    const sourceHash = await sha256(original);
    const cached = await env.DB.prepare('SELECT translated_text AS translation,model FROM entry_translations WHERE entry_id=? AND team_id=? AND source_hash=? AND source_language=? AND target_language=\'en\'').bind(entry.id, user.teamId, sourceHash, sourceLanguage).first<{ translation: string; model: string }>();
    if (cached) return json({ translation: cached.translation, cached: true, sourceLanguage, targetLanguage: 'en', model: cached.model });

    const translatorUrl = String((env as TranslationEnvironment).TRANSLATOR_URL ?? '').trim().replace(/\/$/, '');
    if (!translatorUrl) return json({ error: 'translator_unavailable' }, 503);

    try {
        const response = await fetch(`${translatorUrl}/translate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: original, sourceLanguage, targetLanguage: 'en' }),
            signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) return json({ error: response.status === 400 ? 'unsupported_language' : 'translator_unavailable' }, 503);
        const result = await response.json() as { translatedText?: string; model?: string };
        const translation = String(result.translatedText ?? '').trim();
        if (!translation) return json({ error: 'translator_unavailable' }, 503);
        const model = String(result.model ?? 'argos-local').slice(0, 80);
        await env.DB.prepare('INSERT OR REPLACE INTO entry_translations(entry_id,team_id,source_hash,source_language,target_language,translated_text,model,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(entry.id, user.teamId, sourceHash, sourceLanguage, 'en', translation, model, Date.now()).run();
        return json({ translation, cached: false, sourceLanguage, targetLanguage: 'en', model });
    } catch {
        return json({ error: 'translator_unavailable' }, 503);
    }
}
