"use strict";
/**
 * Saltcorn-Plugin: Kimai (Zeiterfassung) – nur lesend
 *
 * View-Typen (an eine Tabelle gebunden)
 *  - KimaiStunden:   zugeordnete Stunden einer Entity oder eines Prozesses,
 *                    die letzten N Einträge (z.B. 5–7), optional mit Summe
 *  - KimaiKunde:     Ebene Kunde, z.B. Tabelle entity – Kimai-Kunde über {$kunde}
 *  - KimaiProjekt:   Ebene Projekt, z.B. Tabelle projects – Kimai-Projekt über {$prozess_projekt}
 *  - KimaiDatensatz: frei konfigurierbar (Kunde und/oder Projekte über Vorlagen)
 *  Darstellung je View: Register, einzelne Liste (mit Zeilenbegrenzung), letzte
 *  Stundeneinträge oder letzter Stundeneintrag (nur Datum / nur Eintrag / beides).
 *
 * View-Typ ohne Tabelle
 *  - KimaiUebersicht: Kunden suchen und dieselben Register anzeigen.
 *
 * Aktionen: kimai_abgleich, kimai_abgleich_kunde, kimai_abgleich_projekt – schreiben
 *  Kunden-/Projekt-ID, Stunden und den letzten Stundeneintrag in Felder.
 */
const Workflow = require("@saltcorn/data/models/workflow");
const Form = require("@saltcorn/data/models/form");
const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Role = require("@saltcorn/data/models/role");
const { div, script, domReady } = require("@saltcorn/markup/tags");
const { KimaiClient, KimaiError, normalizeBase } = require("./lib/kimai");
const { buildVariables, DEFAULT_VARIABLES, dateVariables, fill, isoDay, rangePreset, TemplateError } = require("./lib/template");
const { MAPPING_DEFAULTS, MATCH_MODES, withDefaults, resolveRow, resolveCustomerId, timesheetScope, idOf } = require("./lib/resolve");
const { kimaiPanel } = require("./lib/browser");
const { layoutFields, layoutOptions } = require("./lib/layout");
const { renderHours } = require("./lib/hours");

function getFieldRepeat() {
  try {
    const mod = require("@saltcorn/data/models/fieldrepeat");
    return (mod && mod.default) || mod;
  } catch (_) {
    return null;
  }
}

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const SECRET_USER_FIELDS = ["password", "api_token", "verification_token", "reset_password_token", "reset_password_expiry", "_attributes"];

// ----------------------------------------------------------------------------
// Plugin-Konfiguration
// ----------------------------------------------------------------------------
function clientFrom(cfg) {
  const c = cfg || {};
  return new KimaiClient({
    base_url: c.base_url,
    auth_mode: c.auth_mode,
    token: c.token,
    username: c.username,
    timeout_ms: c.timeout_ms,
    cache_ttl_s: c.cache_ttl_s,
    timesheet_ttl_s: c.timesheet_ttl_s,
  });
}

const variableFields = () => [
  { name: "var_name", label: "Variable", sublabel: "ohne $, z.B. kunde", type: "String" },
  {
    name: "var_value",
    label: "Wert / Vorlage",
    sublabel: "Felder {feld}, {feld:4}, {feld[0:4]}; andere Variablen {$name}",
    type: "String",
  },
];

const configuration_workflow = () =>
  new Workflow({
    steps: [
      {
        name: "Kimai-Verbindung",
        form: async () =>
          new Form({
            fields: [
              {
                name: "base_url",
                label: "Kimai-URL",
                sublabel: "z.B. https://zeit.example.invalid (ohne /api). Bei Installation in Unterordner: https://host/kimai",
                type: "String",
                required: true,
              },
              {
                name: "auth_mode",
                label: "Anmeldung",
                type: "String",
                required: true,
                attributes: {
                  options: [
                    { name: "bearer", label: "API-Token (Kimai 2: Profil > API-Zugang)" },
                    { name: "legacy", label: "Alt: Benutzername + API-Passwort (X-AUTH-USER/X-AUTH-TOKEN)" },
                  ],
                },
                default: "bearer",
              },
              {
                name: "username",
                label: "Kimai-Benutzername (nur alte Anmeldung)",
                type: "String",
                showIf: { auth_mode: "legacy" },
              },
              {
                name: "token",
                label: "API-Token / API-Passwort",
                sublabel:
                  "Eigener Kimai-Benutzer nur für Saltcorn empfohlen. Rolle mit Lesezugriff auf Kunden, Projekte, Tätigkeiten und auf Zeiteinträge aller Benutzer (view_other_timesheet)",
                type: "String",
                input_type: "password",
                required: true,
              },
              { name: "timeout_ms", label: "Timeout (ms)", type: "Integer", default: 30000 },
              {
                name: "cache_ttl_s",
                label: "Zwischenspeicher Kunden/Projekte/Tätigkeiten (Sekunden)",
                sublabel: "0 = jedes Mal neu laden. Bei vielen Projekten (5.000+) empfohlen: 300",
                type: "Integer",
                default: 300,
              },
              { name: "timesheet_ttl_s", label: "Zwischenspeicher Zeiteinträge (Sekunden)", type: "Integer", default: 60 },
              {
                name: "max_entries",
                label: "Höchstzahl Zeiteinträge je Abfrage",
                sublabel: "Schutz vor sehr großen Abfragen; darüber wird die Anzeige begrenzt",
                type: "Integer",
                default: 5000,
              },
              { name: "ui_links", label: "Links „In Kimai öffnen“ anzeigen", type: "Bool", default: true },
              { name: "ui_locale", label: "Sprache der Kimai-Links", type: "String", default: "de" },
            ],
          }),
      },
      {
        name: "Zuordnungsvariablen",
        form: async (context) => {
          const FieldRepeat = getFieldRepeat();
          const { vars, problems } = buildVariables(context || {});
          let test = "";
          try {
            const v = await clientFrom(context).version();
            test = `<div class="alert alert-success py-1">Verbindung zu Kimai ${esc((v && (v.version || v.semver)) || "")} hergestellt.</div>`;
          } catch (e) {
            test = `<div class="alert alert-danger py-1">Verbindungstest: ${esc(e.message)}</div>`;
          }
          const dv = dateVariables();
          const intro =
            test +
            '<p class="mb-1">Variablen legen die <b>Abhängigkeiten</b> zwischen Saltcorn und Kimai zentral fest. ' +
            "Views und Aktionen verwenden sie in Vorlagen als <code>{$name}</code>, z.B. Kunde „Name beginnt mit“ <code>{$kunde}</code>. " +
            "Ändern Sie hier eine Variable, gilt das für alle Views.</p>" +
            '<p class="mb-1 small">Aktuell wirksam: ' +
            Object.entries(vars)
              .map(([k, v]) => `<code>{$${esc(k)}}</code> = <code>${esc(v)}</code>`)
              .join(", ") +
            (Object.keys(DEFAULT_VARIABLES).some((k) => !(context.variables || []).some((x) => x && x.var_name === k))
              ? " (nicht eingetragene Standardvariablen gelten mit Vorgabewert)"
              : "") +
            "</p>" +
            '<p class="mb-1 small text-muted">Eingebaute Datumsvariablen: ' +
            Object.keys(dv)
              .map((k) => `<code>{$${k}}</code>`)
              .join(" ") +
            "</p>" +
            (problems.length
              ? '<div class="alert alert-warning py-1"><b>Werden ignoriert:</b><ul class="mb-0">' +
                problems.map((p) => "<li>" + esc(p) + "</li>").join("") +
                "</ul></div>"
              : "");
          const fields = [new Field({ name: "_var_intro", label: " ", input_type: "custom_html", attributes: { html: intro } })];
          if (FieldRepeat) fields.push(new FieldRepeat({ name: "variables", label: "Variablen", fields: variableFields() }));
          return new Form({ fields });
        },
      },
    ],
  });

// ----------------------------------------------------------------------------
// Hilfen
// ----------------------------------------------------------------------------
const roleOf = (req) => (req && req.user && req.user.id ? req.user.role_id : 100);
const allowed = (req, minRole, fallback) => {
  const v = minRole === undefined || minRole === null || minRole === "" ? fallback : minRole;
  return roleOf(req) <= Number(v);
};

async function roleOptions() {
  const roles = await Role.find({}, { orderBy: "id" });
  return roles.map((r) => ({ label: r.role, name: `${r.id}` }));
}

