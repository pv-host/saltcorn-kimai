// Kleiner Kimai-2-Nachbau für Tests (nur die gelesenen Endpunkte)
const http = require("http");

function data() {
  const customers = [
    { id: 1, name: "[0815] Holzpellets Muster GmbH", number: "K-0815", comment: "", visible: true, billable: true, currency: "EUR" },
    { id: 2, name: "[0816] Biogas Nord KG", number: "K-0816", comment: "Altkunde", visible: true, billable: true, currency: "EUR" },
    { id: 3, name: "[1408] Firma Alt", number: "", comment: "", visible: false, billable: true, currency: "EUR" },
    { id: 4, name: "Ohne Präfix AG", number: "X1", comment: "", visible: true, billable: true, currency: "CHF" },
  ];
  const projects = [
    { id: 11, name: "08150001", customer: 1, parentTitle: customers[0].name, comment: "SURE Erstzert.", visible: true, billable: true, number: "", orderNumber: "A-1", current: true },
    { id: 12, name: "08150002", customer: 1, parentTitle: customers[0].name, comment: "REDcert Rezert.", visible: true, billable: true, number: "", orderNumber: "", current: false },
    { id: 13, name: "08150003", customer: 1, parentTitle: customers[0].name, comment: "alt", visible: false, billable: true, number: "", orderNumber: "", current: false },
    { id: 21, name: "08160001", customer: 2, parentTitle: customers[1].name, comment: "", visible: true, billable: true, number: "", orderNumber: "", current: true },
    { id: 31, name: "14080001", customer: 3, parentTitle: customers[2].name, comment: "", visible: true, billable: true, number: "", orderNumber: "", current: true },
  ];
  const activities = [
    { id: 100, name: "Audit vor Ort", project: null, visible: true, billable: true },
    { id: 101, name: "Bericht", project: null, visible: true, billable: true },
    { id: 102, name: "Fahrtzeit", project: null, visible: false, billable: false },
    { id: 111, name: "Dokumentenprüfung 0001", project: 11, visible: true, billable: true },
    { id: 121, name: "Nachaudit", project: 21, visible: true, billable: true },
  ];
  const users = {
    5: { id: 5, username: "anna@example.invalid", alias: "Anna Berger" },
    6: { id: 6, username: "bernd", alias: "Bernd Kramer" },
  };
  const ts = [];
  let id = 1000;
  const add = (begin, hours, project, activity, user, extra = {}) => {
    const b = new Date(begin + "Z");
    const e = new Date(b.getTime() + hours * 3600000).toISOString().slice(0, 19);
    ts.push({ id: id++, begin: begin + "+0200", end: e + "+0200", duration: Math.round(hours * 3600), project, activity, user, description: extra.d || "", exported: !!extra.exported, billable: extra.billable !== false, rate: hours * 100, tags: [] });
  };
  add("2026-02-03T08:00:00", 2.5, 11, 100, 5, { d: "Vor-Ort-Audit" });
  add("2026-02-04T09:00:00", 1, 11, 111, 5, { exported: true });
  add("2026-03-10T10:00:00", 0.75, 12, 101, 6, { d: "Bericht; Teil 1" });
  add("2026-03-11T10:00:00", 0.5, 12, 102, 6, { billable: false });
  add("2025-11-20T08:00:00", 4, 11, 100, 6);
  add("2026-04-01T08:00:00", 3, 21, 121, 5);
  for (let i = 0; i < 620; i++) add(`2026-05-${String(1 + (i % 28)).padStart(2, "0")}T07:00:00`, 0.25, 12, 101, 6);
  return { customers, projects, activities, users, ts };
}

