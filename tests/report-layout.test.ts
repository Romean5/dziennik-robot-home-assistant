import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReportPages, type ReportLayoutEntry } from '../app/report-layout.js';

function row(id: string, date: string, reportSlot: ReportLayoutEntry['reportSlot'], company = 'Firma A'): ReportLayoutEntry {
    return { id, workDate: date, createdAt: Date.parse(`${date}T12:00:00Z`), company, project: 'Ulica 1', reportSlot };
}

function assigned(pages: ReturnType<typeof buildReportPages<ReportLayoutEntry>>) {
    return Object.fromEntries(pages.flatMap(page => [
        ...(page.upper ?? []).map(entry => [entry.id, 'upper']),
        ...(page.lower ?? []).map(entry => [entry.id, 'lower']),
    ]));
}

test('dolny → górny → dolny pozostają w wybranych raportach', () => {
    const entries = [
        row('lower-1', '2026-10-19', 'lower'),
        row('upper-2', '2026-10-20', 'upper'),
        row('lower-3', '2026-10-21', 'lower'),
    ];
    const pages = buildReportPages(entries, 'Domyślna firma');
    assert.deepEqual(assigned(pages), { 'lower-1': 'lower', 'upper-2': 'upper', 'lower-3': 'lower' });
    assert.deepEqual(pages[0].lower?.map(entry => entry.id), ['lower-1', 'lower-3']);
    assert.deepEqual(pages[0].upper?.map(entry => entry.id), ['upper-2']);
});

test('późniejsze wybory nie zmieniają wcześniejszych przypisań', () => {
    const entries: ReportLayoutEntry[] = [];
    entries.push(row('first', '2026-10-19', 'lower'));
    const firstAssignment = assigned(buildReportPages(entries, ''));
    entries.push(row('second', '2026-10-20', 'upper'));
    entries.push(row('third', '2026-10-21', 'lower'));
    assert.deepEqual(firstAssignment, { first: 'lower' });
    assert.deepEqual(assigned(buildReportPages(entries, '')), { first: 'lower', second: 'upper', third: 'lower' });
});

test('automatyczne (historyczne) wpisy nie przejmują wyboru ręcznych wpisów', () => {
    const pages = buildReportPages([
        row('manual-lower', '2026-10-19', 'lower'),
        row('automatic', '2026-10-20', 'auto'),
        row('manual-upper', '2026-10-21', 'upper'),
    ], '');
    assert.deepEqual(assigned(pages), { 'manual-lower': 'lower', automatic: 'upper', 'manual-upper': 'upper' });
});

test('przekroczenie ośmiu pozycji tworzy kolejną stronę w tym samym raporcie', () => {
    const entries = Array.from({ length: 9 }, (_, index) => row(`lower-${index + 1}`, `2026-10-${String(19 + index).padStart(2, '0')}`, 'lower'));
    const pages = buildReportPages(entries, '');
    assert.equal(pages.length, 2);
    assert.equal(pages[0].lower?.length, 8);
    assert.equal(pages[1].lower?.length, 1);
    assert.equal(pages.some(page => page.upper?.length), false);
    assert.equal(Object.keys(assigned(pages)).length, 9);
});

test('różni klienci nie są łączeni w jeden blankiet', () => {
    const pages = buildReportPages([
        row('client-a', '2026-10-19', 'lower', 'Firma A'),
        row('client-b', '2026-10-20', 'lower', 'Firma B'),
    ], '');
    assert.equal(pages.length, 2);
    assert.deepEqual(pages.map(page => page.lower?.map(entry => entry.id)), [['client-a'], ['client-b']]);
});

test('dwie ulice tego samego dnia zachowują osobne wiersze i godziny', () => {
    const first = { ...row('street-a', '2026-11-10', 'upper'), project: 'Ulica A', hours: '4' };
    const second = { ...row('street-b', '2026-11-10', 'upper'), project: 'Ulica B', hours: '3' };
    const pages = buildReportPages([first, second], '');
    assert.equal(pages.length, 1);
    assert.deepEqual(pages[0].upper?.map(e => [e.workDate, e.project, e.hours]), [
        ['2026-11-10', 'Ulica A', '4'], ['2026-11-10', 'Ulica B', '3'],
    ]);
    assert.equal(pages[0].upper?.reduce((sum, e) => sum + Number(e.hours), 0), 7);
});

test('zmiana ulicy bez nazwy firmy dodaje wiersz do tego samego blankietu', () => {
    for (const slot of ['upper', 'lower'] as const) {
        const first = { ...row('first', '2026-11-10', slot, ''), project: 'Ulica A' };
        const second = { ...row('second', '2026-11-10', slot, ''), project: 'Ulica B' };
        const pages = buildReportPages([first, second], '');
        assert.equal(pages.length, 1);
        assert.deepEqual(pages[0][slot]?.map(e => e.id), ['first', 'second']);
        assert.equal(pages[0][slot === 'upper' ? 'lower' : 'upper'], undefined);
    }
});

test('brakująca firma korzysta z nagłówka wybranego blankietu', () => {
    const pages = buildReportPages([
        { ...row('old', '2026-11-10', 'lower', ''), project: 'Ulica A' },
        { ...row('new', '2026-11-10', 'lower', 'Firma Dolna'), project: 'Ulica B' },
    ], { upper: 'Firma Górna', lower: 'Firma Dolna' });
    assert.equal(pages.length, 1);
    assert.deepEqual(pages[0].lower?.map(e => e.id), ['new', 'old']);
    assert.equal(pages[0].upper, undefined);
});

test('różne odstępy w nazwie firmy nie rozdzielają ulic', () => {
    const pages = buildReportPages([
        row('a', '2026-11-10', 'upper', 'Firma   A'),
        { ...row('b', '2026-11-10', 'upper', 'firma A'), project: 'Ulica B' },
    ], '');
    assert.equal(pages.length, 1);
    assert.equal(pages[0].upper?.length, 2);
});
