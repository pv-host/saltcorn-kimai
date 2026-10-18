"use strict";
/**
 * Schlanker Kimai-2-REST-Client (nur lesend) ohne Fremdabhängigkeiten.
 *
 *  - Authentifizierung: API-Token als Bearer (Kimai ≥ 2.0) oder alt
 *    X-AUTH-USER / X-AUTH-TOKEN (Kimai 1.x / frühe 2.x)
 *  - Kunden, Projekte und Tätigkeiten liefert Kimai ohne Seitenaufteilung;
 *    sie werden im Speicher zwischengespeichert (TTL konfigurierbar).
 *  - Zeiteinträge sind seitenweise (max. 500 je Seite). Der Abruf wertet die
 *    X-Total-Pages-Header aus UND bricht ab, sobald eine Seite nur bereits
 *    bekannte IDs enthält (Proxy/Kimai liefert sonst ggf. immer dieselbe Liste).
 */

class KimaiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

/** Gemeinsamer Zwischenspeicher aller Clients: key -> { at, ttl, value } */
const CACHE = new Map();
const CACHE_MAX = 500;

function cacheGet(key) {
  const e = CACHE.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > e.ttl) {
    CACHE.delete(key);
    return undefined;
  }
  return e.value;
}
function cacheSet(key, value, ttl) {
  if (!(ttl > 0)) return;
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, { at: Date.now(), ttl, value });
}
function cacheClear(prefix) {
  for (const k of [...CACHE.keys()]) if (!prefix || k.startsWith(prefix)) CACHE.delete(k);
}

/** https://kimai.example.org/ oder .../api -> https://kimai.example.org */
function normalizeBase(url) {
  let u = String(url || "").trim();
  if (!u) throw new KimaiError("Kimai-Plugin: keine Kimai-URL konfiguriert", 500);
  if (!/^https?:\/\//i.test(u)) throw new KimaiError("Kimai-URL muss mit http:// oder https:// beginnen", 500);
  u = u.replace(/\/+$/, "").replace(/\/api$/i, "");
  return u;
}

/** Query-String; Arrays werden als key[]=a&key[]=b übergeben, leere Werte entfallen. */
function qs(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      for (const x of v) if (x !== undefined && x !== null && x !== "") parts.push(`${encodeURIComponent(k)}[]=${encodeURIComponent(x)}`);
    } else parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.length ? "?" + parts.join("&") : "";
}

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

class KimaiClient {
  /**
   * @param {object} o { base_url, auth_mode: "bearer"|"legacy", token, username,
   *                     timeout_ms, cache_ttl_s, timesheet_ttl_s }
   */
  constructor(o) {
    this.base = normalizeBase(o.base_url);
    this.auth_mode = o.auth_mode === "legacy" ? "legacy" : "bearer";
    this.token = String(o.token || "");
    this.username = String(o.username || "");
    this.timeout = Number(o.timeout_ms) > 0 ? Number(o.timeout_ms) : 30000;
    this.ttl = (Number(o.cache_ttl_s) >= 0 ? Number(o.cache_ttl_s) : 300) * 1000;
    this.tsTtl = (Number(o.timesheet_ttl_s) >= 0 ? Number(o.timesheet_ttl_s) : 60) * 1000;
    if (!this.token) throw new KimaiError("Kimai-Plugin: kein API-Token konfiguriert", 500);
    if (this.auth_mode === "legacy" && !this.username)
      throw new KimaiError("Kimai-Plugin: für die alte Anmeldung (X-AUTH-USER) fehlt der Benutzername", 500);
    this.cachePrefix = this.base + "|" + this.auth_mode + "|" + this.username + "|";
  }

  headers() {
    const h = { Accept: "application/json" };
    if (this.auth_mode === "legacy") {
      h["X-AUTH-USER"] = this.username;
      h["X-AUTH-TOKEN"] = this.token;
    } else h.Authorization = "Bearer " + this.token;
    return h;
  }

