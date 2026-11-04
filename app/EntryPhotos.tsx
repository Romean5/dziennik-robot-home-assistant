'use client';

import { useEffect, useRef, useState } from 'react';

type PhotoView = { id: string; url: string; index: number };
type ArchivePhoto = { name: string; blob: Blob };

const encoder = new TextEncoder();

function crc32(data: Uint8Array) {
    let value = 0xffffffff;
    for (const byte of data) {
        value ^= byte;
        for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
}

function writeU16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true); }
function writeU32(view: DataView, offset: number, value: number) { view.setUint32(offset, value, true); }

function createZip(files: Array<{ name: string; data: Uint8Array }>) {
    const localParts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];
    let offset = 0;
    for (const file of files) {
        const name = encoder.encode(file.name);
        const checksum = crc32(file.data);
        const local = new Uint8Array(30 + name.length);
        const localView = new DataView(local.buffer);
        writeU32(localView, 0, 0x04034b50); writeU16(localView, 4, 20); writeU16(localView, 6, 0x0800);
        writeU16(localView, 8, 0); writeU32(localView, 14, checksum); writeU32(localView, 18, file.data.length); writeU32(localView, 22, file.data.length);
        writeU16(localView, 26, name.length); writeU16(localView, 28, 0); local.set(name, 30);
        localParts.push(local, file.data);

        const central = new Uint8Array(46 + name.length);
        const centralView = new DataView(central.buffer);
        writeU32(centralView, 0, 0x02014b50); writeU16(centralView, 4, 20); writeU16(centralView, 6, 20); writeU16(centralView, 8, 0x0800);
        writeU16(centralView, 10, 0); writeU32(centralView, 16, checksum); writeU32(centralView, 20, file.data.length); writeU32(centralView, 24, file.data.length);
        writeU16(centralView, 28, name.length); writeU16(centralView, 30, 0); writeU16(centralView, 32, 0); writeU16(centralView, 34, 0); writeU16(centralView, 36, 0);
        writeU32(centralView, 38, 0); writeU32(centralView, 42, offset); central.set(name, 46);
        centralParts.push(central);
        offset += local.length + file.data.length;
    }
    const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    writeU32(endView, 0, 0x06054b50); writeU16(endView, 4, 0); writeU16(endView, 6, 0); writeU16(endView, 8, files.length); writeU16(endView, 10, files.length);
    writeU32(endView, 12, centralSize); writeU32(endView, 16, offset); writeU16(endView, 20, 0);
    return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

