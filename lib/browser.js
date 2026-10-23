/* eslint-disable no-var */
/**
 * Browser-Teil der Kimai-Ansichten. Wird per Function.toString() in die Seite
 * eingebettet und läuft im Browser, nicht in Node. Alle Aufrufe gehen über
 * Saltcorns view_post (inkl. CSRF-Token) an die Routen der View.
 *
 * O = { viewname, uid, ctx, mode: "row"|"browse", tabs: [..], default_tab,
 *       perms: { timesheets, rates, refresh }, range: { from, to },
 *       links: { base, locale } | null, page_size, show_info, group_default,
 *       single: bool (nur ein Inhalt, keine Register), compact: bool (letzte Einträge),
 *       max_rows: Höchstzahl dargestellter Zeilen je Liste (0 = alle), labels: {} }
 */
function kimaiPanel(O) {
  var root = document.getElementById(O.uid);
  if (!root) return;
  var $ = function (s) { return root.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
  var ctx = {};
  var k;
  for (k in O.ctx) ctx[k] = O.ctx[k];
  var D = null; // aufgelöste Kunden/Projekte/Tätigkeiten
  var TS = null; // geladene Zeiteinträge
  var tab = O.default_tab || O.tabs[0];
  var page = 0;
  var group = O.group_default || "project";
  var projSearch = "";

  var TAB_LABEL = { customers: "Kunde", projects: "Projekte", activities: "Tätigkeiten", timesheets: "Stundeneinträge" };
  for (k in O.labels || {}) TAB_LABEL[k] = O.labels[k];
  var MAX = Number(O.max_rows) > 0 ? Number(O.max_rows) : 0;
  /** Zeilenbegrenzung: Liste kürzen und Hinweis auf weitere Zeilen */
  function lim(list) { return MAX && list.length > MAX ? list.slice(0, MAX) : list; }
  function more(list, what) {
    return MAX && list.length > MAX
      ? '<div class="small text-muted kimai-hint">… ' + (list.length - MAX) + " weitere " + esc(what || "Zeilen") + " nicht dargestellt (Begrenzung auf " + MAX + ")</div>"
      : "";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function hm(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0) );
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (m === 60) { h++; m = 0; }
    return h + ":" + (m < 10 ? "0" : "") + m;
  }
  function dec(sec) { return ((Number(sec) || 0) / 3600).toFixed(2).replace(".", ","); }
  function money(v, cur) {
    if (v === null || v === undefined || v === "") return "";
    return Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur ? " " + esc(cur) : "");
  }
  function day(s) {
    if (!s) return "";
    var p = String(s).slice(0, 10).split("-");
    return p.length === 3 ? p[2] + "." + p[1] + "." + p[0] : s;
  }
  function time(s) { return s ? String(s).slice(11, 16) : ""; }
  function msg(t, kind) {
    $(".kimai-msg").innerHTML = t ? '<div class="alert alert-' + (kind || "danger") + ' py-1 px-2 small mb-2" role="alert">' + esc(t) + "</div>" : "";
  }
  function busy(on) { $(".kimai-busy").style.display = on ? "" : "none"; }
  function body(extra) {
    var d = {}, x;
    for (x in extra) d[x] = extra[x];
    for (x in ctx) d[x] = ctx[x]; // Kontext (Datensatz-ID) hat Vorrang
    return d;
  }
  function post(route, payload, cb) {
    busy(true);
    view_post(O.viewname, route, body(payload || {}), function (res) {
      busy(false);
      if (res && (res.kimai_error || res.error)) {
        if (res.mapping) renderMapping(res.mapping);
        msg(res.kimai_error || res.error, res.status === 400 || res.status === 404 ? "warning" : "danger");
        return;
      }
      msg("");
      cb && cb(res || {});
    });
  }
  function link(kind, id) {
    if (!O.links || !id) return "";
    var path = { customer: "/admin/customer/" + id + "/details", project: "/admin/project/" + id + "/details",
      activity: "/admin/activity/" + id + "/details", timesheet: "/team/timesheet/" + id + "/edit" }[kind];
    return ' <a href="' + esc(O.links.base + "/" + O.links.locale + path) + '" target="_blank" rel="noopener" title="In Kimai öffnen" class="text-muted small"><i class="fas fa-external-link-alt"></i></a>';
  }
  function badgeHidden(o) { return o && o.visible === false ? ' <span class="badge bg-secondary">inaktiv</span>' : ""; }
  // Tabellen wie Saltcorns List (mkTable): gleiche Klassen, Ausrichtung über
  // text-align-right, Layout-Optionen aus O.layout (siehe lib/layout.js)
  var LO = O.layout || { class: "table-valign-middle " };
  function blank(v) { return v === undefined || v === null || String(v).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "").trim() === ""; }
  function collapseCss(id, labels, bp) {
    var s = "#" + id;
    return "<style>@media only screen and (max-width: " + bp + "px) {" +
      s + " table, " + s + " thead, " + s + " tbody, " + s + " th, " + s + " td, " + s + " tr { display: block; }" +
      s + " td.text-align-right, " + s + " th.text-align-right { text-align: left !important; }" +
      s + " thead tr { position: absolute; top: -9999px; left: -9999px; }" +
      s + " tr { border: 1px solid #ccc; } " + s + " tr:not(:first-child) { border-top-width: 3px }" +
      s + " td { border: none; border-bottom: 1px solid #eee; position: relative; padding-left: 50%; min-height: 1.5lh; }" +
      s + " td:before { position: absolute; top: 6px; left: 6px; width: 45%; padding-right: 10px; white-space: nowrap; }" +
      labels.map(function (l, i) { return s + " td:nth-of-type(" + (i + 1) + "):before { content: \"" + String(l).replace(/["\\<>]/g, "") + "\"; }"; }).join("") +
      "}</style>";
  }
  /** head: [{ t, align: "right", keep }], rows: Zellen-Arrays (HTML), name: eindeutiger Tabellenname */
  function table(head, rows, empty, name) {
    if (!rows.length) return '<div class="text-muted small kimai-empty">' + esc(empty || "Keine Einträge") + "</div>";
    var cols = head.map(function (h, i) { return i; });
    if (LO.hideNull) cols = cols.filter(function (i) { return head[i].keep || rows.some(function (r) { return !blank(r[i]); }); });
    function al(i) { return head[i].align ? ' class="text-align-' + head[i].align + '"' : ""; }
    var id = LO.collapse ? (O.table_id || O.uid) + "_" + (name || "t") : "";
    var cls = "table table-sm " + (LO.class || "") + (LO.fixed ? "table-layout-fixed" : "");
    return "<div" + (LO.sticky ? "" : ' class="table-responsive"') + (id ? ' id="' + esc(id) + '"' : "") + '><table class="' + cls.trim() + '">' +
      (LO.noHeader ? "" : "<thead" + (LO.sticky ? ' class="sticky-top"' : "") + "><tr>" + cols.map(function (i) { return "<th" + al(i) + ">" + esc(head[i].t) + "</th>"; }).join("") + "</tr></thead>") +
      "<tbody>" + rows.map(function (r) { return "<tr>" + cols.map(function (i) { return "<td" + al(i) + ">" + (r[i] === undefined || r[i] === null ? "" : r[i]) + "</td>"; }).join("") + "</tr>"; }).join("") +
      "</tbody></table></div>" + (id ? collapseCss(id, cols.map(function (i) { return head[i].t; }), LO.breakpoint || 760) : "");
  }
  /** Seitennavigation wie Saltcorns List (helpers.pagination), cur ab 1 */
  function pager(cur, pages) {
    var from = Math.max(1, cur - 3), to = Math.min(pages, cur + 3), lis = [];
    function item(n, active) { return '<li class="page-item' + (active ? " active" : "") + '"><span class="page-link link-style kimai-page" role="link" data-page="' + n + '">' + n + "</span></li>"; }
    var dots = '<li class="page-item"><span class="page-link">...</span></li>';
    if (from > 1) { lis.push(item(1)); lis.push(dots); }
    for (var n = from; n <= to; n++) lis.push(item(n, n === cur));
    if (to < pages) { lis.push(dots); lis.push(item(pages)); }
    return '<ul class="pagination">' + lis.join("") + "</ul>";
  }
  var RIGHT = "right";
  var running = ' <span class="badge bg-success">läuft</span>';

  // ------------------------------------------------------------ Grundgerüst
  root.innerHTML =
    '<div class="kimai-head d-flex flex-wrap align-items-center gap-2 mb-2">' +
    (O.mode === "browse"
      ? '<form class="kimai-search d-flex gap-1"><input type="search" class="form-control form-control-sm" style="min-width:16rem" placeholder="Kunde suchen (Name, Nummer)" name="term"><button class="btn btn-sm btn-outline-primary" type="submit"><i class="fas fa-search"></i></button></form>'
      : "") +
    '<div class="kimai-info small text-muted flex-grow-1"></div>' +
    '<span class="kimai-busy spinner-border spinner-border-sm text-secondary" style="display:none" role="status"></span>' +
    (O.perms.refresh ? '<button type="button" class="btn btn-sm btn-outline-secondary kimai-refresh" title="Neu aus Kimai laden"><i class="fas fa-sync-alt"></i></button>' : "") +
    "</div>" +
    '<div class="kimai-msg"></div>' +
    (O.mode === "browse" ? '<div class="kimai-hits mb-2"></div>' : "") +
    '<ul class="nav nav-tabs kimai-tabs mb-2" style="display:none">' +
    O.tabs.map(function (t) {
      return '<li class="nav-item"><a href="#" class="nav-link" data-tab="' + t + '">' + TAB_LABEL[t] + ' <span class="badge bg-light text-dark kimai-count-' + t + '"></span></a></li>';
    }).join("") +
    "</ul>" +
    O.tabs.map(function (t) { return '<div class="kimai-pane" data-pane="' + t + '" style="display:none"></div>'; }).join("");

  $$(".kimai-tabs [data-tab]").forEach(function (a) {
    a.addEventListener("click", function (e) { e.preventDefault(); show(a.getAttribute("data-tab")); });
  });
  if ($(".kimai-refresh"))
    $(".kimai-refresh").addEventListener("click", function () {
      if (O.mode === "browse" && !ctx.customer_id) return;
      post("refresh", {}, function (res) { setData(res); if (TS) loadTimesheets(); });
    });

  function show(t) {
    tab = t;
    $$(".kimai-tabs .nav-link").forEach(function (a) { a.classList.toggle("active", a.getAttribute("data-tab") === t); });
    $$(".kimai-pane").forEach(function (p) { p.style.display = p.getAttribute("data-pane") === t ? "" : "none"; });
    if (t === "timesheets" && !TS && O.perms.timesheets) loadTimesheets();
  }

  function renderMapping(m) {
    if (!O.show_info) return;
    var parts = [];
    if (m.customer_value) parts.push("Kunde: " + esc(m.customer_label || "") + " „" + esc(m.customer_value) + "“");
    if (m.project_value) parts.push("Projekte: " + esc(m.project_label || "") + " „" + esc(m.project_value) + "“");
    $(".kimai-info").innerHTML = parts.join(" · ");
  }

  function setData(res) {
    D = res;
    renderMapping(res.mapping || {});
    $(".kimai-tabs").style.display = O.single ? "none" : "";
    var counts = { customers: D.customers.length, projects: D.projects.length, activities: D.activities.length };
    for (var c in counts) { var el = $(".kimai-count-" + c); if (el) el.textContent = counts[c]; }
    if (!D.customers.length && !D.projects.length)
      msg("In Kimai wurde zu diesem Datensatz kein Kunde/Projekt gefunden.", "warning");
    renderAll();
    show(tab);
  }

  // ------------------------------------------------------------ Summen aus Zeiteinträgen
  function sumsBy(key) {
    var s = {};
    if (!TS) return s;
    TS.entries.forEach(function (e) { var v = e[key]; s[v] = (s[v] || 0) + (Number(e.duration) || 0); });
    return s;
  }

  function renderCustomers() {
    var p = $('[data-pane="customers"]');
    if (!p) return;
    var hrs = sumsBy("customer");
    p.innerHTML = table(
      [{ t: "Kunde" }, { t: "Nummer" }, { t: "Kommentar" }, { t: "Projekte", align: RIGHT }].concat(TS ? [{ t: "Stunden", align: RIGHT }] : []),
      lim(D.customers).map(function (c) {
        var n = D.projects.filter(function (pr) { return pr.customer === c.id; }).length;
        return [esc(c.name) + badgeHidden(c) + link("customer", c.id), esc(c.number || ""), esc(c.comment || ""), n]
          .concat(TS ? [hm(hrs[c.id] || 0)] : []);
      }),
      "Kein Kimai-Kunde zugeordnet", "kunden"
    ) + more(D.customers, "Kunden");
  }

  function renderProjects() {
    var p = $('[data-pane="projects"]');
    if (!p) return;
    var hrs = sumsBy("project");
    var q = projSearch.toLowerCase();
    var list = D.projects.filter(function (pr) {
      return !q || (pr.name + " " + (pr.comment || "") + " " + (pr.number || "") + " " + (pr.orderNumber || "")).toLowerCase().indexOf(q) >= 0;
    });
    var multi = D.customers.length > 1;
    var withSearch = D.projects.length > 1;
    p.innerHTML =
      (withSearch ? '<input type="search" class="form-control form-control-sm mb-2 kimai-psearch" style="max-width:20rem" placeholder="Projekte filtern" value="' + esc(projSearch) + '">' : "") +
      table(
        [{ t: "Projekt" }].concat(multi ? [{ t: "Kunde" }] : []).concat([{ t: "Nummer / Auftrag" }, { t: "Kommentar" }])
          .concat(TS ? [{ t: "Stunden", align: RIGHT }] : []),
        lim(list).map(function (pr) {
          return [esc(pr.name) + badgeHidden(pr) + link("project", pr.id)].concat(multi ? [esc(pr.customer_name || "")] : [])
            .concat([esc([pr.number, pr.orderNumber].filter(Boolean).join(" / ")), esc(pr.comment || "")])
            .concat(TS ? [hm(hrs[pr.id] || 0)] : []);
        }),
        "Keine Projekte", "projekte"
      ) + more(list, "Projekte");
    var inp = $(".kimai-psearch");
    if (inp) inp.addEventListener("input", function () { projSearch = inp.value; renderProjects(); var i2 = $(".kimai-psearch"); i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); });
  }

  function renderActivities() {
    var p = $('[data-pane="activities"]');
    if (!p) return;
    var hrs = sumsBy("activity");
    p.innerHTML = table(
      [{ t: "Tätigkeit" }, { t: "Gilt für" }, { t: "Kommentar" }].concat(TS ? [{ t: "Stunden", align: RIGHT }] : []),
      lim(D.activities).map(function (a) {
        return [esc(a.name) + badgeHidden(a) + link("activity", a.id),
          a.project ? esc(a.project_name || "Projekt " + a.project) : '<span class="badge bg-info text-dark">global</span>',
          esc(a.comment || "")].concat(TS ? [hm(hrs[a.id] || 0)] : []);
      }),
      "Keine Tätigkeiten", "taetigkeiten"
    ) + more(D.activities, "Tätigkeiten");
  }

  // ------------------------------------------------------------ Stundeneinträge
  function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? " selected" : "") + ">" + esc(label) + "</option>"; }
  var F = { from: (O.range && O.range.from) || "", to: (O.range && O.range.to) || "", project: "", activity: "", user: "", exported: "", billable: "" };

  function renderTimesheets() {
    var p = $('[data-pane="timesheets"]');
    if (!p) return;
    if (!O.perms.timesheets) { p.innerHTML = '<div class="text-muted small kimai-empty">Keine Berechtigung für Stundeneinträge.</div>'; return; }
    if (O.compact) { renderRecent(p); return; }
    var users = {};
    if (TS) TS.entries.forEach(function (e) { users[e.user_id] = e.user; });
    var form =
      '<form class="kimai-tsform row g-2 align-items-end mb-2">' +
      '<div class="col-auto"><label class="form-label small mb-0">Von</label><input type="date" class="form-control form-control-sm" name="from" value="' + esc(F.from) + '"></div>' +
      '<div class="col-auto"><label class="form-label small mb-0">Bis</label><input type="date" class="form-control form-control-sm" name="to" value="' + esc(F.to) + '"></div>' +
      '<div class="col-auto"><label class="form-label small mb-0">Zeitraum</label><select class="form-select form-select-sm" name="preset">' +
      opt("", "–") + opt("year", "aktuelles Jahr") + opt("last_year", "Vorjahr") + opt("month", "aktueller Monat") + opt("90", "letzte 90 Tage") + opt("365", "letzte 12 Monate") + opt("all", "gesamt") +
      "</select></div>" +
      '<div class="col-auto"><label class="form-label small mb-0">Projekt</label><select class="form-select form-select-sm" name="project" style="max-width:16rem">' + opt("", "alle") +
      D.projects.map(function (pr) { return opt(pr.id, pr.name, F.project); }).join("") + "</select></div>" +
      '<div class="col-auto"><label class="form-label small mb-0">Tätigkeit</label><select class="form-select form-select-sm" name="activity" style="max-width:14rem">' + opt("", "alle") +
      D.activities.map(function (a) { return opt(a.id, a.name, F.activity); }).join("") + "</select></div>" +
      '<div class="col-auto"><label class="form-label small mb-0">Benutzer</label><select class="form-select form-select-sm" name="user">' + opt("", "alle") +
      Object.keys(users).map(function (u) { return opt(u, users[u], F.user); }).join("") + "</select></div>" +
      '<div class="col-auto"><label class="form-label small mb-0">Export</label><select class="form-select form-select-sm" name="exported">' +
      opt("", "alle", F.exported) + opt("0", "offen", F.exported) + opt("1", "exportiert", F.exported) + "</select></div>" +
      '<div class="col-auto"><label class="form-label small mb-0">Abrechenbar</label><select class="form-select form-select-sm" name="billable">' +
      opt("", "alle", F.billable) + opt("1", "ja", F.billable) + opt("0", "nein", F.billable) + "</select></div>" +
      '<div class="col-auto"><button class="btn btn-sm btn-primary" type="submit"><i class="fas fa-filter"></i> Laden</button></div>' +
      (TS && TS.entries.length ? '<div class="col-auto"><button class="btn btn-sm btn-outline-secondary kimai-csv" type="button"><i class="fas fa-file-csv"></i> CSV</button></div>' : "") +
      "</form>";
    var out = form;
    if (TS) {
      var tot = 0, bill = 0, amount = 0, cur = "";
      TS.entries.forEach(function (e) {
        tot += Number(e.duration) || 0;
        if (e.billable) bill += Number(e.duration) || 0;
        if (e.rate !== undefined) amount += Number(e.rate) || 0;
        if (e.currency) cur = e.currency;
      });
      out += '<div class="d-flex flex-wrap gap-3 small mb-2">' +
        "<span><b>" + TS.entries.length + "</b> Einträge</span>" +
        "<span><b>" + hm(tot) + "</b> h (" + dec(tot) + ")</span>" +
        "<span>davon abrechenbar <b>" + hm(bill) + "</b> h</span>" +
        (O.perms.rates ? "<span>Betrag <b>" + money(amount, cur) + "</b></span>" : "") +
        (TS.truncated ? '<span class="text-danger">Anzeige auf ' + TS.entries.length + " Einträge begrenzt – Zeitraum eingrenzen</span>" : "") +
        (TS.own_only ? '<span class="text-muted">nur eigene Einträge</span>' : "") +
        "</div>";
      // Gruppensummen
      var keyOf = {
        project: function (e) { return e.project_name; }, activity: function (e) { return e.activity_name; },
        user: function (e) { return e.user; }, month: function (e) { return String(e.begin).slice(0, 7); },
        customer: function (e) { return e.customer_name; },
      }[group];
      var g = {};
      TS.entries.forEach(function (e) {
        var kk = keyOf(e) || "–";
        if (!g[kk]) g[kk] = { d: 0, n: 0, r: 0 };
        g[kk].d += Number(e.duration) || 0; g[kk].n++; g[kk].r += Number(e.rate) || 0;
      });
      var keys = Object.keys(g).sort(function (a, b) { return group === "month" ? (a < b ? 1 : -1) : g[b].d - g[a].d; });
      out += '<details class="mb-2"' + (TS.entries.length ? " open" : "") + '><summary class="small">Summen nach ' +
        '<select class="form-select form-select-sm d-inline-block w-auto kimai-group">' +
        opt("project", "Projekt", group) + opt("activity", "Tätigkeit", group) + opt("user", "Benutzer", group) + opt("month", "Monat", group) +
        (D.customers.length > 1 ? opt("customer", "Kunde", group) : "") + "</select></summary>" +
        table([{ t: { project: "Projekt", activity: "Tätigkeit", user: "Benutzer", month: "Monat", customer: "Kunde" }[group] || "" }, { t: "Einträge", align: RIGHT }, { t: "Stunden", align: RIGHT }, { t: "dezimal", align: RIGHT }].concat(O.perms.rates ? [{ t: "Betrag", align: RIGHT }] : []),
          keys.map(function (kk) {
            return [esc(group === "month" ? kk.slice(5, 7) + "/" + kk.slice(0, 4) : kk), g[kk].n, hm(g[kk].d), dec(g[kk].d)]
              .concat(O.perms.rates ? [money(g[kk].r, cur)] : []);
          }), "Keine Einträge im Zeitraum", "summen") +
        "</details>";
      // Einzelne Einträge, seitenweise
      var size = MAX || O.page_size || 50;
      var pages = MAX ? 1 : Math.max(1, Math.ceil(TS.entries.length / size));
      if (page >= pages) page = pages - 1;
      var slice = TS.entries.slice(page * size, page * size + size);
      out += table(
        [{ t: "Datum" }, { t: "Zeit" }, { t: "Stunden", align: RIGHT }, { t: "Benutzer" }, { t: "Projekt" }, { t: "Tätigkeit" }, { t: "Beschreibung" }]
          .concat(O.perms.rates ? [{ t: "Betrag", align: RIGHT }] : []).concat([{ t: "", keep: true }]),
        slice.map(function (e) {
          return [day(e.begin), time(e.begin) + (e.end ? "–" + time(e.end) : running),
            hm(e.duration), esc(e.user), esc(e.project_name), esc(e.activity_name), esc(e.description || "")]
            .concat(O.perms.rates ? [money(e.rate, e.currency)] : [])
            .concat([(e.exported ? '<i class="fas fa-lock text-muted" title="exportiert"></i>' : "") + (e.billable === false ? ' <i class="fas fa-ban text-muted" title="nicht abrechenbar"></i>' : "") + link("timesheet", e.id)]);
        }),
        "Keine Stundeneinträge im gewählten Zeitraum", "eintraege"
      ) + more(TS.entries, "Stundeneinträge");
      if (pages > 1)
        out += pager(page + 1, pages);
    }
    p.innerHTML = out;
    var f = $(".kimai-tsform");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      ["from", "to", "project", "activity", "user", "exported", "billable"].forEach(function (n) { F[n] = f.elements[n].value; });
      page = 0;
      loadTimesheets();
    });
    f.elements.preset.addEventListener("change", function () {
      var r = presetRange(f.elements.preset.value);
      if (r) { f.elements.from.value = r[0]; f.elements.to.value = r[1]; }
    });
    if ($(".kimai-group")) $(".kimai-group").addEventListener("change", function (e) { group = e.target.value; renderTimesheets(); });
    if ($(".kimai-group")) $(".kimai-group").addEventListener("click", function (e) { e.preventDefault(); });
    $$(".kimai-page").forEach(function (el) { el.addEventListener("click", function () { page = Number(el.getAttribute("data-page")) - 1; renderTimesheets(); }); });
    if ($(".kimai-csv")) $(".kimai-csv").addEventListener("click", csv);
  }

  /** Kompakte Liste der letzten Stundeneinträge (ohne Filter und Summen) */
  function renderRecent(p) {
    if (!TS) { p.innerHTML = '<div class="text-muted small kimai-empty">Stundeneinträge werden geladen …</div>'; return; }
    var multi = D.projects.length > 1;
    p.innerHTML = table(
      [{ t: "Datum" }, { t: "Stunden", align: RIGHT }, { t: "Benutzer" }].concat(multi ? [{ t: "Projekt" }] : [])
        .concat([{ t: "Tätigkeit" }, { t: "Beschreibung" }]).concat(O.perms.rates ? [{ t: "Betrag", align: RIGHT }] : []).concat([{ t: "", keep: true }]),
      lim(TS.entries).map(function (e) {
        return [day(e.begin) + (e.end ? "" : running), hm(e.duration), esc(e.user)].concat(multi ? [esc(e.project_name)] : [])
          .concat([esc(e.activity_name), esc(e.description || "")]).concat(O.perms.rates ? [money(e.rate, e.currency)] : []).concat([link("timesheet", e.id)]);
      }),
      "Keine Stundeneinträge", "letzte"
    ) + (TS.truncated || (MAX && TS.entries.length > MAX) ? '<div class="small text-muted kimai-hint">… ältere Einträge nicht dargestellt</div>' : "") +
      (TS.own_only ? '<div class="small text-muted kimai-hint">nur eigene Einträge</div>' : "");
  }

  function iso(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function presetRange(v) {
    var n = new Date(), y = n.getFullYear();
    if (v === "year") return [y + "-01-01", y + "-12-31"];
    if (v === "last_year") return [y - 1 + "-01-01", y - 1 + "-12-31"];
    if (v === "month") return [iso(new Date(y, n.getMonth(), 1)), iso(n)];
    if (v === "90") return [iso(new Date(n.getTime() - 90 * 864e5)), iso(n)];
    if (v === "365") return [iso(new Date(n.getTime() - 365 * 864e5)), iso(n)];
    if (v === "all") return ["", ""];
    return null;
  }

  function loadTimesheets() {
    post("timesheets", { from: F.from, to: F.to, project: F.project, activity: F.activity, user: F.user, exported: F.exported, billable: F.billable }, function (res) {
      TS = res;
      var el = $(".kimai-count-timesheets");
      if (el) el.textContent = TS.entries.length + (TS.truncated ? "+" : "");
      renderAll();
    });
  }

  function csv() {
    var q = function (v) { v = String(v == null ? "" : v); return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var head = ["Datum", "Beginn", "Ende", "Dauer (h:mm)", "Dauer (dezimal)", "Benutzer", "Kunde", "Projekt", "Tätigkeit", "Beschreibung", "Abrechenbar", "Exportiert"];
    if (O.perms.rates) head.push("Betrag");
    var lines = [head.join(";")];
    TS.entries.forEach(function (e) {
      var r = [day(e.begin), time(e.begin), time(e.end), hm(e.duration), dec(e.duration), e.user, e.customer_name, e.project_name, e.activity_name, e.description,
        e.billable === false ? "nein" : "ja", e.exported ? "ja" : "nein"];
      if (O.perms.rates) r.push(e.rate === undefined || e.rate === null ? "" : String(Number(e.rate).toFixed(2)).replace(".", ","));
      lines.push(r.map(q).join(";"));
    });
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kimai-stunden" + (F.from ? "-" + F.from : "") + (F.to ? "-" + F.to : "") + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function renderAll() {
    if (!D) return;
    renderCustomers();
    renderProjects();
    renderActivities();
    renderTimesheets();
  }

  // ------------------------------------------------------------ Start
  if (O.mode === "browse") {
    var sf = $(".kimai-search");
    sf.addEventListener("submit", function (e) {
      e.preventDefault();
      post("search", { term: sf.elements.term.value }, function (res) {
        var hits = res.customers || [];
        $(".kimai-hits").innerHTML = hits.length
          ? '<div class="list-group list-group-flush border rounded" style="max-height:16rem;overflow:auto">' +
            hits.map(function (c) { return '<a href="#" class="list-group-item list-group-item-action py-1 small" data-cid="' + c.id + '">' + esc(c.name) + (c.number ? ' <span class="text-muted">' + esc(c.number) + "</span>" : "") + badgeHidden(c) + "</a>"; }).join("") +
            (res.more ? '<div class="list-group-item small text-muted">… weitere Treffer, Suche eingrenzen</div>' : "") + "</div>"
          : '<div class="text-muted small">Kein Kunde gefunden</div>';
        $$(".kimai-hits [data-cid]").forEach(function (a) {
          a.addEventListener("click", function (ev) {
            ev.preventDefault();
            ctx.customer_id = a.getAttribute("data-cid");
            $(".kimai-hits").innerHTML = "";
            TS = null;
            post("load", {}, setData);
          });
        });
      });
    });
  } else {
    post("load", {}, setData);
  }
}

module.exports = { kimaiPanel };
