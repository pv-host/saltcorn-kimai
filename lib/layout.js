"use strict";
/**
 * Gemeinsames Tabellenlayout aller Kimai-Ansichten, angelehnt an Saltcorns
 * View-Typ „List“ (Saltcorn 1.6): gleiche Konfigurationsfelder (Register
 * „Layout“, gleiche Feldnamen wie List), gleiche CSS-Klassen und gleiches
 * Markup wie mkTable aus @saltcorn/markup:
 *
 *   <div class="table-responsive"><table class="table table-sm table-valign-middle ...">
 *     <thead><tr><th>…</th><th class="text-align-right">…</th></tr></thead>
 *     <tbody><tr><td>…</td><td class="text-align-right">…</td></tr></tbody>
 *   </table></div>
 *
 * Serverseitig (KimaiStunden) wird mkTable direkt verwendet, im Browser
 * (KimaiKunde, KimaiProjekt, KimaiDatensatz, KimaiUebersicht) baut
 * lib/browser.js dasselbe Markup aus layoutOptions() nach.
 */

let mkTable = null;
try {
  // Bei laufendem Saltcorn immer vorhanden; Rückfall nur für isolierte Tests
  mkTable = require("@saltcorn/markup").mkTable;
} catch (_) {
  mkTable = null;
}

const VALIGN = ["Middle", "Top", "Bottom"];

/**
 * Konfigurationsfelder wie List → „Layout options“.
 * @param {object} [showIf] optionale Bedingung, z.B. { hours_style: "table" }
 */
function layoutFields(showIf) {
  const w = showIf ? { showIf } : {};
  const tab = "Layout";
  return [
    { name: "_omit_header", label: "Kopfzeile ausblenden", sublabel: "Spaltenüberschriften nicht anzeigen", type: "Bool", tab, ...w },
    { name: "hide_null_columns", label: "Leere Spalten ausblenden", sublabel: "Spalte nicht anzeigen, wenn sie in keiner Zeile einen Wert hat", type: "Bool", tab, ...w },
    { name: "_hover_rows", label: "Zeilen hervorheben", sublabel: "Zeile unter dem Mauszeiger hervorheben", type: "Bool", tab, ...w },
    { name: "_striped_rows", label: "Zebrastreifen", sublabel: "Zeilen abwechselnd hinterlegen", type: "Bool", tab, ...w },
    { name: "_card_rows", label: "Zeilen als Karten", sublabel: "Jede Zeile in einer Karte, nicht von allen Themes unterstützt", type: "Bool", tab, ...w },
    { name: "_borderless", label: "Ohne Linien", sublabel: "Keine Linien zwischen den Zeilen", type: "Bool", tab, ...w },
    {
      name: "_cell_valign",
      label: "Vertikale Ausrichtung",
      type: "String",
      required: true,
      attributes: { options: [{ name: "Middle", label: "Mitte" }, { name: "Top", label: "Oben" }, { name: "Bottom", label: "Unten" }] },
      default: "Middle",
      tab,
      ...w,
    },
    { name: "_responsive_collapse", label: "Auf kleinen Bildschirmen untereinander", sublabel: "Spalten je Zeile untereinander statt nebeneinander", type: "Bool", tab, ...w },
    {
      name: "_collapse_breakpoint_px",
      label: "Umbruch unterhalb von (px)",
      type: "Integer",
      default: 760,
      tab,
      showIf: { ...(showIf || {}), _responsive_collapse: true },
    },
    {
      name: "_table_layout",
      label: "Tabellenlayout",
      type: "String",
      attributes: { options: [{ name: "Auto", label: "automatische Spaltenbreite" }, { name: "Fixed", label: "feste Spaltenbreite" }] },
      default: "Auto",
      tab,
      ...w,
    },
    { name: "_sticky_header", label: "Kopfzeile fixieren", sublabel: "Kopfzeile bleibt beim Blättern sichtbar", type: "Bool", tab, ...w },
  ];
}

const on = (v) => v === true || v === "true" || v === "on";

/**
 * Optionen aus der View-Konfiguration, wie List sie an mkTable übergibt.
 * Ergebnis ist reines JSON und wird auch an den Browser-Teil übergeben.
 */
