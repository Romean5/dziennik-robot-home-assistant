'use client';

import { useEffect, useRef, useState } from 'react';

type PhotoView = { id: string; url: string; index: number };

export default function EntryPhotos({ entryId, count, files, language, canDelete = false, onDeletePhoto }: {
    entryId: string;
    count: number;
    files?: File[];
    language: 'pl' | 'da' | 'en' | 'lt';
    canDelete?: boolean;
    onDeletePhoto?: (photoId: string, index: number) => Promise<boolean>;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const objectUrls = useRef(new Set<string>());
    const [photos, setPhotos] = useState<PhotoView[]>([]);
    const [selected, setSelected] = useState(0);
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState(false);
    const labels = language === 'lt'
        ? { open: 'Peržiūrėti nuotraukas', close: 'Uždaryti', previous: 'Ankstesnė', next: 'Kita', error: 'Nuotraukų nepavyko įkelti. Bandykite dar kartą, kai serveris vėl veiks.', loading: 'Įkeliama…', original: 'Atidaryti visu dydžiu', photo: 'Nuotrauka', delete: 'Ištrinti nuotrauką', confirm: 'Ar tikrai norite ištrinti?', failed: 'Nuotraukos nepavyko ištrinti.' }
        : language === 'da'
        ? { open: 'Se billeder', close: 'Luk', previous: 'Forrige', next: 'Næste', error: 'Billederne kunne ikke indlæses. Prøv igen, når serveren er tilgængelig.', loading: 'Indlæser…', original: 'Åbn i fuld størrelse', photo: 'Billede', delete: 'Slet billede', confirm: 'Er du sikker på, at du vil slette?', failed: 'Billedet kunne ikke slettes.' }
        : language === 'en'
        ? { open: 'View photos', close: 'Close', previous: 'Previous', next: 'Next', error: 'Could not load photos. Try again when the server is available.', loading: 'Loading…', original: 'Open full size', photo: 'Photo', delete: 'Delete photo', confirm: 'Are you sure you want to delete it?', failed: 'The photo could not be deleted.' }
        : { open: 'Zobacz zdjęcia', close: 'Zamknij', previous: 'Poprzednie', next: 'Następne', error: 'Nie udało się wczytać zdjęć. Spróbuj ponownie, gdy serwer będzie dostępny.', loading: 'Wczytywanie…', original: 'Otwórz w pełnym rozmiarze', photo: 'Zdjęcie', delete: 'Usuń zdjęcie', confirm: 'Czy na pewno chcesz usunąć?', failed: 'Nie udało się usunąć zdjęcia.' };

    useEffect(() => () => { objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current.clear(); }, []);

    async function open() {
        dialog.current?.showModal();
        objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current.clear();
        setLoading(true); setError(false); setSelected(0); setPhotos([]);
        try {
            if (files) {
                if (!files.length) throw new Error('No photos');
                setPhotos(files.map((file, index) => { const url = URL.createObjectURL(file); objectUrls.current.add(url); return { id: String(index), index, url }; }));
            } else {
                const response = await fetch(`/api/entries/${encodeURIComponent(entryId)}/photos`, { cache: 'no-store' });
                if (!response.ok) throw new Error('Photos unavailable');
                const data = await response.json() as { photos?: { id: string }[] };
                if (!Array.isArray(data.photos) || !data.photos.length) throw new Error('No photos');
                setPhotos(data.photos.map((photo: { id: string }, index: number) => ({ id: photo.id, index, url: `/api/photos/${encodeURIComponent(photo.id)}` })));
            }
        } catch { setError(true); } finally { setLoading(false); }
    }

    async function deleteSelected() {
        const photo = photos[selected];
        if (!photo || !onDeletePhoto || !window.confirm(labels.confirm)) return;
        setDeleting(true); setError(false);
        try {
            if (!await onDeletePhoto(photo.id, photo.index)) throw new Error('Delete failed');
            if (photo.url.startsWith('blob:')) { URL.revokeObjectURL(photo.url); objectUrls.current.delete(photo.url); }
            setPhotos(current => current.filter(item => item.id !== photo.id).map((item, index) => files ? { ...item, id: String(index), index } : item));
            setSelected(current => Math.min(current, Math.max(0, photos.length - 2)));
            if (photos.length === 1) dialog.current?.close();
        } catch { setError(true); } finally { setDeleting(false); }
    }

    if (!count) return null;
    return <>
        <button className="photo-open" type="button" onClick={open}>📷 {labels.open} ({count})</button>
        <dialog className="photo-dialog" ref={dialog} aria-label={labels.open} onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
            <div className="photo-toolbar"><strong>{labels.photo}{photos.length ? ` ${selected + 1} / ${photos.length}` : ''}</strong><button type="button" onClick={() => dialog.current?.close()}>{labels.close} ✕</button></div>
            {loading ? <p role="status">{labels.loading}</p> : error && !photos.length ? <p role="alert">{labels.error}</p> : photos.length > 0 && <>
                <div className="photo-stage"><img src={photos[selected]?.url} alt={`${labels.photo} ${selected + 1}`} onError={() => setError(true)} /></div>
                <div className="photo-toolbar">
                    <button type="button" disabled={selected === 0} onClick={() => setSelected(value => value - 1)}>← {labels.previous}</button>
                    <a href={photos[selected]?.url} target="_blank" rel="noopener noreferrer">{labels.original}</a>
                    <button type="button" disabled={selected === photos.length - 1} onClick={() => setSelected(value => value + 1)}>{labels.next} →</button>
                </div>
                {canDelete && <button className="photo-delete" type="button" disabled={deleting} onClick={deleteSelected}>{deleting ? '…' : labels.delete}</button>}
                {error && <p role="alert">{labels.failed}</p>}
            </>}
        </dialog>
    </>;
}
