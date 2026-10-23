Hinweis zur Einzelentwicklung: `ENTWICKLUNG.md` und `UMSTELLUNG.md` in diesem Ordner sind der Einstieg. Weitere Plugins oder das frühere Gesamtarchiv werden dafür nicht benötigt.

# Bereinigte Fassung 0.4.0

Stand 21.10.2026. Vor Installation SECURITY-REVIEW.md und UMSTELLUNG.md in diesem Ordner lesen. Historische Testangaben im folgenden Text gelten nicht als erneuter Integrationstest dieser Fassung.

Weiterentwicklung 0.5.0 (23.10.2026): Tabellen aller Views im Layout der Saltcorn-View „List“, siehe Abschnitt „Layout wie Saltcorn-List“ und CHANGELOG.md.

# saltcorn-kimai

Saltcorn-Plugin, das eine Kimai-2-Installation **lesend** einbindet: Kunden, Projekte, Tätigkeiten und Stundeneinträge zu einem Saltcorn-Datensatz, zum Beispiel zu einer Entity. Wie Saltcorn-Datensatz, Kimai-Kunde, Projekte und Tätigkeiten zusammenhängen, legen Sie über **Vorlagen und Variablen** fest.

View-Typen je **Ebene** (an eine Tabelle gebunden):

| View-Typ | Ebene | Beispiel in entity | Zuordnung (Vorgabe) |
|---|---|---|---|
| `KimaiStunden` | Kunde **oder** Projekt (wählbar) | `entity` oder `projects` | die letzten N zugeordneten Stundeneinträge, z.B. 5–7 |
| `KimaiKunde` | Kunde | Tabelle `entity` | Kimai-Kundenname beginnt mit `{$kunde}` = `[{entity_code:4}]` |
| `KimaiProjekt` | Projekt | Tabelle `projects` | Kimai-Projektname ist gleich `{$prozess_projekt}` = `{reference_code:8}`, gesucht beim Kunden `{$prozess_kunde}` = `[{reference_code[0:4]:8}]` |
| `KimaiDatensatz` | frei | beliebig | Kunde und/oder Projekte frei über Vorlagen |

Jede dieser Views hat eine **Darstellung**:

| Darstellung | Inhalt |
|---|---|
| Register | Kunde, Projekte, Tätigkeiten, Stundeneinträge als Register |
| Kundendaten / Projektliste bzw. Projektdaten / Tätigkeiten | eine einzelne Liste |
| Stundeneinträge mit Filter und Summen | Zeitraum, Projekt, Tätigkeit, Benutzer, Export, abrechenbar; Summen; CSV |
| Letzte Stundeneinträge (kompakt) | die neuesten N Einträge ohne Filter |
| Letzter Stundeneintrag: nur Datum | z.B. `28.05.2026` oder `vor 3 Tagen` |
| Letzter Stundeneintrag: nur Eintrag | z.B. `Bernd Kramer: Bericht (0:15 h) – Text` |
| Letzter Stundeneintrag: Datum und Eintrag | beides in einer Zeile |

**Zeilenbegrenzung:** „Höchstzahl dargestellter Zeilen“ begrenzt jede Liste (Kunden, Projekte, Tätigkeiten, Stundeneinträge). Darunter steht, wie viele Zeilen nicht dargestellt sind. Summen und CSV beziehen sich weiter auf alle Einträge im Zeitraum. Bei „Letzte Stundeneinträge“ holt das Plugin nur so viele Einträge aus Kimai wie dargestellt werden (Vorgabe 10).

**Letzter Stundeneintrag separat:** Datum und Eintrag sind eigene Darstellungen. Legen Sie je eine View an und platzieren Sie sie unabhängig voneinander im Layout, z.B. das Datum im Kopf der Entity und den Eintrag in einer Infobox. Diese Views werden serverseitig ohne JavaScript erzeugt und stehen wie ein Feld im Text.

Außerdem:

- **View `KimaiUebersicht`** (ohne Tabelle): Kunden suchen, danach dieselben Register.
- **Aktionen `kimai_abgleich_kunde`, `kimai_abgleich_projekt`, `kimai_abgleich`**: schreiben Kunden-/Projekt-ID, Stunden eines Zeitraums sowie **Datum und Text des letzten Stundeneintrags** in Felder, etwa für Listen-Views. Saltcorn-Listen können keine Views je Zeile einbetten.

