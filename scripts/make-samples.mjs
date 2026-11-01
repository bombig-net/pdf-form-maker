// Generates sample PDFs that mimic a typical layout export:
//  - sample-layers.pdf: placeholders as PDF layers (optional content groups) named [Form_TYPE_Name]
//  - sample-tags.pdf:   placeholders with text tags [Form_TYPE_Name] inside rectangles
//  - sample-plain.pdf:  an ordinary form without any tags (for automatic field suggestions)
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
  p.drawText('Registration', { x: 56, y: 770, size: 26, font: bold, color: ACCENT });
  p.drawText('Please fill in all fields and send the form back.', { x: 56, y: 748, size: 10, font: reg, color: INK });

  p.drawText('First name', { x: 56, y: 700, size: 9, font: bold, color: INK });
  withLayer(p, '[Form_Text_FirstName]', () => p.drawRectangle({ x: 56, y: 670, width: 230, height: 24, color: rgb(0.96, 0.96, 0.97), borderColor: LINE, borderWidth: 0.75 }));
  p.drawText('Enter your first name', { x: 62, y: 678, size: 11, font: reg, color: rgb(0.6, 0.6, 0.62) });

  p.drawText('Last name', { x: 309, y: 700, size: 9, font: bold, color: INK });
  withLayer(p, '[Form_Text_LastName]', () => p.drawRectangle({ x: 309, y: 670, width: 230, height: 24, color: rgb(0.96, 0.96, 0.97), borderColor: LINE, borderWidth: 0.75 }));

  p.drawText('Email', { x: 56, y: 640, size: 9, font: bold, color: INK });
  withLayer(p, '[Form_Text_Email]', () => p.drawRectangle({ x: 56, y: 610, width: 483, height: 24, color: rgb(0.96, 0.96, 0.97), borderColor: LINE, borderWidth: 0.75 }));

  p.drawText('Salutation', { x: 56, y: 580, size: 9, font: bold, color: INK });
  withLayer(p, '[Form_Radio_Salutation_Ms]', () => p.drawCircle({ x: 63, y: 562, size: 6, borderColor: INK, borderWidth: 0.75 }));
  p.drawText('Ms', { x: 75, y: 558, size: 10, font: reg, color: INK });
  withLayer(p, '[Form_Radio_Salutation_Mr]', () => p.drawCircle({ x: 123, y: 562, size: 6, borderColor: INK, borderWidth: 0.75 }));
  p.drawText('Mr', { x: 135, y: 558, size: 10, font: reg, color: INK });
  withLayer(p, '[Form_Radio_Salutation_Mx]', () => p.drawCircle({ x: 183, y: 562, size: 6, borderColor: INK, borderWidth: 0.75 }));
  p.drawText('Mx', { x: 195, y: 558, size: 10, font: reg, color: INK });

  p.drawText('Message', { x: 56, y: 525, size: 11, font: serif, color: INK });
  withLayer(p, '[Form_Area_Message]', () => p.drawRectangle({ x: 56, y: 400, width: 483, height: 118, color: rgb(0.96, 0.96, 0.97), borderColor: LINE, borderWidth: 0.75 }));

  // Dark area (Smart Contrast)
  p.drawRectangle({ x: 40, y: 250, width: 515, height: 120, color: ACCENT });
  p.drawText('Member number', { x: 56, y: 340, size: 9, font: bold, color: rgb(1, 1, 1) });
  withLayer(p, '[Form_Text_MemberNumber]', () => p.drawRectangle({ x: 56, y: 305, width: 230, height: 26, borderColor: rgb(1, 1, 1), borderWidth: 0.75, opacity: 1 }));

  withLayer(p, '[Form_Check_Terms]', () => p.drawRectangle({ x: 56, y: 200, width: 12, height: 12, borderColor: INK, borderWidth: 0.75 }));
  p.drawText('I accept the terms of participation.', { x: 76, y: 202, size: 10, font: reg, color: INK });

  // Page 2 – same field name as on page 1 (multi-page)
  page2.drawText('Project', { x: 56, y: 770, size: 26, font: bold, color: ACCENT });
  page2.drawText('First name', { x: 56, y: 700, size: 9, font: bold, color: INK });
  withLayer(page2, '[Form_Text_FirstName]', () => page2.drawRectangle({ x: 56, y: 670, width: 230, height: 24, borderColor: LINE, borderWidth: 0.75 }));
  page2.drawText('Project name', { x: 56, y: 640, size: 9, font: bold, color: INK });
  withLayer(page2, '[Form_Text_ProjectName]', () => page2.drawRectangle({ x: 56, y: 610, width: 483, height: 24, borderColor: LINE, borderWidth: 0.75 }));

  for (const [page, m] of props) {
    const d = doc.context.obj({});
    for (const { tag, ref } of m.values()) d.set(PDFName.of(tag), ref);
    page.node.Resources().set(PDFName.of('Properties'), d);
  }
  doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: ocgRefs, D: { Order: ocgRefs, ON: ocgRefs } }));
  writeFileSync(`${out}/sample-layers.pdf`, await doc.save());
}

