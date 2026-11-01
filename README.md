# PDF Form Maker

Web-App, die aus einer normalen PDF ein **ausfüllbares PDF-Formular (AcroForm)** macht. Platzhalter im Layout werden über eine Namenskonvention automatisch zu Formularfeldern. Im visuellen Editor lassen sich die Felder danach prüfen, anpassen und ergänzen.

Die App funktioniert mit PDFs aus jedem Programm, z. B. Affinity, InDesign, Illustrator, Canva, Word oder LibreOffice. Die gesamte Verarbeitung läuft **im Browser**: Es werden keine Dateien hochgeladen, und es gibt keine Server-Infrastruktur.

## So kommen die Felder ins Dokument

Es gibt drei Wege, die sich beliebig kombinieren lassen.

**1. Text-Tag im Layout (funktioniert mit jeder PDF).** Zeichne ein Rechteck dort, wo das Feld hin soll, und schreib einen Tag als Text hinein:

| Tag | Ergebnis |
| --- | --- |
| `[Form_Text_Feldname]` | Einzeiliges Textfeld |
| `[Form_Area_Feldname]` | Mehrzeiliges Textfeld |
| `[Form_Check_Feldname]` | Checkbox |
| `[Form_Radio_Gruppe_Wert]` | Radio-Button; gleiche Gruppe = eine Auswahl |

Das kleinste Rechteck um den Tag wird zum Feld, der Tag selbst wird beim Export ausgeblendet. Bei Checkboxen und Radio-Buttons darf der Tag auch direkt rechts neben dem Kästchen stehen.

**2. Ebenenname.** Wenn dein Programm Ebenen als PDF-Ebenen (Optional Content Groups) exportiert, kannst du das Rechteck stattdessen auf eine Ebene mit dem Tag als Namen legen. Ob und wie Ebenen mitexportiert werden, hängt vom Programm und den Exporteinstellungen ab. Im Zweifel ist der Text-Tag der sichere Weg.

**3. Manuell im Editor.** Felder lassen sich auch ohne Vorbereitung direkt auf der Seite aufziehen, z. B. bei gescannten Dokumenten oder PDFs von Dritten.

Text, der schon im Platzhalter steht, etwa „Hier Name eintragen“, bleibt nicht statisch unter dem Feld stehen. Er wird ausgeblendet und als grauer **Ghost-Text** ins Formularfeld übernommen.

Bereits vorhandene Formularfelder werden übernommen. Ein exportiertes Formular lässt sich also erneut öffnen und weiterbearbeiten.

## Funktionen

- **Automatische Erkennung** über Text-Tags und Ebenennamen, inklusive Inhalten in Form-XObjects.
- **Visueller Editor:** Felder aufziehen, verschieben, skalieren, löschen, duplizieren; Rückgängig/Wiederholen.
- **Schrift-Matching:** Schriftfamilie (Sans/Serif/Mono), Größe und Farbe werden aus dem Text im Feld bzw. der Beschriftung daneben oder darüber übernommen. Eigene TTF/OTF-Schriften lassen sich einbetten.
- **Smart Align:** Einrasten an Kanten anderer Felder und an Linien der Vorlage (Alt hält das Einrasten kurz an).
- **Automatische Tab-Reihenfolge** von links oben nach rechts unten, auch auf gedrehten Seiten.
- **Smart Fields:** E-Mail, Datum (TT.MM.JJJJ, Kalender in Acrobat mobil), Telefon, Zahl, PLZ.
- **Smart Contrast:** Die Eingabefarbe wird auf dunklem Hintergrund automatisch hell.
- **Zurücksetzen-Button** als eigener Feldtyp.
- **Seitenverwaltung:** drehen, umsortieren (ziehen), löschen, weitere PDFs anhängen.
- **Gleichnamige Felder auf mehreren Seiten:** Abfrage, ob sie synchronisiert (ein Feld mit mehreren Widgets) oder getrennt (Suffix `_S1`, `_S2` …) werden sollen.
- **Mehrfachauswahl:** Shift-Klick oder Auswahlrahmen; gemeinsam verschieben, ausrichten, gleichmäßig verteilen, Breite/Höhe angleichen und Eigenschaften setzen.
- **Kopieren und Einfügen** von Feldern (⌘/Strg C/V), auch auf andere Seiten.
- **Feldnamen aus Beschriftungen:** Ein gezeichnetes Feld neben „Vorname“ heißt automatisch `Vorname`.
- **Testmodus** (⌘/Strg E): Formular direkt in der App ausfüllen, inklusive Tab-Reihenfolge, Ghost-Text, Formatprüfung und synchronisierter Felder.
- **Preflight vor dem Export:** Hinweise auf überlappende Felder, Felder am Seitenrand, sehr kleine Schrift, Namenskonflikte und Radio-Gruppen mit nur einer Option.
- **Hilfe ohne Treffer:** Werden keine Platzhalter gefunden, erklärt die App die wahrscheinliche Ursache.
- **Touch:** Pinch-to-Zoom und große Griffe auf dem iPad, Eigenschaften als Bottom Sheet auf dem Telefon; Strg/⌘ + Mausrad oder Trackpad am Desktop.