  /** GET /api/<path>; liefert { data, headers }. ttl in ms (0 = kein Cache). */
  async get(path, params, { ttl = 0, allow404 = false } = {}) {
    const url = this.base + "/api/" + String(path).replace(/^\/+/, "") + qs(params);
    const key = this.cachePrefix + url;
    if (ttl > 0) {
      const hit = cacheGet(key);
      if (hit !== undefined) return hit;
    }
    let res;
    try {
      res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(this.timeout), redirect: "follow" });
    } catch (e) {
      const why = e && (e.name === "TimeoutError" || e.name === "AbortError") ? "Zeitüberschreitung" : (e.cause && e.cause.code) || e.message;
      throw new KimaiError(`Kimai nicht erreichbar (${why})`, 502);
    }
    if (res.status === 404 && allow404) return { data: null, headers: res.headers };
    if (!res.ok) {
      let detail = "";
      try {
        const j = await res.json();
        detail = (j && (j.message || (j.error && j.error.message))) || "";
      } catch (_) {}
      const msg = {
        401: "Kimai hat den API-Token abgelehnt (401). Token und Anmeldeart in der Plugin-Konfiguration prüfen.",
        403: "Der Kimai-Benutzer des Tokens hat dafür keine Berechtigung (403).",
        404: "In Kimai nicht gefunden (404).",
      }[res.status];
      throw new KimaiError((msg || `Kimai-Fehler HTTP ${res.status}`) + (detail ? ` ${detail}` : ""), res.status === 401 || res.status === 403 ? 502 : res.status);
    }
    let data;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      throw new KimaiError("Kimai lieferte kein JSON – URL prüfen (Reverse-Proxy, Anmeldeseite?)", 502);
    }
    const out = { data, headers: res.headers };
    if (ttl > 0) cacheSet(key, out, ttl);
    return out;
  }

  clearCache() {
    cacheClear(this.cachePrefix);
  }

  async version() {
    const { data } = await this.get("version");
    return data;
  }

  /** Alle Kunden (visible: 1 sichtbar, 2 versteckt, 3 alle). */
  async customers({ visible = 3, term } = {}) {
    const { data } = await this.get("customers", { visible, term, orderBy: "name", order: "ASC" }, { ttl: this.ttl });
    return dedupe(data);
  }

  async customer(id) {
    if (!/^\d+$/.test(String(id))) throw new KimaiError(`Ungültige Kimai-Kunden-ID „${id}“`, 400);
    const { data } = await this.get(`customers/${id}`, {}, { ttl: this.ttl, allow404: true });
    return data;
  }

  /** Projekte; ignoreDates=1, sonst liefert Kimai nur aktuell laufende Projekte. */
  async projects({ customers = [], visible = 3, term } = {}) {
    if (!customers.length) {
      const { data } = await this.get("projects", { visible, term, ignoreDates: 1, orderBy: "name" }, { ttl: this.ttl });
      return dedupe(data);
    }
    const all = [];
    for (const part of chunk([...new Set(customers.map(Number))].sort((a, b) => a - b), 100)) {
      const { data } = await this.get("projects", { customers: part, visible, ignoreDates: 1, orderBy: "name" }, { ttl: this.ttl });
      all.push(...(data || []));
    }
    return dedupe(all);
  }

  async project(id) {
    if (!/^\d+$/.test(String(id))) throw new KimaiError(`Ungültige Kimai-Projekt-ID „${id}“`, 400);
    const { data } = await this.get(`projects/${id}`, {}, { ttl: this.ttl, allow404: true });
    return data;
  }

  /** Tätigkeiten der Projekte (inkl. globaler) bzw. nur globale. */
  async activities({ projects = [], visible = 3, globalsOnly = false } = {}) {
    if (globalsOnly || !projects.length) {
      const { data } = await this.get("activities", { visible, globals: 1, orderBy: "name" }, { ttl: this.ttl });
      return dedupe(data);
    }
    const all = [];
    for (const part of chunk([...new Set(projects.map(Number))].sort((a, b) => a - b), 100)) {
      const { data } = await this.get("activities", { projects: part, visible, orderBy: "name" }, { ttl: this.ttl });
      all.push(...(data || []));
    }
    return dedupe(all);
  }

  /**
   * Zeiteinträge seitenweise laden.
   * @param {object} filter  { customers[], projects[], activities[], begin, end, exported, billable, user }
   * @param {object} o       { max = 5000, size = 500 }
   * @returns {{ entries: object[], truncated: boolean, pages: number }}
   */
  async timesheets(filter, { max = 5000, size = 500 } = {}) {
    const f = filter || {};
    if (!(f.customers && f.customers.length) && !(f.projects && f.projects.length))
      throw new KimaiError("Zeiteinträge werden nur mit Kunden- oder Projektfilter abgefragt", 400);
    const base = {
      user: f.user || "all",
      customers: f.projects && f.projects.length ? [] : f.customers,
      projects: f.projects,
      activities: f.activities,
      begin: f.begin,
      end: f.end,
      exported: f.exported,
      billable: f.billable,
      full: "true",
      orderBy: "begin",
      order: "DESC",
      size: Math.min(500, Math.max(1, size)),
    };
    const seen = new Set();
    const entries = [];
    let truncated = false;
    let page = 1;
    let pages = 0;
    for (; page <= 1000; page++) {
      const { data, headers } = await this.get("timesheets", { ...base, page }, { ttl: this.tsTtl, allow404: page > 1 });
      if (!data) break; // Seite hinter dem Ende -> 404
      pages++;
      const list = Array.isArray(data) ? data : [];
      let fresh = 0;
      for (const t of list) {
        if (!t || t.id === undefined || seen.has(t.id)) continue;
        seen.add(t.id);
        fresh++;
        if (entries.length >= max) {
          truncated = true;
          break;
        }
        entries.push(t);
      }
      if (truncated) break;
      const totalPages = Number(headers && headers.get && headers.get("x-total-pages"));
      if (Number.isFinite(totalPages) && totalPages > 0 && page >= totalPages) break;
      if (list.length < base.size) break;
      if (fresh === 0) break; // Wiederholungsschutz
    }
    return { entries, truncated, pages };
  }
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || x.id === undefined || seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

module.exports = { KimaiClient, KimaiError, normalizeBase, qs, cacheClear, dedupe, _cache: CACHE };