Der API-Token bleibt auf dem Server; der Browser spricht nur mit Saltcorn. Es gibt keine Laufzeit-Fremdabhängigkeiten. `@saltcorn/data` und `@saltcorn/markup` stehen unter `devDependencies`, damit npm keine zweite Saltcorn-Kopie in das Plugin installiert.

## Installation

Saltcorn → Einstellungen → Module → Hinzufügen:

| Feld | Wert |
|---|---|
| Name | `saltcorn-kimai` |
| Quelle | `npm` (nach Veröffentlichung) oder `github` mit Position `plugin-contributors/saltcorn-kimai` |

Alternativ am Server, ohne Webserver-Timeout:

```bash
# Ordner aus dem ZIP z.B. nach /opt/saltcorn-plugins/saltcorn-kimai kopieren
saltcorn install-plugin -d /opt/saltcorn-plugins/saltcorn-kimai
```

Für Updates verwenden Sie die Update-Funktion beim vorhandenen Modul und legen das Modul nicht noch einmal an. `saltcorn install-plugin -d` legt bei einer neuen Version einen zweiten Moduleintrag ohne Konfiguration an. In diesem Fall den alten Eintrag behalten und das Modul dort aktualisieren.

## Kimai vorbereiten

1. Einen technischen Kimai-Benutzer anlegen, z.B. `svc-saltcorn`.
2. Rolle mit Leserechten auf Kunden, Projekte und Tätigkeiten sowie **`view_other_timesheet`** (Zeiteinträge aller Benutzer). Ohne dieses Recht liefert Kimai stillschweigend nur die Einträge des technischen Benutzers.
3. Der Benutzer muss alle Kunden sehen (Teams beachten).
4. Profil → API-Zugang → **API-Token** erzeugen (Kimai ≥ 2.0). Bei älteren Installationen: API-Passwort mit Anmeldeart „Alt“.

## Plugin konfigurieren

**Schritt 1 – Kimai-Verbindung**

| Einstellung | Vorgabe | Hinweis |
|---|---|---|
| Kimai-URL | – | ohne `/api`, z.B. `https://zeit.example.invalid` |
| Anmeldung | API-Token | alt: `X-AUTH-USER` + `X-AUTH-TOKEN` |
| Zwischenspeicher Kunden/Projekte/Tätigkeiten | 300 s | bei 5.000+ Projekten sinnvoll |
| Zwischenspeicher Zeiteinträge | 60 s | |
| Höchstzahl Zeiteinträge je Abfrage | 5.000 | darüber wird die Anzeige begrenzt und markiert |
| Links „In Kimai öffnen“ / Sprache | an / `de` | |

**Schritt 2 – Zuordnungsvariablen.** Oben steht ein Verbindungstest. Darunter pflegen Sie die Variablen, die alle Views und Aktionen gemeinsam nutzen:

| Variable | Vorgabe | Bedeutung |
|---|---|---|
| `kunde` | `[{entity_code:4}]` | Anfang des Kimai-Kundennamens, Schema `[NNNN] Firma` |
| `projekt` | `{entity_code:4}` | Vorlage für Projektfilter, z.B. `{reference_code}` für Projects |
| `kimai_benutzer` | `{email}` | Kimai-Benutzer eines Saltcorn-Benutzers (für „nur eigene Einträge“) |
| `prozess_projekt` | `{reference_code:8}` | Kimai-Projektname eines Prozesses (Ebene Projekt) |
| `prozess_kunde` | `[{reference_code[0:4]:8}]` | Kimai-Kunde eines Prozesses: erste 4 Stellen der reference_code |

Ändern Sie eine Variable hier, gilt die Änderung sofort für alle Views. Eigene Variablen sind möglich, zum Beispiel `nr` = `{entity_code:4}` und `kunde` = `[{$nr}]`.

### Vorlagen

