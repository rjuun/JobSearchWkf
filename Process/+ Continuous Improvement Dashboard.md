

Refer to [[++ Continuous Improvement Procedure]] and [[CI - Continuous Improvement]]


```dataviewjs
// Fixed order, not incidental — groupBy on date-sorted pages previously put
// sections wherever the first page of that status happened to fall, so a
// group could drift depending on what else was in the folder. Canonical
// values are documented in "++ Continuous Improvement Procedure.md".
const STATUS_ORDER = ["0 - Idea", "1 - Development", "2 - Testing", "9 - LLM Run Required", "3 - Delivered", "4 - Abandoned", "5 - Superseded"];

const dvPages = dv.pages('"Process/CI"');
const pagesArr = dvPages.array();

// --- Code: incremental "CI-###" id, computed here rather than stored in
// frontmatter, so nobody has to hand-assign or remember a number. Order is
// by ci-date ascending (tie-broken by file name for a stable result when two
// CIs share a date). Note this is NOT based on file creation time (file.ctime)
// on purpose — ctime is reset by git clone/checkout, which would scramble the
// numbering on any machine other than the one a CI was first created on.
const orderedForCode = pagesArr.slice().sort((a, b) => {
    const ad = a["ci-date"], bd = b["ci-date"];
    if (ad && bd) {
        const diff = ad - bd;
        if (diff !== 0) return diff;
    } else if (ad && !bd) return -1;
    else if (!ad && bd) return 1;
    return a.file.name.localeCompare(b.file.name);
});
const codeMap = {};
orderedForCode.forEach((p, i) => { codeMap[p.file.path] = "CI-" + String(i + 1).padStart(3, "0"); });

// --- Delivered date: read straight from each note's simple-time-tracker
// code block (the log of actual work sessions) rather than a hand-maintained
// property, so it can't drift from what the tracker says. Takes the latest
// endTime across all entries/sub-entries in the block.
function collectTimes(entries, out) {
    for (const e of (entries || [])) {
        if (e.endTime) out.push(new Date(e.endTime));
        if (e.subEntries) collectTimes(e.subEntries, out);
    }
}
const deliveredMap = {};
// Built via String.fromCharCode rather than a literal fence, so this script
// never contains three backticks in a row — that would prematurely close the
// dataviewjs code block it lives in.
const FENCE = String.fromCharCode(96, 96, 96);
const trackerRe = new RegExp(FENCE + "simple-time-tracker\\s*\\n([\\s\\S]*?)" + FENCE);
for (const p of pagesArr) {
    const text = await dv.io.load(p.file.path);
    const match = text && text.match(trackerRe);
    if (!match) continue;
    try {
        const data = JSON.parse(match[1]);
        const times = [];
        collectTimes(data.entries, times);
        if (times.length) deliveredMap[p.file.path] = new Date(Math.max(...times));
    } catch (e) { /* malformed tracker block — leave undelivered */ }
}
// dd.mmm — e.g. "01.Aug". Handles both Luxon DateTime (ci-date) and plain
// JS Date (derived delivered-date) inputs.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(d) {
    if (!d) return "-";
    let day, month;
    if (d instanceof Date) { day = d.getUTCDate(); month = d.getUTCMonth(); }
    else if (d.toFormat) { day = d.day; month = d.month - 1; }
    else return String(d).slice(0, 10);
    return String(day).padStart(2, "0") + "." + MONTHS[month];
}

// Colour-coded, single-letter priority badge — narrower than the word, and
// scannable at a glance. High=red, Medium=amber, Low=green.
const PRIORITY = {
    high:   { bg: "#e15759", label: "H" },
    medium: { bg: "#f2b134", label: "M" },
    low:    { bg: "#59a14f", label: "L" }
};
function priorityBadge(p) {
    const c = PRIORITY[(p || "").toLowerCase()];
    if (!c) return "";
    return `<span title="${p}" style="display:inline-block; min-width:14px; padding:1px 5px; border-radius:8px; background:${c.bg}; color:#fff; font-weight:bold; text-align:center;">${c.label}</span>`;
}

const groups = dvPages
    .sort(p => p["ci-date"], 'desc')
    .groupBy(p => p["ci-status"] || "No Status").array();
groups.sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a.key);
    const bi = STATUS_ORDER.indexOf(b.key);
    return (ai === -1 ? STATUS_ORDER.length : ai) - (bi === -1 ? STATUS_ORDER.length : bi);
});
// Delivered section: latest delivery first, rather than inheriting the
// creation-date ordering every other group uses.
groups.forEach(group => {
    let rows = Array.from(group.rows);
    if (group.key === "3 - Delivered") {
        rows.sort((a, b) => {
            const ad = deliveredMap[a.file.path] ? deliveredMap[a.file.path].getTime() : 0;
            const bd = deliveredMap[b.file.path] ? deliveredMap[b.file.path].getTime() : 0;
            return bd - ad;
        });
    }
    group.rows = rows;
});

let grandEst = 0;
let grandSpent = 0;
const COLS = 9; // Code, File, Area, Wave, Priority, Created, Delivered, Estimated, Spent
let html = `
<table style="width:100%; border-collapse:collapse; font-size:11px; line-height:1.15;">
    <thead>
        <tr style="background:#f0f0f0;">
            <th style="padding:3px 6px; text-align:left; border:1px solid #ddd; width:1%; white-space:nowrap;">Code</th>
            <th style="padding:3px 6px; text-align:left; border:1px solid #ddd;">File</th>
            <th style="padding:3px 6px; text-align:left; border:1px solid #ddd;">Area</th>
            <th style="padding:3px 6px; text-align:center; border:1px solid #ddd; width:1%; white-space:nowrap;" title="Roadmap wave (e.g. O2, M1)">Wave</th>
            <th style="padding:3px 4px; text-align:center; border:1px solid #ddd; width:1%; white-space:nowrap;" title="Priority">Pri</th>
            <th style="padding:3px 6px; text-align:left; border:1px solid #ddd; width:1%; white-space:nowrap;" title="Created">Made</th>
            <th style="padding:3px 6px; text-align:left; border:1px solid #ddd; width:1%; white-space:nowrap;" title="Delivered">Done</th>
            <th style="padding:3px 6px; text-align:right; border:1px solid #ddd; width:1%; white-space:nowrap;" title="Estimated">Est.</th>
            <th style="padding:3px 6px; text-align:right; border:1px solid #ddd; width:1%; white-space:nowrap;" title="Spent">Used</th>
        </tr>
    </thead>
    <tbody>