async function tags() {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('Order', { x: 56, y: 770, size: 26, font: bold, color: ACCENT });
  p.drawText('Company', { x: 56, y: 700, size: 9, font: bold, color: INK });
  p.drawRectangle({ x: 56, y: 670, width: 483, height: 24, borderColor: LINE, borderWidth: 0.75 });
  p.drawText('[Form_Text_Company]', { x: 62, y: 678, size: 12, font: reg, color: rgb(0.2, 0.2, 0.6) });
  p.drawText('Customer number', { x: 56, y: 640, size: 9, font: bold, color: INK });
  p.drawRectangle({ x: 56, y: 610, width: 200, height: 24, borderColor: LINE, borderWidth: 0.75 });
  p.drawText('[Form_Text_CustomerNumber]', { x: 62, y: 618, size: 11, font: mono, color: INK });
  p.drawText('Date', { x: 280, y: 640, size: 9, font: bold, color: INK });
  p.drawRectangle({ x: 280, y: 610, width: 120, height: 24, borderColor: LINE, borderWidth: 0.75 });
  p.drawText('[Form_Text_Date]', { x: 286, y: 618, size: 10, font: reg, color: INK });
  p.drawRectangle({ x: 56, y: 570, width: 12, height: 12, borderColor: INK, borderWidth: 0.75 });
  p.drawText('[Form_Check_Newsletter]', { x: 76, y: 572, size: 9, font: reg, color: INK });
  p.drawText('Notes', { x: 56, y: 540, size: 9, font: bold, color: INK });
  p.drawRectangle({ x: 56, y: 420, width: 483, height: 112, borderColor: LINE, borderWidth: 0.75 });
  p.drawText('[Form_Area_Notes]', { x: 62, y: 518, size: 10, font: reg, color: INK });
  p.drawText('Optional: delivery instructions', { x: 62, y: 504, size: 10, font: reg, color: rgb(0.6, 0.6, 0.62) });
  writeFileSync(`${out}/sample-tags.pdf`, await doc.save());
}

async function plain() {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p = doc.addPage([595.28, 841.89]);
  const label = (t, x, y) => p.drawText(t, { x, y, size: 9, font: bold, color: INK });
  p.drawText('Contact form', { x: 56, y: 770, size: 24, font: bold, color: ACCENT });
  // Panel around the inputs (must not become a field)
  p.drawRectangle({ x: 44, y: 520, width: 507, height: 210, borderColor: LINE, borderWidth: 0.5 });
  label('Full name', 56, 700); p.drawRectangle({ x: 56, y: 672, width: 230, height: 22, borderColor: LINE, borderWidth: 0.75 });
  label('Company', 309, 700); p.drawRectangle({ x: 309, y: 672, width: 230, height: 22, borderColor: LINE, borderWidth: 0.75 });
  label('Email', 56, 650); p.drawRectangle({ x: 56, y: 622, width: 483, height: 22, color: rgb(0.96, 0.96, 0.97) });
  p.drawText('name@example.com', { x: 62, y: 629, size: 10, font: reg, color: rgb(0.62, 0.62, 0.64) });
  label('Message', 56, 600); p.drawRectangle({ x: 56, y: 530, width: 483, height: 64, borderColor: LINE, borderWidth: 0.75 });
  // Checkboxes: drawn squares and a glyph
  p.drawRectangle({ x: 56, y: 490, width: 11, height: 11, borderColor: INK, borderWidth: 0.75 });
  p.drawText('Send me the newsletter', { x: 74, y: 492, size: 10, font: reg, color: INK });
  p.drawRectangle({ x: 250, y: 490, width: 11, height: 11, borderColor: INK, borderWidth: 0.75 });
  p.drawText('I accept the terms', { x: 268, y: 492, size: 10, font: reg, color: INK });
  // Underline fields
  p.drawText('Place, date', { x: 56, y: 440, size: 10, font: reg, color: INK });
  p.drawLine({ start: { x: 120, y: 438 }, end: { x: 300, y: 438 }, thickness: 0.75, color: INK });
  p.drawText('Signature', { x: 320, y: 440, size: 10, font: reg, color: INK });
  p.drawLine({ start: { x: 375, y: 438 }, end: { x: 539, y: 438 }, thickness: 0.75, color: INK });
  // Underscores in text
  p.drawText('Reference: ______________________', { x: 56, y: 405, size: 10, font: reg, color: INK });
  // Heading with an underline (text sits on the line: not a field)
  p.drawText('Opening hours', { x: 56, y: 360, size: 12, font: bold, color: INK });
  p.drawLine({ start: { x: 56, y: 357 }, end: { x: 150, y: 357 }, thickness: 0.75, color: INK });
  // Table grid (must not produce fields)
  for (let i = 0; i <= 3; i++) p.drawLine({ start: { x: 56, y: 340 - i * 20 }, end: { x: 400, y: 340 - i * 20 }, thickness: 0.5, color: LINE });
  for (const x of [56, 200, 300, 400]) p.drawLine({ start: { x, y: 340 }, end: { x, y: 280 }, thickness: 0.5, color: LINE });
  p.drawText('Mon', { x: 62, y: 326, size: 9, font: reg, color: INK }); p.drawText('9-17', { x: 206, y: 326, size: 9, font: reg, color: INK });
  writeFileSync(`${out}/sample-plain.pdf`, await doc.save());
}

await layers();
await tags();
await plain();
