// Erzeugt Beispiel-PDFs, die einen Affinity-Export nachbilden:
//  - beispiel-ebenen.pdf: Platzhalter als PDF-Ebenen (Optional Content Groups) mit Namen [Form_TYP_Name]
//  - beispiel-tags.pdf:   Platzhalter mit Text-Tags [Form_TYP_Name] im Rechteck
import { PDFDocument, StandardFonts, rgb, PDFName, PDFOperator, PDFHexString } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'public';
mkdirSync(out, { recursive: true });

const INK = rgb(0.13, 0.15, 0.2);
const LINE = rgb(0.75, 0.77, 0.8);
const ACCENT = rgb(0.11, 0.27, 0.45);

async function layers() {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const ocgRefs = [];
  const mkOcg = (name) => {
    const ref = doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFHexString.fromText(name) }));
    ocgRefs.push(ref);
    return ref;
  };

  const page1 = doc.addPage([595.28, 841.89]);
  const page2 = doc.addPage([595.28, 841.89]);
  const props = new Map();
  const withLayer = (page, name, draw) => {
    let tag = props.get(page)?.get(name);
    if (!tag) {
      const ref = mkOcg(name);
      const m = props.get(page) ?? new Map();
      tag = 'oc' + (m.size + 1);
      m.set(name, { tag, ref });
      props.set(page, m);
    } else tag = tag.tag;
    page.pushOperators(PDFOperator.of('BDC', [PDFName.of('OC'), PDFName.of(tag)]));
    draw();
    page.pushOperators(PDFOperator.of('EMC'));
  };

  const p = page1;
  p.drawText('Anmeldung', { x: 56, y: 770, size: 26, font: bold, color: ACCENT });
  p.drawText('Bitte vollständig ausfüllen und zurücksenden.', { x: 56, y: 748, size: 10, font: reg, color: INK });

  p.drawText('Vorname', { x: 56, y: 700, size: 9, font: bold, color: INK });
  withLayer(p, '[Form_Text_Vorname]', () => p.drawRectangle({ x: 56, y: 670, width: 230, height: 24, color: rgb(0.96, 0.96, 0.97), borderColor: LINE, borderWidth: 0.75 }));
  p.drawText('Hier Vorname eintragen', { x: 62, y: 678, size: 11, font: reg, color: rgb(0.6, 0.6, 0.62) });

  p.drawText('Nachname', { x: 309, y: 700, size: 9, font: bold, color: INK });
  withLayer(p, '[Form_Text_Nachname]', () => p.drawRectangle({ x: 309, y: 670, width: 230, height: 24, color: rgb(0.96, 0.96, 0.97), borderColor: LINE, borderWidth: 0.75 }));

  p.drawText('E-Mail', { x: 56, y: 640, size: 9, font: bold, color: INK });
  withLayer(p, '[Form_Text_Email]', () => p.drawRectangle({ x: 56, y: 610, width: 483, height: 24, color: rgb(0.96, 0.96, 0.97), borderColor: LINE, borderWidth: 0.75 }));

  p.drawText('Anrede', { x: 56, y: 580, size: 9, font: bold, color: INK });
  withLayer(p, '[Form_Radio_Anrede_Frau]', () => p.drawCircle({ x: 63, y: 562, size: 6, borderColor: INK, borderWidth: 0.75 }));
  p.drawText('Frau', { x: 75, y: 558, size: 10, font: reg, color: INK });
  withLayer(p, '[Form_Radio_Anrede_Herr]', () => p.drawCircle({ x: 123, y: 562, size: 6, borderColor: INK, borderWidth: 0.75 }));
  p.drawText('Herr', { x: 135, y: 558, size: 10, font: reg, color: INK });
  withLayer(p, '[Form_Radio_Anrede_Divers]', () => p.drawCircle({ x: 183, y: 562, size: 6, borderColor: INK, borderWidth: 0.75 }));
  p.drawText('Divers', { x: 195, y: 558, size: 10, font: reg, color: INK });

  p.drawText('Nachricht', { x: 56, y: 525, size: 11, font: serif, color: INK });
  withLayer(p, '[Form_Area_Nachricht]', () => p.drawRectangle({ x: 56, y: 400, width: 483, height: 118, color: rgb(0.96, 0.96, 0.97), borderColor: LINE, borderWidth: 0.75 }));

  // Dunkle Fläche (Smart Contrast)
  p.drawRectangle({ x: 40, y: 250, width: 515, height: 120, color: ACCENT });
  p.drawText('Mitgliedsnummer', { x: 56, y: 340, size: 9, font: bold, color: rgb(1, 1, 1) });
  withLayer(p, '[Form_Text_Mitgliedsnummer]', () => p.drawRectangle({ x: 56, y: 305, width: 230, height: 26, borderColor: rgb(1, 1, 1), borderWidth: 0.75, opacity: 1 }));

  withLayer(p, '[Form_Check_AGB]', () => p.drawRectangle({ x: 56, y: 200, width: 12, height: 12, borderColor: INK, borderWidth: 0.75 }));
  p.drawText('Ich akzeptiere die Teilnahmebedingungen.', { x: 76, y: 202, size: 10, font: reg, color: INK });

  // Seite 2 – gleicher Feldname wie auf Seite 1 (Multi-Page)
  page2.drawText('Projekt', { x: 56, y: 770, size: 26, font: bold, color: ACCENT });
  page2.drawText('Vorname', { x: 56, y: 700, size: 9, font: bold, color: INK });
  withLayer(page2, '[Form_Text_Vorname]', () => page2.drawRectangle({ x: 56, y: 670, width: 230, height: 24, borderColor: LINE, borderWidth: 0.75 }));
  page2.drawText('Projektname', { x: 56, y: 640, size: 9, font: bold, color: INK });
  withLayer(page2, '[Form_Text_Projektname]', () => page2.drawRectangle({ x: 56, y: 610, width: 483, height: 24, borderColor: LINE, borderWidth: 0.75 }));

  for (const [page, m] of props) {
    const d = doc.context.obj({});
    for (const { tag, ref } of m.values()) d.set(PDFName.of(tag), ref);
    page.node.Resources().set(PDFName.of('Properties'), d);
  }
  doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: ocgRefs, D: { Order: ocgRefs, ON: ocgRefs } }));
  writeFileSync(`${out}/beispiel-ebenen.pdf`, await doc.save());
}