`;
groups.forEach(group => {
    let groupEst = 0;
    let groupSpent = 0;
    // Group Header
    html += `<tr><td colspan="${COLS}" style="font-weight:bold; padding:5px 6px; background:#f8f8f8; border:1px solid #ddd;">${group.key}</td></tr>`;
    group.rows.forEach(row => {
        const est = Number(row["ci-estimated-time"] || 0);
        const spent = Number(row["ci-time-spent"] || 0);

        groupEst += est;
        groupSpent += spent;
        grandEst += est;
        grandSpent += spent;

        // Build a proper Obsidian internal link manually
        const fileLink = `<a class="internal-link" data-href="${row.file.path}" href="${row.file.path}">${row.file.name}</a>`;
        const code = codeMap[row.file.path] || "-";
        const area = row["ci-area"] || "-";
        const wave = row["ci-roadmap"] || "-";
        const created = fmtDate(row["ci-date"]);
        // Only shown once a CI is actually Delivered — otherwise this would
        // just be "last logged work session," which isn't the same claim.
        const delivered = row["ci-status"] === "3 - Delivered" ? fmtDate(deliveredMap[row.file.path]) : "-";

        html += `
            <tr>
                <td style="padding:2px 6px; border:1px solid #ddd; white-space:nowrap;">${code}</td>
                <td style="padding:2px 6px; border:1px solid #ddd;">${fileLink}</td>
                <td style="padding:2px 6px; border:1px solid #ddd;">${area}</td>
                <td style="padding:2px 6px; border:1px solid #ddd; text-align:center; white-space:nowrap;">${wave}</td>
                <td style="padding:2px 4px; border:1px solid #ddd; text-align:center;">${priorityBadge(row["ci-priority"])}</td>
                <td style="padding:2px 6px; border:1px solid #ddd; white-space:nowrap;">${created}</td>
                <td style="padding:2px 6px; border:1px solid #ddd; white-space:nowrap;">${delivered}</td>
                <td style="padding:2px 6px; text-align:right; border:1px solid #ddd;">${est || "-"}</td>
                <td style="padding:2px 6px; text-align:right; border:1px solid #ddd;">${spent || "-"}</td>
            </tr>`;
    });
    // Group Total
    html += `
        <tr style="font-weight:bold; background:#f0f0f0;">
            <td style="padding:4px 6px; border:1px solid #ddd;">Total</td>
            <td style="padding:4px 6px; border:1px solid #ddd;"></td>
            <td style="padding:4px 6px; border:1px solid #ddd;"></td>
            <td style="padding:4px 6px; border:1px solid #ddd;"></td>
            <td style="padding:4px 6px; border:1px solid #ddd;"></td>
            <td style="padding:4px 6px; border:1px solid #ddd;"></td>
            <td style="padding:4px 6px; border:1px solid #ddd;"></td>
            <td style="padding:4px 6px; text-align:right; border:1px solid #ddd;">${groupEst}</td>
            <td style="padding:4px 6px; text-align:right; border:1px solid #ddd;">${groupSpent}</td>
        </tr>`;
});
html += `</tbody></table>`;
dv.el("div", html);
dv.paragraph(`**Grand Total** — Estimated: **${grandEst}** | Spent: **${grandSpent}**`);

```