## Grenzen und technische Hinweise

- **Eingabeschriften:** Beim Tippen in ein Formularfeld braucht der PDF-Reader die vollständige Schrift. Die meisten Programme betten nur die verwendeten Zeichen ein. Die App ordnet deshalb Helvetica, Times oder Courier zu (inkl. Fett/Kursiv) oder bettet eine hochgeladene Schrift vollständig ein.
- **Validierungen und Ghost-Text** nutzen Acrobat-JavaScript. Sie wirken in Adobe Acrobat/Reader (Desktop und Mobil). Andere Viewer zeigen den Ghost-Text als Darstellung an und ignorieren die Prüfungen.
- **Statischer Text** wird nicht gelöscht, sondern über den Textrender-Modus 3 unsichtbar gemacht. Layout und Abstände bleiben dadurch unverändert.
- **Automatische Erkennung** braucht echten Text in der PDF. Bei Scans oder in Pfade umgewandelter Schrift werden Tags nicht gefunden; Felder lassen sich dort manuell anlegen.
- **Verschlüsselte PDFs** müssen vorher ohne Passwortschutz exportiert werden.

## Entwicklung

```bash
npm install
npm run dev          # Entwicklungsserver
npm test             # Tests (Erkennung, Export, Geometrie, Performance)
npm run build        # Web-App in dist/
npm run build:single # eine einzige HTML-Datei in dist-single/
```

Benötigt Node.js 20 oder neuer. Die Beispiel-PDFs in `src/assets/` werden von `scripts/make-samples.mjs` erzeugt (automatisch vor `dev`, `build` und `test`).

### Aufbau

| Pfad | Inhalt |
| --- | --- |
| `src/pdf/tokenizer.ts`, `src/pdf/interpreter.ts` | Content-Stream-Parser: Ebenen, Pfade, Text, Schriften, Farben |
| `src/pdf/analyze.ts` | Analyse einer PDF (pdf-lib + pdf.js) |
| `src/pdf/detect.ts` | Namenskonvention, Feld-Erkennung, Schrift- und Farbzuordnung |
| `src/pdf/export.ts` | AcroForm-Export, Text ausblenden, Seiten zusammenstellen, Tab-Reihenfolge |
| `src/ui/` | Editor: Viewer, Seitenleiste, Eigenschaften, Aktionen |
| `test/` | Vitest-Tests |

### Automatische Tests und GitHub Pages einrichten

Die Workflow-Vorlagen liegen in `docs/workflows/`:

- `ci.yml` führt bei jedem Push und Pull Request Tests und Build aus.
- `pages.yml` baut die App bei jedem Push auf `main` und veröffentlicht sie auf GitHub Pages.

Einmalig einrichten:

1. Beide Dateien nach `.github/workflows/` kopieren (im GitHub-Webinterface: „Add file → Create new file“, als Namen `.github/workflows/ci.yml` eingeben und den Inhalt einfügen; dasselbe für `pages.yml`).
2. Unter **Settings → Pages → Build and deployment → Source** die Option **GitHub Actions** wählen.

Danach ist die App nach jedem Push unter `https://<organisation>.github.io/pdf-form-maker/` erreichbar.
