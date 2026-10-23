# saltcorn-kimai: eigenständige Weiterentwicklung

Version / Stand: 0.5.0. Stand: 23.10.2026. Funktionsversion auf Basis der Einzelentwicklung 0.4.0:
Tabellenlayout wie Saltcorn-List (siehe CHANGELOG.md). Keine Veröffentlichung, keine
Produktionsinstallation. Sicherheitskorrekturen aus 0.4.0 bleiben unverändert erhalten.


## Aufbau und Zuständigkeit

Dieser Ordner ist der maßgebliche Arbeitsstand für diese Komponente. Der Quellcode
liegt direkt hier, nicht in einem übergeordneten Sammelpaket. Jede Änderung, Version
und Freigabe kann künftig separat erfolgen; die übrigen Pluginordner bleiben unberührt.
Die installierbare Komponente ist dennoch auf ihre jeweilige Plattform angewiesen.

- **README.md:** Bedienung und technische Voraussetzungen.
- **UMSTELLUNG.md / SECURITY-REVIEW.md:** Sicherheitsregeln und notwendige Bestandsumstellungen.
- **development/:** Zugeordnete Unterlagen, Muster und historische Testnachweise.
- **Tests:** Vorhandene Tests bleiben im ursprünglichen Testordner; zusätzliche
  Sicherheitsregressionen liegen gegebenenfalls unter `security-tests/`.
- **SHA256SUMS:** Prüfsummen dieses Entwicklungsstands, bei Änderungen neu erstellen.

## Lokal entwickeln und prüfen

```sh
# Node.js 20; ausschließlich in einer Entwicklungsumgebung
npm install --ignore-scripts
npm run test:all
```

Die Tests benötigen die Saltcorn-Plattformbibliotheken, nicht andere Plugins aus diesem
Projekt. Diese Bibliotheken sind jetzt explizit als Entwicklungsabhängigkeiten angegeben.
Bei Verwendung der echten Saltcorn-Datenbibliothek eine isolierte PostgreSQL-Testverbindung
über `DATABASE_URL` konfigurieren; `--ignore-scripts` erzeugt kein natives SQLite-Modul.
Installationsskripte von Abhängigkeiten nicht ungeprüft freigeben.


## Prüfstand und Freigabe

0.5.0: 41 erfolgreiche Tests und 3 Sicherheitsregressionen am 23.10.2026, dazu Oberflächenprüfung in einer lokalen Saltcorn-1.6.2-Testinstanz gegen den Kimai-Nachbau (`development/evidence/layout-0.5.0-2026-10-23.txt`). 39 erfolgreiche Tests im Bereinigungsstand vom 21.10.2026. Die alten Protokolle sind eindeutig datiert und dürfen nicht als erneute
Produktions- oder Integrationsprüfung ausgegeben werden. `development/evidence/aufteilung-2026-10-23.json`
dokumentiert die tatsächlich bei der Aufteilung wiederholten Prüfungen.

Es gibt keine Imports oder Laufzeitverweise auf andere Pluginordner. Der bisherige
Sammelstand bleibt nur als historischer Prüfbeleg bestehen und ist nicht mehr der
Ort für neue Quelländerungen. Funktionscode und Produktversion bleiben bei dieser
Aufteilung unverändert; geändert werden Organisation, Dokumentation und Test-/Entwicklungsmetadaten.

## Nächster Entwicklungsauftrag

Für Folgeaufträge den Plugin-Namen, die Version und das gewünschte Verhalten nennen.
Neue Zugangsdaten und echte Infrastrukturbezeichner nicht in Quellen, Beispiele
oder Anhänge aufnehmen. Vor Veröffentlichung Versionierung, Abhängigkeiten,
Berechtigungen und Umstellung erneut prüfen; `private: true` bleibt bei Node-Paketen erhalten.

## Eigenes Installationspaket erstellen

`npm pack --ignore-scripts` erzeugt nur für dieses Plugin ein lokales TGZ. Es erfolgt keine Veröffentlichung. Vor einem neuen Release die Version ausschließlich dieses Plugins anpassen und die Tests sowie Abhängigkeitsprüfung wiederholen.
