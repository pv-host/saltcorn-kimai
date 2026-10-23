"use strict";
/**
 * Serverseitige Darstellung „Stunden“: die letzten N Stundeneinträge eines
 * Datensatzes (Entity oder Prozess), optional mit Summen. Kein JavaScript nötig.
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
const { layoutOptions, renderTable } = require("./layout");
const sum = (list) => list.reduce((a, e) => a + (Number(e.duration) || 0), 0);

/** Spalten: Schlüssel -> [Überschrift, Zelle(e), Ausrichtung] – Namen und Reihenfolge wie in allen Kimai-Ansichten */
const running = '<span class="badge bg-success">läuft</span>';
const COLUMNS = {
  datum: ["Datum", (e) => esc(dayDE(e.begin)), ""],
  zeit: ["Zeit", (e) => esc(String(e.begin || "").slice(11, 16)) + (e.end ? "–" + esc(String(e.end).slice(11, 16)) : " " + running), ""],
  dauer: ["Stunden", (e) => esc(hm(e.duration)), "right"],
  benutzer: ["Benutzer", (e) => esc(e.user), ""],
  kunde: ["Kunde", (e) => esc(e.customer_name), ""],
  projekt: ["Projekt", (e) => esc(e.project_name), ""],
  taetigkeit: ["Tätigkeit", (e) => esc(e.activity_name), ""],
  beschreibung: ["Beschreibung", (e) => esc(e.description), ""],
  betrag: ["Betrag", (e) => esc(money(e.rate, e.currency)), "right"],
};
const COLUMN_DEFAULTS = { datum: true, zeit: false, dauer: true, benutzer: true, kunde: false, projekt: "auto", taetigkeit: true, beschreibung: true, betrag: false };

/**
 * @param {object} o { tableId (für „untereinander“), entries (neueste zuerst, bereits begrenzt), total (Sekunden|null),
 *   totalCount, more (weitere vorhanden), config, showRates, links, multiProject, ownOnly }
 */
function renderHours(o) {
  const c = o.config || {};
  const entries = o.entries || [];
  const title = c.hours_title ? `<div class="fw-bold mb-1 kimai-title">${esc(c.hours_title)}</div>` : "";
  if (!entries.length)
    return `<div class="kimai-hours">${title}<div class="text-muted small kimai-empty">${esc(
      c.hours_empty_text === undefined || c.hours_empty_text === null ? "Keine Stundeneinträge" : c.hours_empty_text
    )}</div></div>`;
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
    (sums.length ? `<div class="small kimai-sum">${sums.join(" · ")}</div>` : "") +
    (o.more && mode !== "total" && mode !== "both" ? `<div class="small text-muted kimai-hint">… ältere Einträge nicht dargestellt</div>` : "") +
    (o.ownOnly ? `<div class="small text-muted kimai-hint">nur eigene Einträge</div>` : "");
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
  const hdrs = cols.map((k) => ({ label: COLUMNS[k][0], key: COLUMNS[k][1], ...(COLUMNS[k][2] ? { align: COLUMNS[k][2] } : {}) }));
  if (o.links && c.hours_links) hdrs.push({ label: "", key: (e) => link(e), keep: true });
  const table = renderTable(hdrs, entries, layoutOptions(c), o.tableId);
  return `<div class="kimai-hours">${title}${table}${foot}</div>`;
}

module.exports = { renderHours, COLUMNS, COLUMN_DEFAULTS, hm, dec };
