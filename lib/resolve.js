"use strict";
/**
 * Abhängigkeiten Saltcorn-Datensatz -> Kimai-Kunde -> Projekte -> Tätigkeiten.
 *
 * Alle Regeln kommen aus der View-/Aktionskonfiguration (Zuordnungsfelder) und
 * den Variablen der Plugin-Konfiguration. Ein leerer oder zu kurzer
 * Zuordnungswert führt immer zu einem Fehler statt zu „alle Kunden“.
 */
const { fill, TemplateError } = require("./template");
const { KimaiError } = require("./kimai");

const norm = (s) => String(s == null ? "" : s).normalize("NFC").trim();
const lower = (s) => norm(s).toLocaleLowerCase("de-DE");
const idOf = (x) => (x && typeof x === "object" ? x.id : x);

/** Vorgaben für alle Zuordnungsfelder (View und Aktion). */
const MAPPING_DEFAULTS = {
  customer_match: "name_prefix",
  customer_value: "{$kunde}",
  customer_id_field: "",
  project_scope: "customer",
  project_match: "name_prefix",
  project_value: "{$projekt}",
  project_id_field: "",
  activity_scope: "both",
  include_hidden: true,
};

const withDefaults = (c) => {
  const out = { ...MAPPING_DEFAULTS };
  for (const [k, v] of Object.entries(c || {})) if (v !== undefined && v !== null && v !== "") out[k] = v;
  if (c && c.include_hidden === false) out.include_hidden = false;
  return out;
};

const MATCH_MODES = {
  name_prefix: "Name beginnt mit",
  name_exact: "Name ist gleich",
  name_contains: "Name enthält",
  number: "Kimai-Feld „Nummer“ ist gleich",
  comment_contains: "Kommentar enthält",
  id_field: "Kimai-ID steht in einem Feld",
};

/** Vergleich eines Kimai-Objekts mit dem Zuordnungswert. */
function matches(mode, obj, value) {
  const v = lower(value);
  switch (mode) {
    case "name_prefix":
      return lower(obj.name).startsWith(v);
    case "name_exact":
      return lower(obj.name) === v;
    case "name_contains":
      return lower(obj.name).includes(v);
    case "number":
      return lower(obj.number) === v;
    case "order_number":
      return lower(obj.orderNumber) === v;
    case "comment_contains":
      return lower(obj.comment).includes(v);
    default:
      throw new TemplateError(`Unbekannte Zuordnungsart „${mode}“`, 500);
  }
}

/** Zuordnungswert aus Vorlage; Präfix/Enthält brauchen mind. 2 Zeichen. */
function matchValue(mode, template, row, vars, what) {
  const value = norm(fill(template, row, vars));
  if (!value) throw new TemplateError(`Die Vorlage für ${what} ergibt für diesen Datensatz einen leeren Wert`);
  if ((mode === "name_prefix" || mode === "name_contains" || mode === "comment_contains") && value.length < 2)
    throw new TemplateError(`Der Zuordnungswert „${value}“ für ${what} ist zu kurz`);
  return value;
}

/** IDs aus einem Feld (auch kommagetrennt). */
function idsFromField(row, field, what) {
  if (!field) throw new TemplateError(`Kein Feld für die Kimai-ID (${what}) gewählt`, 500);
  const raw = row[field];
  const ids = String(raw == null ? "" : raw)
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!ids.length) throw new TemplateError(`Für diesen Datensatz ist keine Kimai-ID (${what}) im Feld „${field}“ hinterlegt`);
  for (const id of ids) if (!/^\d+$/.test(id)) throw new TemplateError(`„${id}“ im Feld „${field}“ ist keine Kimai-ID`);
  return [...new Set(ids.map(Number))];
}

const visibleOf = (c) => (c.include_hidden === false ? 1 : 3);

async function resolveCustomers(client, c, row, vars) {
  if (c.customer_match === "none") return { customers: [], value: null };
  if (c.customer_match === "id_field") {
    const ids = idsFromField(row, c.customer_id_field, "Kunde");
    const out = [];
    for (const id of ids) {
      const cu = await client.customer(id);
      if (cu && (c.include_hidden !== false || cu.visible !== false)) out.push(cu);
    }
    return { customers: out, value: ids.join(", ") };
  }
  const value = matchValue(c.customer_match, c.customer_value, row, vars, "den Kunden");
  const all = await client.customers({ visible: visibleOf(c) });
  return { customers: all.filter((cu) => matches(c.customer_match, cu, value)), value };
}

