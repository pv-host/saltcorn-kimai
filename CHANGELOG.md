# 0.4.0: Sicherheits- und Datenschutzbereinigung

Installationsbezüge neutralisiert; Einzelheiten siehe SECURITY-REVIEW.md. Es wurden keine produktiven Instanzen verändert.

# Changelog

## 0.5.0 – 2026-10-23

- **Layout wie Saltcorn-List:** KimaiStunden rendert serverseitig mit `mkTable` aus `@saltcorn/markup` (gleiches Markup und gleiche Klassen wie List, `data-row-id` je Zeile). Die Browser-Tabellen von KimaiKunde, KimaiProjekt, KimaiDatensatz und KimaiUebersicht erzeugen dasselbe Markup.
- Neues Register **Layout** im letzten Konfigurationsschritt mit den Feldnamen der List-View: Kopfzeile ausblenden, leere Spalten ausblenden, Zeilen hervorheben, Zebrastreifen, Zeilen als Karten, ohne Linien, vertikale Ausrichtung, untereinander auf kleinen Bildschirmen (Umbruch px), Tabellenlayout, Kopfzeile fixieren (`lib/layout.js`).
- Zahlenspalten rechtsbündig über Saltcorns `text-align-right` statt Bootstrap `text-end`. Die Seitennavigation der Stundeneinträge entspricht List (`ul.pagination`, Seitenzahlen statt «/»).
- Einheitliche Spalten: „Dauer“ heißt überall „Stunden“, Kundenliste „Kunde“ statt „Name“, Projektliste in der Reihenfolge Nummer/Auftrag, Kommentar. Badge „läuft“ auch in KimaiStunden; Beschreibung und Kommentar ohne verkleinerte Schrift; Summentabelle mit Gruppenüberschrift.
- Einheitliche Hinweis-, Summen- und Leerzeilen (`kimai-hint`, `kimai-sum`, `kimai-empty`).
- Verhaltensänderung: Bestehende Views ohne Layout-Einstellungen erscheinen wie eine List mit Vorgaben, also ohne Hervorheben unter dem Mauszeiger. Bisher waren Browser-Tabellen immer `table-hover`. Bei Bedarf „Zeilen hervorheben“ einschalten.
- Tests: 41 (neu: Layout-Optionen und -Markup, Browser-Tabellen).


## 0.3.0 – 2026-10-21

- Neuer View-Typ **KimaiStunden**: zugeordnete Stunden einer Entity (Ebene Kunde) oder eines Prozesses (Ebene Projekt), die letzten N Einträge (Vorgabe 5, z.B. 5–7), serverseitig ohne JavaScript
- Summenzeile: dargestellte Einträge, Gesamtstunden im Zeitraum oder beides; Tabelle oder kompakte Liste; Spalten wählbar; Projektspalte automatisch nur bei mehreren Projekten
- Kleine Kimai-Abfrage (nur N+4 Einträge), solange keine Gesamtsumme verlangt ist

## 0.2.0 – 2026-10-18

- Neue View-Typen je Ebene: **KimaiKunde** (z.B. entity) und **KimaiProjekt** (z.B. projects; Projekt über `{$prozess_projekt}`, optional nur beim Kunden `{$prozess_kunde}`); KimaiDatensatz bleibt als freie Variante
- Neue Einstellung **Darstellung**: Register, einzelne Liste, Stundeneinträge mit Filter, letzte Stundeneinträge (kompakt), letzter Stundeneintrag – nur Datum, nur Eintrag oder beides (serverseitig, getrennt platzierbar)
- **Höchstzahl dargestellter Zeilen** je Liste mit Hinweis auf nicht dargestellte Zeilen; kompakte Liste lädt nur N Einträge aus Kimai
- Aktionen **kimai_abgleich_kunde** und **kimai_abgleich_projekt**; alle Aktionen können Datum und Text des letzten Stundeneintrags sowie Projekt-IDs speichern
- Vorlagen: `{feld[0:4]:8}` füllt erst auf und schneidet dann aus; neue Standardvariablen `prozess_projekt`, `prozess_kunde`
- Prüfschritt zeigt Kunden- und Projektsuchwert

## 0.1.0 – 2026-10-18

- Erste Version: Kimai 2 lesend einbinden
- View **KimaiDatensatz**: Kunde, Projekte, Tätigkeiten und Stundeneinträge zu einem Datensatz, z.B. `entity`. Register, Filter, Summen, Seitenblättern, CSV-Export, Links nach Kimai, Prüfschritt in der Konfiguration
- View **KimaiUebersicht**: Kunden suchen ohne Tabelle
- Aktion **kimai_abgleich**: Kunden-ID, Name, Projektanzahl und Stunden in Felder schreiben
- Zuordnung über Vorlagen (`{feld}`, `{feld:4}`, `{feld[0:4]}`) und zentrale Variablen (`{$kunde}`, `{$projekt}`, `{$kimai_benutzer}`, Datumsvariablen)
- Rechte: Stundeneinträge, Einträge aller Benutzer oder nur eigene, Beträge, Neu laden
- Zwischenspeicher, Seitenaufteilung mit Wiederholungsschutz, `ignoreDates=1` für Projekte