function photoExtension(contentType: string) {
    if (contentType.includes('png')) return '.png';
    if (contentType.includes('webp')) return '.webp';
    if (contentType.includes('heic')) return '.heic';
    return '.jpg';
}

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
    const [sharing, setSharing] = useState(false);
    const [shareMessage, setShareMessage] = useState('');
    const [error, setError] = useState(false);
    const labels = language === 'lt'
        ? { open: 'Peržiūrėti nuotraukas', close: 'Uždaryti', previous: 'Ankstesnė', next: 'Kita', error: 'Nuotraukų nepavyko įkelti. Bandykite dar kartą, kai serveris vėl veiks.', loading: 'Įkeliama…', original: 'Atidaryti visu dydžiu', photo: 'Nuotrauka', delete: 'Ištrinti nuotrauką', confirm: 'Ar tikrai norite ištrinti?', failed: 'Nuotraukos nepavyko ištrinti.', share: 'Siųsti nuotraukas', sharing: 'Ruošiamas failas…', shared: 'Pasirinkite programą, kuria norite siųsti.', downloaded: 'ZIP failas atsisiųstas.', shareFailed: 'Nepavyko paruošti nuotraukų siuntimui.' }
        : language === 'da'
        ? { open: 'Se billeder', close: 'Luk', previous: 'Forrige', next: 'Næste', error: 'Billederne kunne ikke indlæses. Prøv igen, når serveren er tilgængelig.', loading: 'Indlæser…', original: 'Åbn i fuld størrelse', photo: 'Billede', delete: 'Slet billede', confirm: 'Er du sikker på, at du vil slette?', failed: 'Billedet kunne ikke slettes.', share: 'Send billeder', sharing: 'Forbereder fil…', shared: 'Vælg appen til at sende billederne.', downloaded: 'ZIP-filen er hentet.', shareFailed: 'Billederne kunne ikke klargøres til deling.' }
        : language === 'en'
        ? { open: 'View photos', close: 'Close', previous: 'Previous', next: 'Next', error: 'Could not load photos. Try again when the server is available.', loading: 'Loading…', original: 'Open full size', photo: 'Photo', delete: 'Delete photo', confirm: 'Are you sure you want to delete it?', failed: 'The photo could not be deleted.', share: 'Send photos', sharing: 'Preparing file…', shared: 'Choose an app to send the photos.', downloaded: 'The ZIP file was downloaded.', shareFailed: 'Could not prepare the photos for sharing.' }
        : { open: 'Zobacz zdjęcia', close: 'Zamknij', previous: 'Poprzednie', next: 'Następne', error: 'Nie udało się wczytać zdjęć. Spróbuj ponownie, gdy serwer będzie dostępny.', loading: 'Wczytywanie…', original: 'Otwórz w pełnym rozmiarze', photo: 'Zdjęcie', delete: 'Usuń zdjęcie', confirm: 'Czy na pewno chcesz usunąć?', failed: 'Nie udało się usunąć zdjęcia.', share: 'Wyślij zdjęcia', sharing: 'Przygotowuję plik…', shared: 'Wybierz aplikację, przez którą chcesz wysłać zdjęcia.', downloaded: 'Plik ZIP został pobrany.', shareFailed: 'Nie udało się przygotować zdjęć do wysłania.' };

    useEffect(() => () => { objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current.clear(); }, []);

    async function readRemotePhotos() {
        const response = await fetch(`/api/entries/${encodeURIComponent(entryId)}/photos`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Photos unavailable');
        const data = await response.json() as { photos?: { id: string }[] };
        if (!Array.isArray(data.photos) || !data.photos.length) throw new Error('No photos');
        return data.photos.map((photo, index) => ({ id: photo.id, index, url: `/api/photos/${encodeURIComponent(photo.id)}` }));
    }

    async function open() {
        dialog.current?.showModal();
        objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current.clear();
        setLoading(true); setError(false); setSelected(0); setPhotos([]);
        try {
            if (files) {
                if (!files.length) throw new Error('No photos');
                setPhotos(files.map((file, index) => { const url = URL.createObjectURL(file); objectUrls.current.add(url); return { id: String(index), index, url }; }));
            } else setPhotos(await readRemotePhotos());
        } catch { setError(true); } finally { setLoading(false); }
    }

    async function sharePhotos() {
        setSharing(true); setShareMessage('');
        try {
            let archivePhotos: ArchivePhoto[];
            if (files) {
                if (!files.length) throw new Error('No photos');
                archivePhotos = files.map((file, index) => ({ name: file.name || `zdjecie-${index + 1}${photoExtension(file.type)}`, blob: file }));
            } else {
                const remotePhotos = photos.length ? photos : await readRemotePhotos();
                archivePhotos = await Promise.all(remotePhotos.map(async (photo, index) => {
                    const response = await fetch(photo.url, { cache: 'no-store' });
                    if (!response.ok) throw new Error('Photo unavailable');
                    const blob = await response.blob();
                    return { name: `zdjecie-${index + 1}${photoExtension(blob.type)}`, blob };
                }));
            }
            const zip = createZip(await Promise.all(archivePhotos.map(async photo => ({ name: photo.name, data: new Uint8Array(await photo.blob.arrayBuffer()) }))));
            const archive = new File([zip], `zdjecia-${entryId.slice(0, 8)}.zip`, { type: 'application/zip' });
            const shareData = { title: labels.share, text: labels.share, files: [archive] };
            if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
                try {
                    await navigator.share(shareData);
                    setShareMessage(labels.shared);
                    return;
                } catch (shareError) {
                    if ((shareError as DOMException).name === 'AbortError') return;
                }
            }
            const downloadUrl = URL.createObjectURL(archive);
            const link = document.createElement('a'); link.href = downloadUrl; link.download = archive.name; link.click();
            window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
            setShareMessage(labels.downloaded);
        } catch { setShareMessage(labels.shareFailed); } finally { setSharing(false); }
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
        <button className="photo-share" type="button" disabled={sharing} onClick={sharePhotos}>📦 {sharing ? labels.sharing : labels.share} ({count})</button>
        {shareMessage && <small className="photo-share-status" role="status">{shareMessage}</small>}
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
