// Tests: Vorlagen, Kimai-Client, Zuordnung und Stundenfilter gegen den Kimai-Nachbau
// Aufruf: npm test  (für die index.js-Tests muss @saltcorn/data auflösbar sein)
const assert = require("assert");
const { start } = require("./mock-kimai");
const { fill, buildVariables, rangePreset, isoDay, dateVariables } = require("../lib/template");
const { KimaiClient, qs, normalizeBase, cacheClear } = require("../lib/kimai");
const { resolveRow, resolveCustomerId, timesheetScope, withDefaults } = require("../lib/resolve");

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed++;
  console.log("  ok -", name);
};

(async () => {
  const PORT = Number(process.env.KIMAI_TEST_PORT || 18190);
  const mock = await start(PORT);
  const cfg = { base_url: `http://localhost:${PORT}/`, token: "secret-token", cache_ttl_s: 300, timesheet_ttl_s: 0 };
  const client = new KimaiClient(cfg);
  const { vars } = buildVariables({});
  const entity = { id: 7, entity_code: 815, contact_code: 1, entity_name: "Holzpellets Muster", reference_code: "08150002" };

  console.log("Vorlagen und Variablen:");
  await t("Feld, Auffüllen, Variable", () => {
    assert.strictEqual(fill("[{entity_code:4}]", entity, vars), "[0815]");
    assert.strictEqual(fill("{$kunde}", entity, vars), "[0815]");
    assert.strictEqual(fill("{$projekt}{contact_code:2}", entity, vars), "081501");
    assert.strictEqual(fill("[{reference_code[0:4]}]", entity, vars), "[0815]");
    assert.strictEqual(fill("{reference_code[4:8]:6}", entity, vars), "0002");
    assert.strictEqual(fill("{$prozess_kunde}", { reference_code: 1000001 }, vars), "[0100]"); // erst auffüllen, dann ausschneiden
    assert.strictEqual(fill("{$prozess_projekt}", { reference_code: 1000001 }, vars), "01000001");
  });
  await t("eigene Variablen überschreiben Vorgaben, verschachtelt", () => {
    const v = buildVariables({ variables: [{ var_name: "nr", var_value: "{entity_code:4}" }, { var_name: "$kunde", var_value: "[{$nr}-{contact_code:2}]" }] }).vars;
    assert.strictEqual(fill("{$kunde}", entity, v), "[0815-01]");
  });
  await t("Fehler: leeres Feld, unbekannte Variable, Zirkel", () => {
    assert.throws(() => fill("{$kunde}", { entity_code: "" }, vars), /kein Wert für \{entity_code\}/);
    assert.throws(() => fill("{$gibtsnicht}", entity, vars), /Unbekannte Variable/);
    const v = buildVariables({ variables: [{ var_name: "a", var_value: "{$b}" }, { var_name: "b", var_value: "{$a}" }] }).vars;
    assert.throws(() => fill("{$a}", entity, v), /zu tief/);
  });
  await t("ungültige Variablen werden gemeldet", () => {
    const r = buildVariables({ variables: [{ var_name: "1x", var_value: "a" }, { var_name: "heute", var_value: "x" }, { var_name: "k", var_value: "1" }, { var_name: "k", var_value: "2" }] });
    assert.strictEqual(r.problems.length, 3);
  });
  await t("Datumsvariablen und Zeiträume", () => {
    const now = new Date(2026, 9, 18, 12);
    assert.strictEqual(dateVariables(now).jahresbeginn, "2026-01-01");
    assert.deepStrictEqual(rangePreset("last_year", {}, now), { from: "2025-01-01", to: "2025-12-31" });
    assert.deepStrictEqual(rangePreset("all", {}, now), { from: null, to: null });
    assert.deepStrictEqual(rangePreset("template", { row: { audit: new Date(2026, 1, 3) }, vars, from_template: "{audit}", to_template: "{$heute}" }, now).from, "2026-02-03");
    assert.throws(() => isoDay("2026-02-30"));
  });

  console.log("Client:");
  await t("URL-Normalisierung und Query-Arrays", () => {
    assert.strictEqual(normalizeBase("https://k.example/api/"), "https://k.example");
    assert.strictEqual(qs({ customers: [1, 2], a: "", b: null, visible: 3 }), "?customers[]=1&customers[]=2&visible=3");
    assert.throws(() => normalizeBase("k.example"));
  });
  await t("falscher Token -> verständlicher Fehler", async () => {
    const bad = new KimaiClient({ ...cfg, token: "x" });
    await assert.rejects(bad.customers(), /API-Token abgelehnt/);
  });
  await t("alte Anmeldung X-AUTH-USER", async () => {
    const legacy = new KimaiClient({ ...cfg, auth_mode: "legacy", username: "svc" });
    assert.strictEqual((await legacy.version()).version, "2.40.0");
  });
  await t("nicht erreichbar -> 502", async () => {
    const off = new KimaiClient({ ...cfg, base_url: "http://127.0.0.1:1", timeout_ms: 2000 });
    await assert.rejects(off.version(), (e) => e.status === 502);
  });
  await t("Projekte mit ignoreDates (sonst fehlen beendete Projekte)", async () => {
    const p = await client.projects({ customers: [1] });
    assert.deepStrictEqual(p.map((x) => x.id).sort(), [11, 12, 13]);
  });
  await t("Zwischenspeicher: zweiter Kundenabruf ohne HTTP", async () => {
    cacheClear();
    mock.calls.length = 0;
    await client.customers();
    await client.customers();
    assert.strictEqual(mock.calls.filter((c) => c.startsWith("/api/customers")).length, 1);
  });
  await t("Zeiteinträge seitenweise (625 Einträge, 2 Seiten)", async () => {
    const r = await client.timesheets({ customers: [1] });
    assert.strictEqual(r.entries.length, 625);
    assert.strictEqual(r.pages, 2);
    assert.strictEqual(r.truncated, false);
  });
  await t("Höchstzahl begrenzt die Abfrage", async () => {
    const r = await client.timesheets({ customers: [1] }, { max: 100 });
    assert.strictEqual(r.entries.length, 100);
    assert.strictEqual(r.truncated, true);
  });
  await t("Wiederholungsschutz bei kaputter Seitenaufteilung", async () => {
    const m2 = await start(PORT + 1, { brokenPaging: true });
    const c2 = new KimaiClient({ ...cfg, base_url: `http://localhost:${PORT + 1}`, timesheet_ttl_s: 0 });
    const r = await c2.timesheets({ customers: [1] });
    assert.strictEqual(r.entries.length, 500);
    assert.strictEqual(r.pages, 2); // zweite Seite liefert nur Bekanntes -> Abbruch
    await m2.close();
  });
  await t("ohne Kunden-/Projektfilter keine Zeiteinträge", async () => {
    await assert.rejects(client.timesheets({}), /nur mit Kunden- oder Projektfilter/);
  });

  console.log("Zuordnung:");
  await t("Entity -> Kunde über Präfix {$kunde}", async () => {
    const r = await resolveRow(client, {}, entity, vars);
    assert.deepStrictEqual(r.customers.map((c) => c.id), [1]);
    assert.deepStrictEqual(r.projects.map((p) => p.id).sort(), [11, 12, 13]);
    // projektbezogene von 11 + globale (auch versteckte)
    assert.deepStrictEqual(r.activities.map((a) => a.id).sort(), [100, 101, 102, 111]);
    assert.deepStrictEqual(timesheetScope(r), { customers: [1] });
  });
  await t("inaktive ausblenden", async () => {
    const r = await resolveRow(client, { include_hidden: false }, entity, vars);
    assert.deepStrictEqual(r.projects.map((p) => p.id).sort(), [11, 12]);
    assert.ok(!r.activities.some((a) => a.id === 102));
    const r2 = await resolveRow(client, { include_hidden: false }, { entity_code: 1408 }, vars);
    assert.strictEqual(r2.customers.length, 0);
  });
  await t("Kunde über Nummer und über ID-Feld", async () => {
    const r = await resolveRow(client, { customer_match: "number", customer_value: "K-{entity_code:4}" }, entity, vars);
    assert.deepStrictEqual(r.customers.map((c) => c.id), [1]);
    const r2 = await resolveRow(client, { customer_match: "id_field", customer_id_field: "kimai_ids" }, { kimai_ids: "1, 2" }, vars);
    assert.deepStrictEqual(r2.customers.map((c) => c.id), [1, 2]);
    await assert.rejects(resolveRow(client, { customer_match: "id_field", customer_id_field: "kimai_ids" }, { kimai_ids: "" }, vars), /keine Kimai-ID/);
    await assert.rejects(resolveRow(client, { customer_match: "id_field", customer_id_field: "kimai_ids" }, { kimai_ids: "1;x" }, vars), /keine Kimai-ID/);
  });
  await t("Prozess -> Kunde über {reference_code[0:4]}, Projekt über {reference_code}", async () => {
    const proc = { reference_code: "08150002" };
    const v = buildVariables({ variables: [{ var_name: "kunde_prozess", var_value: "[{reference_code[0:4]}]" }] }).vars;
    const r = await resolveRow(client, { customer_value: "{$kunde_prozess}", project_scope: "customer_match", project_match: "name_exact", project_value: "{reference_code}" }, proc, v);
    assert.deepStrictEqual(r.customers.map((c) => c.id), [1]);
    assert.deepStrictEqual(r.projects.map((p) => p.id), [12]);
  });
  await t("Prozess -> Projekt über {reference_code} innerhalb des Kunden", async () => {
    const r = await resolveRow(client, { project_scope: "customer_match", project_match: "name_exact", project_value: "{reference_code}" }, entity, vars);
    assert.deepStrictEqual(r.projects.map((p) => p.id), [12]);
    assert.deepStrictEqual(timesheetScope(r), { projects: [12] });
    assert.deepStrictEqual(r.activities.map((a) => a.id).sort(), [100, 101, 102]); // keine projektbez. für 12
  });
  await t("ohne Kunde: Projekte über Vorlage in allen Kunden, Kunde abgeleitet", async () => {
    const r = await resolveRow(client, { customer_match: "none", project_scope: "match", project_match: "name_prefix", project_value: "0816" }, {}, vars);
    assert.deepStrictEqual(r.projects.map((p) => p.id), [21]);
    assert.deepStrictEqual(r.customers.map((c) => c.id), [2]);
  });
  await t("Schutz: leere/zu kurze Werte zeigen nie alle Kunden", async () => {
    await assert.rejects(resolveRow(client, { customer_value: "{entity_name}" }, { entity_name: " " }, vars), /kein Wert|leeren Wert/);
    await assert.rejects(resolveRow(client, { customer_value: "[" }, {}, vars), /zu kurz/);
    await assert.rejects(resolveRow(client, { customer_match: "none" }, {}, vars), /Ohne Kundenzuordnung/);
  });
  await t("Übersicht über Kunden-ID", async () => {
    const r = await resolveCustomerId(client, {}, 2);
    assert.deepStrictEqual(r.projects.map((p) => p.id), [21]);
    await assert.rejects(resolveCustomerId(client, {}, 999), /nicht gefunden/);
  });
  await t("Vorgaben bleiben bei leeren Konfigurationswerten", () => {
    assert.strictEqual(withDefaults({ customer_value: "" }).customer_value, "{$kunde}");
  });

  let haveSaltcorn = true;
  try {
    require.resolve("@saltcorn/data/models/table");
  } catch (_) {
    haveSaltcorn = false;
  }
  if (haveSaltcorn) {
    console.log("Stundeneinträge (index.js):");
    const plugin = require("../index.js");
    const { loadEntries, ownUserKey, publicData } = plugin._internal;
    const r = await resolveRow(client, {}, entity, vars);
    const staff = { user: { id: 2, role_id: 40, email: "x@example.invalid" } };
    const user = { user: { id: 3, role_id: 80, email: "Anna@example.invalid" } };
    await t("Zeitraum, Summen, Beträge nur mit Recht", async () => {
      const res = await loadEntries(client, {}, {}, r, { from: "2026-01-01", to: "2026-03-31" }, staff, vars);
      assert.strictEqual(res.entries.length, 4);
      assert.strictEqual(res.entries.reduce((a, e) => a + e.duration, 0), 4.75 * 3600);
      assert.ok(res.entries.every((e) => e.rate === undefined));
      const admin = await loadEntries(client, {}, {}, r, { from: "2026-01-01", to: "2026-03-31" }, { user: { id: 1, role_id: 1 } }, vars);
      assert.strictEqual(admin.entries[0].currency, "EUR");
      assert.ok(admin.entries[0].rate > 0);
      assert.strictEqual(admin.entries.find((e) => e.id === 1000).user, "Anna Berger");
      assert.strictEqual(admin.entries.find((e) => e.id === 1000).customer_name, "[0815] Holzpellets Muster GmbH");
    });
    await t("Filter Projekt/Tätigkeit/Export/Abrechenbar/Benutzer", async () => {
      const b = { from: "2026-01-01", to: "2026-03-31" };
      assert.strictEqual((await loadEntries(client, {}, {}, r, { ...b, project: "12" }, staff, vars)).entries.length, 2);
      assert.strictEqual((await loadEntries(client, {}, {}, r, { ...b, activity: "100" }, staff, vars)).entries.length, 1);
      assert.strictEqual((await loadEntries(client, {}, {}, r, { ...b, exported: "1" }, staff, vars)).entries.length, 1);
      assert.strictEqual((await loadEntries(client, {}, {}, r, { ...b, billable: "0" }, staff, vars)).entries.length, 1);
      assert.strictEqual((await loadEntries(client, {}, {}, r, { ...b, user: "6" }, staff, vars)).entries.length, 2);
    });
    await t("fremdes Projekt wird abgewiesen", async () => {
      await assert.rejects(loadEntries(client, {}, {}, r, { project: "21" }, staff, vars), /gehört nicht/);
    });
    await t("Rolle unter Grenze sieht nur eigene Einträge (E-Mail = Kimai-Benutzername)", async () => {
      const res = await loadEntries(client, {}, {}, r, { from: "2026-01-01", to: "2026-03-31" }, user, vars);
      assert.strictEqual(res.own_only, true);
      assert.deepStrictEqual(res.entries.map((e) => e.id).sort(), [1000, 1001]);
      const anon = await loadEntries(client, {}, {}, r, {}, {}, vars);
      assert.strictEqual(anon.entries.length, 0);
      assert.strictEqual(ownUserKey({ kimai_user_template: "{password}" }, { user: { id: 1, password: "geheim" } }, vars), null);
    });
    await t("ungültiger Zeitraum", async () => {
      await assert.rejects(loadEntries(client, {}, {}, r, { from: "2026-05-01", to: "2026-01-01" }, staff, vars), /liegt nach/);
    });
    await t("Anzeige-Daten enthalten nur nötige Felder", () => {
      const d = publicData(r, {});
      assert.deepStrictEqual(Object.keys(d), ["customers", "projects", "activities", "mapping"]);
      assert.strictEqual(d.projects[0].customer_name, "[0815] Holzpellets Muster GmbH");
      assert.strictEqual(d.activities.find((a) => a.id === 111).project_name, "08150001");
      assert.strictEqual(d.mapping.customer_value, "[0815]");
    });
    const { mappingOf, lastEntry, lastEntryText, lastDateText, renderLast } = plugin._internal;
    await t("Ebene Projekt: Prozess -> Kimai-Projekt über {$prozess_projekt} beim Kunden {$prozess_kunde}", async () => {
      const proc = { reference_code: "08150002" };
      const rp = await resolveRow(client, mappingOf("projekt", {}), proc, vars);
      assert.deepStrictEqual(rp.customers.map((c) => c.id), [1]);
      assert.deepStrictEqual(rp.projects.map((p) => p.id), [12]);
      assert.deepStrictEqual(timesheetScope(rp), { projects: [12] });
      const ra = await resolveRow(client, mappingOf("projekt", { project_within_customer: false }), proc, vars);
      assert.deepStrictEqual(ra.projects.map((p) => p.id), [12]);
      assert.deepStrictEqual(ra.customers.map((c) => c.id), [1]); // abgeleitet
      const none = await resolveRow(client, mappingOf("projekt", {}), { reference_code: "08159999" }, vars);
      assert.strictEqual(none.projects.length, 0);
    });
    await t("Ebene Kunde: „keine Kundenzuordnung“ und „alle Kunden“ sind ausgeschlossen", () => {
      const m = mappingOf("kunde", { customer_match: "none", project_scope: "match" });
      assert.strictEqual(m.customer_match, "name_prefix");
      assert.strictEqual(m.project_scope, "customer");
    });
    await t("Begrenzung: nur N neueste Einträge, Abfrage mit kleiner Seitengröße", async () => {
      mock.calls.length = 0;
      const res = await loadEntries(client, {}, {}, r, {}, staff, vars, { max: 3 });
      assert.strictEqual(res.entries.length, 3);
      assert.strictEqual(res.truncated, true);
      assert.ok(mock.calls.some((c) => c.includes("size=3")));
      assert.ok(res.entries[0].begin >= res.entries[1].begin);
    });
    await t("letzter Stundeneintrag: Entity, Prozess, eigene, ohne Treffer", async () => {
      const last = await lastEntry(client, {}, {}, r, staff, vars);
      assert.strictEqual(last.begin.slice(0, 10), "2026-05-28");
      const rp = await resolveRow(client, mappingOf("projekt", {}), { reference_code: "08150001" }, vars);
      assert.strictEqual((await lastEntry(client, {}, {}, rp, staff, vars)).id, 1001);
      const own = await lastEntry(client, {}, {}, r, user, vars);
      assert.strictEqual(own.id, 1001); // Anna: 04.02.2026
      const rn = await resolveRow(client, mappingOf("projekt", {}), { reference_code: "08150003" }, vars);
      assert.strictEqual(await lastEntry(client, {}, {}, rn, staff, vars), null);
    });
    await t("letzter Stundeneintrag: Datum und Eintrag getrennt formatiert", () => {
      const e = { id: 9, begin: "2026-10-16T08:00:00+0200", end: "2026-10-16T10:30:00+0200", duration: 9000, user: "Anna Berger", activity_name: "Audit vor Ort", project_name: "08150001", customer_name: "[0815] X", description: "" };
      const now = new Date(2026, 9, 18, 12);
      assert.strictEqual(lastDateText(e, "date"), "16.10.2026");
      assert.strictEqual(lastDateText(e, "datetime"), "16.10.2026 08:00");
      assert.strictEqual(lastDateText(e, "relative", now), "vor 2 Tagen");
      assert.strictEqual(lastEntryText(e), "Anna Berger: Audit vor Ort (2:30 h)"); // leere Beschreibung samt „–“ entfällt
      assert.strictEqual(lastEntryText({ ...e, description: "Bericht" }, "{projekt} {taetigkeit}: {beschreibung}"), "08150001 Audit vor Ort: Bericht");
      const d = renderLast("last_date", e, {}, null);
      assert.ok(d.includes("16.10.2026") && !d.includes("Audit"));
      const en = renderLast("last_entry", { ...e, description: "<b>x</b>" }, {}, null);
      assert.ok(en.includes("Audit") && !en.includes("16.10.2026") && en.includes("&lt;b&gt;"));
      const both = renderLast("last_both", e, { last_label: "Zuletzt:", last_link: true }, { base: "https://k", locale: "de" });
      assert.ok(both.includes("Zuletzt:") && both.includes("16.10.2026") && both.includes("Audit") && both.includes("/de/team/timesheet/9/edit"));
      assert.ok(renderLast("last_date", null, {}, null).includes("kein Stundeneintrag"));
    });
    const { loadHours } = plugin._internal;
    const { renderHours } = require("../lib/hours");
    await t("KimaiStunden: Entity – letzte 5 Einträge, kleine Kimai-Abfrage", async () => {
      mock.calls.length = 0;
      const h = await loadHours(client, {}, { hours_limit: 5 }, r, entity, staff, vars);
      assert.strictEqual(h.entries.length, 5);
      assert.strictEqual(h.more, true);
      assert.strictEqual(h.total, null);
      assert.ok(mock.calls.every((c) => !c.startsWith("/api/timesheets") || c.includes("size=9")));
      const html = renderHours({ ...h, config: { hours_limit: 5 }, showRates: false, multiProject: true });
      assert.strictEqual((html.match(/<tr[ >]/g) || []).length, 6); // Kopf + 5
      assert.ok(html.includes("<th>Projekt</th>") && html.includes("5 Einträge: <b>1:15 h</b>"));
      // Layout wie Saltcorns List (mkTable)
      assert.ok(html.includes('<div class="table-responsive"><table class="table table-sm table-valign-middle'));
      assert.ok(html.includes('<th class="text-align-right">Stunden</th>') && html.includes('<td class="text-align-right">0:15</td>'));
      assert.ok(!html.includes("text-end"));
      assert.ok(html.includes("ältere Einträge nicht dargestellt"));
    });
    await t("Layout wie List: Optionen, Klassen, Kopfzeile, leere Spalten, untereinander", async () => {
      const { layoutOptions, layoutFields, renderTable, LAYOUT_FIELD_NAMES } = require("../lib/layout");
      assert.deepStrictEqual(LAYOUT_FIELD_NAMES, ["_omit_header", "hide_null_columns", "_hover_rows", "_striped_rows", "_card_rows", "_borderless", "_cell_valign", "_responsive_collapse", "_collapse_breakpoint_px", "_table_layout", "_sticky_header"]);
      assert.ok(layoutFields().every((f) => f.tab === "Layout"));
      const lo = layoutOptions({ _hover_rows: true, _striped_rows: true, _borderless: true, _cell_valign: "Top" });
      assert.strictEqual(lo.class, "table-hover table-striped table-borderless table-valign-top ");
      assert.strictEqual(layoutOptions({}).class, "table-valign-middle ");
      assert.strictEqual(layoutOptions({ _cell_valign: "x<y" }).class, "table-valign-middle ");
      const hdrs = [{ label: "A", key: (x) => x.a }, { label: "B", key: (x) => x.b, align: "right" }, { label: "", key: () => "", keep: true }];
      const rows = [{ a: "1", b: "" }, { a: "2", b: null }];
      let html = renderTable(hdrs, rows, layoutOptions({ _omit_header: true }));
      assert.ok(!html.includes("<thead") && html.includes('<td class="text-align-right"></td>'));
      html = renderTable(hdrs, rows, layoutOptions({ hide_null_columns: true }));
      assert.ok(html.includes("<th>A</th>") && !html.includes(">B</th>") && (html.match(/<th[ >]/g) || []).length === 2);
      html = renderTable(hdrs, rows, layoutOptions({ _responsive_collapse: true, _collapse_breakpoint_px: 600, _sticky_header: true, _table_layout: "Fixed" }), "kimai_v_1");
      assert.ok(html.includes('id="kimai_v_1"') && html.includes("max-width: 600px") && html.includes("sticky-top") && html.includes("table-layout-fixed"));
      assert.ok(!html.includes("table-responsive"));
    });
    await t("Layout: Browser-Tabellen wie List (Markup, Ausrichtung, Seitennavigation)", async () => {
      const { kimaiPanel } = require("../lib/browser");
      const src = kimaiPanel.toString();
      assert.ok(!/text-end|btn btn-sm btn-outline-secondary kimai-(prev|next)|"Dauer"/.test(src));
      assert.ok(src.includes('<ul class="pagination">') && src.includes("page-link link-style") && src.includes("text-align-"));
      const idx = await plugin.viewtemplates({})[1].configuration_workflow().steps;
      assert.ok(idx.length >= 3);
    });
    await t("KimaiStunden: Prozess – 7 Einträge, Gesamtsumme im Zeitraum, Liste", async () => {
      const rp = await resolveRow(client, mappingOf("projekt", {}), { reference_code: "08150001" }, vars);
      const c = { hours_limit: 7, hours_sum: "both", range_preset: "all", hours_style: "list" };
      const h = await loadHours(client, {}, c, rp, {}, staff, vars);
      assert.strictEqual(h.entries.length, 3);
      assert.strictEqual(h.total, 7.5 * 3600);
      assert.strictEqual(h.totalCount, 3);
      const html = renderHours({ ...h, config: c, showRates: false, multiProject: false });
      assert.ok(html.includes("<li") && !html.includes("<table") && html.includes("gesamt: <b>7:30 h</b>"));
      assert.ok(!html.includes("08150001")); // Projektspalte „auto“ bei einem Projekt aus
    });
    await t("KimaiStunden: Zeitraum, eigene Einträge, Beträge, leer", async () => {
      const c = { hours_limit: 6, range_preset: "template", range_from_template: "2026-02-01", range_to_template: "2026-03-31", hours_sum: "total" };
      const h = await loadHours(client, {}, c, r, {}, staff, vars);
      assert.strictEqual(h.totalCount, 4);
      assert.strictEqual(h.rangeLabel, "01.02.2026–31.03.2026");
      const own = await loadHours(client, {}, { hours_limit: 6 }, r, {}, user, vars);
      assert.deepStrictEqual(own.entries.map((e) => e.id).sort(), [1000, 1001]);
      assert.strictEqual(own.ownOnly, true);
      const adm = await loadHours(client, {}, { hours_limit: 1, min_role_rates: "1" }, r, {}, { user: { id: 1, role_id: 1 } }, vars);
      const html = renderHours({ ...adm, config: { col_betrag: true }, showRates: true });
      assert.ok(html.includes("25,00 EUR"));
      assert.ok(!renderHours({ ...adm, config: { col_betrag: true }, showRates: false }).includes("EUR"));
      assert.ok(renderHours({ entries: [], config: {} }).includes("Keine Stundeneinträge"));
      assert.ok(renderHours({ entries: [{ id: 1, begin: "2026-01-01T08:00:00", end: "2026-01-01T09:00:00", duration: 3600, user: "<x>", description: "" }], config: {} }).includes("&lt;x&gt;"));
    });
    await t("Plugin-Struktur", () => {
      assert.strictEqual(plugin.plugin_name, "saltcorn-kimai");
      const vts = plugin.viewtemplates({});
      assert.deepStrictEqual(vts.map((v) => v.name), ["KimaiStunden", "KimaiKunde", "KimaiProjekt", "KimaiDatensatz", "KimaiUebersicht"]);
      assert.deepStrictEqual(Object.keys(vts[1].routes).sort(), ["load", "refresh", "timesheets"]);
      assert.deepStrictEqual(Object.keys(plugin.actions({})), ["kimai_abgleich", "kimai_abgleich_kunde", "kimai_abgleich_projekt"]);
    });
  } else console.log("(index.js-Tests übersprungen: @saltcorn/data nicht gefunden – NODE_PATH setzen)");

  await mock.close();
  console.log(`\n${passed} Tests bestanden`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
