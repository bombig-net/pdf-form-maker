# PDF Form Maker

Web-App, die PDFs aus Affinity Publisher, Designer und Photo in **ausfüllbare PDF-Formulare (AcroForms)** umwandelt. Platzhalter werden über eine Namenskonvention automatisch erkannt. Danach lassen sich Felder im visuellen Editor prüfen, anpassen und ergänzen.

Die gesamte Verarbeitung läuft **im Browser**. Es werden keine Dateien hochgeladen, und es gibt keine Server-Infrastruktur.

## Platzhalter in Affinity anlegen

Zeichne ein Rechteck dort, wo das Feld hin soll, und benenne es nach diesem Schema:

| Name | Ergebnis |
| --- | --- |
| `[Form_Text_Feldname]` | Einzeiliges Textfeld |
| `[Form_Area_Feldname]` | Mehrzeiliges Textfeld |
| `[Form_Check_Feldname]` | Checkbox |
| `[Form_Radio_Gruppe_Wert]` | Radio-Button; gleiche Gruppe = eine Auswahl |

Die App erkennt Platzhalter auf zwei Wegen:

1. **Ebenenname.** Liegt das Rechteck auf einer Ebene mit diesem Namen und schreibt dein PDF-Export Ebenen (Optional Content Groups) mit, wird das Feld exakt auf die Ebeneninhalte gelegt.
2. **Text-Tag.** Schreib den Namen als Text in das Rechteck, z. B. `[Form_Text_Firma]`. Die App nimmt das kleinste umgebende Rechteck als Feldgröße und blendet den Tag beim Export aus. Bei Checkboxen und Radio-Buttons darf der Tag auch direkt rechts neben dem Kästchen stehen. Dieser Weg funktioniert unabhängig von den Exporteinstellungen.

Zusätzlich steht im Platzhalter liegender Text wie „Hier Name eintragen“ im Export nicht mehr statisch unter dem Feld. Er wird ausgeblendet und als grauer **Ghost-Text** in das Formularfeld übernommen.

Bereits vorhandene Formularfelder einer PDF werden übernommen, sodass man ein exportiertes Formular erneut bearbeiten kann.

## Funktionen

- **Automatische Erkennung** über Ebenennamen und Text-Tags, inklusive Seiten mit Form-XObjects.
- **Visueller Editor:** Felder aufziehen, verschieben, skalieren, löschen, duplizieren; Rückgängig/Wiederholen.
- **Schrift-Matching:** Schriftfamilie (Sans/Serif/Mono), Größe und Farbe werden aus Text im Feld bzw. der Beschriftung daneben/darüber übernommen. Eigene TTF/OTF-Schriften lassen sich einbetten.
- **Smart Align:** Einrasten an Kanten anderer Felder und an Linien der Vorlage (Alt hält das Einrasten kurz an).
- **Automatische Tab-Reihenfolge** von links oben nach rechts unten, auch auf gedrehten Seiten.
- **Smart Fields:** E-Mail, Datum (TT.MM.JJJJ, Kalender in Acrobat mobil), Telefon, Zahl, PLZ.
- **Smart Contrast:** Eingabefarbe wird bei dunklem Hintergrund automatisch hell.
- **Zurücksetzen-Button** als eigener Feldtyp.
- **Seitenverwaltung:** drehen, umsortieren (ziehen), löschen, weitere PDFs anhängen.
- **Gleichnamige Felder auf mehreren Seiten:** Abfrage, ob synchronisiert (ein Feld mit mehreren Widgets) oder getrennt (Suffix `_S1`, `_S2` …).
- **Touch:** Pinch-to-Zoom und große Griffe auf dem iPad; Strg/⌘ + Mausrad oder Trackpad am Desktop.

## Technische Hinweise

- Eingabeschriften: PDF-Formulare können beim Tippen nur Schriften verwenden, die vollständig in der Datei liegen. Affinity bettet Schriften als Teilmengen ein. Die App ordnet deshalb Helvetica, Times oder Courier zu (inkl. Fett/Kursiv) oder bettet eine hochgeladene Schrift vollständig ein.
- Validierungen und Ghost-Text nutzen Acrobat-JavaScript. Sie wirken in Adobe Acrobat/Reader (Desktop und Mobil). Andere Viewer zeigen den Ghost-Text als Darstellung an und ignorieren die Prüfungen.
- Statischer Text wird nicht gelöscht, sondern über den Textrender-Modus 3 unsichtbar gemacht. Dadurch bleiben Layout und Abstände der Vorlage unverändert.

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