const errJson = (e, extra) => ({
  // bewusst nicht „error“: Saltcorn würde zusätzlich eine Meldung einblenden
  json: { kimai_error: (e && e.message) || "Unbekannter Fehler", status: (e && e.status) || 500, ...(extra || {}) },
});

const pick = (o, keys) => {
  const out = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
};

/** Nur die für die Anzeige nötigen Felder an den Browser geben. */
function publicData(resolved, mappingCfg) {
  const custName = new Map(resolved.customers.map((c) => [c.id, c.name]));
  const projName = new Map(resolved.projects.map((p) => [p.id, p.name]));
  const info = resolved.info || {};
  return {
    customers: resolved.customers.map((c) => pick(c, ["id", "name", "number", "comment", "visible", "billable", "currency", "color"])),
    projects: resolved.projects.map((p) => {
      const cid = Number(idOf(p.customer));
      return {
        ...pick(p, ["id", "name", "number", "orderNumber", "comment", "visible", "billable", "start", "end"]),
        customer: cid,
        customer_name: custName.get(cid) || p.parentTitle || "",
      };
    }),
    activities: resolved.activities.map((a) => {
      const pid = a.project === null || a.project === undefined ? null : Number(idOf(a.project));
      return {
        ...pick(a, ["id", "name", "number", "comment", "visible", "billable"]),
        project: pid,
        project_name: pid ? projName.get(pid) || a.parentTitle || "" : "",
      };
    }),
    mapping: {
      customer_value: info.customer_value,
      customer_label: info.customer_match === "id" ? "Kimai-ID" : MATCH_MODES[info.customer_match] || "",
      project_value: info.project_value,
      project_label: info.project_match ? MATCH_MODES[info.project_match] || "" : "",
    },
  };
}

const userName = (u) => (u && typeof u === "object" ? u.alias || u.username || `#${u.id}` : u ? `#${u}` : "");

/** Kimai-Zeiteintrag -> Anzeigeobjekt */
function publicEntry(t, maps, showRates) {
  const proj = t.project && typeof t.project === "object" ? t.project : null;
  const pid = Number(idOf(t.project));
  const cust = proj && proj.customer && typeof proj.customer === "object" ? proj.customer : null;
  const cid = cust ? cust.id : maps.projCust.get(pid);
  const act = t.activity && typeof t.activity === "object" ? t.activity : null;
  const aid = Number(idOf(t.activity));
  let duration = Number(t.duration) || 0;
  if (!t.end && t.begin) duration = Math.max(0, (Date.now() - new Date(t.begin).getTime()) / 1000);
  const out = {
    id: t.id,
    begin: t.begin,
    end: t.end || null,
    duration,
    user_id: Number(idOf(t.user)),
    user: userName(t.user),
    customer: cid,
    customer_name: (cust && cust.name) || maps.custName.get(cid) || "",
    project: pid,
    project_name: (proj && proj.name) || maps.projName.get(pid) || "",
    activity: aid,
    activity_name: (act && act.name) || maps.actName.get(aid) || "",
    description: t.description || "",
    exported: !!t.exported,
    billable: t.billable !== false,
    tags: Array.isArray(t.tags) ? t.tags : [],
  };
  if (showRates) {
    out.rate = t.rate;
    out.currency = (cust && cust.currency) || maps.custCur.get(cid) || "";
  }
  return out;
}

function lookupMaps(resolved) {
  return {
    custName: new Map(resolved.customers.map((c) => [c.id, c.name])),
    custCur: new Map(resolved.customers.map((c) => [c.id, c.currency])),
    projName: new Map(resolved.projects.map((p) => [p.id, p.name])),
    projCust: new Map(resolved.projects.map((p) => [p.id, Number(idOf(p.customer))])),
    actName: new Map(resolved.activities.map((a) => [a.id, a.name])),
  };
}

/** Kimai-Benutzer des angemeldeten Saltcorn-Benutzers (für „nur eigene Einträge“). */
function ownUserKey(config, req, vars) {
  if (!req || !req.user || !req.user.id) return null;
  try {
    const v = fill(config.kimai_user_template || "{$kimai_benutzer}", req.user, vars, { blocked: SECRET_USER_FIELDS });
    return String(v).trim().toLocaleLowerCase("de-DE") || null;
  } catch (_) {
    return null;
  }
}
const isOwnEntry = (t, key) => {
  if (!key || !t.user || typeof t.user !== "object") return false;
  return [t.user.username, t.user.alias, t.user.email].some((x) => x && String(x).trim().toLocaleLowerCase("de-DE") === key);
};

/** Stundeneinträge im aufgelösten Bereich laden und filtern. */
async function loadEntries(client, pluginCfg, config, resolved, body, req, vars, opts = {}) {
  const scope = timesheetScope(resolved);
  const ids = scope.customers || scope.projects;
  const base = { entries: [], truncated: false, own_only: false };
  if (!ids.length) return base;
  const filter = { ...scope };
  const projectIds = new Set(resolved.projects.map((p) => p.id));
  if (body.project !== undefined && body.project !== null && body.project !== "") {
    const pid = Number(body.project);
    if (!projectIds.has(pid)) throw new KimaiError("Projekt gehört nicht zu diesem Datensatz", 403);
    filter.customers = [];
    filter.projects = [pid];
  }
  if (body.activity !== undefined && body.activity !== null && body.activity !== "") {
    if (!/^\d+$/.test(String(body.activity))) throw new KimaiError("Ungültige Tätigkeit", 400);
    filter.activities = [Number(body.activity)];
  }
  const from = isoDay(body.from);
  const to = isoDay(body.to);
  if (from && to && from > to) throw new TemplateError("„Von“ liegt nach „Bis“");
  if (from) filter.begin = from + "T00:00:00";
  if (to) filter.end = to + "T23:59:59";
  for (const k of ["exported", "billable"]) if (body[k] === "0" || body[k] === "1") filter[k] = body[k];
  const ownOnly = !allowed(req, config.min_role_all_users, "40");
  const pluginMax = Number(pluginCfg.max_entries) > 0 ? Number(pluginCfg.max_entries) : 5000;
  // Kleine Abfragen (letzte Einträge): nur so viele holen wie nötig. Bei „nur eigene“
  // wird erst nach dem Abruf gefiltert, deshalb dann der volle Umfang.
  const max = opts.max && !ownOnly ? opts.max : pluginMax;
  const r = await client.timesheets(filter, { max: Math.min(max, pluginMax), size: Math.min(500, max) });
  let entries = r.entries;
  // Sicherheitsnetz: nur Einträge der zugeordneten Projekte/Kunden
  const custIds = new Set(resolved.customers.map((c) => c.id));
  entries = entries.filter((t) => {
    const pid = Number(idOf(t.project));
    if (scope.projects) return projectIds.has(pid);
    const proj = t.project && typeof t.project === "object" ? t.project : null;
    const cid = proj && proj.customer ? Number(idOf(proj.customer)) : null;
    return projectIds.has(pid) || (cid !== null && custIds.has(cid));
  });
  let own_only = false;
  if (ownOnly) {
    own_only = true;
    const key = ownUserKey(config, req, vars);
    entries = entries.filter((t) => isOwnEntry(t, key));
  }
  if (body.user !== undefined && body.user !== null && body.user !== "") {
    const uid = Number(body.user);
    entries = entries.filter((t) => Number(idOf(t.user)) === uid);
  }
  const maps = lookupMaps(resolved);
  const showRates = allowed(req, config.min_role_rates, "1");
  let out = entries.map((t) => publicEntry(t, maps, showRates));
  let truncated = r.truncated;
  if (opts.max && out.length > opts.max) {
    out = out.slice(0, opts.max);
    truncated = true;
  }
  return { entries: out, truncated, own_only };
}

// ----------------------------------------------------------------------------
// Letzter Stundeneintrag
// ----------------------------------------------------------------------------
const LAST_ENTRY_DEFAULT = "{benutzer}: {taetigkeit} ({dauer} h) – {beschreibung}";
const LAST_PLACEHOLDERS = ["datum", "uhrzeit", "ende", "dauer", "dauer_dezimal", "benutzer", "kunde", "projekt", "taetigkeit", "beschreibung", "exportiert", "abrechenbar"];

