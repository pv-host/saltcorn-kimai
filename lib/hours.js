"use strict";
/**
 * Serverseitige Darstellung „Stunden“: die letzten N Stundeneinträge eines
 * Datensatzes (Facility oder Prozess), optional mit Summen. Kein JavaScript nötig.
 */
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayDE = (s) => (s ? `${String(s).slice(8, 10)}.${String(s).slice(5, 7)}.${String(s).slice(0, 4)}` : "");
const hm = (sec) => {
  const t = Math.round((Number(sec) || 0) / 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const dec = (sec) => ((Number(sec) || 0) / 3600).toFixed(2).replace(".", ",");
const money = (v, cur) =>
  v === undefined || v === null || v === ""
    ? ""
    : Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur ? " " + cur : "");
const sum = (list) => list.reduce((a, e) => a + (Number(e.duration) || 0), 0);

/** Spalten: Schlüssel -> [Überschrift, Zelle(e), CSS] */
const COLUMNS = {
  datum: ["Datum", (e) => esc(dayDE(e.begin)), "text-nowrap"],
  zeit: ["Zeit", (e) => esc(String(e.begin || "").slice(11, 16) + (e.end ? "–" + String(e.end).slice(11, 16) : " läuft")), "text-nowrap"],
  dauer: ["Stunden", (e) => esc(hm(e.duration)), "text-end text-nowrap"],
  benutzer: ["Benutzer", (e) => esc(e.user), ""],
  kunde: ["Kunde", (e) => esc(e.customer_name), ""],
  projekt: ["Projekt", (e) => esc(e.project_name), ""],
  taetigkeit: ["Tätigkeit", (e) => esc(e.activity_name), ""],
  beschreibung: ["Beschreibung", (e) => `<span class="small">${esc(e.description)}</span>`, ""],
  betrag: ["Betrag", (e) => esc(money(e.rate, e.currency)), "text-end text-nowrap"],
};
const COLUMN_DEFAULTS = { datum: true, zeit: false, dauer: true, benutzer: true, kunde: false, projekt: "auto", taetigkeit: true, beschreibung: true, betrag: false };

/**
 * @param {object} o { entries (neueste zuerst, bereits begrenzt), total (Sekunden|null),
 *   totalCount, more (weitere vorhanden), config, showRates, links, multiProject, ownOnly }
 */
function renderHours(o) {
  const c = o.config || {};
  const entries = o.entries || [];
  const title = c.hours_title ? `<div class="fw-bold mb-1 kimai-hours-title">${esc(c.hours_title)}</div>` : "";
  if (!entries.length)
    return `<div class="kimai-hours">${title}<span class="text-muted small">${esc(
      c.hours_empty_text === undefined || c.hours_empty_text === null ? "Keine Stundeneinträge" : c.hours_empty_text
    )}</span></div>`;
  const cols = Object.keys(COLUMNS).filter((k) => {
    const v = c["col_" + k] === undefined ? COLUMN_DEFAULTS[k] : c["col_" + k];
    if (k === "betrag" && !o.showRates) return false;
    if (v === "auto") return !!o.multiProject;
    return v === true || v === "true" || v === "on";
  });
  const link = (e) =>
    o.links && c.hours_links
      ? ` <a href="${esc(`${o.links.base}/${o.links.locale}/team/timesheet/${e.id}/edit`)}" target="_blank" rel="noopener" class="text-muted small" title="In Kimai öffnen"><i class="fas fa-external-link-alt"></i></a>`
      : "";
  const shownSum = sum(entries);
  const sums = [];
  const mode = c.hours_sum || "shown";
  if (mode === "shown" || mode === "both") sums.push(`${entries.length} Einträge: <b>${hm(shownSum)} h</b> (${dec(shownSum)})`);
  if ((mode === "total" || mode === "both") && o.total !== null && o.total !== undefined)
    sums.push(`gesamt${o.rangeLabel ? " " + esc(o.rangeLabel) : ""}: <b>${hm(o.total)} h</b> (${dec(o.total)}) in ${o.totalCount} Einträgen`);
  const foot =
    (sums.length ? `<div class="small kimai-hours-sum">${sums.join(" · ")}</div>` : "") +
    (o.more && mode !== "total" && mode !== "both" ? `<div class="small text-muted">… ältere Einträge nicht dargestellt</div>` : "") +
    (o.ownOnly ? `<div class="small text-muted">nur eigene Einträge</div>` : "");
  if (c.hours_style === "list") {
    const tpl = (e) =>
      cols
        .map((k) => (k === "beschreibung" && !e.description ? "" : COLUMNS[k][1](e)))
        .filter(Boolean)
        .join(" · ");
    return `<div class="kimai-hours">${title}<ul class="list-unstyled mb-1">${entries
      .map((e) => `<li class="small">${tpl(e)}${link(e)}</li>`)
      .join("")}</ul>${foot}</div>`;
  }
  const head = cols.map((k) => `<th class="${COLUMNS[k][2]}">${COLUMNS[k][0]}</th>`).join("") + (o.links && c.hours_links ? "<th></th>" : "");
  const rows = entries
    .map((e) => "<tr>" + cols.map((k) => `<td class="${COLUMNS[k][2]}">${COLUMNS[k][1](e)}</td>`).join("") + (o.links && c.hours_links ? `<td>${link(e)}</td>` : "") + "</tr>")
    .join("");
  return `<div class="kimai-hours">${title}<div class="table-responsive"><table class="table table-sm mb-1"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>${foot}</div>`;
}

module.exports = { renderHours, COLUMNS, COLUMN_DEFAULTS, hm, dec };
