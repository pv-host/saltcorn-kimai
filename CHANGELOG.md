# Changelog

## 0.2.0 – 2026-10-18

- Neue View-Typen je Ebene: **KimaiKunde** (z.B. facility) und **KimaiProjekt** (z.B. prozesse; Projekt über `{$prozess_projekt}`, optional nur beim Kunden `{$prozess_kunde}`); KimaiDatensatz bleibt als freie Variante
- Neue Einstellung **Darstellung**: Register, einzelne Liste, Stundeneinträge mit Filter, letzte Stundeneinträge (kompakt), letzter Stundeneintrag – nur Datum, nur Eintrag oder beides (serverseitig, getrennt platzierbar)
- **Höchstzahl dargestellter Zeilen** je Liste mit Hinweis auf nicht dargestellte Zeilen; kompakte Liste lädt nur N Einträge aus Kimai
- Aktionen **kimai_abgleich_kunde** und **kimai_abgleich_projekt**; alle Aktionen können Datum und Text des letzten Stundeneintrags sowie Projekt-IDs speichern
- Vorlagen: `{feld[0:4]:8}` füllt erst auf und schneidet dann aus; neue Standardvariablen `prozess_projekt`, `prozess_kunde`
- Prüfschritt zeigt Kunden- und Projektsuchwert

## 0.1.0 – 2026-10-18

- Erste Version: Kimai 2 lesend einbinden
- View **KimaiDatensatz**: Kunde, Projekte, Tätigkeiten und Stundeneinträge zu einem Datensatz, z.B. `facility`. Register, Filter, Summen, Seitenblättern, CSV-Export, Links nach Kimai, Prüfschritt in der Konfiguration
- View **KimaiUebersicht**: Kunden suchen ohne Tabelle
- Aktion **kimai_abgleich**: Kunden-ID, Name, Projektanzahl und Stunden in Felder schreiben
- Zuordnung über Vorlagen (`{feld}`, `{feld:4}`, `{feld[0:4]}`) und zentrale Variablen (`{$kunde}`, `{$projekt}`, `{$kimai_benutzer}`, Datumsvariablen)
- Rechte: Stundeneinträge, Einträge aller Benutzer oder nur eigene, Beträge, Neu laden
- Zwischenspeicher, Seitenaufteilung mit Wiederholungsschutz, `ignoreDates=1` für Projekte