| Platzhalter | Bedeutung |
|---|---|
| `{feld}` | Wert eines Feldes der Tabelle |
| `{feld:4}` | links mit Nullen auf 4 Stellen: `815` → `0815` |
| `{feld[0:4]}` | Ausschnitt, Zeichen 0 bis 4: `{reference_code[0:4]}` → `0815` aus `08150002` |
| `{feld[0:4]:8}` | erst auf 8 Stellen auffüllen, dann ausschneiden: `1000001` → `01000001` → `0100` |
| `{$name}` | Variable aus Schritt 2 (darf selbst Felder und Variablen enthalten) |
| `{$heute}` `{$jahr}` `{$vorjahr}` `{$monat}` `{$jahresbeginn}` `{$jahresende}` `{$vorjahresbeginn}` `{$vorjahresende}` `{$monatsbeginn}` `{$vor30tagen}` `{$vor90tagen}` `{$vor365tagen}` | eingebaute Datumsvariablen |

Ist ein Feld leer oder ergibt die Vorlage einen leeren bzw. zu kurzen Wert (unter 2 Zeichen bei „beginnt mit/enthält“), zeigt die View einen Hinweis. Sie zeigt dann **nie** alle Kunden an.

## Einbindung in entity

### Ebene Kunde – Tabelle `entity`

1. Views → Neu: Typ **KimaiKunde**, Tabelle **entity**, Mindestrolle z.B. `staff`.
2. Schritt „Zuordnung zu Kimai“: Vorgaben übernehmen (Name beginnt mit `{$kunde}`, alle Projekte des Kunden). Andere Zuordnungsarten: Name ist gleich/enthält, Kimai-Feld „Nummer“ (z.B. `K-{entity_code:4}`), Kommentar enthält, Kimai-ID in einem Feld.
3. Schritt „Prüfung“: zeigt für die ersten drei Entities Suchwert, Kunden, Projekte und Tätigkeiten.
4. Schritt „Darstellung und Rechte“: Darstellung, Höchstzahl Zeilen und Rollen.

Empfohlene Views:

| Name | Darstellung | Einstellungen |
|---|---|---|
| `entity_kimai` | Register | Höchstzahl Zeilen z.B. 20 |
| `entity_kimai_letzte` | Letzte Stundeneinträge | Höchstzahl Zeilen 5 |
| `entity_kimai_datum` | Letzter Stundeneintrag: nur Datum | Beschriftung „Zuletzt gebucht:“ |
| `entity_kimai_eintrag` | Letzter Stundeneintrag: nur Eintrag | Vorlage `{benutzer}: {taetigkeit} ({dauer} h) – {beschreibung}` |

### Ebene Projekt – Tabelle `projects`

1. Views → Neu: Typ **KimaiProjekt**, Tabelle **projects**.
2. Zuordnung (Vorgaben): Projekt finden über „Name ist gleich“, Vorlage `{$prozess_projekt}`. Die Einstellung „Projekt nur beim zugehörigen Kimai-Kunden suchen“ ist eingeschaltet, Kunde über `{$prozess_kunde}`. Ausgeschaltet wird in allen Projekten gesucht.
3. Darstellung wie oben, z.B. `prozess_kimai_stunden` (Stundeneinträge, Höchstzahl 10) und `prozess_kimai_letzter` (Datum und Eintrag, Datumsformat „relativ“).

Stundeneinträge beziehen sich auf dieser Ebene nur auf das gefundene Projekt.

### Zugeordnete Stunden – View `KimaiStunden`

Diese schlanke View zeigt die neuesten Stundeneinträge einer Entity oder eines Prozesses. Sie wird serverseitig ohne JavaScript erzeugt.

1. Views → Neu: Typ **KimaiStunden**, Tabelle `entity` oder `projects`.
2. **Ebene:** Kunde (entity: alle Stunden des Kimai-Kunden) oder Projekt (projects: Stunden des Kimai-Projekts). Bei Tabellennamen mit „proz“ ist „Projekt“ vorgewählt.
3. **Zuordnung** und **Prüfung** wie bei KimaiKunde bzw. KimaiProjekt.
4. **Darstellung und Rechte:**

| Einstellung | Vorgabe | Hinweis |
|---|---|---|
| Anzahl dargestellter Einträge | 5 | die neuesten, 1–50, z.B. 5 bis 7 |
| Zeitraum | gesamt | auch aktuelles Jahr, Vorjahr, letzte 90 Tage, aus Vorlage |
| Summenzeile | Summe der dargestellten | oder Gesamtstunden im Zeitraum, beides, keine |
| Darstellung | Tabelle | oder kompakte Liste, eine Zeile je Eintrag |
| Spalten | Datum, Stunden, Benutzer, Tätigkeit, Beschreibung | Projekt „auto“ = nur bei mehreren Projekten; Uhrzeit, Kunde, Betrag zuschaltbar |
| Überschrift / Text ohne Einträge | – / „Keine Stundeneinträge“ | |
| Laufende Einträge, Links nach Kimai | aus | |

