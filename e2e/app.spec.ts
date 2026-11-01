import { test, expect, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';

const sample = (name: string) => `src/assets/${name}`;

async function openFile(page: Page, file: string) {
  await page.goto('/');
  await page.locator('.home-main input[type=file]').first().setInputFiles(file);
  await expect(page.locator('.editor')).toBeVisible();
}
async function draw(page: Page, key: string, x: number, y: number, w = 110, h = 26) {
  await page.keyboard.press(key);
  const box = (await page.locator('.page').first().boundingBox())!;
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + w, box.y + y + h, { steps: 4 });
  await page.mouse.up();
}
const closePanel = (page: Page) => page.locator('.inspector button[aria-label="Clear selection"]').click();
/** Opens a collapsible section in the properties panel if it is closed. */
async function openSection(page: Page, id: string) {
  const d = page.locator(`.inspector details[data-sec="${id}"]`);
  if (!(await d.evaluate((el) => (el as HTMLDetailsElement).open))) await d.locator('summary').click();
}

test('opens the sample and detects its fields', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make any PDF fillable' })).toBeVisible();
  await page.locator('.side-link', { hasText: 'Open sample' }).click();
  await page.locator('dialog.modal .btn.primary').click();
  await expect(page.locator('.field')).toHaveCount(11);
  await expect(page.locator('.empty-help')).toHaveCount(0);
});

test('draws a field, aligns a selection and undoes', async ({ page }) => {
  await openFile(page, sample('sample-tags.pdf'));
  await expect(page.locator('.field')).toHaveCount(5);
  await draw(page, 't', 600, 180);
  await expect(page.locator('.field')).toHaveCount(6);
  await closePanel(page);
  await page.locator('.field[data-type=text]').nth(0).click();
  await page.locator('.field[data-type=text]').nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.multi-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Align left' }).click();
  const xs = await page.locator('.field.selected').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(new Set(xs).size).toBe(1);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.field')).toHaveCount(5);
});

test('calculates and shows conditional fields in test mode', async ({ page }) => {
  await openFile(page, sample('sample-tags.pdf'));
  const name = (n: string) => page.locator('input[name=name]').fill(n);
  await draw(page, 't', 560, 140); await name('Qty'); await closePanel(page);
  await draw(page, 't', 700, 140); await name('Price'); await closePanel(page);
  await draw(page, 't', 840, 140); await name('Total');
  await openSection(page, 'f:calc');
  await page.locator('select[name=calcOp]').selectOption('formula');
  await page.locator('input[name=formula]').fill('Qty * Price');
  await expect(page.locator('.field .logic-badge', { hasText: 'fx' })).toHaveCount(1);
  await closePanel(page);
  await page.locator('.field-row', { hasText: 'Notes' }).click();
  await openSection(page, 'f:visibility');
  await page.locator('select[name=showIf]').selectOption({ label: 'Only if Newsletter is checked' });
  await expect(page.locator('.field .logic-badge', { hasText: 'if' })).toHaveCount(1);
  await page.keyboard.press('Control+e');
  const notes = page.locator('.test-field[data-type=area] textarea');
  await expect(notes).toBeHidden();
  await page.locator('[data-fname="Qty"]').fill('3');
  await page.locator('[data-fname="Price"]').fill('12,50');
  await expect(page.locator('[data-fname="Total"]')).toHaveValue('37,50');
  await page.locator('.test-field[data-type=check] input').check();
  await expect(notes).toBeVisible();
});

test('suggests fields on a PDF without tags', async ({ page }) => {
  await openFile(page, sample('sample-plain.pdf'));
  await page.locator('.empty-help').getByRole('button', { name: 'Suggest fields' }).click();
  await expect(page.locator('.field')).toHaveCount(9);
  await expect(page.locator('.field.selected')).toHaveCount(9);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.field')).toHaveCount(0);
});

