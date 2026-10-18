"use strict";
/**
 * Vorlagen und Variablen für die Zuordnung Saltcorn-Datensatz -> Kimai.
 *
 *  {feld}      Wert eines Tabellenfeldes, z.B. {facilitynr}
 *  {feld:4}    links mit Nullen auf 4 Stellen aufgefüllt, z.B. {facilitynr:4} -> 0815
 *  {feld[0:4]} Ausschnitt (Zeichen 0 bis 4), z.B. {certnr[0:4]} -> 0815 aus 08150002
 *  {feld[0:4]:8} erst auf 8 Stellen auffüllen, dann ausschneiden
 *  {$name}     Variable aus der Plugin-Konfiguration (Schritt 2) oder eingebaute
 *              Datumsvariable, z.B. {$kunde} oder {$jahresbeginn}
 *
 * Variablen dürfen selbst Feld-Platzhalter und andere Variablen enthalten
 * (max. 5 Ebenen). Leere Feldwerte sind ein Fehler, damit nie „alle Kunden“
 * oder ein falscher Kunde angezeigt wird.
 */

class TemplateError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.mapping_error = true;
  }
}

const PH = /\{(\$?)([a-zA-Z0-9_]+)(?:\[(\d{1,2}):(\d{1,2})\])?(?::(\d{1,2}))?\}/g;
const VAR_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

/** Voreinstellungen, solange in der Plugin-Konfiguration nichts anderes steht. */
const DEFAULT_VARIABLES = {
  kunde: "[{facilitynr:4}]",
  projekt: "{facilitynr:4}",
  kimai_benutzer: "{email}",
  prozess_projekt: "{certnr:8}",
  prozess_kunde: "[{certnr[0:4]:8}]",
};

const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Eingebaute Datumsvariablen (Serverzeit). */
function dateVariables(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const minus = (days) => ymd(new Date(now.getTime() - days * 86400000));
  return {
    heute: ymd(now),
    jahr: String(y),
    vorjahr: String(y - 1),
    monat: pad2(m + 1),
    jahresbeginn: `${y}-01-01`,
    jahresende: `${y}-12-31`,
    vorjahresbeginn: `${y - 1}-01-01`,
    vorjahresende: `${y - 1}-12-31`,
    monatsbeginn: `${y}-${pad2(m + 1)}-01`,
    vor30tagen: minus(30),
    vor90tagen: minus(90),
    vor365tagen: minus(365),
  };
}

/** Variablenliste aus der Plugin-Konfiguration: { variables: [{var_name, var_value}] } */
function buildVariables(pluginCfg) {
  const vars = { ...DEFAULT_VARIABLES };
  const problems = [];
  const list = Array.isArray(pluginCfg && pluginCfg.variables) ? pluginCfg.variables : [];
  const seen = new Set();
  list.forEach((v, i) => {
    if (!v || (!v.var_name && !v.var_value)) return;
    const name = String(v.var_name || "").trim().replace(/^\$/, "");
    if (!VAR_NAME_RE.test(name)) return problems.push(`Eintrag ${i + 1}: ungültiger Name „${name}“`);
    if (seen.has(name)) return problems.push(`Eintrag ${i + 1}: Variable „${name}“ doppelt`);
    if (dateVariables()[name] !== undefined)
      return problems.push(`Eintrag ${i + 1}: „${name}“ ist eine eingebaute Datumsvariable`);
    seen.add(name);
    vars[name] = String(v.var_value == null ? "" : v.var_value);
  });
  return { vars, problems };
}

function fmtValue(v) {
  if (v instanceof Date && !isNaN(v)) return ymd(v);
  if (typeof v === "boolean") return v ? "ja" : "nein";
  if (v && typeof v === "object" && v.id !== undefined) return String(v.id);
  return String(v);
}

/** Feld- und Variablennamen einer Vorlage (zur Anzeige/Prüfung). */
function placeholders(template) {
  return [...String(template || "").matchAll(PH)].map((m) => (m[1] ? "$" : "") + m[2]);
}

/**
 * Füllt eine Vorlage.
 * @param {string} template
 * @param {object} row       Datensatz (Felder)
 * @param {object} vars      Variablen (aus buildVariables().vars)
 * @param {object} opts      { strict=true, blocked=[] }
 */
function fill(template, row, vars, { strict = true, blocked = [] } = {}, depth = 0) {
  if (depth > 5) throw new TemplateError("Variablen verweisen zu tief aufeinander (Zirkelbezug?)", 500);
  const missing = [];
  const allVars = { ...dateVariables(), ...(vars || {}) };
  const out = String(template == null ? "" : template).replace(PH, (_, isVar, k, from, to, pad) => {
    let v;
    if (isVar) {
      if (allVars[k] === undefined) throw new TemplateError(`Unbekannte Variable {$${k}}`, 500);
      v = fill(allVars[k], row, vars, { strict, blocked }, depth + 1);
    } else {
      const raw = blocked.includes(k) ? undefined : row ? row[k] : undefined;
      if (raw === undefined || raw === null || String(raw).trim() === "") {
        missing.push(k);
        return "";
      }
      v = fmtValue(raw).replace(/[\u0000-\u001f]/g, "");
    }
    // erst auffüllen, dann ausschneiden: {certnr[0:4]:8} -> 1000001 -> 01000001 -> 0100
    if (pad) v = String(v).padStart(Number(pad), "0");
    if (from !== undefined) v = String(v).slice(Number(from), Number(to));
    return v;
  });
  if (strict && missing.length)
    throw new TemplateError(
      `Für diesen Datensatz ist kein Wert für ${missing.map((m) => `{${m}}`).join(", ")} hinterlegt`
    );
  return out;
}

/** YYYY-MM-DD prüfen; leer -> null */
function isoDay(s) {
  const v = String(s == null ? "" : s).trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new TemplateError(`Ungültiges Datum „${v}“ (erwartet JJJJ-MM-TT)`);
  const d = new Date(v + "T00:00:00Z");
  if (isNaN(d) || d.toISOString().slice(0, 10) !== v) throw new TemplateError(`Ungültiges Datum „${v}“`);
  return v;
}

/** Zeitraum-Vorgabe einer View -> { from, to } (YYYY-MM-DD oder null) */
function rangePreset(preset, { row, vars, from_template, to_template } = {}, now = new Date()) {
  const d = dateVariables(now);
  switch (preset) {
    case "year":
      return { from: d.jahresbeginn, to: d.jahresende };
    case "last_year":
      return { from: d.vorjahresbeginn, to: d.vorjahresende };
    case "365":
      return { from: d.vor365tagen, to: d.heute };
    case "90":
      return { from: d.vor90tagen, to: d.heute };
    case "30":
      return { from: d.vor30tagen, to: d.heute };
    case "month":
      return { from: d.monatsbeginn, to: d.heute };
    case "template": {
      const f = from_template ? fill(from_template, row || {}, vars, { strict: false }).trim() : "";
      const t = to_template ? fill(to_template, row || {}, vars, { strict: false }).trim() : "";
      return { from: isoDay(f.slice(0, 10)), to: isoDay(t.slice(0, 10)) };
    }
    default:
      return { from: null, to: null };
  }
}

module.exports = {
  TemplateError,
  DEFAULT_VARIABLES,
  dateVariables,
  buildVariables,
  placeholders,
  fill,
  isoDay,
  rangePreset,
  ymd,
};