function start(port, { token = "secret-token", brokenPaging = false } = {}) {
  const D = data();
  const calls = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    calls.push(u.pathname + u.search);
    const send = (code, body, headers = {}) => {
      res.writeHead(code, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const auth = req.headers.authorization === "Bearer " + token || (req.headers["x-auth-user"] === "svc" && req.headers["x-auth-token"] === token);
    if (!auth) return send(401, { code: 401, message: "Invalid credentials" });
    const q = u.searchParams;
    const arr = (k) => q.getAll(k + "[]").map(Number).concat(q.get(k) ? [Number(q.get(k))] : []);
    const vis = (o) => { const v = q.get("visible") || "1"; return v === "3" || (v === "1" ? o.visible !== false : o.visible === false); };
    const p = u.pathname;
    let m;
    if (p === "/api/version") return send(200, { version: "2.40.0", semver: "2.40.0" });
    if (p === "/api/customers") {
      let l = D.customers.filter(vis);
      if (q.get("term")) l = l.filter((c) => c.name.toLowerCase().includes(q.get("term").toLowerCase()));
      return send(200, l);
    }
    if ((m = p.match(/^\/api\/customers\/(\d+)$/))) {
      const c = D.customers.find((x) => x.id === Number(m[1]));
      return c ? send(200, c) : send(404, { message: "Not found" });
    }
    if (p === "/api/projects") {
      const cs = arr("customer").concat(arr("customers").filter((x) => !arr("customer").includes(x)));
      let l = D.projects.filter(vis).filter((x) => !cs.length || cs.includes(x.customer));
      if (q.get("ignoreDates") !== "1") l = l.filter((x) => x.current);
      return send(200, l.map(({ current, ...x }) => x));
    }
    if ((m = p.match(/^\/api\/projects\/(\d+)$/))) {
      const c = D.projects.find((x) => x.id === Number(m[1]));
      return c ? send(200, c) : send(404, { message: "Not found" });
    }
    if (p === "/api/activities") {
      const ps = arr("projects").concat(arr("project"));
      let l = D.activities.filter(vis);
      if (q.get("globals") === "1" || q.get("globals") === "true") l = l.filter((a) => a.project === null);
      else if (ps.length) l = l.filter((a) => a.project === null || ps.includes(a.project));
      return send(200, l);
    }
    if (p === "/api/timesheets") {
      const cs = arr("customers").concat(arr("customer"));
      const ps = arr("projects").concat(arr("project"));
      const as = arr("activities").concat(arr("activity"));
      let l = D.ts.filter((t) => {
        const pr = D.projects.find((x) => x.id === t.project);
        if (cs.length && !cs.includes(pr.customer)) return false;
        if (ps.length && !ps.includes(t.project)) return false;
        if (as.length && !as.includes(t.activity)) return false;
        const b = t.begin.slice(0, 19);
        if (q.get("begin") && b < q.get("begin")) return false;
        if (q.get("end") && b > q.get("end")) return false;
        if (q.get("exported") && String(Number(t.exported)) !== q.get("exported")) return false;
        if (q.get("billable") && String(Number(t.billable)) !== q.get("billable")) return false;
        return true;
      });
      l.sort((a, b) => (a.begin < b.begin ? 1 : -1));
      const size = Math.min(500, Number(q.get("size") || 50));
      const page = Number(q.get("page") || 1);
      const pages = Math.max(1, Math.ceil(l.length / size));
      if (!brokenPaging && page > pages) return send(404, { message: "Not found" });
      const slice = brokenPaging ? l.slice(0, size) : l.slice((page - 1) * size, page * size);
      const full = q.get("full") === "true" || q.get("full") === "1";
      const out = slice.map((t) => {
        if (!full) return t;
        const pr = D.projects.find((x) => x.id === t.project);
        const cu = D.customers.find((x) => x.id === pr.customer);
        const ac = D.activities.find((x) => x.id === t.activity);
        return { ...t, user: D.users[t.user], project: { id: pr.id, name: pr.name, customer: { id: cu.id, name: cu.name, currency: cu.currency } }, activity: { id: ac.id, name: ac.name } };
      });
      const h = brokenPaging ? {} : { "X-Page": page, "X-Total-Count": l.length, "X-Total-Pages": pages, "X-Per-Page": size };
      return send(200, out, h);
    }
    send(404, { message: "Not found" });
  });
  return new Promise((r) => server.listen(port, () => r({ server, calls, D, close: () => new Promise((rr) => server.close(rr)) })));
}

module.exports = { start };