async function tags() {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('Bestellung', { x: 56, y: 770, size: 26, font: bold, color: ACCENT });
  p.drawText('Firma', { x: 56, y: 700, size: 9, font: bold, color: INK });
  p.drawRectangle({ x: 56, y: 670, width: 483, height: 24, borderColor: LINE, borderWidth: 0.75 });
  p.drawText('[Form_Text_Firma]', { x: 62, y: 678, size: 12, font: reg, color: rgb(0.2, 0.2, 0.6) });
  p.drawText('Kundennummer', { x: 56, y: 640, size: 9, font: bold, color: INK });
  p.drawRectangle({ x: 56, y: 610, width: 200, height: 24, borderColor: LINE, borderWidth: 0.75 });
  p.drawText('[Form_Text_Kundennummer]', { x: 62, y: 618, size: 11, font: mono, color: INK });
  p.drawText('Datum', { x: 280, y: 640, size: 9, font: bold, color: INK });
  p.drawRectangle({ x: 280, y: 610, width: 120, height: 24, borderColor: LINE, borderWidth: 0.75 });
  p.drawText('[Form_Text_Datum]', { x: 286, y: 618, size: 10, font: reg, color: INK });
  p.drawRectangle({ x: 56, y: 570, width: 12, height: 12, borderColor: INK, borderWidth: 0.75 });
  p.drawText('[Form_Check_Newsletter]', { x: 76, y: 572, size: 9, font: reg, color: INK });
  p.drawText('Bemerkungen', { x: 56, y: 540, size: 9, font: bold, color: INK });
  p.drawRectangle({ x: 56, y: 420, width: 483, height: 112, borderColor: LINE, borderWidth: 0.75 });
  p.drawText('[Form_Area_Bemerkungen]', { x: 62, y: 518, size: 10, font: reg, color: INK });
  p.drawText('Optional: Wünsche zur Lieferung', { x: 62, y: 504, size: 10, font: reg, color: rgb(0.6, 0.6, 0.62) });
  writeFileSync(`${out}/beispiel-tags.pdf`, await doc.save());
}

await layers();
await tags();

