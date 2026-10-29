'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';

import { PDFDocument, rgb } from 'pdf-lib';
import { buildReportPages } from './report-layout';
import { toLithuanian } from './locale-lt';

import fontkit from '@pdf-lib/fontkit';
import EntryPhotos from './EntryPhotos';

type Language = 'pl' | 'da' | 'en' | 'lt';
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> };

type User = {
    id?: string;
    teamId?: string;
    name: string;

    teamName: string;

    role: string;
    mustChangePin?: boolean;

    fullName?: string;

    defaultCompany?: string;

    defaultProject?: string;

    employeeNumber?: string;

    machine?: string;

    machineNumber?: string;

    language?: Language;

};

type Entry = {
    id: string;

    entryType: string;

    company: string;

    project: string;

    description: string;

    author: string;

    createdAt: number;

    photoCount: number;

    hours: string;

    kilometers: string;

    workDate: string;

    reportSlot?: 'auto' | 'upper' | 'lower';

    latitude?: string;

    longitude?: string;

    pending?: boolean;

    sourceLanguage?: Language;

};

type JoinRequest = {
    id: string;

    name: string;

    createdAt: number;
    status?: string;
    role?: string;

};

type Project = {
    id: string;

    name: string;

};

type DeviceEntry = Entry & { storage: 'device'; photos: File[]; owner?: string };
type ReportMachineSettings = {
    upperCompany: string;
    upperProject: string;
    upperFullName: string;
    upperEmployeeNumber: string;
    upperMachine: string;
    upperMachineNumber: string;
    lowerCompany: string;
    lowerProject: string;
    lowerFullName: string;
    lowerEmployeeNumber: string;
    lowerMachine: string;
    lowerMachineNumber: string;
};
type PendingEntry = {
    id: string;
    owner: string;
    entryType: 'timesheet' | 'worklog';
    company: string;
    project: string;
    description: string;
    hours: string;
    kilometers: string;
    reportSlot: 'auto' | 'upper' | 'lower';
    workDate: string;
    latitude: string;
    longitude: string;
    files: File[];
    createdAt: number;
    sourceLanguage: Language;
};

function ownerKey(value: Pick<User, 'id' | 'teamId' | 'name' | 'teamName'>) {
    return value.teamId && value.id ? `${value.teamId}:${value.id}` : `${value.teamName}:${value.name}`;
}

/**
 * Nazwa duńska jest dosłowną nazwą kratki z firmowego blankietu. Obok
 * pokazujemy jej tłumaczenie w języku aplikacji, aby użytkownik od razu
 * wiedział, gdzie dana wartość trafi na duńskim raporcie PDF.
 */
function reportFieldLabel(lang: Language, english: string, polish: string, danish: string, lithuanian: string) {
    const translation = lang === 'da' ? danish : lang === 'lt' ? lithuanian : lang === 'pl' ? polish : english;
    return translation === danish ? danish : `${danish} — ${translation}`;
}

function ownerCacheKey(kind: 'entries' | 'projects', value: Pick<User, 'id' | 'teamId' | 'name' | 'teamName'>) {
    return `dziennik-offline-${kind}-${encodeURIComponent(ownerKey(value))}`;
}

function ownsPending(item: PendingEntry, value: Pick<User, 'id' | 'teamId' | 'name' | 'teamName'>) {
    return item.owner === ownerKey(value) || item.owner === `${value.teamName}:${value.name}`;
}

function deviceDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('dziennik-robot-device', 2);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('worklogs')) db.createObjectStore('worklogs', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function readDeviceEntries(owner: User): Promise<DeviceEntry[]> {
    const db = await deviceDatabase();
    return new Promise((resolve, reject) => {
        const request = db.transaction('worklogs', 'readonly').objectStore('worklogs').getAll();
        request.onsuccess = () => resolve((request.result as DeviceEntry[]).filter(item => item.owner ? item.owner === ownerKey(owner) : item.author === owner.name));
        request.onerror = () => reject(request.error);
    });
}

async function writeDeviceEntry(entry: DeviceEntry): Promise<void> {
    const db = await deviceDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('worklogs', 'readwrite');
        transaction.objectStore('worklogs').put(entry);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
}

async function deleteDeviceEntry(id: string): Promise<void> {
    const db = await deviceDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('worklogs', 'readwrite');
        transaction.objectStore('worklogs').delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
}

async function readPendingEntries(): Promise<PendingEntry[]> {
    const db = await deviceDatabase();
    return new Promise((resolve, reject) => {
        const request = db.transaction('outbox', 'readonly').objectStore('outbox').getAll();
        request.onsuccess = () => resolve(request.result as PendingEntry[]);
        request.onerror = () => reject(request.error);
    });
}

async function writePendingEntry(entry: PendingEntry): Promise<void> {
    const db = await deviceDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('outbox', 'readwrite');
        transaction.objectStore('outbox').put(entry);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
}

async function deletePendingEntry(id: string): Promise<void> {
    const db = await deviceDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('outbox', 'readwrite');
        transaction.objectStore('outbox').delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
}

function localToday() { const now = new Date();
 return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
 }

function isoWeekKey(date: Date) {
    const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
    const year = value.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil((((value.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
}

function mondayForIsoWeek(key: string) {
    const match = /^(\d{4})-W(\d{2})$/.exec(key);
    if (!match) return null;
    const year = Number(match[1]), week = Number(match[2]);
    const jan4 = new Date(year, 0, 4, 12);
    jan4.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7);
    return jan4;
}

function timesheetDuplicateKey(entry: Entry) {
    return [entry.workDate, entry.company.trim().toLocaleLowerCase(), entry.project.trim().toLocaleLowerCase(), entry.reportSlot || 'auto'].join('\u0000');
}
const copy = {
    pl: { title: 'Dziennik Robót', team: 'Nazwa zespołu / budowy', name: 'Twoje imię', pin: 'Twój PIN', login: 'Wejdź do dziennika', loginHelp: 'Pierwsze wejście tworzy Twój profil. Następnym razem użyj tej samej nazwy, imienia i PIN-u.', wrong: 'Nieprawidłowy PIN albo dane.', invalid: 'Wpisz nazwę, imię oraz PIN z 4–8 cyfr.', pending: 'Prośba wysłana. Administrator musi Cię zatwierdzić.', temporaryExpired: 'PIN tymczasowy wygasł. Zadzwoń do administratora, aby wygenerował nowy.', rateLimited: 'Za dużo nieudanych prób. Spróbuj ponownie za około 15 minut.', admin: 'Prośby o dołączenie', approve: 'Zatwierdź', reject: 'Odrzuć', logout: 'Wyloguj', today: 'Dzisiejszy wpis', project: 'Budowa / ulica', projectPlaceholder: 'np. Ambolten 600, Kolding', work: 'Co zostało zrobione?', workPlaceholder: 'Napisz albo naciśnij mikrofon i opowiedz…', speak: 'Mów', listening: 'Słucham…', photo: 'Dodaj zdjęcia', location: 'Pobierz GPS', locating: 'Pobieram pozycję…', save: 'Zapisz i udostępnij', saving: 'Zapisuję…', recent: 'Wspólne wpisy', empty: 'Pierwszy wspólny wpis pojawi się tutaj.', gpsReady: 'Pozycja zapisana', gpsMissing: 'Bez GPS', photos: 'zdjęć', saved: 'Wpis zapisany — inni już go zobaczą', language: 'Język', voiceUnsupported: 'Głos nie jest dostępny w tej przeglądarce.' },
    da: { title: 'Arbejdsdagbog', team: 'Team / byggeplads', name: 'Dit navn', pin: 'Din PIN', login: 'Åbn dagbogen', loginHelp: 'Første login opretter din profil. Brug samme team, navn og PIN næste gang.', wrong: 'Forkert PIN eller oplysninger.', invalid: 'Indtast team, navn og en PIN på 4–8 cifre.', pending: 'Anmodningen er sendt. Administratoren skal godkende dig.', temporaryExpired: 'Den midlertidige PIN er udløbet. Kontakt administratoren for at få en ny.', rateLimited: 'For mange mislykkede forsøg. Prøv igen om cirka 15 minutter.', admin: 'Anmodninger om adgang', approve: 'Godkend', reject: 'Afvis', logout: 'Log ud', today: 'Dagens registrering', project: 'Arbejde / adresse', projectPlaceholder: 'f.eks. Ambolten 600, Kolding', work: 'Hvad blev udført?', workPlaceholder: 'Skriv eller tryk på mikrofonen og fortæl…', speak: 'Tal', listening: 'Lytter…', photo: 'Tilføj billeder', location: 'Hent GPS', locating: 'Finder position…', save: 'Gem og del', saving: 'Gemmer…', recent: 'Fælles registreringer', empty: 'Den første fælles registrering vises her.', gpsReady: 'Position gemt', gpsMissing: 'Uden GPS', photos: 'billeder', saved: 'Registreringen er gemt og delt', language: 'Sprog', voiceUnsupported: 'Tale er ikke tilgængelig i denne browser.' },
    en: { title: 'Work Log', team: 'Team / site name', name: 'Your name', pin: 'Your PIN', login: 'Open work log', loginHelp: 'Your first login creates a profile. Use the same team, name and PIN next time.', wrong: 'Incorrect PIN or details.', invalid: 'Enter a team, name and a 4–8 digit PIN.', pending: 'Request sent. The administrator must approve you.', temporaryExpired: 'The temporary PIN expired. Contact the administrator for a new one.', rateLimited: 'Too many failed attempts. Try again in about 15 minutes.', admin: 'Join requests', approve: 'Approve', reject: 'Reject', logout: 'Log out', today: "Today's entry", project: 'Site / address', projectPlaceholder: 'e.g. Ambolten 600, Kolding', work: 'What was completed?', workPlaceholder: 'Type or tap the microphone and describe the work…', speak: 'Speak', listening: 'Listening…', photo: 'Add photos', location: 'Get GPS', locating: 'Getting location…', save: 'Save and share', saving: 'Saving…', recent: 'Shared entries', empty: 'The first shared entry will appear here.', gpsReady: 'Location saved', gpsMissing: 'No GPS', photos: 'photos', saved: 'Entry saved and shared', language: 'Language', voiceUnsupported: 'Voice is unavailable in this browser.' },
    lt: { title: 'Darbo žurnalas', team: 'Komanda / statybvietė', name: 'Jūsų vardas', pin: 'Jūsų PIN kodas', login: 'Atidaryti žurnalą', loginHelp: 'Pirmą kartą prisijungus sukuriamas profilis. Kitą kartą naudokite tą pačią komandą, vardą ir PIN kodą.', wrong: 'Neteisingas PIN kodas arba duomenys.', invalid: 'Įveskite komandą, vardą ir 4–8 skaitmenų PIN kodą.', pending: 'Prašymas išsiųstas. Administratorius turi jį patvirtinti.', temporaryExpired: 'Laikinas PIN kodas nebegalioja. Paprašykite administratoriaus naujo.', rateLimited: 'Per daug nesėkmingų bandymų. Bandykite dar kartą maždaug po 15 minučių.', admin: 'Prisijungimo prašymai', approve: 'Patvirtinti', reject: 'Atmesti', logout: 'Atsijungti', today: 'Šios dienos įrašas', project: 'Statybvietė / adresas', projectPlaceholder: 'pvz., Ambolten 600, Kolding', work: 'Kas buvo atlikta?', workPlaceholder: 'Įrašykite arba paspauskite mikrofoną ir papasakokite apie darbą…', speak: 'Kalbėti', listening: 'Klausoma…', photo: 'Pridėti nuotraukų', location: 'Gauti GPS vietą', locating: 'Nustatoma vieta…', save: 'Išsaugoti ir bendrinti', saving: 'Išsaugoma…', recent: 'Bendri įrašai', empty: 'Čia bus rodomas pirmasis bendras įrašas.', gpsReady: 'Vieta išsaugota', gpsMissing: 'GPS nėra', photos: 'nuotraukų', saved: 'Įrašas išsaugotas ir bendrinamas', language: 'Kalba', voiceUnsupported: 'Šioje naršyklėje balso funkcija neveikia.' }
};

export default function Home() {
    const [lang, setLang] = useState<Language>('pl'), t = copy[lang];
    const [entryTranslations, setEntryTranslations] = useState<Record<string, string>>({});
    const [translatingEntries, setTranslatingEntries] = useState<Record<string, boolean>>({});
    const [translationErrors, setTranslationErrors] = useState<Record<string, boolean>>({});
    const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
    const [showInstallGuide, setShowInstallGuide] = useState(false);
    const [activePanel, setActivePanel] = useState<'home' | 'card' | 'report' | 'worklog' | 'shared' | 'team' | 'settings'>('home');
    const [user, setUser] = useState<User | null>(null), [loading, setLoading] = useState(true), [draftReady, setDraftReady] = useState(false);

    const [name, setName] = useState(''), [pin, setPin] = useState(''), [newPin, setNewPin] = useState(''), [authError, setAuthError] = useState(''), [temporaryPin, setTemporaryPin] = useState<{ name: string; pin: string } | null>(null);
    const [sharedProject, setSharedProject] = useState(''), [sharedScope, setSharedScope] = useState<'all' | 'mine'>('all');

    const [project, setProject] = useState(''), [projects, setProjects] = useState<Project[]>([]), [projectReportSlot, setProjectReportSlot] = useState<'' | 'upper' | 'lower'>(''), [company, setCompany] = useState(''), [work, setWork] = useState(''), [hours, setHours] = useState(''), [kilometers, setKilometers] = useState(''), [workDate, setWorkDate] = useState(localToday()), [dateWasEdited, setDateWasEdited] = useState(false), [fullName, setFullName] = useState(''), [defaultCompany, setDefaultCompany] = useState(''), [defaultProject, setDefaultProject] = useState(''), [employeeNumber, setEmployeeNumber] = useState(''), [machine, setMachine] = useState(''), [machineNumber, setMachineNumber] = useState(''), [files, setFiles] = useState<File[]>([]), [worklogStorage, setWorklogStorage] = useState<'cloud' | 'device'>('cloud'), [deviceEntries, setDeviceEntries] = useState<DeviceEntry[]>([]), [pendingEntries, setPendingEntries] = useState<PendingEntry[]>([]), [position, setPosition] = useState<{
        lat: number;

        lng: number;

    } | null>(null), [locating, setLocating] = useState(false), [listening, setListening] = useState(false), [saving, setSaving] = useState(false), [notice, setNotice] = useState(''), [pdfPreviewUrl, setPdfPreviewUrl] = useState(''), [weekOffset, setWeekOffset] = useState(0), [entries, setEntries] = useState<Entry[]>([]), [requests, setRequests] = useState<JoinRequest[]>([]), [teamUsers, setTeamUsers] = useState<JoinRequest[]>([]);
    const [reportMachineSettings, setReportMachineSettings] = useState<ReportMachineSettings>({ upperCompany: '', upperProject: '', upperFullName: '', upperEmployeeNumber: '', upperMachine: '', upperMachineNumber: '', lowerCompany: '', lowerProject: '', lowerFullName: '', lowerEmployeeNumber: '', lowerMachine: '', lowerMachineNumber: '' });
    const [reportSettingsNotice, setReportSettingsNotice] = useState('');
    const [reportHeaderSlot, setReportHeaderSlot] = useState<'upper' | 'lower'>('upper');
    const [reportSettingsDirty, setReportSettingsDirty] = useState(false);
    const [reportDirtySlots, setReportDirtySlots] = useState<Array<'upper' | 'lower'>>([]);
    const [reportSettingsSaving, setReportSettingsSaving] = useState(false);
    const [periodStartKey, setPeriodStartKey] = useState(() => isoWeekKey(new Date()));
    const [periodEndKey, setPeriodEndKey] = useState(() => isoWeekKey(new Date()));
    const reportHeaderFieldKeys = reportHeaderSlot === 'upper'
        ? { company: 'upperCompany', project: 'upperProject', fullName: 'upperFullName', employeeNumber: 'upperEmployeeNumber', machine: 'upperMachine', machineNumber: 'upperMachineNumber' } as const
        : { company: 'lowerCompany', project: 'lowerProject', fullName: 'lowerFullName', employeeNumber: 'lowerEmployeeNumber', machine: 'lowerMachine', machineNumber: 'lowerMachineNumber' } as const;
    const companyForReportSlot = (slot: '' | 'upper' | 'lower') => slot === 'upper'
        ? reportMachineSettings.upperCompany
        : slot === 'lower'
            ? reportMachineSettings.lowerCompany
            : '';
    function updateReportHeaderField(field: keyof typeof reportHeaderFieldKeys, value: string) {
        const key = reportHeaderFieldKeys[field];
        setReportMachineSettings(current => ({ ...current, [key]: value }));
        setReportDirtySlots(current => current.includes(reportHeaderSlot) ? current : [...current, reportHeaderSlot]);
        setReportSettingsDirty(true);
        setReportSettingsNotice('');
    }
    const pendingSyncing = useRef(false);
    const activeUser = useRef<User | null>(user);
    activeUser.current = user;

    const date = useMemo(() => new Intl.DateTimeFormat(lang === 'da' ? 'da-DK' : lang === 'en' ? 'en-GB' : lang === 'lt' ? 'lt-LT' : 'pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()), [lang]);
    const canManageTeam = user?.role === 'admin' || user?.role === 'manager';

    useEffect(() => { document.documentElement.lang = lang === 'lt' ? 'lt' : lang === 'da' ? 'da' : lang === 'en' ? 'en' : 'pl'; }, [lang]);
    useEffect(() => { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); }, []);
    useEffect(() => {
        const standalone = window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
        if (!standalone && localStorage.getItem('dziennik-install-help-seen') !== '1') setShowInstallGuide(true);
        const captureInstallPrompt = (event: Event) => {
            event.preventDefault();
            setInstallPrompt(event as InstallPromptEvent);
        };
        window.addEventListener('beforeinstallprompt', captureInstallPrompt);
        return () => window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
    }, []);
    useEffect(() => { document.querySelector<HTMLDetailsElement>('.unified-entry')?.removeAttribute('open'); document.querySelector<HTMLDetailsElement>('.fixed-data-fold')?.removeAttribute('open');
 const input = document.querySelector<HTMLInputElement>('input[type="date"]');
 const markDateAsEdited = () => setDateWasEdited(true);
 input?.addEventListener('change', markDateAsEdited);
 return () => input?.removeEventListener('change', markDateAsEdited);
 }, [user]);

    useEffect(() => { try { const savedLanguage = localStorage.getItem('dziennik-language'); if (savedLanguage === 'pl' || savedLanguage === 'da' || savedLanguage === 'en' || savedLanguage === 'lt') setLang(savedLanguage); } catch {} fetch('/api/session').then(r => { if (r.status === 401 || r.status === 403) { localStorage.removeItem('dziennik-offline-user'); return { user: null }; } if (!r.ok) throw new Error('offline'); return r.json(); }).then(d => { if (d?.user) {
        activeUser.current = d.user;
        setUser(d.user);
        if (d.user.language) { setLang(d.user.language); localStorage.setItem('dziennik-language', d.user.language); }
        localStorage.setItem('dziennik-offline-user', JSON.stringify(d.user));

        syncProfile(d.user);

        loadEntries(d.user);
        readDeviceEntries(d.user).then(setDeviceEntries).catch(() => {});
        readPendingEntries().then(all => setPendingEntries(all.filter(item => ownsPending(item, d.user)))).catch(() => {});

        loadProjects(d.user);

        if (d.user.role === 'admin' || d.user.role === 'manager')
            loadRequests();

    } }).catch(() => { try {
        const cached = JSON.parse(localStorage.getItem('dziennik-offline-user') || 'null');
        if (cached?.name) { activeUser.current = cached; setUser(cached); if (cached.language) setLang(cached.language); syncProfile(cached); loadEntries(cached); loadProjects(cached); readDeviceEntries(cached).then(setDeviceEntries).catch(() => {}); readPendingEntries().then(all => setPendingEntries(all.filter(item => ownsPending(item, cached)))).catch(() => {}); }
    } catch {} }).finally(() => setLoading(false));
 }, []);

    useEffect(() => {
        const retry = () => { if (navigator.onLine && user) void syncPendingEntries(); };
        window.addEventListener('online', retry);
        const timer = window.setInterval(retry, 30000);
        retry();
        return () => { window.removeEventListener('online', retry); window.clearInterval(timer); };
    }, [user]);
    useEffect(() => {
        if (!user) return;
        const owned = pendingEntries.filter(pending => ownsPending(pending, user));
        setEntries(current => [...current.filter(entry => !entry.pending && !owned.some(pending => pending.id === entry.id)), ...owned.map(pendingAsEntry)]);
    }, [pendingEntries, user]);

    useEffect(() => {
        setDraftReady(false);
        if (!user) return;
        let draft: Record<string, any> = {};
        try { draft = JSON.parse(localStorage.getItem(`worklog_draft:${ownerKey(user)}`) || '{}'); } catch {}
        setCompany(draft.company ?? user.defaultCompany ?? '');
        setProject(draft.project ?? user.defaultProject ?? '');
        setWork(draft.work ?? ''); setHours(draft.hours ?? ''); setKilometers(draft.kilometers ?? '');
        setFiles([]); setPosition(null);
        setDateWasEdited(Boolean(draft.dateWasEdited));
        setWorkDate(draft.dateWasEdited && draft.workDate ? draft.workDate : localToday());
        setDraftReady(true);
    }, [user]);
    useEffect(() => { if (draftReady && user) {
        try { localStorage.setItem(`worklog_draft:${ownerKey(user)}`, JSON.stringify({ company, project, work, hours, kilometers, workDate: dateWasEdited ? workDate : '', dateWasEdited })); } catch {}
    } }, [draftReady, user, company, project, work, hours, kilometers, workDate, dateWasEdited]);

    function syncProfile(value: User) { setFullName(value.fullName ?? '');
 setDefaultCompany(value.defaultCompany ?? '');
 setCompany(value.defaultCompany ?? '');
 setDefaultProject(value.defaultProject ?? '');
 if (value.defaultProject)
        setProject(value.defaultProject);
 setEmployeeNumber(value.employeeNumber ?? '');
 setMachine(value.machine ?? '');
 setMachineNumber(value.machineNumber ?? '');
 }
    function changeLanguage(next: Language) {
        setLang(next);
        try { localStorage.setItem('dziennik-language', next); } catch {}
        if (!user) return;
        const updated = { ...user, language: next };
        activeUser.current = updated;
        setUser(updated);
        localStorage.setItem('dziennik-offline-user', JSON.stringify(updated));
        void fetch('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName, defaultCompany, defaultProject, employeeNumber, machine, machineNumber, language: next }) });
    }

    async function installApp() {
        if (!installPrompt) {
            setShowInstallGuide(true);
            return;
        }
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        setInstallPrompt(null);
        if (choice.outcome === 'accepted') {
            setShowInstallGuide(false);
            localStorage.setItem('dziennik-install-help-seen', '1');
        }
    }

    function dismissInstallGuide() {
        setShowInstallGuide(false);
        localStorage.setItem('dziennik-install-help-seen', '1');
    }

    function installGuide() {
        return <>
            <button className="install-help-trigger" type="button" onClick={installApp}>{installPrompt ? (lang === 'lt' ? 'Įdiegti dabar' : lang === 'da' ? 'Installer nu' : lang === 'en' ? 'Install now' : 'Zainstaluj teraz') : (lang === 'lt' ? 'Kaip įdiegti' : lang === 'da' ? 'Sådan installerer du' : lang === 'en' ? 'How to install' : 'Jak zainstalować')}</button>
            {showInstallGuide && <aside className="install-help-card" role="status">
                <strong>{lang === 'lt' ? 'Pridėkite Darbo žurnalą prie pradžios ekrano' : lang === 'da' ? 'Føj Arbejdsdagbog til startskærmen' : lang === 'en' ? 'Add Work Log to your home screen' : 'Dodaj Dziennik Robót do ekranu głównego'}</strong>
                <p>{lang === 'lt' ? 'Android: naršyklės meniu ⋮ → „Įdiegti programą“ arba „Pridėti prie pradžios ekrano“. iPhone: atidarykite nuorodą „Safari“, palieskite „Bendrinti“ → „Įtraukti į pradžios ekraną“ → „Pridėti“. Kompiuteryje ieškokite diegimo piktogramos adreso juostoje arba naršyklės meniu.' : lang === 'da' ? 'Android: browsermenuen ⋮ → „Installer appen“ eller „Føj til startskærmen“. iPhone: åbn linket i Safari, tryk på Del → Føj til hjemmeskærm → Tilføj. På computer: brug installationsikonet i adresselinjen eller browsermenuen.' : lang === 'en' ? 'Android: browser menu ⋮ → “Install app” or “Add to Home screen”. iPhone: open the link in Safari, tap Share → “Add to Home Screen” → Add. On a computer, look for the install icon in the address bar or browser menu.' : 'Android: menu przeglądarki ⋮ → „Zainstaluj aplikację” albo „Dodaj do ekranu głównego”. iPhone: otwórz link w Safari, stuknij Udostępnij → „Do ekranu początkowego” → Dodaj. Na komputerze szukaj ikony instalacji przy pasku adresu albo w menu przeglądarki.'}</p>
                <div className="install-help-actions">
                    {installPrompt && <button className="secondary-button" type="button" onClick={installApp}>{lang === 'lt' ? 'Įdiegti dabar' : lang === 'da' ? 'Installer nu' : lang === 'en' ? 'Install now' : 'Zainstaluj teraz'}</button>}
                    <button className="secondary-button" type="button" onClick={dismissInstallGuide}>{lang === 'lt' ? 'Supratau' : lang === 'da' ? 'Forstået' : lang === 'en' ? 'Got it' : 'Rozumiem'}</button>
                </div>
            </aside>}
        </>;
    }
    async function translateEntry(entry: Entry) {
        if (entryTranslations[entry.id]) { setEntryTranslations(current => { const next = { ...current }; delete next[entry.id]; return next; }); return; }
        setTranslatingEntries(current => ({ ...current, [entry.id]: true }));
        setTranslationErrors(current => ({ ...current, [entry.id]: false }));
        try {
            const response = await fetch('/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entryId: entry.id }), signal: AbortSignal.timeout(125_000) });
            const result = await response.json().catch(() => ({})) as { translation?: string };
            if (!response.ok || !result.translation) throw new Error('translation_failed');
            setEntryTranslations(current => ({ ...current, [entry.id]: result.translation! }));
        } catch {
            setTranslationErrors(current => ({ ...current, [entry.id]: true }));
        } finally {
            setTranslatingEntries(current => ({ ...current, [entry.id]: false }));
        }
    }
    async function loadEntries(value: User | null = user) { try { const r = await fetch('/api/entries');
 if (!value || !activeUser.current || ownerKey(value) !== ownerKey(activeUser.current)) return;
 if (r.status === 401 || r.status === 403) { if (value) localStorage.removeItem(ownerCacheKey('entries', value)); setEntries([]); return; }
 if (!r.ok) throw new Error('offline');
 if (r.ok) {
        const d = await r.json(), rows = d.entries as Entry[], counts = rows.filter(e => e.entryType === 'timesheet').reduce<Record<string, number>>((all, e) => { const key = timesheetDuplicateKey(e); all[key] = (all[key] ?? 0) + 1;
 return all;
 }, {});

        const normalized = rows.map(e => { const createdDate = new Date(e.createdAt), created = Number.isFinite(createdDate.getTime()) ? new Date(createdDate.getTime() - createdDate.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : e.workDate;
 const daysApart = Math.round((new Date(created + 'T12:00:00').getTime() - new Date(e.workDate + 'T12:00:00').getTime()) / 86400000);
 return e.entryType === 'timesheet' && counts[timesheetDuplicateKey(e)] > 1 && daysApart > 0 && daysApart <= 7 ? { ...e, workDate: created } : e;
 }); setEntries(normalized); if (value) localStorage.setItem(ownerCacheKey('entries', value), JSON.stringify(normalized));

    } } catch { if (!value || !activeUser.current || ownerKey(value) !== ownerKey(activeUser.current)) return; try { const cached = value ? JSON.parse(localStorage.getItem(ownerCacheKey('entries', value)) || '[]') : []; if (Array.isArray(cached)) setEntries(cached); } catch {} } }
    async function loadProjects(value: User | null = user) { try { const r = await fetch('/api/projects');
 if (!value || !activeUser.current || ownerKey(value) !== ownerKey(activeUser.current)) return;
 if (r.status === 401 || r.status === 403) { if (value) localStorage.removeItem(ownerCacheKey('projects', value)); setProjects([]); return; }
 if (!r.ok) throw new Error('offline');
 if (r.ok) {
        const d = await r.json();

        setProjects(d.projects); if (value) localStorage.setItem(ownerCacheKey('projects', value), JSON.stringify(d.projects));

        if (!project && d.projects.length)
            setProject(d.projects[0].name);

    } } catch { if (!value || !activeUser.current || ownerKey(value) !== ownerKey(activeUser.current)) return; try { const cached = value ? JSON.parse(localStorage.getItem(ownerCacheKey('projects', value)) || '[]') : []; if (Array.isArray(cached)) setProjects(cached); } catch {} } }
    function pendingAsEntry(p: PendingEntry): Entry {
        return { id: p.id, entryType: p.entryType, company: p.company, project: p.project, description: p.description, author: user?.name ?? '', createdAt: p.createdAt, photoCount: p.files.length, hours: p.hours, kilometers: p.kilometers, workDate: p.workDate, reportSlot: p.reportSlot, latitude: p.latitude, longitude: p.longitude, pending: true, sourceLanguage: p.sourceLanguage ?? lang };
    }
    function pendingForm(p: PendingEntry) {
        const form = new FormData();
        form.set('id', p.id);
        form.set('owner', p.owner);
        form.set('entryType', p.entryType);
        form.set('company', p.company);
        form.set('project', p.project);
        form.set('description', p.description);
        form.set('sourceLanguage', p.sourceLanguage ?? lang);
        form.set('hours', p.hours);
        form.set('kilometers', p.kilometers);
        form.set('reportSlot', p.reportSlot);
        form.set('workDate', p.workDate);
        if (p.latitude) form.set('latitude', p.latitude);
        if (p.longitude) form.set('longitude', p.longitude);
        p.files.forEach(file => form.append('photos', file));
        return form;
    }
    async function syncPendingEntries() {
        if (!navigator.onLine || !user || pendingSyncing.current) return;
        pendingSyncing.current = true;
        const pending = (await readPendingEntries().catch(() => [] as PendingEntry[])).filter(item => ownsPending(item, user));
        if (!pending.length) { setPendingEntries([]); pendingSyncing.current = false; return; }
        try { for (const item of pending) {
            if (!activeUser.current || ownerKey(activeUser.current) !== ownerKey(user)) break;
            try {
                const response = await fetch('/api/entries', { method: 'POST', body: pendingForm(item), signal: AbortSignal.timeout(20000) });
                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) break;
                    continue;
                }
                const result = await response.json().catch(() => null);
                if (!result?.ok || result.complete === false) break;
                await deletePendingEntry(item.id);
            } catch {
                break;
            }
        }
        const remaining = (await readPendingEntries().catch(() => [] as PendingEntry[])).filter(item => ownsPending(item, user));
        if (!activeUser.current || ownerKey(activeUser.current) !== ownerKey(user)) return;
        setPendingEntries(remaining);
        if (remaining.length !== pending.length) await loadEntries(user);
        } finally { pendingSyncing.current = false; }
    }
    async function loadRequests() { const r = await fetch('/api/admin/requests');
 if (r.ok) {
        const d = await r.json();

        setRequests(d.requests); setTeamUsers(d.users ?? []);

    } }
    async function decide(id: string, action: 'approve' | 'reject') { await fetch('/api/admin/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action }) });
 await loadRequests();
 }
    async function resetMemberPin(member: JoinRequest) {
        const accepted = window.confirm(lang === 'da' ? `Nulstil PIN for ${member.name}?` : lang === 'en' ? `Reset the PIN for ${member.name}?` : `Zresetować PIN użytkownika ${member.name}?`);
        if (!accepted) return;
        const response = await fetch('/api/admin/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: member.id, action: 'resetPin' }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.temporaryPin) { setNotice(lang === 'da' ? 'PIN kunne ikke nulstilles' : lang === 'en' ? 'Could not reset the PIN' : lang === 'lt' ? toLithuanian('Nie udało się zresetować PIN-u') : 'Nie udało się zresetować PIN-u'); return; }
        setTemporaryPin({ name: member.name, pin: result.temporaryPin });
    }
    async function changeMemberRole(member: JoinRequest, action: 'grantManager' | 'revokeManager') {
        const giving = action === 'grantManager';
        const accepted = window.confirm(giving
            ? `Nadać użytkownikowi ${member.name} uprawnienia administratora brygady?`
            : `Odebrać użytkownikowi ${member.name} uprawnienia administratora brygady?`);
        if (!accepted) return;
        const response = await fetch('/api/admin/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: member.id, action }) });
        if (!response.ok) { setNotice('Nie udało się zmienić uprawnień.'); return; }
        setNotice(giving ? `Uprawnienia administratora brygady nadano użytkownikowi ${member.name}.` : `Uprawnienia administratora brygady odebrano użytkownikowi ${member.name}.`);
        await loadRequests();
    }
    async function login() { setAuthError('');
 const r = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, pin, language: lang }) });
 const d = await r.json().catch(() => ({}));
 if (r.status === 202) {
        setAuthError(t.pending);

        return;

    } if (r.ok) {
        activeUser.current = d.user;
        setUser(d.user);
        localStorage.setItem('dziennik-offline-user', JSON.stringify(d.user));
        readPendingEntries().then(all => setPendingEntries(all.filter(item => ownsPending(item, d.user)))).catch(() => {});

        syncProfile(d.user);

        setPin('');

        await loadEntries(d.user);

        await loadProjects(d.user);

        if (d.user.role === 'admin' || d.user.role === 'manager')
            await loadRequests();

    }
    else
        setAuthError(d.error === 'too_many_attempts' ? t.rateLimited : d.error === 'temporary_pin_expired' ? t.temporaryExpired : d.error === 'wrong_pin' ? t.wrong : t.invalid);
 }
    async function saveProfile() { await fetch('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName, defaultCompany, defaultProject, employeeNumber, machine, machineNumber, language: lang }) });
 if (!company)
        setCompany(defaultCompany);
 if (defaultProject)
        setProject(defaultProject);
 setNotice('Dane do raportu zapisane');
 }
    async function changePin() { if (!/^\d{4,8}$/.test(newPin)) {
        setNotice('PIN musi mieć od 4 do 8 cyfr');

        return;

    } const r = await fetch('/api/pin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: newPin }) });
 const result = await r.json().catch(() => ({}));
 if (r.ok) {
        setNewPin('');
        if (user?.mustChangePin) {
            const updated = { ...user, mustChangePin: false };
            activeUser.current = updated;
            setUser(updated);
            localStorage.setItem('dziennik-offline-user', JSON.stringify(updated));
            await loadEntries(updated);
            await loadProjects(updated);
        }

        setNotice('Nowy PIN zapisany');

    } else if (result.error === 'choose_new_pin') setNotice(lang === 'da' ? 'Vælg en anden PIN end den midlertidige.' : lang === 'en' ? 'Choose a PIN different from the temporary one.' : lang === 'lt' ? toLithuanian('Wybierz PIN inny niż tymczasowy.') : 'Wybierz PIN inny niż tymczasowy.'); }
    async function logout() {
 activeUser.current = null; setUser(null); setEntries([]); setDeviceEntries([]); setPendingEntries([]); setProjects([]); setTeamUsers([]); setRequests([]); setDraftReady(false);
 setWork(''); setHours(''); setKilometers(''); setProject(''); setCompany(''); setFiles([]);
 localStorage.removeItem('dziennik-offline-user');
 try { await fetch('/api/logout', { method: 'POST' }); } catch {}
 }
    function addPhotos(e: ChangeEvent<HTMLInputElement>) { setFiles(current => [...current, ...Array.from(e.target.files ?? [])].slice(0, 8));
 }
    function getLocation() { setLocating(true);
 navigator.geolocation.getCurrentPosition(r => { setPosition({ lat: r.coords.latitude, lng: r.coords.longitude });
 setLocating(false);
 }, () => setLocating(false), { enableHighAccuracy: true, timeout: 12000 });
 }
    function startVoice() { const R = (window as typeof window & {
        webkitSpeechRecognition?: new () => any;

    }).webkitSpeechRecognition;
 if (!R) {
        setNotice(t.voiceUnsupported);

        return;

    } const rec = new R();
 rec.lang = lang === 'pl' ? 'pl-PL' : lang === 'da' ? 'da-DK' : lang === 'lt' ? 'lt-LT' : 'en-GB';
 rec.onstart = () => setListening(true);
 rec.onend = () => setListening(false);
 rec.onresult = (e: any) => setWork(v => `${v}${v ? ' ' : ''}${e.results[0][0].transcript}`);
 rec.start();
 }
    async function saveDeviceWorklog(entryDate: string) {
        if (!user) return;
        setSaving(true);
        const entry: DeviceEntry = { id: crypto.randomUUID(), entryType: 'worklog', company, project: project.trim(), description: work.trim(), author: user.name, createdAt: Date.now(), photoCount: files.length, hours: '0', kilometers: '0', workDate: entryDate, latitude: position ? String(position.lat) : '', longitude: position ? String(position.lng) : '', storage: 'device', photos: files, owner: ownerKey(user), sourceLanguage: lang };
        try {
            await writeDeviceEntry(entry);
            setDeviceEntries(current => [entry, ...current]);
            setWork('');
            setFiles([]);
            setPosition(null);
            setWorkDate(localToday());
            setDateWasEdited(false);
            setNotice(lang === 'da' ? 'Kun gemt på denne telefon' : lang === 'en' ? 'Saved only on this device' : lang === 'lt' ? toLithuanian('Zapisano tylko na tym telefonie') : 'Zapisano tylko na tym telefonie');
        } catch {
            setNotice(lang === 'da' ? 'Kunne ikke gemme på telefonen' : lang === 'en' ? 'Could not save on this device' : lang === 'lt' ? toLithuanian('Nie udało się zapisać na telefonie') : 'Nie udało się zapisać na telefonie');
        } finally {
            setSaving(false);
            setTimeout(() => setNotice(''), 2500);
        }
    }
    async function saveEntry(entryType: 'timesheet' | 'worklog') { const entryDate = dateWasEdited ? workDate : localToday();
 if (!project.trim() || !entryDate || (entryType === 'timesheet' ? (!hours && !kilometers) : !work.trim()))
        return;
 if (entryType === 'timesheet' && projectReportSlot !== 'upper' && projectReportSlot !== 'lower') {
        setNotice(lang === 'da' ? 'Vælg øverste eller nederste rapport.' : lang === 'en' ? 'Choose the upper or lower report.' : lang === 'lt' ? toLithuanian('Wybierz górny albo dolny raport.') : 'Wybierz górny albo dolny raport.');
        return;
    }
 if (entryType === 'worklog' && worklogStorage === 'device') { await saveDeviceWorklog(entryDate); return; }
 const entryCompany = entryType === 'timesheet' ? (companyForReportSlot(projectReportSlot) || defaultCompany || company) : company;
 const pending: PendingEntry = { id: crypto.randomUUID(), owner: user ? ownerKey(user) : '', entryType, company: entryCompany, project: project.trim(), description: entryType === 'worklog' ? work.trim() : '', hours: entryType === 'timesheet' ? hours : '0', kilometers: entryType === 'timesheet' ? kilometers : '0', reportSlot: entryType === 'timesheet' ? projectReportSlot as 'upper' | 'lower' : 'auto', workDate: entryDate, latitude: entryType === 'worklog' && position ? String(position.lat) : '', longitude: entryType === 'worklog' && position ? String(position.lng) : '', files: entryType === 'worklog' ? files : [], createdAt: Date.now(), sourceLanguage: lang };
 setSaving(true);
 try { await writePendingEntry(pending); } catch { setSaving(false); setNotice(lang === 'pl' ? 'Nie udało się zapisać na urządzeniu. Nie zamykaj formularza.' : lang === 'da' ? 'Kunne ikke gemme på enheden. Hold formularen åben.' : 'Could not save on this device. Keep the form open.'); return; }
 setPendingEntries(current => [...current, pending]);
 let response: Response | null = null;
 try { response = await fetch('/api/entries', { method: 'POST', body: pendingForm(pending), signal: AbortSignal.timeout(20000) }); } catch { response = null; }
 if (!response || response.status >= 500 || response.status === 429) {
        setEntries(current => [pendingAsEntry(pending), ...current]);
        setSaving(false);
        setNotice(lang === 'da' ? 'Gemt på telefonen — venter på serveren' : lang === 'en' ? 'Saved on this device — waiting for the server' : lang === 'lt' ? toLithuanian('Zapisano na telefonie — czeka na serwer') : 'Zapisano na telefonie — czeka na serwer');
        setTimeout(() => setNotice(''), 3500);
        return;
    }
 const r = response;
 setSaving(false);
 const result = await r.json().catch(() => null);
 if (r.ok && result?.complete === false) {
        setNotice(lang === 'da' ? 'Gemmer billeder — venter på serveren' : lang === 'en' ? 'Photos are still waiting for the server' : lang === 'lt' ? toLithuanian('Zdjęcia czekają na serwer') : 'Zdjęcia czekają na serwer');
        setTimeout(() => setNotice(''), 3500);
        return;
    }
 if (r.ok) {
        await deletePendingEntry(pending.id);
        setPendingEntries(current => current.filter(item => item.id !== pending.id));
        setWorkDate(localToday());

        setDateWasEdited(false);

        if (!projects.some(p => p.name.toLocaleLowerCase() === project.trim().toLocaleLowerCase())) {
            await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: project.trim() }) });

            await loadProjects(user);

        }
        if (entryType === 'timesheet') {
            setHours('');
            setKilometers('');
            setProjectReportSlot('');

            setNotice('Godziny zapisane');

        }
        else {
            setWork('');

            setFiles([]);

            setPosition(null);

            setNotice(t.saved);

        }
        await loadEntries(user);

        setTimeout(() => setNotice(''), 2500);

    } else if (r.status !== 401 && r.status !== 403) {
        await deletePendingEntry(pending.id);
        setPendingEntries(current => current.filter(item => item.id !== pending.id));
        setNotice(lang === 'da' ? 'Kunne ikke gemme registreringen' : lang === 'en' ? 'The entry could not be saved' : lang === 'lt' ? toLithuanian('Nie udało się zapisać wpisu') : 'Nie udało się zapisać wpisu');
        setTimeout(() => setNotice(''), 3500);
    } }
    const effectiveWorkDate = (entry: Entry) => { const createdDate = new Date(entry.createdAt);
 const created = Number.isFinite(createdDate.getTime()) ? new Date(createdDate.getTime() - createdDate.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : entry.workDate;
 const duplicated = entries.some(other => other.id !== entry.id && other.entryType === 'timesheet' && timesheetDuplicateKey(other) === timesheetDuplicateKey(entry));
 return duplicated && created > entry.workDate ? created : entry.workDate;
 };

    const monday = new Date();

    monday.setHours(0, 0, 0, 0);

    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + weekOffset * 7);

    const reportWeekKey = isoWeekKey(monday);
    useEffect(() => {
        if (!user?.id) return;
        let active = true;
        const cacheKey = `dziennik-report-machines:${ownerKey(user)}:${reportWeekKey}`;
        setReportSettingsDirty(false);
        setReportDirtySlots([]);
        setReportSettingsNotice('');
        const fallback: ReportMachineSettings = {
            upperCompany: user.defaultCompany ?? '', upperProject: user.defaultProject ?? '', upperFullName: user.fullName ?? '', upperEmployeeNumber: user.employeeNumber ?? '', upperMachine: user.machine ?? '', upperMachineNumber: user.machineNumber ?? '',
            lowerCompany: user.defaultCompany ?? '', lowerProject: user.defaultProject ?? '', lowerFullName: user.fullName ?? '', lowerEmployeeNumber: user.employeeNumber ?? '', lowerMachine: user.machine ?? '', lowerMachineNumber: user.machineNumber ?? ''
        };
        setReportMachineSettings(fallback);
        try {
            const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null') as ReportMachineSettings | null;
            if (cached && active) setReportMachineSettings({ ...fallback, ...cached });
        } catch {}
        fetch(`/api/report-settings?weekKey=${encodeURIComponent(reportWeekKey)}`, { cache: 'no-store' })
            .then(response => { if (!response.ok) throw new Error('settings_unavailable'); return response.json(); })
            .then(data => {
                if (!active || !data?.settings) return;
                const serverSettings = data.settings as Partial<ReportMachineSettings> & { headerFieldsConfigured?: number | boolean };
                const saved = { ...fallback, ...serverSettings } as ReportMachineSettings;
                if (!serverSettings.headerFieldsConfigured) {
                    for (const key of ['upperCompany','upperProject','upperFullName','upperEmployeeNumber','lowerCompany','lowerProject','lowerFullName','lowerEmployeeNumber'] as const) saved[key] = fallback[key];
                }
                setReportMachineSettings(saved);
                try { localStorage.setItem(cacheKey, JSON.stringify(saved)); } catch {}
            }).catch(() => {});
        return () => { active = false; };
    }, [user?.id, user?.machine, user?.machineNumber, reportWeekKey]);

    async function saveReportMachineSettings() {
        if (!user?.id || !reportSettingsDirty || reportSettingsSaving) return;
        const cacheKey = `dziennik-report-machines:${ownerKey(user)}:${reportWeekKey}`;
        setReportSettingsSaving(true);
        setReportSettingsNotice('');
        try {
            const response = await fetch('/api/report-settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weekKey: reportWeekKey, slot: reportHeaderSlot, ...reportMachineSettings }) });
            if (!response.ok) throw new Error('settings_save_failed');
            try { localStorage.setItem(cacheKey, JSON.stringify(reportMachineSettings)); } catch {}
            setReportDirtySlots(current => current.filter(slot => slot !== reportHeaderSlot));
            setReportSettingsDirty(false);
            setReportSettingsNotice(lang === 'da' ? `Oplysninger for ${reportHeaderSlot === 'upper' ? 'øverste' : 'nederste'} skema er gemt på serveren.` : lang === 'en' ? `The ${reportHeaderSlot} form details were saved on the server.` : `Zapisano dane ${reportHeaderSlot === 'upper' ? 'górnego' : 'dolnego'} blankietu na serwerze.`);
        } catch {
            setReportSettingsNotice(lang === 'da' ? 'Serveren er utilgængelig. Ændringerne er ikke bekræftet som gemt.' : lang === 'en' ? 'Server unavailable. The changes are not confirmed as saved.' : lang === 'lt' ? toLithuanian('Serwer niedostępny. Zmiany nie zostały potwierdzone jako zapisane.') : 'Serwer niedostępny. Zmiany nie zostały potwierdzone jako zapisane.');
        } finally {
            setReportSettingsSaving(false);
        }
        window.setTimeout(() => setReportSettingsNotice(''), 3500);
    }

    const sunday = new Date(monday);

    sunday.setDate(monday.getDate() + 6);

    const weekEntries = entries.filter(e => { if (e.entryType !== 'timesheet')
        return false;
 const d = new Date(`${effectiveWorkDate(e)}T12:00:00`);
 return d >= monday && d <= sunday;
 }).sort((a, b) => effectiveWorkDate(a).localeCompare(effectiveWorkDate(b)));

    const weekNumber = (() => { const d = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()));
 d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
 const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
 return Math.ceil((((d.getTime() - y.getTime()) / 86400000) + 1) / 7);
 })();

    const totalHours = weekEntries.reduce((s, e) => s + (Number(e.hours) || 0), 0), totalKm = weekEntries.reduce((s, e) => s + (Number(e.kilometers) || 0), 0);
    const currentMonday = new Date();
    currentMonday.setHours(12, 0, 0, 0);
    currentMonday.setDate(currentMonday.getDate() - ((currentMonday.getDay() + 6) % 7));
    const oldestTimesheetDate = entries.filter(e => e.entryType === 'timesheet').map(effectiveWorkDate).sort()[0];
    const firstMonday = oldestTimesheetDate ? new Date(`${oldestTimesheetDate}T12:00:00`) : new Date(currentMonday);
    firstMonday.setDate(firstMonday.getDate() - ((firstMonday.getDay() + 6) % 7));
    const elapsedUtcDays = (Date.UTC(currentMonday.getFullYear(), currentMonday.getMonth(), currentMonday.getDate()) - Date.UTC(firstMonday.getFullYear(), firstMonday.getMonth(), firstMonday.getDate())) / 86400000;
    const periodWeekCount = Math.max(1, Math.floor(elapsedUtcDays / 7) + 1);
    const periodWeekOptions = Array.from({ length: periodWeekCount }, (_, index) => {
        const monday = new Date(firstMonday);
        monday.setDate(monday.getDate() + index * 7);
        const key = isoWeekKey(monday);
        const [year, week] = key.split('-W');
        return { key, label: `${lang === 'da' ? 'Uge' : lang === 'en' ? 'Week' : lang === 'lt' ? toLithuanian('Tydzień') : 'Tydzień'} ${week}, ${year}` };
    });
    const periodStartMonday = mondayForIsoWeek(periodStartKey) || currentMonday;
    const periodEndMonday = mondayForIsoWeek(periodEndKey) || currentMonday;
    const periodStartDate = new Date(Math.min(periodStartMonday.getTime(), periodEndMonday.getTime()));
    const periodEndDate = new Date(Math.max(periodStartMonday.getTime(), periodEndMonday.getTime()));
    periodEndDate.setDate(periodEndDate.getDate() + 6);
    const periodEntries = entries.filter(e => {
        if (e.entryType !== 'timesheet') return false;
        const day = new Date(`${effectiveWorkDate(e)}T12:00:00`);
        return day >= periodStartDate && day <= periodEndDate;
    }).sort((a, b) => effectiveWorkDate(a).localeCompare(effectiveWorkDate(b)));
    const periodHours = periodEntries.reduce((sum, e) => sum + (Number(e.hours) || 0), 0);
    const periodKm = periodEntries.reduce((sum, e) => sum + (Number(e.kilometers) || 0), 0);
    const periodDays = new Set(periodEntries.map(effectiveWorkDate)).size;
    const periodWeeks = periodWeekOptions.filter(option => option.key >= isoWeekKey(periodStartDate) && option.key <= isoWeekKey(periodEndDate)).map(option => {
        const monday = mondayForIsoWeek(option.key)!;
        const sunday = new Date(monday);
        sunday.setDate(sunday.getDate() + 6);
        const weekRows = periodEntries.filter(e => {
            const day = new Date(`${effectiveWorkDate(e)}T12:00:00`);
            return day >= monday && day <= sunday;
        });
        return { ...option, hours: weekRows.reduce((sum, e) => sum + (Number(e.hours) || 0), 0), km: weekRows.reduce((sum, e) => sum + (Number(e.kilometers) || 0), 0) };
    });
    const sharedEntries = [...entries.filter(e => e.entryType === 'worklog'), ...deviceEntries].filter(e => !sharedProject || e.project === sharedProject).filter(e => sharedScope === 'all' || e.author === user?.name).sort((a, b) => b.createdAt - a.createdAt);

    async function buildExactPdf() { if (!weekEntries.length)
        return null;
 const [templateBytes, fontBytes] = await Promise.all([fetch('/timeregistrering-clean.pdf').then(r => r.arrayBuffer()), fetch('/DejaVuSans.ttf').then(r => r.arrayBuffer())]);
 const pdf = await PDFDocument.create();
 pdf.setTitle(`TIMEREGISTRERING - uge ${weekNumber}`);
 pdf.setSubject(`Uge ${weekNumber}, ${monday.getFullYear()}`);
 pdf.registerFontkit(fontkit);
 const font = await pdf.embedFont(fontBytes, { subset: true });
 const [background] = await pdf.embedPdf(templateBytes, [0]);
 // Each row keeps its own destination. Manual upper/lower assignments are
 // separate lanes; automatic rows retain their independent legacy upper lane.
 const pages = buildReportPages(weekEntries.map(entry => ({ ...entry, workDate: effectiveWorkDate(entry) })), defaultCompany);
 const white = rgb(1, 1, 1), black = rgb(0, 0, 0);
 const fit = (value: string, max: number, size = 11) => { let s = size;
 while (s > 6 && font.widthOfTextAtSize(value, s) > max)
        s -= .5;
 return s;
 };
 const text = (page: any, value: unknown, x: number, y: number, max = 200, size = 11) => { const v = String(value ?? '');
 page.drawText(v, { x, y, size: fit(v, max, size), font, color: black });
 };
 const centered = (page: any, value: unknown, left: number, right: number, y: number, size = 11) => { const v = String(value ?? ''), s = fit(v, right - left - 4, size), x = left + (right - left - font.widthOfTextAtSize(v, s)) / 2;
 page.drawText(v, { x, y, size: s, font, color: black });
 };
 const clearSlot = (page: any, offset: number) => { const y = offset ? 139 : 515;
 page.drawRectangle({ x: 469, y, width: 40, height: 19, color: white });
 page.drawRectangle({ x: 511, y, width: 41, height: 19, color: white });
 };
 const fillSlot = (page: any, rows: Entry[], offset: number, slot: 'upper' | 'lower') => { const header = slot === 'upper' ? reportMachineSettings.upperCompany : reportMachineSettings.lowerCompany;
 const siteHeader = slot === 'upper' ? reportMachineSettings.upperProject : reportMachineSettings.lowerProject;
 const employee = slot === 'upper' ? reportMachineSettings.upperEmployeeNumber : reportMachineSettings.lowerEmployeeNumber;
 const operatorName = slot === 'upper' ? reportMachineSettings.upperFullName : reportMachineSettings.lowerFullName;
 const slotMachine = slot === 'upper' ? reportMachineSettings.upperMachine : reportMachineSettings.lowerMachine;
 const slotMachineNumber = slot === 'upper' ? reportMachineSettings.upperMachineNumber : reportMachineSettings.lowerMachineNumber;
 const textDrop = offset ? 5 : 0;
 clearSlot(page, offset);
 text(page, header, 126, 779 - offset - textDrop, 202, 13);
 text(page, weekNumber, 380, 779 - offset - textDrop, 18, 12);
 text(page, employee, 483, 779 - offset - textDrop, 49, 12);
 text(page, siteHeader, 100, 757 - offset - textDrop, 430, 10);
 text(page, slotMachine, 59, 735 - offset - textDrop, 105, 11);
 text(page, slotMachineNumber, 225, 735 - offset - textDrop, 102, 10);
 text(page, operatorName, 430, 735 - offset - textDrop, 102, 10);
 rows.slice(0, 8).forEach((e, i) => { const y = 684 - offset - i * 22, d = new Date(effectiveWorkDate(e) + 'T12:00:00');
 centered(page, d.toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit' }), 18, 70, y - 2 - textDrop, 9);
 centered(page, `${d.getFullYear()} r.`, 18, 70, y - 10 - textDrop, 7);
 text(page, e.project, 76, y - textDrop, 289, 11);
 centered(page, e.hours, 381, 425, y - 1 - textDrop, 11);
 centered(page, e.kilometers, 425, 468, y - 1 - textDrop, 11);
 });
 const h = rows.reduce((s, e) => s + (Number(e.hours) || 0), 0), km = rows.reduce((s, e) => s + (Number(e.kilometers) || 0), 0);
 // The lower blank's totals sat a little below the center of their cells.
 const totalsY = (offset ? 149 : 525) - textDrop;
 centered(page, h, 469, 510, totalsY, 12);
 centered(page, km, 511, 553, totalsY, 12);
 };
 for (let i = 0;
 i < pages.length;
 i += 1) {
        const page = pdf.addPage([background.width, background.height]);

        page.drawPage(background, { x: 0, y: 0, width: background.width, height: background.height });

        if (pages[i].upper) fillSlot(page, pages[i].upper!, 0, 'upper');
        else clearSlot(page, 0);
        if (pages[i].lower) fillSlot(page, pages[i].lower!, 372, 'lower');
        else clearSlot(page, 372);

    } const bytes = await pdf.save();
 return new Blob([bytes], { type: 'application/pdf' });
 }
    async function previewExactPdf() { const mobile = window.matchMedia('(max-width:700px)').matches, tab = mobile ? window.open('about:blank', '_blank') : null;
 setNotice('Tworzę podgląd…');
 const blob = await buildExactPdf();
 if (!blob) {
        tab?.close();

        return;

    } const url = URL.createObjectURL(blob);
 if (mobile) {
        if (tab)
            tab.location.href = url;

        else
            window.location.assign(url);

        setTimeout(() => URL.revokeObjectURL(url), 60000);

    }

    else {
        if (pdfPreviewUrl)
            URL.revokeObjectURL(pdfPreviewUrl);

        setPdfPreviewUrl(url);

 } setNotice('Podgląd PDF gotowy');
 }
    async function deleteEntry(entry: Entry) {
        const confirmation = lang === 'da' ? 'Er du sikker på, at du vil slette?' : lang === 'en' ? 'Are you sure you want to delete it?' : lang === 'lt' ? toLithuanian('Czy na pewno chcesz usunąć?') : 'Czy na pewno chcesz usunąć?';
        if (!window.confirm(confirmation)) return;
        try {
            if ('storage' in entry) {
                await deleteDeviceEntry(entry.id);
                setDeviceEntries(all => all.filter(item => item.id !== entry.id));
            } else {
                if (entry.pending && !navigator.onLine) {
                    setNotice(lang === 'da' ? 'Forbind til serveren for at slette den ventende registrering.' : lang === 'en' ? 'Connect to the server to delete this pending entry.' : lang === 'lt' ? toLithuanian('Połącz się z serwerem, aby usunąć oczekujący wpis.') : 'Połącz się z serwerem, aby usunąć oczekujący wpis.');
                    return;
                }
                const response = await fetch(`/api/entries?id=${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
                if (!response.ok && !(entry.pending && response.status === 404)) throw new Error('Delete failed');
                if (entry.pending) await deletePendingEntry(entry.id);
                setPendingEntries(all => all.filter(item => item.id !== entry.id));
            }
            setEntries(all => all.filter(item => item.id !== entry.id));
            setNotice(lang === 'da' ? 'Registrering slettet.' : lang === 'en' ? 'Entry deleted.' : lang === 'lt' ? toLithuanian('Wpis usunięty.') : 'Wpis usunięty.');
        } catch {
            setNotice(lang === 'da' ? 'Kunne ikke slette.' : lang === 'en' ? 'Could not delete.' : lang === 'lt' ? toLithuanian('Nie udało się usunąć.') : 'Nie udało się usunąć.');
        }
    }
    async function deleteEntryPhoto(entry: Entry, photoId: string, photoIndex: number): Promise<boolean> {
        try {
            if ('storage' in entry) {
                const current = deviceEntries.find(item => item.id === entry.id);
                if (!current) return false;
                const photos = current.photos.filter((_, index) => index !== photoIndex);
                const updated = { ...current, photos, photoCount: photos.length };
                await writeDeviceEntry(updated);
                setDeviceEntries(all => all.map(item => item.id === entry.id ? updated : item));
            } else {
                if (entry.pending && !navigator.onLine) return false;
                const response = await fetch(`/api/photos/${encodeURIComponent(photoId)}`, { method: 'DELETE' });
                if (!response.ok && !(entry.pending && response.status === 404)) return false;
                if (entry.pending) {
                    const pending = pendingEntries.find(item => item.id === entry.id);
                    if (pending) {
                        const updated = { ...pending, files: pending.files.filter((_, index) => index !== photoIndex) };
                        await writePendingEntry(updated);
                        setPendingEntries(all => all.map(item => item.id === entry.id ? updated : item));
                    }
                }
            }
            setEntries(all => all.map(item => item.id === entry.id ? { ...item, photoCount: Math.max(0, item.photoCount - 1) } : item));
            return true;
        } catch { return false; }
    }
    async function deleteProject(projectToDelete: Project) {
        const confirmation = lang === 'da' ? 'Er du sikker på, at du vil slette?' : lang === 'en' ? 'Are you sure you want to delete it?' : lang === 'lt' ? toLithuanian('Czy na pewno chcesz usunąć?') : 'Czy na pewno chcesz usunąć?';
        if (!window.confirm(`${confirmation}\n\n${projectToDelete.name}`)) return;
        try {
            const response = await fetch(`/api/projects?id=${encodeURIComponent(projectToDelete.id)}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Delete failed');
            setProjects(all => all.filter(item => item.id !== projectToDelete.id));
            if (project === projectToDelete.name) setProject('');
            if (sharedProject === projectToDelete.name) setSharedProject('');
            if (user) {
                const cached = projects.filter(item => item.id !== projectToDelete.id);
                localStorage.setItem(ownerCacheKey('projects', user), JSON.stringify(cached));
            }
            setNotice(lang === 'da' ? 'Byggepladsen er fjernet fra listen.' : lang === 'en' ? 'Site removed from the list.' : lang === 'lt' ? toLithuanian('Ulica usunięta z listy. Wcześniejsze wpisy zachowano.') : 'Ulica usunięta z listy. Wcześniejsze wpisy zachowano.');
        } catch {
            setNotice(lang === 'da' ? 'Kunne ikke slette byggepladsen.' : lang === 'en' ? 'Could not remove the site.' : lang === 'lt' ? toLithuanian('Nie udało się usunąć ulicy z listy.') : 'Nie udało się usunąć ulicy z listy.');
        }
    }
    async function downloadExactPdf() { setNotice('Tworzę PDF…');
 const blob = await buildExactPdf();
 if (!blob)
        return;
 const url = URL.createObjectURL(blob), a = document.createElement('a');
 a.href = url;
 a.download = `TIMEREGISTRERING-uge-${weekNumber}.pdf`;
 a.click();
 setTimeout(() => URL.revokeObjectURL(url), 1000);
 setNotice('PDF pobrany');
 }
    async function shareExactPdf() { setNotice('Przygotowuję raport…'); const blob = await buildExactPdf(); if (!blob) return; const file = new File([blob], `TIMEREGISTRERING-uge-${weekNumber}.pdf`, { type: 'application/pdf' }); const title = `TIMEREGISTRERING - uge ${weekNumber}`; if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) { try { await navigator.share({ title, text: title, files: [file] }); setNotice('Raport udostępniony'); return; } catch (e) { if ((e as DOMException).name === 'AbortError') return; } } const subject = encodeURIComponent(title); window.location.href = `mailto:?subject=${subject}&body=${encodeURIComponent('Raport znajduje się w załączonym pliku PDF.')}`; setNotice('Wybierz program do wysłania raportu'); }
    if (loading)
        return <main className="center-screen">
<div className="loader"/>
</main>;

    if (!user)
        return <main className="login-shell">
<section className="login-card">
<div className="login-logo">DR</div>
<h1>{t.title}</h1>
<p>{t.loginHelp}</p>
<label className="field">
<span>{t.name}</span>
<input value={name} onChange={e => setName(e.target.value)} autoComplete="name"/>
</label>
<label className="field">
<span>{t.pin}</span>
<input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" type="password" autoComplete="current-password"/>
</label>{authError && <p className="auth-error">{authError}</p>}<button className="save-button" onClick={login}>{t.login}</button>
<label className="login-language">
<span>{t.language}</span>
<select value={lang} onChange={e => changeLanguage(e.target.value as Language)}>
<option value="pl">Polski</option>
<option value="da">Dansk</option>
<option value="en">English</option>
<option value="lt">Lietuvių</option>
</select>
</label>
{installGuide()}
</section>
</main>;

    if (user.mustChangePin)
        return <main className="login-shell">
<section className="login-card">
<div className="login-logo">DR</div>
<h1>{lang === 'da' ? 'Vælg en ny PIN' : lang === 'en' ? 'Choose a new PIN' : lang === 'lt' ? toLithuanian('Ustaw nowy PIN') : 'Ustaw nowy PIN'}</h1>
<p>{lang === 'da' ? 'Administratorens midlertidige PIN kan kun bruges én gang. Vælg din egen PIN for at fortsætte.' : lang === 'en' ? 'The temporary PIN from the administrator works only for this login. Choose your own PIN to continue.' : lang === 'lt' ? toLithuanian('Tymczasowy PIN od administratora służy tylko do tego logowania. Ustaw własny PIN, aby przejść dalej.') : 'Tymczasowy PIN od administratora służy tylko do tego logowania. Ustaw własny PIN, aby przejść dalej.'}</p>
<label className="field"><span>{lang === 'da' ? 'Ny PIN (4–8 cifre)' : lang === 'en' ? 'New PIN (4–8 digits)' : lang === 'lt' ? toLithuanian('Nowy PIN (4–8 cyfr)') : 'Nowy PIN (4–8 cyfr)'}</span><input value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" type="password" autoComplete="new-password" /></label>
{notice && <p className="auth-error">{notice}</p>}
<button className="save-button" onClick={changePin} disabled={!/^\d{4,8}$/.test(newPin)}>{lang === 'da' ? 'Gem ny PIN' : lang === 'en' ? 'Save new PIN' : lang === 'lt' ? toLithuanian('Zapisz nowy PIN') : 'Zapisz nowy PIN'}</button>
</section>
</main>;

    return <main className="app-shell">
<header className="topbar">
<div className="brand-mark">DR</div>
<div>
<h1>{t.title}</h1>
<p>{user.teamName} · {user.name}</p>
</div>
<label className="language-select">
<select value={lang} onChange={e => changeLanguage(e.target.value as Language)}>
<option value="pl">PL</option>
<option value="da">DA</option>
<option value="en">EN</option>
<option value="lt">LT</option>
</select>
</label>
{installGuide()}
</header>
<button className="logout" onClick={logout}>{t.logout}</button>
<nav className="dashboard-tiles no-print" aria-label={lang === 'da' ? 'Menu' : lang === 'en' ? 'Menu' : lang === 'lt' ? toLithuanian('Menu') : 'Menu'}>
<button className={`dashboard-tile ${activePanel === 'card' ? 'selected' : ''}`} onClick={() => setActivePanel('card')}><span>✎</span><strong>{lang === 'da' ? 'Arbejdskort' : lang === 'en' ? 'Work card' : lang === 'lt' ? toLithuanian('Karta pracy') : 'Karta pracy'}</strong><small>{lang === 'da' ? 'Timer og rapportdata' : lang === 'en' ? 'Hours and report data' : lang === 'lt' ? toLithuanian('Godziny i dane raportu') : 'Godziny i dane raportu'}</small></button>
<button className={`dashboard-tile ${activePanel === 'report' ? 'selected' : ''}`} onClick={() => setActivePanel('report')}><span>▤</span><strong>{lang === 'da' ? 'Ugerapport' : lang === 'en' ? 'Weekly report' : lang === 'lt' ? toLithuanian('Raport tygodniowy') : 'Raport tygodniowy'}</strong><small>{lang === 'da' ? `Uge ${weekNumber}` : lang === 'en' ? `Week ${weekNumber}` : lang === 'lt' ? `${toLithuanian('Tydzień')} ${weekNumber}` : `Tydzień ${weekNumber}`}</small></button>
<button className={`dashboard-tile ${activePanel === 'worklog' ? 'selected' : ''}`} onClick={() => setActivePanel('worklog')}><span>☷</span><strong>{lang === 'da' ? 'Dagens notat' : lang === 'en' ? 'Today’s note' : lang === 'lt' ? toLithuanian('Dzisiejszy wpis') : 'Dzisiejszy wpis'}</strong><small>{lang === 'da' ? 'Beskrivelse og billeder' : lang === 'en' ? 'Description and photos' : lang === 'lt' ? toLithuanian('Opis i zdjęcia') : 'Opis i zdjęcia'}</small></button>
<button className={`dashboard-tile ${activePanel === 'shared' ? 'selected' : ''}`} onClick={() => setActivePanel('shared')}><span>⌂</span><strong>{lang === 'da' ? 'Fælles indlæg' : lang === 'en' ? 'Shared entries' : lang === 'lt' ? toLithuanian('Wspólne wpisy') : 'Wspólne wpisy'}</strong><small>{lang === 'da' ? 'Byggepladser og fotos' : lang === 'en' ? 'Sites and photos' : lang === 'lt' ? toLithuanian('Budowy i zdjęcia') : 'Budowy i zdjęcia'}</small></button>
{canManageTeam && <button className={`dashboard-tile ${activePanel === 'team' ? 'selected' : ''}`} onClick={() => setActivePanel('team')}><span>♙</span><strong>{lang === 'da' ? 'Teammedlemmer' : lang === 'en' ? 'Team users' : lang === 'lt' ? toLithuanian('Użytkownicy zespołu') : 'Użytkownicy zespołu'}</strong><small>{teamUsers.length}</small></button>}
<button className={`dashboard-tile ${activePanel === 'settings' ? 'selected' : ''}`} onClick={() => setActivePanel('settings')}><span>⚙</span><strong>{lang === 'da' ? 'Indstillinger' : lang === 'en' ? 'Settings' : lang === 'lt' ? toLithuanian('Ustawienia') : 'Ustawienia'}</strong><small>{lang === 'da' ? 'Skift PIN' : lang === 'en' ? 'Change PIN' : lang === 'lt' ? toLithuanian('Zmiana PIN-u') : 'Zmiana PIN-u'}</small></button>
</nav>
{activePanel !== 'home' && <button className="back-to-tiles no-print" onClick={() => setActivePanel('home')}>‹ {lang === 'da' ? 'Alle felter' : lang === 'en' ? 'All tiles' : lang === 'lt' ? toLithuanian('Wszystkie kafelki') : 'Wszystkie kafelki'}</button>}
    {activePanel === 'team' && canManageTeam && <details className="admin-card user-list-card" open>
<summary>{lang === 'da' ? 'Teammedlemmer' : lang === 'en' ? 'Team users' : lang === 'lt' ? toLithuanian('Użytkownicy zespołu') : 'Użytkownicy zespołu'} <span className="chevron">⌄</span><b>{teamUsers.length}</b></summary>
<p className="admin-help">{lang === 'da' ? 'Eksisterende PIN-koder vises ikke. Du kan nulstille en medlems PIN og give dem en midlertidig kode.' : lang === 'en' ? 'Existing PINs are never shown. You can reset a member’s PIN and give them a temporary code.' : lang === 'lt' ? toLithuanian('Dotychczasowe PIN-y nie są widoczne. Możesz zresetować PIN członka i przekazać mu nowy, tymczasowy kod.') : 'Dotychczasowe PIN-y nie są widoczne. Możesz zresetować PIN członka i przekazać mu nowy, tymczasowy kod.'}</p>
{requests.length > 0 && <>
<h3 className="pending-heading">{t.admin}<span>{requests.length}</span></h3>
{requests.map(r => <div className="request-row" key={r.id}>
<strong>{r.name}</strong>
<div>
<button onClick={() => decide(r.id, 'approve')}>{t.approve}</button>
<button className="reject" onClick={() => decide(r.id, 'reject')}>{t.reject}</button>
</div>
</div>)}</>}
{teamUsers.map(member => <div className="request-row" key={member.id}><strong>{member.name}</strong><div>{member.role === 'admin' ? <span>{lang === 'da' ? 'hovedadministrator' : lang === 'en' ? 'main administrator' : 'Główny administrator'}</span> : <>{member.role === 'manager' && <span>{lang === 'da' ? 'brigadeadministrator' : lang === 'en' ? 'crew administrator' : 'Administrator brygady'}</span>}{member.id !== user.id && <button className="reject" onClick={() => resetMemberPin(member)}>{lang === 'da' ? 'Nulstil PIN' : lang === 'en' ? 'Reset PIN' : lang === 'lt' ? toLithuanian('Resetuj PIN') : 'Resetuj PIN'}</button>}{user.role === 'admin' && <button className="secondary-button" onClick={() => changeMemberRole(member, member.role === 'manager' ? 'revokeManager' : 'grantManager')}>{member.role === 'manager' ? 'Odbierz administratora' : 'Nadaj administratora'}</button>}</>}</div></div>)}
{temporaryPin && <div className="admin-help" role="status"><strong>{lang === 'da' ? `Midlertidig PIN for ${temporaryPin.name}:` : lang === 'en' ? `Temporary PIN for ${temporaryPin.name}:` : `Tymczasowy PIN dla ${temporaryPin.name}:`} {temporaryPin.pin}</strong><p>{lang === 'da' ? 'Fortæl den til personen inden for 24 timer. Den vises kun nu; næste gang skal personen vælge en ny PIN.' : lang === 'en' ? 'Share it with the person within 24 hours. It is shown only now; they must choose a new PIN at login.' : lang === 'lt' ? toLithuanian('Przekaż go tej osobie w ciągu 24 godzin. Kod jest pokazany tylko teraz; przy logowaniu ustawi własny PIN.') : 'Przekaż go tej osobie w ciągu 24 godzin. Kod jest pokazany tylko teraz; przy logowaniu ustawi własny PIN.'}</p><button className="secondary-button" onClick={() => setTemporaryPin(null)}>{lang === 'da' ? 'Luk' : lang === 'en' ? 'Dismiss' : lang === 'lt' ? toLithuanian('Zamknij') : 'Zamknij'}</button></div>}
</details>}
    {activePanel === 'card' && <details className="entry-card unified-entry no-print" open>
<summary>{lang === 'da' ? 'Dagens arbejdskort' : lang === 'en' ? 'Today’s work card' : lang === 'lt' ? toLithuanian('Dzisiejsza karta pracy') : 'Dzisiejsza karta pracy'}<span>⌄</span>
</summary>
<details className="form-section fixed-data-fold">
<summary>{lang === 'da' ? 'Faste rapportoplysninger' : lang === 'en' ? 'Fixed report details' : lang === 'lt' ? toLithuanian('Stałe dane do raportu') : 'Stałe dane do raportu'}<span className="chevron">⌄</span></summary>
<p className="admin-help">{lang === 'da' ? 'Vælg øverste eller nederste blanket. Oplysningerne gemmes kun for den valgte blanket.' : lang === 'en' ? 'Choose the upper or lower form. Details are saved only for the selected form.' : lang === 'lt' ? toLithuanian('Wybierz górny albo dolny blankiet. Dane zapisują się tylko dla wybranego blankietu.') : 'Wybierz górny albo dolny blankiet. Dane zapisują się tylko dla wybranego blankietu.'}</p>
<div className="report-machine-fields">
<label className="field"><span>{lang === 'da' ? 'Rediger blanket' : lang === 'en' ? 'Edit form' : lang === 'lt' ? toLithuanian('Edytuj blankiet') : 'Edytuj blankiet'}</span><select value={reportHeaderSlot} onChange={e => { const slot = e.target.value as 'upper' | 'lower'; setReportHeaderSlot(slot); setReportSettingsDirty(reportDirtySlots.includes(slot)); setReportSettingsNotice(''); }}><option value="upper">{lang === 'da' ? 'Øverste rapport' : lang === 'en' ? 'Upper report' : lang === 'lt' ? toLithuanian('Górny raport') : 'Górny raport'}</option><option value="lower">{lang === 'da' ? 'Nederste rapport' : lang === 'en' ? 'Lower report' : lang === 'lt' ? toLithuanian('Dolny raport') : 'Dolny raport'}</option></select></label>
<h3>{reportHeaderSlot === 'upper' ? (lang === 'da' ? 'Øverste blanket' : lang === 'en' ? 'Upper form' : lang === 'lt' ? toLithuanian('Górny blankiet') : 'Górny blankiet') : (lang === 'da' ? 'Nederste blanket' : lang === 'en' ? 'Lower form' : lang === 'lt' ? toLithuanian('Dolny blankiet') : 'Dolny blankiet')}</h3>
<label className="field"><span>{reportFieldLabel(lang, 'Customer / company', 'Klient / firma', 'Kunde / firma', 'Klientas / įmonė')}</span><input value={reportMachineSettings[reportHeaderFieldKeys.company]} onChange={e => updateReportHeaderField('company', e.target.value)}/></label>
<label className="field"><span>{reportFieldLabel(lang, 'Work site / address', 'Budowa / ulica', 'Arbejdsplads / adresse', 'Statybvietė / adresas')}</span><input value={reportMachineSettings[reportHeaderFieldKeys.project]} onChange={e => updateReportHeaderField('project', e.target.value)}/></label>
<label className="field"><span>{reportFieldLabel(lang, 'Operator name', 'Imię i nazwisko operatora', 'Maskinførerens navn', 'Mašinos operatoriaus vardas')}</span><input value={reportMachineSettings[reportHeaderFieldKeys.fullName]} onChange={e => updateReportHeaderField('fullName', e.target.value)}/></label>
<label className="field"><span>{reportFieldLabel(lang, 'Employee number', 'Numer pracownika', 'Medarbejdernummer', 'Darbuotojo numeris')}</span><input value={reportMachineSettings[reportHeaderFieldKeys.employeeNumber]} onChange={e => updateReportHeaderField('employeeNumber', e.target.value)}/></label>
<label className="field"><span>{reportFieldLabel(lang, 'Machine', 'Maszyna', 'Maskine', 'Mašina')}</span><input value={reportMachineSettings[reportHeaderFieldKeys.machine]} onChange={e => updateReportHeaderField('machine', e.target.value)}/></label>
<label className="field"><span>{reportFieldLabel(lang, 'Machine number / tonnage', 'Numer maszyny / tonaż', 'Maskinnummer / tonnage', 'Mašinos numeris / tonažas')}</span><input value={reportMachineSettings[reportHeaderFieldKeys.machineNumber]} onChange={e => updateReportHeaderField('machineNumber', e.target.value)}/></label>
</div>
<button className={`secondary-button report-settings-save${reportSettingsDirty ? '' : ' report-settings-saved'}`} onClick={saveReportMachineSettings} disabled={!reportSettingsDirty || reportSettingsSaving}>{reportSettingsSaving ? (lang === 'da' ? 'Gemmer…' : lang === 'en' ? 'Saving…' : lang === 'lt' ? toLithuanian('Zapisuję…') : 'Zapisuję…') : reportSettingsDirty ? (lang === 'da' ? 'Gem ændringer' : lang === 'en' ? 'Save changes' : lang === 'lt' ? toLithuanian('Zapisz zmiany') : 'Zapisz zmiany') : (lang === 'da' ? 'Gemt ✓' : lang === 'en' ? 'Saved ✓' : lang === 'lt' ? toLithuanian('Zapisano ✓') : 'Zapisano ✓')}</button>
{reportSettingsNotice && <p className="report-settings-notice" role="status">{reportSettingsNotice}</p>}
</details>
    <section className="form-section">
<h3>{lang === 'da' ? 'Tidsregistrering' : lang === 'en' ? 'Time registration' : lang === 'lt' ? toLithuanian('Ewidencja godzin') : 'Ewidencja godzin'}</h3>
<div className="compact-grid">
<label className="field">
<span>{lang === 'da' ? 'Dato' : lang === 'en' ? 'Date' : lang === 'lt' ? toLithuanian('Data') : 'Data'}</span>
                        <input type="date" value={workDate} onChange={e => { setWorkDate(e.target.value);
 setDateWasEdited(true);
 }}/>
</label>
<label className="field">
<span>{lang === 'da' ? 'Timer' : lang === 'en' ? 'Hours' : lang === 'lt' ? toLithuanian('Godziny') : 'Godziny'}</span>
<input type="number" min="0" step="0.25" inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)}/>
</label>
<label className="field">
<span>{lang === 'da' ? 'Kilometer' : lang === 'en' ? 'Kilometres' : lang === 'lt' ? toLithuanian('Kilometry') : 'Kilometry'}</span>
<input type="number" min="0" step="1" inputMode="numeric" value={kilometers} onChange={e => setKilometers(e.target.value)}/>
</label>
</div>{pendingEntries.length > 0 && <p className="pending-sync">{lang === 'da' ? `Afventer serveren: ${pendingEntries.length}` : lang === 'en' ? `Waiting for server: ${pendingEntries.length}` : `Czeka na serwer: ${pendingEntries.length}`}</p>}
<label className="field">
<span>{lang === 'da' ? 'Arbejdsplads / adresse (denne dag)' : lang === 'en' ? 'Work site / address (this day)' : lang === 'lt' ? toLithuanian('Budowa / ulica (ten dzień)') : 'Budowa / ulica (ten dzień)'}</span>
<input value={project} onChange={e => setProject(e.target.value)} list="project-list"/>
<datalist id="project-list">{projects.map(p => <option key={p.id} value={p.name}/>)}</datalist>
</label>
<label className="field report-slot-select"><span>{lang === 'da' ? 'Gem i rapport' : lang === 'en' ? 'Save to report' : lang === 'lt' ? toLithuanian('Zapisz w raporcie') : 'Zapisz w raporcie'}</span><select value={projectReportSlot} onChange={e => setProjectReportSlot(e.target.value as '' | 'upper' | 'lower')}><option value="">{lang === 'da' ? 'Vælg rapport…' : lang === 'en' ? 'Choose a report…' : lang === 'lt' ? toLithuanian('Wybierz raport…') : 'Wybierz raport…'}</option><option value="upper">{lang === 'da' ? 'Øverste rapport' : lang === 'en' ? 'Upper report' : lang === 'lt' ? toLithuanian('Górny raport') : 'Górny raport'}</option><option value="lower">{lang === 'da' ? 'Nederste rapport' : lang === 'en' ? 'Lower report' : lang === 'lt' ? toLithuanian('Dolny raport') : 'Dolny raport'}</option></select></label>
{notice && <p className="notice">{notice}</p>}<button className="save-button" onClick={() => saveEntry('timesheet')} disabled={saving || !project.trim() || (!hours && !kilometers) || !workDate || (projectReportSlot !== 'upper' && projectReportSlot !== 'lower')}>{saving ? t.saving : lang === 'da' ? 'Gem timer' : lang === 'en' ? 'Save hours' : lang === 'lt' ? toLithuanian('Zapisz godziny') : 'Zapisz godziny'}</button>
</section>
</details>}
    {activePanel === 'report' && <details className="report-fold no-print" open>
<summary>{lang === 'da' ? 'Ugerapport' : lang === 'en' ? 'Weekly report' : lang === 'lt' ? toLithuanian('Raport tygodniowy') : 'Raport tygodniowy'} · {weekNumber}<span>⌄</span></summary>
    <section className="report-card">
<div>
<div className="week-selector">
<button onClick={() => setWeekOffset(x => x - 1)} aria-label={lang === 'da' ? 'Forrige uge' : lang === 'en' ? 'Previous week' : lang === 'lt' ? toLithuanian('Poprzedni tydzień') : 'Poprzedni tydzień'}>‹</button>
<h2>{lang === 'da' ? 'Ugerapport' : lang === 'en' ? 'Weekly report' : lang === 'lt' ? toLithuanian('Raport tygodniowy') : 'Raport tygodniowy'} · {weekNumber}</h2>
<button onClick={() => setWeekOffset(x => Math.min(0, x + 1))} disabled={weekOffset >= 0} aria-label={lang === 'da' ? 'Næste uge' : lang === 'en' ? 'Next week' : lang === 'lt' ? toLithuanian('Następny tydzień') : 'Następny tydzień'}>›</button>
</div>
<p>{weekEntries.length} {lang === 'da' ? 'dage' : lang === 'en' ? 'days' : lang === 'lt' ? toLithuanian('dni') : 'dni'} · {totalHours} h · {totalKm} km</p>
<div className="timesheet-entry-list">{weekEntries.map(e => <div className="timesheet-entry-row" key={e.id}><span><strong>{effectiveWorkDate(e)}</strong> · {e.project} · {e.hours || '0'} h · {e.kilometers || '0'} km · {e.reportSlot === 'upper' ? (lang === 'da' ? 'Øverste rapport' : lang === 'en' ? 'Upper report' : lang === 'lt' ? toLithuanian('Górny raport') : 'Górny raport') : e.reportSlot === 'lower' ? (lang === 'da' ? 'Nederste rapport' : lang === 'en' ? 'Lower report' : lang === 'lt' ? toLithuanian('Dolny raport') : 'Dolny raport') : (lang === 'da' ? 'Automatisk' : lang === 'en' ? 'Automatic' : lang === 'lt' ? toLithuanian('Automatycznie') : 'Automatycznie')}</span><button className="table-delete" onClick={() => deleteEntry(e)}>{lang === 'da' ? 'Slet' : lang === 'en' ? 'Delete' : lang === 'lt' ? toLithuanian('Usuń') : 'Usuń'}</button></div>)}</div>
</div>
<div className="report-actions">
<button className="secondary-button" onClick={previewExactPdf} disabled={!weekEntries.length}>{lang === 'da' ? 'Vis PDF' : lang === 'en' ? 'Preview PDF' : lang === 'lt' ? toLithuanian('Podgląd PDF') : 'Podgląd PDF'}</button>
<button className="secondary-button" onClick={shareExactPdf} disabled={!weekEntries.length}>{lang === 'da' ? 'Send' : lang === 'en' ? 'Share' : lang === 'lt' ? toLithuanian('Wyślij') : 'Wyślij'}</button>
<button className="report-button" onClick={downloadExactPdf} disabled={!weekEntries.length}>{lang === 'da' ? 'Download PDF' : lang === 'en' ? 'Download PDF' : lang === 'lt' ? toLithuanian('Pobierz PDF') : 'Pobierz PDF'}</button>
</div>
</section>
<details className="period-summary">
<summary>{lang === 'da' ? 'Oversigt for periode' : lang === 'en' ? 'Period summary' : lang === 'lt' ? toLithuanian('Zestawienie okresu') : 'Zestawienie okresu'}<span>⌄</span></summary>
<div className="period-controls">
<label className="field"><span>{lang === 'da' ? 'Fra uge' : lang === 'en' ? 'From week' : lang === 'lt' ? toLithuanian('Od tygodnia') : 'Od tygodnia'}</span><select value={periodStartKey} onChange={e => { const next = e.target.value; setPeriodStartKey(next); if (next > periodEndKey) setPeriodEndKey(next); }}>{periodWeekOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
<label className="field"><span>{lang === 'da' ? 'Til uge' : lang === 'en' ? 'To week' : lang === 'lt' ? toLithuanian('Do tygodnia') : 'Do tygodnia'}</span><select value={periodEndKey} onChange={e => { const next = e.target.value; setPeriodEndKey(next); if (next < periodStartKey) setPeriodStartKey(next); }}>{periodWeekOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
</div>
<p className="period-totals">{periodWeeks.length} {lang === 'da' ? 'uger' : lang === 'en' ? 'weeks' : lang === 'lt' ? toLithuanian('tyg.') : 'tyg.'} · {periodDays} {lang === 'da' ? 'arbejdsdage' : lang === 'en' ? 'workdays' : lang === 'lt' ? toLithuanian('dni pracy') : 'dni pracy'} · <strong>{periodHours} h</strong> · {periodKm} km</p>
{periodWeeks.length > 1 && <div className="period-week-list">{periodWeeks.map(week => <div key={week.key}><span>{week.label}</span><strong>{week.hours} h · {week.km} km</strong></div>)}</div>}
{!periodEntries.length && <p className="period-empty">{lang === 'da' ? 'Ingen registrerede timer i denne periode.' : lang === 'en' ? 'No hours recorded for this period.' : lang === 'lt' ? toLithuanian('Brak zapisanych godzin w tym okresie.') : 'Brak zapisanych godzin w tym okresie.'}</p>}
</details>
</details>}{pdfPreviewUrl && <div className="pdf-preview no-print" role="dialog" aria-modal="true" aria-label={lang === 'da' ? 'PDF-forhåndsvisning' : lang === 'en' ? 'PDF preview' : lang === 'lt' ? toLithuanian('Podgląd PDF') : 'Podgląd PDF'}>
<div className="pdf-preview-bar">
<strong>{lang === 'da' ? 'PDF-forhåndsvisning' : lang === 'en' ? 'PDF preview' : lang === 'lt' ? toLithuanian('Podgląd PDF') : 'Podgląd PDF'}</strong>
<button className="secondary-button" onClick={() => { URL.revokeObjectURL(pdfPreviewUrl);
 setPdfPreviewUrl('');
 }}>{lang === 'da' ? 'Luk' : lang === 'en' ? 'Close' : lang === 'lt' ? toLithuanian('Zamknij') : 'Zamknij'}</button>
</div>
<iframe src={pdfPreviewUrl} title={lang === 'da' ? 'PDF-forhåndsvisning' : lang === 'en' ? 'PDF preview' : lang === 'lt' ? toLithuanian('Podgląd PDF') : 'Podgląd PDF'}/>
</div>}{activePanel === 'worklog' && <details className="entry-card worklog-card no-print" open>
<summary>{t.today}<span>⌄</span>
</summary>
<label className="field"><span>{lang === 'da' ? 'Gem som' : lang === 'en' ? 'Save as' : lang === 'lt' ? toLithuanian('Zapisz jako') : 'Zapisz jako'}</span><select value={worklogStorage} onChange={e => setWorklogStorage(e.target.value as 'cloud' | 'device')}><option value="cloud">{lang === 'da' ? 'I skyen — synlig for teamet' : lang === 'en' ? 'In the cloud — visible to the team' : lang === 'lt' ? toLithuanian('W chmurze — widoczne dla zespołu') : 'W chmurze — widoczne dla zespołu'}</option><option value="device">{lang === 'da' ? 'Kun på denne telefon' : lang === 'en' ? 'Only on this device' : lang === 'lt' ? toLithuanian('Tylko na tym telefonie') : 'Tylko na tym telefonie'}</option></select></label>
<label className="field">
<span>{t.project}</span>
<input value={project} onChange={e => setProject(e.target.value)} list="project-list"/>
</label>
<label className="field">
<span>{t.work}</span>
<textarea value={work} onChange={e => setWork(e.target.value)} placeholder={t.workPlaceholder} rows={5}/>
</label>
<button className={`voice-button ${listening ? 'active' : ''}`} onClick={startVoice}>
<span className="mic">●</span>{listening ? t.listening : t.speak}</button>
<div className="actions-grid">
<label className="action-button photo-button">
<span>📷</span>{t.photo}<input type="file" accept="image/*" capture="environment" multiple onChange={addPhotos}/>
</label>
<button className="action-button" onClick={getLocation}>
<span>⌖</span>{locating ? t.locating : t.location}</button>
</div>{files.length > 0 && <div className="photo-strip">{files.map((file, i) => <div className="photo-thumb" key={`${file.name}-${i}`}>
<img src={URL.createObjectURL(file)} alt=""/>
<button onClick={() => setFiles(x => x.filter((_, j) => j !== i))}>×</button>
</div>)}</div>}<div className={`gps-status ${position ? 'ready' : ''}`}>{position ? `● ${t.gpsReady} · ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : `○ ${t.gpsMissing}`}</div>
<button className="save-button" onClick={() => saveEntry('worklog')} disabled={saving || !project.trim() || !work.trim() || !workDate}>{saving ? t.saving : t.save}</button>
</details>}
    <section className="print-report">
<h1>Timeregistrering · {lang === 'pl' ? 'tydzień' : lang === 'da' ? 'uge' : lang === 'lt' ? 'savaitė' : 'week'} {weekNumber}</h1>
<div className="report-meta">
<p>
<b>{lang === 'pl' ? 'Imię i nazwisko' : lang === 'da' ? 'Navn og efternavn' : lang === 'lt' ? 'Vardas ir pavardė' : 'Full name'}:</b> {fullName || '—'}</p>
<p>
<b>{lang === 'pl' ? 'Numer pracownika' : lang === 'da' ? 'Medarbejdernr.' : lang === 'lt' ? 'Darbuotojo numeris' : 'Employee no.'}:</b> {employeeNumber || '—'}</p>
<p>
<b>{lang === 'pl' ? 'Maszyna' : lang === 'da' ? 'Maskine' : lang === 'lt' ? 'Mašina' : 'Machine'}:</b> {machine || '—'}</p>
<p>
<b>Kundegodkendelse:</b> {machineNumber || '—'}</p>
</div>
<table>
<thead>
<tr>
<th>{lang === 'pl' ? 'Data' : lang === 'da' ? 'Dato' : lang === 'lt' ? 'Data' : 'Date'}</th>
<th>{lang === 'pl' ? 'Firma' : lang === 'da' ? 'Firma' : lang === 'lt' ? 'Įmonė' : 'Company'}</th>
<th>{lang === 'pl' ? 'Budowa / ulica' : lang === 'da' ? 'Byggeplads / adresse' : lang === 'lt' ? 'Statybvietė / gatvė' : 'Site / address'}</th>
<th>{lang === 'pl' ? 'Opis' : lang === 'da' ? 'Arbejde' : lang === 'lt' ? 'Darbas' : 'Work'}</th>
<th>{lang === 'pl' ? 'Godziny' : lang === 'da' ? 'Timer' : lang === 'lt' ? 'Valandos' : 'Hours'}</th>
<th>Km</th><th>{lang === 'da' ? 'Handling' : lang === 'en' ? 'Action' : lang === 'lt' ? toLithuanian('Akcja') : 'Akcja'}</th>
</tr>
</thead>
<tbody>{weekEntries.map(e => <tr key={e.id}>
<td>{effectiveWorkDate(e)}</td>
<td>{e.company || '—'}</td>
<td>{e.project}</td>
<td>{e.description}</td>
<td>{e.hours}</td>
<td>{e.kilometers}</td><td><button className="table-delete" onClick={() => deleteEntry(e)}>{lang === 'da' ? 'Slet' : lang === 'en' ? 'Delete' : lang === 'lt' ? toLithuanian('Usuń') : 'Usuń'}</button></td>
</tr>)}</tbody>
<tfoot>
<tr>
<th colSpan={4}>{lang === 'pl' ? 'Razem' : lang === 'da' ? 'I alt' : lang === 'lt' ? 'Iš viso' : 'Total'}</th>
<th>{totalHours}</th>
<th>{totalKm}</th><th></th>
</tr>
</tfoot>
</table>
</section>
    {activePanel === 'shared' && <section className="recent-section no-print">
<h2>{t.recent}</h2>
<details className="project-management">
<summary>{lang === 'da' ? 'Gemte byggepladser' : lang === 'en' ? 'Saved sites' : lang === 'lt' ? toLithuanian('Zapisane ulice') : 'Zapisane ulice'} · {projects.length}<span>⌄</span></summary>
<p>{lang === 'da' ? 'Sletning fjerner kun adressen fra valgmulighederne. Tidligere registreringer bevares.' : lang === 'en' ? 'Deleting removes only the address from the suggestions. Existing entries are kept.' : lang === 'lt' ? toLithuanian('Usunięcie usuwa ulicę tylko z podpowiedzi. Wcześniejsze wpisy zostają.') : 'Usunięcie usuwa ulicę tylko z podpowiedzi. Wcześniejsze wpisy zostają.'}</p>
{projects.length === 0 ? <small>{lang === 'da' ? 'Ingen gemte byggepladser.' : lang === 'en' ? 'No saved sites.' : lang === 'lt' ? toLithuanian('Brak zapisanych ulic.') : 'Brak zapisanych ulic.'}</small> : projects.map(savedProject => <div className="project-management-row" key={savedProject.id}><span>{savedProject.name}</span><button className="table-delete" onClick={() => deleteProject(savedProject)}>{lang === 'da' ? 'Slet' : lang === 'en' ? 'Delete' : lang === 'lt' ? toLithuanian('Usuń') : 'Usuń'}</button></div>)}
</details>
<div className="shared-filters">
<label className="field"><span>{lang === 'da' ? 'Byggeplads / adresse' : lang === 'en' ? 'Site / address' : lang === 'lt' ? toLithuanian('Budowa / ulica') : 'Budowa / ulica'}</span><select value={sharedProject} onChange={e => setSharedProject(e.target.value)}><option value="">{lang === 'da' ? 'Alle byggepladser' : lang === 'en' ? 'All sites' : lang === 'lt' ? toLithuanian('Wszystkie ulice') : 'Wszystkie ulice'}</option>{projects.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}</select></label>
<label className="field"><span>{lang === 'da' ? 'Visning' : lang === 'en' ? 'View' : lang === 'lt' ? toLithuanian('Widok') : 'Widok'}</span><select value={sharedScope} onChange={e => setSharedScope(e.target.value as 'all' | 'mine')}><option value="all">{lang === 'da' ? 'Alle medarbejdere' : lang === 'en' ? 'All workers' : lang === 'lt' ? toLithuanian('Wszyscy') : 'Wszyscy'}</option><option value="mine">{lang === 'da' ? 'Kun mine' : lang === 'en' ? 'Only mine' : lang === 'lt' ? toLithuanian('Tylko moje') : 'Tylko moje'}</option></select></label>
</div>{sharedEntries.length === 0 ? <div className="empty-state">
<span>▤</span>
<p>{t.empty}</p>
</div> : <div className="entry-list">{sharedEntries.map(e => <article key={e.id}>
<div className="shared-entry-head">
<strong>{e.project}</strong>
<time>{e.workDate} · {e.author}</time>
{(('storage' in e && (e as DeviceEntry).owner === (user ? ownerKey(user) : '')) || e.author === user?.name) && <button className="table-delete" onClick={() => deleteEntry(e)}>{lang === 'da' ? 'Slet post' : lang === 'en' ? 'Delete entry' : lang === 'lt' ? toLithuanian('Usuń wpis') : 'Usuń wpis'}</button>}
</div>
<p>{entryTranslations[e.id] ?? e.description}</p>
{!('storage' in e) && !e.pending && e.sourceLanguage !== 'en' && <div className="translation-controls">
<button className="secondary-button" onClick={() => translateEntry(e)} disabled={Boolean(translatingEntries[e.id])}>{translatingEntries[e.id] ? (lang === 'da' ? 'Oversætter…' : lang === 'en' ? 'Translating…' : lang === 'lt' ? toLithuanian('Tłumaczę…') : 'Tłumaczę…') : entryTranslations[e.id] ? (lang === 'da' ? 'Vis original' : lang === 'en' ? 'Show original' : lang === 'lt' ? toLithuanian('Pokaż oryginał') : 'Pokaż oryginał') : (lang === 'da' ? 'Oversæt til engelsk' : lang === 'en' ? 'Translate to English' : lang === 'lt' ? toLithuanian('Przetłumacz na angielski') : 'Przetłumacz na angielski')}</button>
{translationErrors[e.id] && <small role="status">{lang === 'da' ? 'Oversættelse er ikke tilgængelig. Originalen vises.' : lang === 'en' ? 'Translation unavailable. Showing original.' : lang === 'lt' ? toLithuanian('Tłumaczenie niedostępne. Pokazuję oryginał.') : 'Tłumaczenie niedostępne. Pokazuję oryginał.'}</small>}
</div>}
<EntryPhotos entryId={e.id} count={e.photoCount} language={lang} files={'storage' in e ? (e as DeviceEntry).photos : pendingEntries.find(item => item.id === e.id)?.files} canDelete={('storage' in e && (e as DeviceEntry).owner === (user ? ownerKey(user) : '')) || e.author === user?.name} onDeletePhoto={(photoId, index) => deleteEntryPhoto(e, photoId, index)} />
<small>{'storage' in e ? (lang === 'da' ? 'Kun denne telefon · ' : lang === 'en' ? 'This device only · ' : lang === 'lt' ? toLithuanian('Tylko ten telefon · ') : 'Tylko ten telefon · ') : ''}📷 {e.photoCount} {t.photos} · {e.latitude ? `⌖ ${t.gpsReady}` : t.gpsMissing}</small>
</article>)}</div>}</section>}
{activePanel === 'settings' && <details className="pin-card no-print" open>
<summary>{lang === 'da' ? 'Skift PIN' : lang === 'en' ? 'Change PIN' : lang === 'lt' ? toLithuanian('Zmiana PIN-u') : 'Zmiana PIN-u'}<span>⌄</span>
</summary>
<div className="pin-row">
<label className="field">
<span>{lang === 'da' ? 'Ny PIN (4-8 cifre)' : lang === 'en' ? 'New PIN (4-8 digits)' : lang === 'lt' ? toLithuanian('Nowy PIN (4-8 cyfr)') : 'Nowy PIN (4-8 cyfr)'}</span>
<input value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" type="password"/>
</label>
<button className="secondary-button" onClick={changePin} disabled={!newPin}>{lang === 'da' ? 'Gem' : lang === 'en' ? 'Save' : lang === 'lt' ? toLithuanian('Zapisz') : 'Zapisz'}</button>
</div>
</details>}
</main>;

}