function layoutOptions(config) {
  const c = config || {};
  let cls = "";
  if (on(c._hover_rows)) cls += "table-hover ";
  if (on(c._striped_rows)) cls += "table-striped ";
  if (on(c._card_rows)) cls += "table-card-rows ";
  if (on(c._borderless)) cls += "table-borderless ";
  const va = VALIGN.includes(c._cell_valign) ? c._cell_valign : "Middle";
  cls += `table-valign-${va.toLowerCase()} `;
  const bp = Number(c._collapse_breakpoint_px);
  return {
    class: cls,
    noHeader: on(c._omit_header),
    hideNull: on(c.hide_null_columns),
    sticky: on(c._sticky_header),
    fixed: c._table_layout === "Fixed",
    collapse: on(c._responsive_collapse),
    breakpoint: bp > 0 ? Math.round(bp) : 760,
  };
}

const blank = (v) => v === undefined || v === null || String(v).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "").trim() === "";

/** Spalten entfernen, die in keiner Zeile einen Wert haben (wie List „Hide null columns“). */
function removeNullColumns(hdrs, rows) {
  return hdrs.filter((h) => h.keep || rows.some((r) => !blank(typeof h.key === "function" ? h.key(r) : r[h.key])));
}

const escAttr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** CSS für „untereinander auf kleinen Bildschirmen“, wie mkTable. */
function collapseCss(id, labels, bp) {
  const s = `#${id}`;
  return (
    `<style>@media only screen and (max-width: ${bp}px) {` +
    `${s} table, ${s} thead, ${s} tbody, ${s} th, ${s} td, ${s} tr { display: block; }` +
    `${s} td.text-align-right, ${s} th.text-align-right { text-align: left !important; }` +
    `${s} thead tr { position: absolute; top: -9999px; left: -9999px; }` +
    `${s} tr { border: 1px solid #ccc; } ${s} tr:not(:first-child) { border-top-width: 3px }` +
    `${s} td { border: none; border-bottom: 1px solid #eee; position: relative; padding-left: 50%; min-height: 1.5lh; }` +
    `${s} td:before { position: absolute; top: 6px; left: 6px; width: 45%; padding-right: 10px; white-space: nowrap; }` +
    labels.map((l, i) => `${s} td:nth-of-type(${i + 1}):before { content: "${String(l).replace(/["\\<>]/g, "")}"; }`).join("") +
    `}</style>`
  );
}

/** Eigenes Markup wie mkTable (Rückfall ohne @saltcorn/markup). */
function fallbackTable(hdrs, rows, o) {
  const al = (h) => (h.align ? ` class="text-align-${h.align}"` : "");
  const cls = ["table table-sm", o.class, o.table_layout === "Fixed" && "table-layout-fixed"].filter(Boolean).join(" ");
  const head = o.noHeader
    ? ""
    : `<thead${o.sticky_header ? ' class="sticky-top"' : ""}><tr>${hdrs.map((h) => `<th${al(h)}>${h.label}</th>`).join("")}</tr></thead>`;
  const body = rows.map((r) => `<tr>${hdrs.map((h) => `<td${al(h)}>${typeof h.key === "function" ? h.key(r) : r[h.key]}</td>`).join("")}</tr>`).join("");
  const wrapCls = o.sticky_header ? "" : ' class="table-responsive"';
  return `<div${wrapCls}${o.tableId ? ` id="${escAttr(o.tableId)}"` : ""}><table class="${cls}">${head}<tbody>${body}</tbody></table></div>`;
}

/**
 * Serverseitige Tabelle im List-Layout.
 * @param {Array<{label:string,key:Function|string,align?:string,keep?:boolean}>} hdrs
 * @param {Array<object>} rows
 * @param {object} lo Ergebnis von layoutOptions()
 * @param {string} [tableId] nötig für „untereinander auf kleinen Bildschirmen“
 */
function renderTable(hdrs, rows, lo, tableId) {
  const cols = lo.hideNull ? removeNullColumns(hdrs, rows) : hdrs;
  const opts = { class: lo.class, noHeader: lo.noHeader };
  if (lo.sticky) opts.sticky_header = true;
  if (lo.fixed) opts.table_layout = "Fixed";
  const id = lo.collapse && tableId ? tableId : null;
  if (id) {
    opts.responsiveCollapse = true;
    opts.collapse_breakpoint_px = lo.breakpoint;
    opts.tableId = id;
  }
  if (mkTable) return mkTable(cols, rows, opts);
  return fallbackTable(cols, rows, opts) + (id ? collapseCss(id, cols.map((h) => h.label), lo.breakpoint) : "");
}

module.exports = { layoutFields, layoutOptions, removeNullColumns, renderTable, collapseCss, LAYOUT_FIELD_NAMES: layoutFields().map((f) => f.name) };
