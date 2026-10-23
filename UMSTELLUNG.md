# Umstellung und Sicherheit

Stand: 23.10.2026. Eigenständiger Entwicklungsstand auf Basis der bereinigten
Fassung vom 21.10.2026. Keine Veröffentlichung, keine Produktionsinstallation und
keine neue Funktionsversion durch diese Aufteilung. Sicherheitskorrekturen bleiben erhalten.

## Vor jeder Übernahme

- **Sicherung:** Datenbank, Plugin-Konfiguration und bisherige Quellpakete lokal sichern. Die Sicherung kann sensible Angaben enthalten und gehört nicht in öffentliche Repositories oder Chat-Anhänge.
- **Testumgebung:** Zuerst eine isolierte Instanz verwenden. Produktionszugangsdaten nicht in Testkonfigurationen übernehmen und ausgehende Verbindungen auf die benötigten Ziele beschränken.
- **Zugänge:** Das in einem historischen Chat offengelegte Passwort ändern, sofern dies nicht schon geschehen ist. Wiederverwendete Passwörter und betroffene Sitzungen ebenfalls berücksichtigen.
- **Veröffentlichung:** Die Node-Pakete sind vorsorglich als `private: true` gekennzeichnet. Es wurde nichts nach GitHub, npm oder auf einen öffentlichen Webserver übertragen.

## Neutrale Bezeichner

Gespeicherte Tabellen-, Feld-, Konto- und Viewzuordnungen anhand der privaten Bestandskonfiguration neu zuordnen. Es gibt keine stillschweigende Datenmigration und keine Zuordnung zu realen Servern in diesem Paket.

## Hinweise zu dieser Komponente

Der Cache trennt jetzt vollständige API-Zugangsdaten. HTTP-Weiterleitungen werden abgelehnt; daher die endgültige API-Basisadresse eintragen und HTTPS verwenden. URLs mit eingebetteten Zugangsdaten, Query oder Fragment werden zurückgewiesen.

Die API muss weiterhin nur die notwendigen Kunden, Projekte und Buchungen sichtbar machen. Ein technisches Konto mit weitreichender Sicht bleibt trotz lokal korrekter Datensatzprüfung ein Risiko bei falscher Feldzuordnung.

## Offene Risiken

Die Abhängigkeitswarnungen der Sicherheitsprüfung vom 21.10.2026 sind durch die Aufteilung nicht behoben. Der damalige gemeinsame Prüfbaum enthielt Saltcorn 1.6.2 und meldete 41 betroffene Paketpositionen; dies ist keine individuelle Schwachstellenzahl dieses Plugins. Vor Freigaben den eigenen installierten Abhängigkeitsbaum erneut prüfen. Historische Chats, Anhänge und produktive Konfigurationen werden durch dieses Paket weder bereinigt noch gelöscht.