async function resolveProjects(client, c, row, vars, customers) {
  const custIds = customers.map((x) => x.id);
  if (c.project_scope === "customer") {
    if (!custIds.length) return { projects: [], value: null };
    return { projects: await client.projects({ customers: custIds, visible: visibleOf(c) }), value: null };
  }
  let candidates;
  if (c.project_scope === "customer_match") {
    if (!custIds.length) return { projects: [], value: null };
    candidates = await client.projects({ customers: custIds, visible: visibleOf(c) });
  } else if (c.project_scope === "match") {
    candidates = null; // erst bei Bedarf alle Projekte laden
  } else throw new TemplateError(`Unbekannter Projektbereich „${c.project_scope}“`, 500);

  if (c.project_match === "id_field") {
    const ids = idsFromField(row, c.project_id_field, "Projekt");
    let out;
    if (candidates) out = candidates.filter((p) => ids.includes(p.id));
    else {
      out = [];
      for (const id of ids) {
        const p = await client.project(id);
        if (p && (c.include_hidden !== false || p.visible !== false)) out.push(p);
      }
    }
    return { projects: out, value: ids.join(", ") };
  }
  const value = matchValue(c.project_match, c.project_value, row, vars, "die Projekte");
  if (!candidates) candidates = await client.projects({ visible: visibleOf(c) });
  return { projects: candidates.filter((p) => matches(c.project_match, p, value)), value };
}

async function resolveActivities(client, c, projects) {
  if (c.activity_scope === "none") return [];
  if (c.activity_scope === "global") return client.activities({ globalsOnly: true, visible: visibleOf(c) });
  if (!projects.length) return [];
  const ids = new Set(projects.map((p) => p.id));
  const list = await client.activities({ projects: [...ids], visible: visibleOf(c) });
  const own = (a) => a.project !== null && a.project !== undefined && ids.has(Number(idOf(a.project)));
  if (c.activity_scope === "project") return list.filter(own);
  // „both“: projektbezogene der gefundenen Projekte + globale
  let globals = list.filter((a) => a.project === null || a.project === undefined);
  if (!globals.length) globals = await client.activities({ globalsOnly: true, visible: visibleOf(c) });
  const seen = new Set();
  return [...list.filter(own), ...globals].filter((a) => (seen.has(a.id) ? false : seen.add(a.id)));
}

/**
 * Komplette Auflösung für einen Datensatz.
 * @returns {{customers, projects, activities, info}}
 */
async function resolveRow(client, mappingCfg, row, vars) {
  const c = withDefaults(mappingCfg);
  if (c.customer_match === "none" && c.project_scope !== "match")
    throw new TemplateError("Ohne Kundenzuordnung muss der Projektbereich „Projekte über Vorlage (alle Kunden)“ sein", 500);
  const cu = await resolveCustomers(client, c, row, vars);
  const pr = await resolveProjects(client, c, row, vars, cu.customers);
  let customers = cu.customers;
  if (c.customer_match === "none" && pr.projects.length) {
    // Kunden aus den gefundenen Projekten ableiten (nur Anzeige)
    const ids = new Set(pr.projects.map((p) => Number(idOf(p.customer))));
    customers = (await client.customers({ visible: 3 })).filter((x) => ids.has(x.id));
  }
  const activities = await resolveActivities(client, c, pr.projects);
  return {
    customers,
    projects: pr.projects,
    activities,
    info: {
      customer_match: c.customer_match,
      customer_value: cu.value,
      project_scope: c.project_scope,
      project_match: c.project_scope === "customer" ? null : c.project_match,
      project_value: pr.value,
      timesheet_filter: c.project_scope === "customer" ? "customers" : "projects",
    },
  };
}

/** Auflösung über eine Kimai-Kunden-ID (Übersichts-View ohne Tabelle). */
async function resolveCustomerId(client, mappingCfg, id) {
  const c = withDefaults(mappingCfg);
  const cu = await client.customer(id);
  if (!cu) throw new KimaiError("Kunde nicht gefunden", 404);
  const projects = await client.projects({ customers: [cu.id], visible: visibleOf(c) });
  const activities = await resolveActivities(client, c, projects);
  return {
    customers: [cu],
    projects,
    activities,
    info: { customer_match: "id", customer_value: String(cu.id), project_scope: "customer", timesheet_filter: "customers" },
  };
}

/** Filter für Zeiteinträge – immer auf die aufgelöste Menge begrenzt. */
function timesheetScope(resolved) {
  if (resolved.info.timesheet_filter === "customers") return { customers: resolved.customers.map((x) => x.id) };
  return { projects: resolved.projects.map((p) => p.id) };
}

module.exports = {
  MAPPING_DEFAULTS,
  MATCH_MODES,
  withDefaults,
  matches,
  resolveRow,
  resolveCustomerId,
  timesheetScope,
  idOf,
};