const dayDE = (s) => (s ? `${String(s).slice(8, 10)}.${String(s).slice(5, 7)}.${String(s).slice(0, 4)}` : "");
const hmOf = (sec) => {
  const t = Math.round((Number(sec) || 0) / 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** Datum des Eintrags je Format: date | datetime | iso | relative */
function lastDateText(e, format, now = new Date()) {
  const d = String(e.begin || "").slice(0, 10);
  if (format === "iso") return d;
  if (format === "datetime") return `${dayDE(e.begin)} ${String(e.begin).slice(11, 16)}`;
  if (format === "relative") {
    const days = Math.round((Date.parse(dateVariables(now).heute + "T00:00:00Z") - Date.parse(d + "T00:00:00Z")) / 86400000);
    if (days <= 0) return "heute";
    if (days === 1) return "gestern";
    return `vor ${days} Tagen`;
  }
  return dayDE(e.begin);
}

/** Text des Eintrags aus der Vorlage; leere Platzhalter samt Trennzeichen am Ende entfallen. */
function lastEntryText(e, template) {
  const v = {
    datum: dayDE(e.begin),
    uhrzeit: String(e.begin || "").slice(11, 16),
    ende: e.end ? String(e.end).slice(11, 16) : "läuft",
    dauer: hmOf(e.duration),
    dauer_dezimal: ((Number(e.duration) || 0) / 3600).toFixed(2).replace(".", ","),
    benutzer: e.user,
    kunde: e.customer_name,
    projekt: e.project_name,
    taetigkeit: e.activity_name,
    beschreibung: e.description,
    exportiert: e.exported ? "exportiert" : "",
    abrechenbar: e.billable === false ? "nicht abrechenbar" : "abrechenbar",
  };
  return String(template || LAST_ENTRY_DEFAULT)
    .replace(/\{([a-z_]+)\}/g, (m, k) => (LAST_PLACEHOLDERS.includes(k) ? String(v[k] == null ? "" : v[k]) : m))
    .replace(/\(\s*\)/g, "")
    .replace(/[\s–\-:,;|]+$/u, "")
    .trim();
}

/** Neuesten Stundeneintrag im aufgelösten Bereich holen (oder null). */
async function lastEntry(client, pluginCfg, config, resolved, req, vars) {
  const running = config.last_include_running === true;
  const r = await loadEntries(client, pluginCfg, config, resolved, {}, req, vars, { max: running ? 1 : 10 });
  return r.entries.find((e) => running || e.end) || null;
}

function renderLast(display, entry, config, links) {
  const empty = config.last_empty_text === undefined || config.last_empty_text === null ? "kein Stundeneintrag" : config.last_empty_text;
  const label = config.last_label ? `<span class="kimai-last-label">${esc(config.last_label)}</span> ` : "";
  if (!entry) return `<span class="kimai-last text-muted">${label}${esc(empty)}</span>`;
  const date = `<span class="kimai-last-date" title="${esc(dayDE(entry.begin) + " " + String(entry.begin).slice(11, 16))}">${esc(lastDateText(entry, config.last_date_format || "date"))}</span>`;
  const text = `<span class="kimai-last-entry">${esc(lastEntryText(entry, config.last_entry_template))}</span>`;
  const link =
    links && config.last_link
      ? ` <a href="${esc(`${links.base}/${links.locale}/team/timesheet/${entry.id}/edit`)}" target="_blank" rel="noopener" class="text-muted small" title="In Kimai öffnen"><i class="fas fa-external-link-alt"></i></a>`
      : "";
  const body = display === "last_date" ? date : display === "last_entry" ? text : `${date}${config.last_separator === undefined ? ": " : esc(config.last_separator)}${text}`;
  return `<span class="kimai-last">${label}${body}${link}</span>`;
}

// ----------------------------------------------------------------------------
// Konfigurationsfelder: Zuordnung (View und Aktion)
// ----------------------------------------------------------------------------
const matchOptions = (keys) => keys.map((k) => ({ name: k, label: MATCH_MODES[k] || k }));

function mappingFields(fieldNames, allFieldsText) {
  return [
    {
      name: "customer_match",
      label: "Kimai-Kunde finden über",
      type: "String",
      required: true,
      attributes: {
        options: [
          ...matchOptions(["name_prefix", "name_exact", "name_contains", "number", "comment_contains", "id_field"]),
          { name: "none", label: "keine Kundenzuordnung (nur Projekte über Vorlage)" },
        ],
      },
      default: MAPPING_DEFAULTS.customer_match,
    },
    {
      name: "customer_value",
      label: "Vorlage Kunde",
      sublabel: `Variablen {$name} oder Felder {feld}, {feld:4}, {feld[0:4]}. Vorgabe {$kunde} = „${DEFAULT_VARIABLES.kunde}“. Felder: ${allFieldsText}`,
      type: "String",
      default: MAPPING_DEFAULTS.customer_value,
      showIf: { customer_match: ["name_prefix", "name_exact", "name_contains", "number", "comment_contains"] },
    },
    {
      name: "customer_id_field",
      label: "Feld mit Kimai-Kunden-ID",
      sublabel: "auch mehrere IDs, kommagetrennt",
      type: "String",
      attributes: { options: fieldNames },
      showIf: { customer_match: "id_field" },
    },
    {
      name: "project_scope",
      label: "Projekte",
      type: "String",
      required: true,
      attributes: {
        options: [
          { name: "customer", label: "alle Projekte der gefundenen Kunden" },
          { name: "customer_match", label: "Projekte der gefundenen Kunden, gefiltert über Vorlage" },
          { name: "match", label: "Projekte über Vorlage (alle Kunden)" },
        ],
      },
      default: MAPPING_DEFAULTS.project_scope,
    },
    {
      name: "project_match",
      label: "Projekt finden über",
      type: "String",
      attributes: {
        options: [
          ...matchOptions(["name_prefix", "name_exact", "name_contains", "number", "comment_contains", "id_field"]),
          { name: "order_number", label: "Kimai-Feld „Auftragsnummer“ ist gleich" },
        ],
      },
      default: MAPPING_DEFAULTS.project_match,
      showIf: { project_scope: ["customer_match", "match"] },
    },
    {
      name: "project_value",
      label: "Vorlage Projekt",
      sublabel: `Vorgabe {$projekt} = „${DEFAULT_VARIABLES.projekt}“, z.B. {reference_code} für Projects`,
      type: "String",
      default: MAPPING_DEFAULTS.project_value,
      showIf: { project_scope: ["customer_match", "match"] },
    },
    {
      name: "project_id_field",
      label: "Feld mit Kimai-Projekt-ID (nur bei „Kimai-ID steht in einem Feld“)",
      type: "String",
      attributes: { options: fieldNames },
      showIf: { project_scope: ["customer_match", "match"] },
    },
    {
      name: "activity_scope",
      label: "Tätigkeiten",
      type: "String",
      required: true,
      attributes: {
        options: [
          { name: "both", label: "projektbezogene der gefundenen Projekte + globale" },
          { name: "project", label: "nur projektbezogene" },
          { name: "global", label: "nur globale" },
        ],
      },
      default: MAPPING_DEFAULTS.activity_scope,
    },
    { name: "include_hidden", label: "Inaktive (versteckte) Kunden, Projekte und Tätigkeiten einbeziehen", type: "Bool", default: true },
  ];
}

/** Felder Ebene Kunde (z.B. Tabelle entity) */
function customerLevelFields(fieldNames, allFieldsText) {
  return mappingFields(fieldNames, allFieldsText)
    .map((f) => {
      if (f.name === "customer_match")
        return { ...f, attributes: { options: f.attributes.options.filter((o) => o.name !== "none") } };
      if (f.name === "project_scope")
        return { ...f, label: "Projekte des Kunden", attributes: { options: f.attributes.options.filter((o) => o.name !== "match") } };
      if (f.name === "project_match" || f.name === "project_value" || f.name === "project_id_field")
        return { ...f, showIf: { project_scope: "customer_match" } };
      return f;
    });
}

/** Felder Ebene Projekt (z.B. Tabelle projects) */
function projectLevelFields(fieldNames, allFieldsText) {
  return [
    {
      name: "project_match",
      label: "Kimai-Projekt finden über",
      type: "String",
      required: true,
      attributes: {
        options: [
          ...matchOptions(["name_exact", "name_prefix", "name_contains", "number", "comment_contains", "id_field"]),
          { name: "order_number", label: "Kimai-Feld „Auftragsnummer“ ist gleich" },
        ],
      },
      default: "name_exact",
    },
    {
      name: "project_value",
      label: "Vorlage Projekt",
      sublabel: `Vorgabe {$prozess_projekt} = „${DEFAULT_VARIABLES.prozess_projekt}“. Felder: ${allFieldsText}`,
      type: "String",
      default: "{$prozess_projekt}",
      showIf: { project_match: ["name_exact", "name_prefix", "name_contains", "number", "comment_contains", "order_number"] },
    },
    {
      name: "project_id_field",
      label: "Feld mit Kimai-Projekt-ID",
      type: "String",
      attributes: { options: fieldNames },
      showIf: { project_match: "id_field" },
    },
    {
      name: "project_within_customer",
      label: "Projekt nur beim zugehörigen Kimai-Kunden suchen",
      sublabel: "empfohlen: schneller und eindeutig. Aus: Suche in allen Projekten",
      type: "Bool",
      default: true,
    },
    {
      name: "customer_match",
      label: "Kimai-Kunde finden über",
      type: "String",
      attributes: { options: matchOptions(["name_prefix", "name_exact", "name_contains", "number", "comment_contains", "id_field"]) },
      default: "name_prefix",
      showIf: { project_within_customer: true },
    },
    {
      name: "customer_value",
      label: "Vorlage Kunde",
      sublabel: `Vorgabe {$prozess_kunde} = „${DEFAULT_VARIABLES.prozess_kunde}“`,
      type: "String",
      default: "{$prozess_kunde}",
      showIf: { project_within_customer: true },
    },
    {
      name: "customer_id_field",
      label: "Feld mit Kimai-Kunden-ID (nur bei „Kimai-ID steht in einem Feld“)",
      type: "String",
      attributes: { options: fieldNames },
      showIf: { project_within_customer: true },
    },
    ...mappingFields(fieldNames, allFieldsText).filter((f) => f.name === "activity_scope" || f.name === "include_hidden"),
  ];
}

const LEVELS = {
  kunde: {
    view: "KimaiKunde",
    description: "Kimai auf Ebene Kunde – z.B. Tabelle entity: Kunde, Projekte, Tätigkeiten, Stundeneinträge, letzter Eintrag",
    fields: customerLevelFields,
    labels: {},
    blurb: "Ebene Kunde: Zum Datensatz (z.B. Entity) wird der Kimai-Kunde gesucht, dazu seine Projekte. Variablen pflegen Sie zentral in der Plugin-Konfiguration, Schritt 2.",
  },
  projekt: {
    view: "KimaiProjekt",
    description: "Kimai auf Ebene Projekt – z.B. Tabelle projects: Projekt, Tätigkeiten, Stundeneinträge, letzter Eintrag",
    fields: projectLevelFields,
    labels: { projects: "Projekt" },
    blurb: "Ebene Projekt: Zum Datensatz (z.B. Prozess mit reference_code) wird das Kimai-Projekt gesucht. Stundeneinträge beziehen sich nur auf dieses Projekt.",
  },
  frei: {
    view: "KimaiDatensatz",
    description: "Kimai frei konfigurierbar zu einem Datensatz (Kunde und/oder Projekte über Vorlagen)",
    fields: mappingFields,
    labels: {},
    blurb: "Wie findet die View zum Datensatz den Kimai-Kunden und die Projekte? Variablen ({$kunde}, {$projekt} …) pflegen Sie zentral in der Plugin-Konfiguration, Schritt 2.",
  },
};

/** Konfiguration einer Ebene -> Zuordnungsregeln für resolveRow */
function mappingOf(level, c) {
  const conf = c || {};
  if (level === "kunde")
    return {
      ...conf,
      customer_match: !conf.customer_match || conf.customer_match === "none" ? "name_prefix" : conf.customer_match,
      project_scope: conf.project_scope === "customer_match" ? "customer_match" : "customer",
    };
  if (level === "projekt") {
    const within = conf.project_within_customer !== false;
    return {
      customer_match: within ? (!conf.customer_match || conf.customer_match === "none" ? "name_prefix" : conf.customer_match) : "none",
      customer_value: conf.customer_value || "{$prozess_kunde}",
      customer_id_field: conf.customer_id_field,
      project_scope: within ? "customer_match" : "match",
      project_match: conf.project_match || "name_exact",
      project_value: conf.project_value || "{$prozess_projekt}",
      project_id_field: conf.project_id_field,
      activity_scope: conf.activity_scope || "both",
      include_hidden: conf.include_hidden,
    };
  }
  return conf;
}

const DISPLAY_LIST = ["tabs", "customers", "projects", "activities", "timesheets", "timesheets_recent"];
const DISPLAY_LAST = ["last_date", "last_entry", "last_both"];

function displayOptions(level) {
  return [
    { name: "tabs", label: "Register (mehrere Inhalte)" },
    { name: "customers", label: "Kundendaten" },
    { name: "projects", label: level === "projekt" ? "Projektdaten" : "Projektliste" },
    { name: "activities", label: "Tätigkeiten" },
    { name: "timesheets", label: "Stundeneinträge mit Filter und Summen" },
    { name: "timesheets_recent", label: "Letzte Stundeneinträge (kompakt)" },
    { name: "last_date", label: "Letzter Stundeneintrag: nur Datum" },
    { name: "last_entry", label: "Letzter Stundeneintrag: nur Eintrag" },
    { name: "last_both", label: "Letzter Stundeneintrag: Datum und Eintrag" },
  ];
}

function rangeFields() {
  return [
    {
      name: "range_preset",
      label: "Zeitraum der Stundeneinträge (Vorgabe)",
      type: "String",
      required: true,
      attributes: {
        options: [
          { name: "year", label: "aktuelles Jahr" },
          { name: "last_year", label: "Vorjahr" },
          { name: "month", label: "aktueller Monat" },
          { name: "90", label: "letzte 90 Tage" },
          { name: "365", label: "letzte 12 Monate" },
          { name: "all", label: "gesamt" },
          { name: "template", label: "aus Vorlage (Felder/Variablen)" },
        ],
      },
      default: "year",
    },
    {
      name: "range_from_template",
      label: "Von (Vorlage)",
      sublabel: "JJJJ-MM-TT, z.B. {audit_datum} oder {$vorjahresbeginn}",
      type: "String",
      showIf: { range_preset: "template" },
    },
    {
      name: "range_to_template",
      label: "Bis (Vorlage)",
      sublabel: "leer = ohne Ende, z.B. {$heute}",
      type: "String",
      showIf: { range_preset: "template" },
    },
  ];
}

function displayFields(roleOpts, { level = "frei", withDisplay = true } = {}) {
  const role = (name, label, def, sub) => ({ name, label, sublabel: sub, type: "String", attributes: { options: roleOpts }, default: def });
  const when = (list) => (withDisplay ? { showIf: { display: list } } : {});
  const head = withDisplay
    ? [
        {
          name: "display",
          label: "Darstellung",
          sublabel: "Für Datum und Eintrag des letzten Stundeneintrags getrennt je eine View anlegen und einzeln platzieren",
          type: "String",
          required: true,
          attributes: { options: displayOptions(level) },
          default: "tabs",
        },
      ]
    : [];
  const fields = [
    ...head,
    { name: "tab_customers", label: "Register „Kunde“", type: "Bool", default: true, ...when("tabs") },
    { name: "tab_projects", label: level === "projekt" ? "Register „Projekt“" : "Register „Projekte“", type: "Bool", default: true, ...when("tabs") },
    { name: "tab_activities", label: "Register „Tätigkeiten“", type: "Bool", default: true, ...when("tabs") },
    { name: "tab_timesheets", label: "Register „Stundeneinträge“", type: "Bool", default: true, ...when("tabs") },
    {
      name: "max_rows",
      label: "Höchstzahl dargestellter Zeilen",
      sublabel: "je Liste (Kunden, Projekte, Tätigkeiten, Stundeneinträge); 0 = alle. Bei „Letzte Stundeneinträge“ Vorgabe 10",
      type: "Integer",
      default: 0,
      ...when(DISPLAY_LIST),
    },
    {
      name: "last_date_format",
      label: "Datumsformat",
      type: "String",
      attributes: {
        options: [
          { name: "date", label: "TT.MM.JJJJ" },
          { name: "datetime", label: "TT.MM.JJJJ HH:MM" },
          { name: "relative", label: "relativ (heute, gestern, vor 5 Tagen)" },
          { name: "iso", label: "JJJJ-MM-TT" },
        ],
      },
      default: "date",
      ...when(["last_date", "last_both"]),
    },
    {
      name: "last_entry_template",
      label: "Vorlage Eintrag",
      sublabel: "Platzhalter: " + LAST_PLACEHOLDERS.map((x) => `{${x}}`).join(" "),
      type: "String",
      default: LAST_ENTRY_DEFAULT,
      ...when(["last_entry", "last_both"]),
    },
    { name: "last_separator", label: "Trenner zwischen Datum und Eintrag", type: "String", default: ": ", ...when("last_both") },
    { name: "last_label", label: "Beschriftung davor", sublabel: "z.B. „Zuletzt gebucht:“ – leer = keine", type: "String", ...when(DISPLAY_LAST) },
    { name: "last_empty_text", label: "Text ohne Eintrag", type: "String", default: "kein Stundeneintrag", ...when(DISPLAY_LAST) },
    { name: "last_include_running", label: "Laufende Einträge berücksichtigen", type: "Bool", default: false, ...when(DISPLAY_LAST) },
    { name: "last_link", label: "Link „In Kimai öffnen“ anhängen", type: "Bool", default: false, ...when(DISPLAY_LAST) },
    {
      name: "default_tab",
      label: "Zuerst angezeigt",
      type: "String",
      attributes: {
        options: [
          { name: "customers", label: "Kunde" },
          { name: "projects", label: "Projekte" },
          { name: "activities", label: "Tätigkeiten" },
          { name: "timesheets", label: "Stundeneinträge" },
        ],
      },
      default: "projects",
      ...when("tabs"),
    },
    ...rangeFields().map((f) => (withDisplay && f.name === "range_preset" ? { ...f, ...when(["tabs", "timesheets", "timesheets_recent"]) } : f)),
    {
      name: "group_default",
      label: "Summen gruppiert nach",
      type: "String",
      attributes: {
        options: [
          { name: "project", label: "Projekt" },
          { name: "activity", label: "Tätigkeit" },
          { name: "user", label: "Benutzer" },
          { name: "month", label: "Monat" },
        ],
      },
      default: "project",
      ...when(["tabs", "timesheets"]),
    },
    { name: "page_size", label: "Einträge je Seite", sublabel: "nur ohne Zeilenbegrenzung", type: "Integer", default: 50, ...when(["tabs", "timesheets"]) },
    { name: "show_info", label: "Zuordnung (Suchwert) über den Inhalten anzeigen", type: "Bool", default: true, ...when(DISPLAY_LIST) },
    role("min_role_timesheets", "Mindestrolle Stundeneinträge sehen", "40"),
    role(
      "min_role_all_users",
      "Mindestrolle Einträge aller Benutzer sehen",
      "40",
      "Andere Rollen sehen nur eigene Einträge (Zuordnung über die Vorlage unten)"
    ),
    {
      name: "kimai_user_template",
      label: "Kimai-Benutzer des Saltcorn-Benutzers",
      sublabel: "Vergleich mit Kimai-Benutzername, Alias oder E-Mail; Felder der Benutzertabelle, Vorgabe {$kimai_benutzer} = {email}",
      type: "String",
      default: "{$kimai_benutzer}",
    },
    role("min_role_rates", "Mindestrolle Beträge (Stundensätze) sehen", "1"),
    role("min_role_refresh", "Mindestrolle „Neu aus Kimai laden“", "40"),
    ...layoutFields(withDisplay ? { display: DISPLAY_LIST } : undefined),
  ];
  return fields;
}

const tabsOf = (config) => {
  const d = config.display || "tabs";
  if (d === "timesheets_recent") return ["timesheets"];
  if (d !== "tabs" && DISPLAY_LIST.includes(d)) return [d];
  const t = ["customers", "projects", "activities", "timesheets"].filter((x) => config["tab_" + x] !== false);
  return t.length ? t : ["projects"];
};

function kimaiLinks(pluginCfg) {
  if (pluginCfg.ui_links === false || !pluginCfg.base_url) return null;
  try {
    return { base: normalizeBase(pluginCfg.base_url), locale: String(pluginCfg.ui_locale || "de").replace(/[^a-zA-Z_]/g, "") || "de" };
  } catch (_) {
    return null;
  }
}

/** HTML-ID für Tabellen wie List: View-Name und Datensatz */
const tableIdOf = (viewname, id) => "kimai_" + String(viewname || "view").replace(/[^A-Za-z0-9_-]/g, "_") + (id === undefined ? "" : "_" + String(id).replace(/[^A-Za-z0-9_-]/g, "_"));

function renderPanel({ viewname, ctx, config, req, mode, pluginCfg, range, labels }) {
  const uid = "kimai_" + Math.random().toString(36).slice(2, 10);
  const tabs = tabsOf(config);
  const links = kimaiLinks(pluginCfg);
  const display = config.display || "tabs";
  const compact = display === "timesheets_recent";
  const O = {
    single: display !== "tabs",
    compact,
    max_rows: Number(config.max_rows) > 0 ? Number(config.max_rows) : compact ? 10 : 0,
    labels: labels || {},
    viewname,
    uid,
    ctx,
    mode,
    tabs,
    default_tab: tabs.includes(config.default_tab) ? config.default_tab : tabs[0],
    perms: {
      timesheets: allowed(req, config.min_role_timesheets, "40"),
      rates: allowed(req, config.min_role_rates, "1"),
      refresh: allowed(req, config.min_role_refresh, "40"),
    },
    range: range || { from: null, to: null },
    links,
    page_size: Number(config.page_size) > 0 ? Number(config.page_size) : 50,
    show_info: config.show_info !== false && !compact,
    group_default: config.group_default || "project",
    layout: layoutOptions(config),
    table_id: tableIdOf(viewname, ctx && ctx.id),
  };
  const json = JSON.stringify(O).replace(/</g, "\\u003c");
  return div({ id: uid, class: "kimai-panel" }, div({ class: "text-muted small" }, "Kimai wird geladen …")) +
    script(domReady(`(${kimaiPanel.toString()})(${json});`));
}

// ----------------------------------------------------------------------------
// Datensatz-Views je Ebene: „KimaiKunde“ (z.B. entity), „KimaiProjekt“
// (z.B. projects) und frei konfigurierbar „KimaiDatensatz“
// ----------------------------------------------------------------------------
const makeRecordView = (pluginCfg, level = "frei") => {
  const cfg = pluginCfg || {};
  const L = LEVELS[level];
  const vars = () => buildVariables(cfg).vars;

  const configuration_workflow = () =>
    new Workflow({
      steps: [
        {
          name: "Zuordnung zu Kimai",
          form: async (context) => {
            const table = await Table.findOne({ id: context.table_id });
            const fields = await table.getFields();
            return new Form({
              blurb: L.blurb,
              fields: L.fields(
                fields.map((f) => f.name),
                fields.map((f) => f.name).join(", ")
              ),
            });
          },
        },
        {
          name: "Prüfung",
          form: async (context) => {
            const table = await Table.findOne({ id: context.table_id });
            let html;
            try {
              const rows = await table.getRows({}, { limit: 3, orderBy: table.pk_name });
              const client = clientFrom(cfg);
              const parts = [];
              for (const row of rows) {
                try {
                  const r = await resolveRow(client, mappingOf(level, context), row, vars());
                  parts.push(
                    `<li>Datensatz ${esc(row[table.pk_name])}: ` +
                      [r.info.customer_value ? `Kunde „${esc(r.info.customer_value)}“` : "", r.info.project_value ? `Projekt „${esc(r.info.project_value)}“` : ""].filter(Boolean).join(", ") +
                      " → " +
                      `${r.customers.length} Kunde(n)${r.customers.length ? " (" + r.customers.slice(0, 3).map((c) => esc(c.name)).join(", ") + ")" : ""}, ` +
                      `${r.projects.length} Projekt(e), ${r.activities.length} Tätigkeit(en)</li>`
                  );
                } catch (e) {
                  parts.push(`<li>Datensatz ${esc(row[table.pk_name])}: <span class="text-danger">${esc(e.message)}</span></li>`);
                }
              }
              html = rows.length
                ? `<p>Probe mit den ersten Datensätzen der Tabelle „${esc(table.name)}“:</p><ul>${parts.join("")}</ul>`
                : "<p>Die Tabelle enthält noch keine Datensätze.</p>";
            } catch (e) {
              html = `<div class="alert alert-danger">Kimai-Abfrage nicht möglich: ${esc(e.message)}</div>`;
            }
            return new Form({
              fields: [new Field({ name: "_probe", label: " ", input_type: "custom_html", attributes: { html } })],
            });
          },
        },
        {
          name: "Darstellung und Rechte",
          form: async () => new Form({ fields: displayFields(await roleOptions(), { level }) }),
        },
      ],
    });

  const get_state_fields = async (table_id) => {
    const table = await Table.findOne({ id: table_id });
    return [{ name: table ? table.pk_name : "id", type: "Integer", primary_key: true, required: true }];
  };

  async function loadRow(table_id, id, req) {
    const table = await Table.findOne({ id: table_id });
    if (!table) throw new KimaiError("Tabelle nicht gefunden", 404);
    if (id === undefined || id === null || id === "") throw new KimaiError("Keine Datensatz-ID", 400);
    const row = await table.getRow(
      { [table.pk_name]: id },
      req && req.user && req.user.id ? { forUser: req.user } : { forPublic: true }
    );
    if (!row) throw new KimaiError("Datensatz nicht gefunden oder kein Zugriff", 403);
    return { table, row };
  }

  async function resolveBody(table_id, config, body, req) {
    const { row } = await loadRow(table_id, body.id, req);
    const client = clientFrom(cfg);
    const resolved = await resolveRow(client, mappingOf(level, config), row, vars());
    return { client, resolved, row };
  }

  const run = async (table_id, viewname, config, state, extra) => {
    const table = await Table.findOne({ id: table_id });
    const id = state[table.pk_name];
    if (id === undefined || id === null || id === "") return div({ class: "text-muted" }, "Kein Datensatz ausgewählt");
    const req = extra && extra.req;
    if (DISPLAY_LAST.includes(config.display)) {
      // serverseitig, ohne JavaScript – lässt sich wie ein Feld im Layout platzieren
      if (!allowed(req, config.min_role_timesheets, "40")) return "";
      try {
        const { client, resolved } = await resolveBody(table_id, config, { id }, req);
        const entry = await lastEntry(client, cfg, config, resolved, req, vars());
        return renderLast(config.display, entry, config, kimaiLinks(cfg));
      } catch (e) {
        return `<span class="kimai-last text-muted small" title="${esc(e.message)}">${
          e.mapping_error ? esc(e.message) : "Kimai nicht verfügbar"
        }</span>`;
      }
    }
    let range = { from: null, to: null };
    try {
      let row = {};
      if (config.range_preset === "template") row = (await loadRow(table_id, id, req)).row;
      range = rangePreset(config.range_preset || "year", {
        row,
        vars: vars(),
        from_template: config.range_from_template,
        to_template: config.range_to_template,
      });
    } catch (_) {}
    return renderPanel({ viewname, ctx: { id }, config, req, mode: "row", pluginCfg: cfg, range, labels: L.labels });
  };

  const routes = {
    async load(table_id, viewname, config, body, { req }) {
      try {
        const { resolved } = await resolveBody(table_id, config, body, req);
        return { json: { success: true, ...publicData(resolved, config) } };
      } catch (e) {
        return errJson(e);
      }
    },
    async refresh(table_id, viewname, config, body, { req }) {
      try {
        if (!allowed(req, config.min_role_refresh, "40")) throw new KimaiError("Keine Berechtigung", 403);
        clientFrom(cfg).clearCache();
        const { resolved } = await resolveBody(table_id, config, body, req);
        return { json: { success: true, ...publicData(resolved, config) } };
      } catch (e) {
        return errJson(e);
      }
    },
    async timesheets(table_id, viewname, config, body, { req }) {
      try {
        if (!allowed(req, config.min_role_timesheets, "40")) throw new KimaiError("Keine Berechtigung für Stundeneinträge", 403);
        const { client, resolved } = await resolveBody(table_id, config, body, req);
        const opts = config.display === "timesheets_recent" ? { max: Number(config.max_rows) > 0 ? Number(config.max_rows) : 10 } : {};
        return { json: { success: true, ...(await loadEntries(client, cfg, config, resolved, body, req, vars(), opts)) } };
      } catch (e) {
        return errJson(e);
      }
    },
  };

  return {
    name: L.view,
    description: L.description,
    display_state_form: false,
    configuration_workflow,
    get_state_fields,
    run,
    routes,
  };
};

// ----------------------------------------------------------------------------
// View-Typ „KimaiUebersicht“ (ohne Tabelle)
// ----------------------------------------------------------------------------
const makeBrowseView = (pluginCfg) => {
  const cfg = pluginCfg || {};
  const vars = () => buildVariables(cfg).vars;

  const configuration_workflow = () =>
    new Workflow({
      steps: [
        {
          name: "Anzeige und Rechte",
          form: async () =>
            new Form({
              fields: [
                {
                  name: "activity_scope",
                  label: "Tätigkeiten",
                  type: "String",
                  required: true,
                  attributes: {
                    options: [
                      { name: "both", label: "projektbezogene + globale" },
                      { name: "project", label: "nur projektbezogene" },
                      { name: "global", label: "nur globale" },
                    ],
                  },
                  default: "both",
                },
                { name: "include_hidden", label: "Inaktive Kunden, Projekte und Tätigkeiten einbeziehen", type: "Bool", default: true },
                ...displayFields(await roleOptions(), { withDisplay: false }).filter(
                  (f) => !["range_from_template", "range_to_template"].includes(f.name) && !f.name.startsWith("last_")
                ).map((f) =>
                  f.name === "range_preset"
                    ? { ...f, attributes: { options: f.attributes.options.filter((o) => o.name !== "template") } }
                    : f
                ),
              ],
            }),
        },
      ],
    });

  const run = async (table_id, viewname, config, state, extra) => {
    const req = extra && extra.req;
    const range = rangePreset(config.range_preset || "year", {});
    return renderPanel({ viewname, ctx: {}, config, req, mode: "browse", pluginCfg: cfg, range });
  };

  const mcfg = (config) => ({ activity_scope: config.activity_scope, include_hidden: config.include_hidden });
  const custId = (body) => {
    if (!/^\d+$/.test(String(body.customer_id || ""))) throw new KimaiError("Bitte zuerst einen Kunden wählen", 400);
    return Number(body.customer_id);
  };

  const routes = {
    async search(table_id, viewname, config, body) {
      try {
        const term = String(body.term || "").trim().toLocaleLowerCase("de-DE");
        if (term.length < 2) throw new TemplateError("Mindestens 2 Zeichen eingeben");
        const list = await clientFrom(cfg).customers({ visible: config.include_hidden === false ? 1 : 3 });
        const hits = list.filter((c) =>
          [c.name, c.number, c.comment].some((x) => x && String(x).toLocaleLowerCase("de-DE").includes(term))
        );
        return {
          json: {
            success: true,
            customers: hits.slice(0, 50).map((c) => pick(c, ["id", "name", "number", "visible"])),
            more: hits.length > 50,
          },
        };
      } catch (e) {
        return errJson(e);
      }
    },
    async load(table_id, viewname, config, body) {
      try {
        const r = await resolveCustomerId(clientFrom(cfg), mcfg(config), custId(body));
        return { json: { success: true, ...publicData(r, config) } };
      } catch (e) {
        return errJson(e);
      }
    },
    async refresh(table_id, viewname, config, body, { req }) {
      try {
        if (!allowed(req, config.min_role_refresh, "40")) throw new KimaiError("Keine Berechtigung", 403);
        const client = clientFrom(cfg);
        client.clearCache();
        const r = await resolveCustomerId(client, mcfg(config), custId(body));
        return { json: { success: true, ...publicData(r, config) } };
      } catch (e) {
        return errJson(e);
      }
    },
    async timesheets(table_id, viewname, config, body, { req }) {
      try {
        if (!allowed(req, config.min_role_timesheets, "40")) throw new KimaiError("Keine Berechtigung für Stundeneinträge", 403);
        const client = clientFrom(cfg);
        const r = await resolveCustomerId(client, mcfg(config), custId(body));
        return { json: { success: true, ...(await loadEntries(client, cfg, config, r, body, req, vars())) } };
      } catch (e) {
        return errJson(e);
      }
    },
  };

  return {
    name: "KimaiUebersicht",
    description: "Kimai-Kunden suchen und Projekte, Tätigkeiten und Stundeneinträge anzeigen (ohne Tabelle)",
    display_state_form: false,
    tableless: true,
    configuration_workflow,
    get_state_fields: async () => [],
    run,
    routes,
  };
};

// ----------------------------------------------------------------------------
// Aktion „kimai_abgleich“
// ----------------------------------------------------------------------------
const ACTION_LEVELS = {
  kimai_abgleich: { level: "frei", what: "frei konfigurierbar wie KimaiDatensatz" },
  kimai_abgleich_kunde: { level: "kunde", what: "Ebene Kunde wie KimaiKunde, z.B. Tabelle entity" },
  kimai_abgleich_projekt: { level: "projekt", what: "Ebene Projekt wie KimaiProjekt, z.B. Tabelle projects" },
};

const makeAction = (pluginCfg, level, what) => ({
  description: `Schreibt Kimai-Daten zum Datensatz in Felder (${what}): Kunde, Projekt, Stunden, letzter Stundeneintrag`,
  requireRow: true,
  configFields: async ({ table }) => {
    const fields = table ? await table.getFields() : [];
    const names = fields.map((f) => f.name);
    const typed = (types) => fields.filter((f) => f.type && types.includes(f.type.name)).map((f) => f.name);
    const numeric = typed(["Integer", "Float", "Money"]);
    const text = typed(["String"]);
    const dates = typed(["Date", "String"]);
    return [
      ...LEVELS[level].fields(names, names.join(", ")),
      ...rangeFields().map((f) => (f.name === "range_preset" ? { ...f, label: "Zeitraum für die Stundensummen" } : f)),
      { name: "field_customer_id", label: "Kimai-Kunden-ID(s) speichern in", sublabel: "Textfeld, mehrere kommagetrennt", type: "String", attributes: { options: text } },
      { name: "field_customer_name", label: "Kimai-Kundenname speichern in", type: "String", attributes: { options: text } },
      { name: "field_project_id", label: "Kimai-Projekt-ID(s) speichern in", type: "String", attributes: { options: text } },
      { name: "field_project_count", label: "Anzahl Projekte speichern in", type: "String", attributes: { options: numeric } },
      { name: "field_hours", label: "Stunden (dezimal) im Zeitraum speichern in", type: "String", attributes: { options: numeric } },
      { name: "field_hours_billable", label: "abrechenbare Stunden speichern in", type: "String", attributes: { options: numeric } },
      { name: "field_last_date", label: "Datum des letzten Stundeneintrags speichern in", sublabel: "Datums- oder Textfeld (TT.MM.JJJJ)", type: "String", attributes: { options: dates } },
      { name: "field_last_entry", label: "Letzten Stundeneintrag speichern in", type: "String", attributes: { options: text } },
      {
        name: "last_entry_template",
        label: "Vorlage letzter Eintrag",
        sublabel: "Platzhalter: " + LAST_PLACEHOLDERS.map((x) => `{${x}}`).join(" "),
        type: "String",
        default: LAST_ENTRY_DEFAULT,
      },
    ];
  },
  run: async ({ row, table, configuration }) => {
    const cfg = pluginCfg || {};
    const vars = buildVariables(cfg).vars;
    const client = clientFrom(cfg);
    const c = configuration || {};
    const r = await resolveRow(client, mappingOf(level, c), row, vars);
    const sys = { min_role_all_users: "100", min_role_rates: "100" }; // Aktion: alle Benutzer, keine Beträge
    const upd = {};
    if (c.field_customer_id) upd[c.field_customer_id] = r.customers.map((x) => x.id).join(",") || null;
    if (c.field_customer_name) upd[c.field_customer_name] = r.customers.map((x) => x.name).join("; ") || null;
    if (c.field_project_id) upd[c.field_project_id] = r.projects.map((x) => x.id).join(",") || null;
    if (c.field_project_count) upd[c.field_project_count] = r.projects.length;
    let hours = null;
    let truncated = false;
    if (c.field_hours || c.field_hours_billable) {
      const range = rangePreset(c.range_preset || "year", {
        row,
        vars,
        from_template: c.range_from_template,
        to_template: c.range_to_template,
      });
      const ts = await loadEntries(client, cfg, sys, r, { from: range.from, to: range.to }, null, vars);
      const sum = (list) => Math.round((list.reduce((a, e) => a + (Number(e.duration) || 0), 0) / 3600) * 100) / 100;
      hours = sum(ts.entries);
      if (c.field_hours) upd[c.field_hours] = hours;
      if (c.field_hours_billable) upd[c.field_hours_billable] = sum(ts.entries.filter((e) => e.billable));
      truncated = ts.truncated;
    }
    let last = null;
    if (c.field_last_date || c.field_last_entry) {
      last = await lastEntry(client, cfg, sys, r, null, vars);
      if (c.field_last_date) {
        const f = table ? (await table.getFields()).find((x) => x.name === c.field_last_date) : null;
        const isDate = f && f.type && f.type.name === "Date";
        upd[c.field_last_date] = last ? (isDate ? new Date(String(last.begin).slice(0, 10) + "T12:00:00") : dayDE(last.begin)) : null;
      }
      if (c.field_last_entry) upd[c.field_last_entry] = last ? lastEntryText(last, c.last_entry_template) : null;
    }
    const same = (a, b) => {
      if (a instanceof Date && b instanceof Date) return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
      return String(a ?? "") === String(b ?? "");
    };
    const changed = Object.keys(upd).filter((k) => !same(row[k], upd[k]));
    if (changed.length && table)
      await table.updateRow(
        Object.fromEntries(changed.map((k) => [k, upd[k]])),
        row[table.pk_name],
        undefined,
        true // keine weiteren Trigger auslösen
      );
    return {
      notify:
        `Kimai: ${r.customers.length} Kunde(n), ${r.projects.length} Projekt(e)` +
        (hours !== null ? `, ${String(hours).replace(".", ",")} h` : "") +
        (c.field_last_date || c.field_last_entry ? `, letzter Eintrag ${last ? dayDE(last.begin) : "–"}` : "") +
        (truncated ? " (Höchstzahl Einträge erreicht – Summe unvollständig)" : ""),
    };
  },
});

const makeActions = (pluginCfg) =>
  Object.fromEntries(Object.entries(ACTION_LEVELS).map(([name, a]) => [name, makeAction(pluginCfg, a.level, a.what)]));


// ----------------------------------------------------------------------------
// View-Typ „KimaiStunden“: zugeordnete Stunden einer Entity oder eines Prozesses
// (letzte N Einträge, serverseitig, ohne JavaScript)
// ----------------------------------------------------------------------------
async function probeHtml(pluginCfg, table, mappingCfg, vars) {
  try {
    const rows = await table.getRows({}, { limit: 3, orderBy: table.pk_name });
    if (!rows.length) return "<p>Die Tabelle enthält noch keine Datensätze.</p>";
    const client = clientFrom(pluginCfg);
    const parts = [];
    for (const row of rows) {
      try {
        const r = await resolveRow(client, mappingCfg, row, vars);
        const vals = [
          r.info.customer_value ? `Kunde „${esc(r.info.customer_value)}“` : "",
          r.info.project_value ? `Projekt „${esc(r.info.project_value)}“` : "",
        ].filter(Boolean);
        parts.push(
          `<li>Datensatz ${esc(row[table.pk_name])}: ${vals.join(", ")} → ${r.customers.length} Kunde(n)` +
            (r.customers.length ? " (" + r.customers.slice(0, 3).map((c) => esc(c.name)).join(", ") + ")" : "") +
            `, ${r.projects.length} Projekt(e)` +
            (r.projects.length && r.projects.length <= 3 ? " (" + r.projects.map((p) => esc(p.name)).join(", ") + ")" : "") +
            "</li>"
        );
      } catch (e) {
        parts.push(`<li>Datensatz ${esc(row[table.pk_name])}: <span class="text-danger">${esc(e.message)}</span></li>`);
      }
    }
    return `<p>Probe mit den ersten Datensätzen der Tabelle „${esc(table.name)}“:</p><ul>${parts.join("")}</ul>`;
  } catch (e) {
    return `<div class="alert alert-danger">Kimai-Abfrage nicht möglich: ${esc(e.message)}</div>`;
  }
}

function hoursDisplayFields(roleOpts) {
  const role = (name, label, def, sub) => ({ name, label, sublabel: sub, type: "String", attributes: { options: roleOpts }, default: def });
  const col = (k, label, def) => ({ name: "col_" + k, label: `Spalte „${label}“`, type: "Bool", default: def });
  return [
    {
      name: "hours_limit",
      label: "Anzahl dargestellter Einträge",
      sublabel: "die neuesten Einträge, z.B. 5 bis 7",
      type: "Integer",
      required: true,
      default: 5,
      attributes: { min: 1, max: 50 },
    },
    ...rangeFields().map((f) =>
      f.name === "range_preset"
        ? { ...f, label: "Zeitraum", default: "all", sublabel: "Einträge und Gesamtsumme nur aus diesem Zeitraum" }
        : f
    ),
    {
      name: "hours_sum",
      label: "Summenzeile",
      type: "String",
      required: true,
      attributes: {
        options: [
          { name: "shown", label: "Summe der dargestellten Einträge" },
          { name: "total", label: "Gesamtstunden im Zeitraum" },
          { name: "both", label: "beides" },
          { name: "none", label: "keine" },
        ],
      },
      default: "shown",
      sublabel: "Gesamtstunden laden alle Einträge des Zeitraums aus Kimai (Zwischenspeicher)",
    },
    {
      name: "hours_style",
      label: "Darstellung",
      type: "String",
      attributes: {
        options: [
          { name: "table", label: "Tabelle" },
          { name: "list", label: "kompakte Liste (eine Zeile je Eintrag)" },
        ],
      },
      default: "table",
    },
    col("datum", "Datum", true),
    col("zeit", "Uhrzeit von–bis", false),
    col("dauer", "Stunden", true),
    col("benutzer", "Benutzer", true),
    {
      name: "col_projekt",
      label: "Spalte „Projekt“",
      type: "String",
      attributes: {
        options: [
          { name: "auto", label: "nur wenn mehrere Projekte (Entity)" },
          { name: "true", label: "immer" },
          { name: "false", label: "nie" },
        ],
      },
      default: "auto",
    },
    col("kunde", "Kunde", false),
    col("taetigkeit", "Tätigkeit", true),
    col("beschreibung", "Beschreibung", true),
    col("betrag", "Betrag (nur mit Recht)", false),
    { name: "hours_title", label: "Überschrift", sublabel: "z.B. „Letzte Stundeneinträge“ – leer = keine", type: "String" },
    { name: "hours_empty_text", label: "Text ohne Einträge", type: "String", default: "Keine Stundeneinträge" },
    { name: "hours_include_running", label: "Laufende Einträge anzeigen", type: "Bool", default: false },
    { name: "hours_links", label: "Links „In Kimai öffnen“", type: "Bool", default: false },
    role("min_role_timesheets", "Mindestrolle Stundeneinträge sehen", "40", "andere Rollen sehen nichts"),
    role("min_role_all_users", "Mindestrolle Einträge aller Benutzer sehen", "40", "andere Rollen sehen nur eigene Einträge"),
    {
      name: "kimai_user_template",
      label: "Kimai-Benutzer des Saltcorn-Benutzers",
      sublabel: "Vorgabe {$kimai_benutzer} = {email}",
      type: "String",
      default: "{$kimai_benutzer}",
    },
    role("min_role_rates", "Mindestrolle Beträge sehen", "1"),
    ...layoutFields({ hours_style: "table" }),
  ];
}

/** Daten für die Stunden-View holen (exportiert für Tests). */
async function loadHours(client, pluginCfg, config, resolved, row, req, vars) {
  const limit = Math.min(50, Math.max(1, Number(config.hours_limit) || 5));
  const running = config.hours_include_running === true;
  const range = rangePreset(config.range_preset || "all", {
    row,
    vars,
    from_template: config.range_from_template,
    to_template: config.range_to_template,
  });
  const body = { from: range.from, to: range.to };
  const mode = config.hours_sum || "shown";
  const needTotal = mode === "total" || mode === "both";
  const r = await loadEntries(client, pluginCfg, config, resolved, body, req, vars, needTotal ? {} : { max: limit + 4 });
  const usable = r.entries.filter((e) => running || e.end);
  const entries = usable.slice(0, limit);
  return {
    entries,
    more: usable.length > limit || (!needTotal && r.truncated),
    total: needTotal ? usable.reduce((a, e) => a + (Number(e.duration) || 0), 0) : null,
    totalCount: needTotal ? usable.length : null,
    totalTruncated: needTotal && r.truncated,
    ownOnly: r.own_only,
    rangeLabel: range.from || range.to ? `${range.from ? dayDE(range.from) : "…"}–${range.to ? dayDE(range.to) : "…"}` : "",
  };
}

const makeHoursView = (pluginCfg) => {
  const cfg = pluginCfg || {};
  const vars = () => buildVariables(cfg).vars;
  const levelOf = (c) => (c && c.level === "projekt" ? "projekt" : "kunde");

  const configuration_workflow = () =>
    new Workflow({
      steps: [
        {
          name: "Ebene",
          form: async (context) => {
            const table = await Table.findOne({ id: context.table_id });
            const guess = table && /proz|process/i.test(table.name) ? "projekt" : "kunde";
            return new Form({
              blurb: "Zu welcher Ebene gehört die Tabelle? Danach richtet sich, wie die Stunden in Kimai gefunden werden.",
              fields: [
                {
                  name: "level",
                  label: "Ebene",
                  type: "String",
                  required: true,
                  attributes: {
                    options: [
                      { name: "kunde", label: "Kunde – z.B. Tabelle entity: alle Stunden des Kimai-Kunden" },
                      { name: "projekt", label: "Projekt – z.B. Tabelle projects: Stunden des Kimai-Projekts" },
                    ],
                  },
                  default: guess,
                },
              ],
            });
          },
        },
        {
          name: "Zuordnung zu Kimai",
          form: async (context) => {
            const table = await Table.findOne({ id: context.table_id });
            const fields = await table.getFields();
            const L = LEVELS[levelOf(context)];
            return new Form({
              blurb: L.blurb,
              fields: L.fields(
                fields.map((f) => f.name),
                fields.map((f) => f.name).join(", ")
              ),
            });
          },
        },
        {
          name: "Prüfung",
          form: async (context) => {
            const table = await Table.findOne({ id: context.table_id });
            const html = await probeHtml(cfg, table, mappingOf(levelOf(context), context), vars());
            return new Form({ fields: [new Field({ name: "_probe", label: " ", input_type: "custom_html", attributes: { html } })] });
          },
        },
        {
          name: "Darstellung und Rechte",
          form: async () => new Form({ fields: hoursDisplayFields(await roleOptions()) }),
        },
      ],
    });

  const get_state_fields = async (table_id) => {
    const table = await Table.findOne({ id: table_id });
    return [{ name: table ? table.pk_name : "id", type: "Integer", primary_key: true, required: true }];
  };

  const run = async (table_id, viewname, config, state, extra) => {
    const req = extra && extra.req;
    if (!allowed(req, config.min_role_timesheets, "40")) return "";
    const table = await Table.findOne({ id: table_id });
    const id = state[table.pk_name];
    if (id === undefined || id === null || id === "") return div({ class: "text-muted small" }, "Kein Datensatz ausgewählt");
    try {
      const row = await table.getRow(
        { [table.pk_name]: id },
        req && req.user && req.user.id ? { forUser: req.user } : { forPublic: true }
      );
      if (!row) return "";
      const client = clientFrom(cfg);
      const resolved = await resolveRow(client, mappingOf(levelOf(config), config), row, vars());
      const h = await loadHours(client, cfg, config, resolved, row, req, vars());
      return renderHours({
        ...h,
        tableId: tableIdOf(viewname, id),
        config,
        showRates: allowed(req, config.min_role_rates, "1"),
        links: kimaiLinks(cfg),
        multiProject: resolved.projects.length > 1,
      });
    } catch (e) {
      return `<div class="kimai-hours text-muted small" title="${esc(e.message)}">${
        e.mapping_error ? esc(e.message) : "Kimai nicht verfügbar"
      }</div>`;
    }
  };

  return {
    name: "KimaiStunden",
    description: "Zugeordnete Stunden einer Entity oder eines Prozesses – die letzten N Kimai-Einträge, optional mit Summe",
    display_state_form: false,
    configuration_workflow,
    get_state_fields,
    run,
  };
};

module.exports = {
  sc_plugin_api_version: 1,
  plugin_name: "saltcorn-kimai",
  configuration_workflow,
  viewtemplates: (cfg) => [makeHoursView(cfg), makeRecordView(cfg, "kunde"), makeRecordView(cfg, "projekt"), makeRecordView(cfg, "frei"), makeBrowseView(cfg)],
  actions: (cfg) => makeActions(cfg),
  // für Tests
  _internal: { loadEntries, publicData, publicEntry, ownUserKey, isOwnEntry, clientFrom, withDefaults, mappingOf, lastEntry, lastEntryText, lastDateText, renderLast, loadHours },
};
