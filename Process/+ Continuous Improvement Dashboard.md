


```dataviewjs
const pages = dv.pages('"JobSearch Camunda/Process/CI"')
    .sort(p => p["ci-date"], 'desc');
const groups = pages.groupBy(p => p["ci-status"] || "No Status");
let grandEst = 0;
let grandSpent = 0;
let html = `
<table style="width:100%; border-collapse:collapse; font-size:13px; line-height:1.1;">
    <thead>
        <tr style="background:#f0f0f0;">
            <th style="padding:4px 8px; text-align:left; border:1px solid #ddd;">Status</th>
            <th style="padding:4px 8px; text-align:left; border:1px solid #ddd;">File</th>
            <th style="padding:4px 8px; text-align:left; border:1px solid #ddd;">Priority</th>
            <th style="padding:4px 8px; text-align:right; border:1px solid #ddd;">Estimated</th>
            <th style="padding:4px 8px; text-align:right; border:1px solid #ddd;">Spent</th>
        </tr>
    </thead>
    <tbody>
`;
groups.forEach(group => {
    let groupEst = 0;
    let groupSpent = 0;
    // Group Header
    html += `<tr><td colspan="5" style="font-weight:bold; padding:6px 8px; background:#f8f8f8; border:1px solid #ddd;">${group.key}</td></tr>`;
    group.rows.forEach(row => {
        const est = Number(row["ci-estimated-time"] || 0);
        const spent = Number(row["ci-time-spent"] || 0);

        groupEst += est;
        groupSpent += spent;
        grandEst += est;
        grandSpent += spent;

        // Build a proper Obsidian internal link manually
        const fileLink = `<a class="internal-link" data-href="${row.file.path}" href="${row.file.path}">${row.file.name}</a>`;

        html += `
            <tr>
                <td style="padding:3px 8px; border:1px solid #ddd;"></td>
                <td style="padding:3px 8px; border:1px solid #ddd;">${fileLink}</td>
                <td style="padding:3px 8px; border:1px solid #ddd;">${row["ci-priority"] || ""}</td>
                <td style="padding:3px 8px; text-align:right; border:1px solid #ddd;">${est || "-"}</td>
                <td style="padding:3px 8px; text-align:right; border:1px solid #ddd;">${spent || "-"}</td>
            </tr>`;
    });
    // Group Total
    html += `
        <tr style="font-weight:bold; background:#f0f0f0;">
            <td style="padding:4px 8px; border:1px solid #ddd;">Total</td>
            <td style="padding:4px 8px; border:1px solid #ddd;"></td>
            <td style="padding:4px 8px; border:1px solid #ddd;"></td>
            <td style="padding:4px 8px; text-align:right; border:1px solid #ddd;">${groupEst}</td>
            <td style="padding:4px 8px; text-align:right; border:1px solid #ddd;">${groupSpent}</td>
        </tr>`;
});
html += `</tbody></table>`;
dv.el("div", html);
dv.paragraph(`**Grand Total** — Estimated: **${grandEst}** | Spent: **${grandSpent}**`);

```

