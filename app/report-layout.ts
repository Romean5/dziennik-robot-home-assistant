/** Pure weekly timesheet layout. Explicit slot assignments are immutable; the
 * automatic lane retains the legacy upper-blank default and never inherits a
 * manual entry's choice. */
export type ReportSlot = 'auto' | 'upper' | 'lower';

export type ReportLayoutEntry = {
    id: string;
    company: string;
    project: string;
    workDate: string;
    createdAt: number;
    reportSlot?: ReportSlot | null;
};

export type ReportPage<T> = { upper?: T[]; lower?: T[] };

const MAX_ROWS_PER_BLANK = 8;

function groupKey(entry: ReportLayoutEntry, fallbackCompany: string) {
    const company = entry.company.trim() || fallbackCompany.trim();
    // Keep entries without a client separated by site, as before.
    return company
        ? `company:${company.toLocaleLowerCase()}`
        : `site:${entry.project.trim().toLocaleLowerCase() || ' '}`;
}

function entryOrder(a: ReportLayoutEntry, b: ReportLayoutEntry) {
    return a.workDate.localeCompare(b.workDate) || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/**
 * Build physical report pages while preserving each entry's selected form.
 * Same-client entries are kept together in the same lane, but a full blank
 * spills onto another page in that same lane rather than into its opposite.
 */
export function buildReportPages<T extends ReportLayoutEntry>(entries: T[], fallbackCompany: string): ReportPage<T>[] {
    const grouped = new Map<string, { slot: 'upper' | 'lower'; rows: T[] }>();

    for (const entry of entries) {
        const explicit = entry.reportSlot === 'upper' || entry.reportSlot === 'lower';
        // Auto is deliberately independent of explicit choices. Historically,
        // an auto-only client was placed in the upper blank by the PDF builder.
        const slot: 'upper' | 'lower' = explicit ? entry.reportSlot as 'upper' | 'lower' : 'upper';
        const key = `${slot}\u0000${groupKey(entry, fallbackCompany)}`;
        const group = grouped.get(key) ?? { slot, rows: [] };
        group.rows.push(entry);
        grouped.set(key, group);
    }

    const groups = [...grouped.values()]
        .map(group => ({ ...group, rows: group.rows.sort(entryOrder) }))
        .sort((a, b) => entryOrder(a.rows[0], b.rows[0]) || a.slot.localeCompare(b.slot));

    const pages: ReportPage<T>[] = [];
    for (const group of groups) {
        for (let start = 0; start < group.rows.length; start += MAX_ROWS_PER_BLANK) {
            const rows = group.rows.slice(start, start + MAX_ROWS_PER_BLANK);
            let pageIndex = pages.findIndex(page => !page[group.slot]);
            if (pageIndex < 0) {
                pageIndex = pages.length;
                pages.push({});
            }
            pages[pageIndex][group.slot] = rows;
        }
    }
    return pages;
}