Bei „Summe der dargestellten“ holt das Plugin nur die benötigten Einträge aus Kimai. „Gesamtstunden“ lädt alle Einträge des Zeitraums, die danach im Zwischenspeicher liegen. Für die Rollen gilt dasselbe wie bei den anderen Views: ohne Recht keine Anzeige, unterhalb der Grenze nur eigene Einträge, Beträge nur mit Recht.

Beispiele: `entity_stunden` (Ebene Kunde, 5 Einträge, Summe „beides“) und `prozess_stunden` (Ebene Projekt, 7 Einträge, kompakte Liste).

### Layout wie Saltcorn-List

Alle Tabellen des Plugins verwenden dasselbe Markup wie die Saltcorn-View **List**: `div.table-responsive` › `table.table.table-sm`, rechtsbündige Zahlenspalten über `text-align-right` und eine Seitennavigation `ul.pagination`. KimaiStunden erzeugt die Tabelle serverseitig direkt mit Saltcorns `mkTable`. KimaiKunde, KimaiProjekt, KimaiDatensatz und KimaiUebersicht bauen im Browser dasselbe Markup nach. Das Theme (z.B. sbadmin2) gestaltet deshalb Kimai-Tabellen und List-Views gleich.

Im letzten Konfigurationsschritt gibt es wie bei List ein Register **Layout**. Die Feldnamen entsprechen denen der List-View:

| Einstellung | List-Feld | Vorgabe |
|---|---|---|
| Kopfzeile ausblenden | `_omit_header` | aus |
| Leere Spalten ausblenden | `hide_null_columns` | aus |
| Zeilen hervorheben | `_hover_rows` | aus |
| Zebrastreifen | `_striped_rows` | aus |
| Zeilen als Karten | `_card_rows` | aus |
| Ohne Linien | `_borderless` | aus |
| Vertikale Ausrichtung | `_cell_valign` | Mitte |
| Auf kleinen Bildschirmen untereinander, Umbruch (px) | `_responsive_collapse`, `_collapse_breakpoint_px` | aus, 760 |
| Tabellenlayout | `_table_layout` | automatisch |
| Kopfzeile fixieren | `_sticky_header` | aus |

Für ein einheitliches Bild dieselben Werte wie in den List-Views setzen. Bei KimaiStunden gilt das Register nur für die Darstellung „Tabelle“, bei den übrigen Views nicht für „Letzter Stundeneintrag“.

Einheitlich in allen Views: Spaltennamen und Reihenfolge (Datum, Zeit, Stunden, Benutzer, Projekt, Tätigkeit, Beschreibung, Betrag, Link), Badge „läuft“ und „inaktiv“, Summen- und Hinweiszeilen (`small`, Hinweise `text-muted`), Text ohne Einträge.

Unterschiede zu List: Die Spalten sind fest vorgegeben, es gibt keine Sortierung über die Kopfzeile, keine Kopfzeilenfilter und keine Zeilenfarbformel.

### In die Show-Views einbetten

Im Builder der Show-View (`entity_show` bzw. `prozess_show`):

1. Das Element **View** an die gewünschte Stelle ziehen. Mehrere Views können getrennt platziert werden: Datum oben im Kopf, Eintrag in einer Karte, Register in einem Tab „Zeiterfassung“.
2. Die View wählen, Beziehung **gleicher Datensatz** (`.entity` bzw. `.projects`).
3. Speichern.

Register- und Listen-Views laden ihre Daten nachträglich, die Seite öffnet sich sofort. Die Views für den letzten Stundeneintrag werden beim Seitenaufbau erzeugt. Dank Zwischenspeicher kostet das je View nur eine kleine Kimai-Abfrage.

### Listen-Views (Spalten „letzter Eintrag“)

Saltcorn-Listen betten keine Views je Zeile ein. Dafür gibt es Felder plus Aktion:

1. In `projects` (bzw. `entity`) die Felder `letzter_eintrag_datum` (Date) und `letzter_eintrag` (String) anlegen.
2. Aktion **kimai_abgleich_projekt** (bzw. `kimai_abgleich_kunde`) konfigurieren: „Datum des letzten Stundeneintrags speichern in“ und „Letzten Stundeneintrag speichern in“.
3. Als Button in der Liste oder als zeitgesteuerten Trigger (z.B. täglich) ausführen. Danach sind beide Felder normale Listenspalten.

## Rechte

| Einstellung (je View) | Vorgabe | Wirkung |
|---|---|---|
| Mindestrolle der View (Saltcorn) | – | wer die View überhaupt sieht |
| Mindestrolle Stundeneinträge sehen | staff | sonst ist das Register gesperrt |
| Mindestrolle Einträge aller Benutzer | staff | andere Rollen sehen nur eigene Einträge: Abgleich von `kimai_benutzer` mit Kimai-Benutzername, Alias oder E-Mail |
| Mindestrolle Beträge sehen | admin | Stundensätze/Beträge werden sonst serverseitig entfernt |
| Mindestrolle „Neu aus Kimai laden“ | staff | leert den Zwischenspeicher |

Außerdem gilt:

- Lesezugriff auf den Datensatz wird mit Saltcorns Tabellen- und Besitzerrechten geprüft.
- Der Browser bekommt nur die aufgelösten Kunden und Projekte. Ein Projektfilter auf ein fremdes Projekt wird abgewiesen.
- Ohne Kunden- oder Projektfilter fragt das Plugin keine Zeiteinträge ab.

## Aktionen

| Aktion | Zuordnung wie |
|---|---|
| `kimai_abgleich_kunde` | KimaiKunde (entity) |
| `kimai_abgleich_projekt` | KimaiProjekt (projects) |
| `kimai_abgleich` | KimaiDatensatz (frei) |

Zielfelder (alle optional):

- Kunden-ID(s), Kundenname, Projekt-ID(s)
- Anzahl Projekte
- Stunden und abrechenbare Stunden im Zeitraum
- Datum des letzten Stundeneintrags (Date- oder Textfeld) und letzter Eintrag (Vorlage wie bei der View)

Das Feld-Update löst keine weiteren Trigger aus. Die Aktion zählt Einträge aller Benutzer und schreibt keine Beträge.

### Platzhalter für den letzten Eintrag

`{datum}` `{uhrzeit}` `{ende}` `{dauer}` (h:mm) `{dauer_dezimal}` `{benutzer}` `{kunde}` `{projekt}` `{taetigkeit}` `{beschreibung}` `{exportiert}` `{abrechenbar}`. Leere Platzhalter am Ende entfallen samt Trennzeichen. Laufende Einträge werden nur berücksichtigt, wenn das eingestellt ist.

## Hinweise

- **Rollen:** Wer nur eigene Einträge sehen darf, bekommt auch beim „letzten Stundeneintrag“ nur den eigenen. Ohne das Recht „Stundeneinträge sehen“ bleiben diese Views leer.
- **Nur lesend.** Das Plugin legt in Kimai nichts an und ändert nichts.
- Kimai liefert Kunden, Projekte und Tätigkeiten ohne Seitenaufteilung. Projekte werden mit `ignoreDates=1` geladen, sonst fehlen beendete Projekte.
- Zeiteinträge werden seitenweise mit 500 Einträgen geladen. Der Abruf wertet `X-Total-Pages` aus und bricht ab, wenn eine Seite nur bereits bekannte IDs enthält. Damit lösen wiederholte identische Listen hinter einem Reverse-Proxy keine Endlosschleife aus.
- Uhrzeiten werden so angezeigt, wie Kimai sie liefert (Zeitzone des technischen Kimai-Benutzers).
- Für ein Zertifikat einer eigenen CA setzen Sie `NODE_EXTRA_CA_CERTS` im Saltcorn-Dienst.

## Tests

```bash
npm test   # mit erreichbarem @saltcorn/data (z.B. NODE_PATH) auch die index.js-Tests
```

Die Tests laufen gegen einen Kimai-Nachbau (`test/mock-kimai.js`). Sie decken Vorlagen, Variablen, Seitenaufteilung, Wiederholungsschutz, Zuordnung, Filter und Rechte ab.

## Lizenz

MIT