test('exports a fillable PDF', async ({ page }) => {
  await openFile(page, sample('sample-tags.pdf'));
  const download = page.waitForEvent('download');
  await page.locator('button.export').click();
  if (await page.locator('dialog.preflight').count()) await page.locator('dialog.preflight .btn.primary').click();
  const file = await (await download).path();
  const form = (await PDFDocument.load(readFileSync(file))).getForm();
  expect(form.getFields().map((f) => f.getName()).sort()).toEqual(['Company', 'CustomerNumber', 'Date', 'Newsletter', 'Notes']);
});

test('keeps recent forms and project files', async ({ page }) => {
  await openFile(page, sample('sample-tags.pdf'));
  await page.locator('.field-row', { hasText: 'Company' }).click();
  await page.locator('input[name=name]').fill('Firm');
  await closePanel(page);
  await openSection(page, 'doc:project');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project file' }).click();
  const projectFile = await (await download).path();
  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page.locator('.recent-card')).toHaveCount(1);
  await page.locator('.recent-open').click();
  await expect(page.locator('.field-row', { hasText: 'Firm' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Back to home' }).click();
  await page.locator('.home-main input[type=file]').nth(1).setInputFiles({ name: 'copy.formmaker', mimeType: 'application/json', buffer: readFileSync(projectFile) });
  await expect(page.locator('.field-row', { hasText: 'Firm' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page.locator('.recent-card')).toHaveCount(2);
});

test('applies one form font to all fields, with per-field exceptions', async ({ page }) => {
  await openFile(page, sample('sample-layers.pdf'));
  await page.locator('dialog.modal .btn.primary').click();
  await openSection(page, 'doc:font');
  const size = page.locator('input[name=formFontSize]');
  await size.fill('');
  await size.pressSequentially('12.5');
  await expect(size).toHaveValue('12.5');
  await expect(size).toBeFocused();
  await page.locator('.field-row', { hasText: 'FirstName' }).first().click();
  await openSection(page, 'f:font');
  await expect(page.locator('.acc[data-sec="f:font"] .acc-meta')).toHaveText('Form font');
  await page.locator('.acc[data-sec="f:font"] .toggle-row', { hasText: 'Own font settings' }).locator('label').click();
  await page.locator('input[name=fontSize]').fill('16');
  await closePanel(page);
  await expect(page.locator('.acc[data-sec="doc:font"] .hint').first()).toContainText('2 fields use their own');  // FirstName exists on two pages (synced)
  await page.getByRole('button', { name: 'Use the form font everywhere' }).click();
  await expect(page.locator('.acc[data-sec="doc:font"] .hint').first()).toContainText('Applies to every field');
});

test('shows every character of a comb field in its own box', async ({ page }) => {
  await openFile(page, sample('sample-tags.pdf'));
  await page.locator('.field-row', { hasText: 'CustomerNumber' }).click();
  await openSection(page, 'f:input');
  await page.locator('.acc[data-sec="f:input"] .toggle-row', { hasText: 'Comb' }).locator('label').click();
  await page.locator('input[name=maxLength]').fill('6');
  await page.keyboard.press('Control+e');
  await page.locator('[data-fname="CustomerNumber"]').pressSequentially('8215');
  await expect(page.locator('.comb-cell')).toHaveText(['8', '2', '1', '5', '', '']);
  // The input underneath must not show its own text on top of the boxes
  await expect(page.locator('[data-fname="CustomerNumber"]')).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  const lefts = await page.locator('.comb-cell').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThan(1);
});

test('keeps dropdown lists readable in dark mode', async ({ browser }) => {
  const page = await browser.newPage({ colorScheme: 'dark', viewport: { width: 1400, height: 900 } });
  await openFile(page, sample('sample-tags.pdf'));
  await page.locator('.field-row', { hasText: 'Company' }).click();
  await page.locator('select[name=type]').selectOption('dropdown');
  await page.keyboard.press('Control+e');
  const select = page.locator('.test-field[data-type=dropdown] select');
  await expect(select).toHaveCSS('color-scheme', 'light');
  await expect(select.locator('option').nth(1)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(select.locator('option').nth(1)).toHaveCSS('color', 'rgb(23, 23, 23)');
  await page.close();
});
