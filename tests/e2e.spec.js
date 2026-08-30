import { test, expect } from '@playwright/test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlL8AAAAASUVORK5CYII=', 'base64');
const docx = Buffer.from('UEsDBBQAAAAIACuBHV0XmADX6wAAALIBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU4DMQy98xWRr2gmAweEUKc9sByBQ/kAK/HMRM2mOC3t3+NpoQdUONpvs99itQ9e7aiwS7GHm7YDRdEk6+LYw8f6pbkHxRWjRZ8i9XAghtXyarE+ZGIl4sg9TLXmB63ZTBSQ25QpCjKkErDKWEad0WxwJH3bdXfapFgp1qbOHiBmTzTg1lf1vJf96ZJCnkE9nphzWA+Ys3cGq+B6F+2vmOY7ohXlkcOTy3wtBNCXI2bo74Qf4ZuUU5wl9Y6lvmIQmv5MxWqbzDaItP3f58KlaRicobN+dsslGWKW1oNvz0hAF88f6GPlyy9QSwMEFAAAAAgAK4EdXT+t/vqvAAAALAEAAAsAAABfcmVscy8ucmVsc43POw7CMAwA0J1TRN5pWgaEUEMXhNQVlQNEiZtWNB/F4dPbk4EBKgZG/57tunnaid0x0uidgKoogaFTXo/OCLh0p/UOGCXptJy8QwEzEjSHVX3GSaY8Q8MYiGXEkYAhpbDnnNSAVlLhA7pc6X20MuUwGh6kukqDfFOWWx4/DVigrNUCYqsrYN0c8B/c9/2o8OjVzaJLP3YsOrIso8Ek4OGj5vqdLjILPJ/Dv548vABQSwMEFAAAAAgAK4EdXX2xK7ikAAAA1wAAABEAAAB3b3JkL2RvY3VtZW50LnhtbEWOvQ7CMAyEd54iyk5TGBCq+rMhFibgAUJjaKXEjuKU0rcnKQPLZ91ZPl/dfZwVbwg8EjZyV5RSAPZkRnw18n47bY9ScNRotCWERi7Asms39VwZ6icHGEVKQK7mRg4x+kop7gdwmgvygGn3pOB0TDK81EzB+EA9MKcHzqp9WR6U0yPKNkU+yCx5+oyQEdszWEviMl2j5qFW2coMK/3K35n6V2q/UEsBAhQDFAAAAAgAK4EdXReYANfrAAAAsgEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACAArgR1dP63++q8AAAAsAQAACwAAAAAAAAAAAAAAgAEcAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACAArgR1dfbEruKQAAADXAAAAEQAAAAAAAAAAAAAAgAH0AQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAAxwIAAAAA', 'base64');

function makePdf() {
  const stream = 'BT\n/F1 24 Tf\n72 720 Td\n(MuStash PDF preview) Tj\nET\n';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  ];

  let pdf = '%PDF-1.4\n%MuStash\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

async function uploadFile(page, file, { password = '', allowDownload = true } = {}) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(file);
  await page.getByTestId('ttl-input').fill('1');
  await expect(page.getByTestId('allow-download')).toBeChecked();
  if (!allowDownload) await page.getByTestId('allow-download').uncheck();
  if (password) await page.getByTestId('password-input').fill(password);
  await page.getByTestId('stash-button').click();
  await expect(page.getByTestId('result-card')).toBeVisible();
  await expect(page.getByTestId('share-url')).not.toHaveValue('');
  return page.getByTestId('share-url').inputValue();
}

async function uploadPng(page, password = '', allowDownload = true) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#localPreview img')).toBeVisible();
  await page.getByTestId('ttl-input').fill('1');
  await expect(page.getByTestId('allow-download')).toBeChecked();
  if (!allowDownload) await page.getByTestId('allow-download').uncheck();
  if (password) await page.getByTestId('password-input').fill(password);
  await page.getByTestId('stash-button').click();
  await expect(page.getByTestId('result-card')).toBeVisible();
  await expect(page.getByTestId('share-url')).not.toHaveValue('');
  return page.getByTestId('share-url').inputValue();
}

test('uploads, previews, and downloads an unrestricted image', async ({ page }) => {
  const shareUrl = await uploadPng(page);
  expect(shareUrl).not.toContain('#k=');
  await page.goto(shareUrl);
  await expect(page.getByTestId('media-state')).toBeVisible();
  const preview = page.locator('[data-testid="media-preview"]');
  await expect(preview).toHaveAttribute('src', /\/api\/shares\/.+\/content/);
  await expect(page.getByTestId('download-button')).toBeVisible();
  await expect(page.getByTestId('preview-only-pill')).toBeHidden();

  const contentUrl = await preview.getAttribute('src');
  const downloadResponse = await page.request.get(new URL(`${contentUrl}?download=1`, page.url()).href);
  expect(downloadResponse.status()).toBe(200);
  expect(downloadResponse.headers()['content-disposition']).toContain('attachment');
});

test('accepts UTF-8 TXT files and serves them as non-executable text', async ({ page }) => {
  const shareUrl = await uploadFile(page, {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Hello from MuStash.\n<script>alert(1)</script>\n', 'utf8')
  });

  await page.goto(shareUrl);
  await expect(page.getByTestId('media-state')).toBeVisible();
  const preview = page.locator('iframe[data-testid="media-preview"]');
  await expect(preview).toBeVisible();
  const contentUrl = await preview.getAttribute('src');
  const response = await page.request.get(new URL(contentUrl, page.url()).href);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/plain');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(await response.text()).toContain('<script>alert(1)</script>');
});

test('preview-only PDF is permitted in the same-origin browser viewer', async ({ page }) => {
  const frameErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /frame-ancestors|refused to frame/i.test(message.text())) {
      frameErrors.push(message.text());
    }
  });

  const shareUrl = await uploadFile(page, {
    name: 'sample.pdf',
    mimeType: 'application/pdf',
    buffer: makePdf()
  }, { allowDownload: false });

  await page.goto(shareUrl);
  await expect(page.getByTestId('preview-only-pill')).toBeVisible();
  const preview = page.locator('iframe[data-testid="media-preview"]');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src', /\/content#toolbar=0&navpanes=0$/);

  const contentUrl = (await preview.getAttribute('src')).split('#')[0];
  const response = await page.request.get(new URL(contentUrl, page.url()).href);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');
  expect(response.headers()['content-disposition']).toBe('inline');
  expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'self'");
  expect(response.headers()['content-security-policy']).not.toContain("frame-ancestors 'none'");
  expect(frameErrors).toEqual([]);
});

test('accepts DOCX files and offers them as downloads', async ({ page }) => {
  const shareUrl = await uploadFile(page, {
    name: 'sample.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docx
  });

  await page.goto(shareUrl);
  await expect(page.getByTestId('document-placeholder')).toBeVisible();
  const downloadButton = page.getByTestId('download-button');
  await expect(downloadButton).toBeVisible();
  const downloadUrl = await downloadButton.getAttribute('href');
  const response = await page.request.get(new URL(downloadUrl, page.url()).href);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  expect(response.headers()['content-disposition']).toContain('attachment');
});

test('preview-only share hides download and rejects attachment requests', async ({ page }) => {
  const shareUrl = await uploadPng(page, '', false);
  await page.goto(shareUrl);
  await expect(page.getByTestId('media-state')).toBeVisible();
  await expect(page.getByTestId('download-button')).toBeHidden();
  await expect(page.getByTestId('preview-only-pill')).toBeVisible();
  await expect(page.locator('#mediaFrame')).toHaveClass(/preview-only/);

  const preview = page.locator('[data-testid="media-preview"]');
  expect(await preview.evaluate((element) => element.draggable)).toBe(false);
  const contextMenuPrevented = await preview.evaluate((element) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(contextMenuPrevented).toBe(true);

  const contentUrl = await preview.getAttribute('src');
  const previewResponse = await page.request.get(new URL(contentUrl, page.url()).href);
  expect(previewResponse.status()).toBe(200);
  expect(previewResponse.headers()['content-disposition']).toBe('inline');
  expect(previewResponse.headers()['cache-control']).toContain('no-store');

  const downloadResponse = await page.request.get(new URL(`${contentUrl}?download=1`, page.url()).href);
  expect(downloadResponse.status()).toBe(403);
});

test('password share uses a derived fragment key and can also be unlocked manually', async ({ browser, page }) => {
  const password = 'correct horse battery staple';
  const shareUrl = await uploadPng(page, password);
  expect(shareUrl).toContain('#k=');
  expect(shareUrl).not.toContain(encodeURIComponent(password));

  await page.goto(shareUrl);
  await expect(page.getByTestId('media-state')).toBeVisible();

  const stripped = shareUrl.split('#')[0];
  const context = await browser.newContext();
  const manual = await context.newPage();
  await manual.goto(stripped);
  await expect(manual.getByTestId('unlock-password')).toBeVisible();
  await manual.getByTestId('unlock-password').fill(password);
  await manual.getByTestId('unlock-button').click();
  await expect(manual.getByTestId('media-state')).toBeVisible();
  await context.close();
});

test('rejects unsupported active-content files server-side', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({ name: 'payload.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') });
  await page.getByTestId('stash-button').click();
  await expect(page.locator('#status')).toContainText('Unsupported file type');
  await expect(page.getByTestId('result-card')).toBeHidden();
});

test('drag and drop is offered only on desktop', async ({ page }, testInfo) => {
  await page.goto('/');
  const desktop = testInfo.project.name === 'chromium';
  const dropzone = page.locator('#dropzone');
  const dropHint = page.getByTestId('drop-hint');

  await expect(dropzone).toHaveAttribute('data-drag-enabled', String(desktop));
  if (desktop) await expect(dropHint).toBeVisible();
  else await expect(dropHint).toBeHidden();
});

test('hamburger menu exposes theme toggle and future settings', async ({ page }) => {
  await page.goto('/');
  const menuToggle = page.getByTestId('menu-toggle');
  const menu = page.locator('#appMenu');

  await expect(menu).toBeHidden();
  await menuToggle.click();
  await expect(menu).toBeVisible();
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('theme-toggle')).toBeVisible();
  await expect(page.getByTestId('settings-item')).toBeDisabled();
  await expect(page.getByTestId('settings-item')).toContainText('Soon');

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
});

test('theme preference persists from menu toggle', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('menu-toggle').click();
  const toggle = page.getByTestId('theme-toggle');
  const initialPressed = await toggle.getAttribute('aria-pressed');
  await toggle.click();

  const theme = await page.locator('html').getAttribute('data-theme');
  expect(['light', 'dark']).toContain(theme);
  await expect(toggle).toHaveAttribute('aria-pressed', initialPressed === 'true' ? 'false' : 'true');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.getByTestId('menu-toggle').click();
  await expect(page.getByTestId('theme-toggle')).toHaveAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
});

test('ttl steppers adjust hours beside the input-suffix field', async ({ page }) => {
  await page.goto('/');
  const ttl = page.getByTestId('ttl-input');
  await ttl.fill('2');
  await page.getByRole('button', { name: 'Increase hours' }).click();
  await expect(ttl).toHaveValue('2.25');
  await page.getByRole('button', { name: 'Decrease hours' }).click();
  await expect(ttl).toHaveValue('2');
  await expect(page.locator('.number-steppers')).toBeVisible();
  await expect(page.locator('.ttl-control .input-suffix')).toBeVisible();
});

test('settings grid places ttl, password, and download controls', async ({ page }, testInfo) => {
  await page.goto('/');
  const grid = page.locator('.settings-grid');
  await expect(grid.locator('.settings-ttl')).toBeVisible();
  await expect(grid.locator('.settings-password')).toBeVisible();
  await expect(grid.locator('.settings-download')).toBeVisible();
  await expect(grid.getByTestId('allow-download')).toBeChecked();
  await expect(grid.locator('.download-option-copy strong')).toHaveText('Allow Download');
  await expect(grid.locator('.download-option-copy small')).toHaveCount(0);

  const areas = (await grid.evaluate((el) => getComputedStyle(el).gridTemplateAreas))
    .replace(/"/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const mobile = /mobile|pixel/i.test(testInfo.project.name);
  if (mobile) {
    expect(areas).toContain('ttl download');
    expect(areas).toContain('password password');
  } else {
    expect(areas).toBe('ttl password download');
  }
});

test('ttl input selects its value on focus', async ({ page }) => {
  await page.goto('/');
  const ttl = page.getByTestId('ttl-input');
  await ttl.fill('12');
  await ttl.blur();
  const selectedOnFocus = await ttl.evaluate((el) => {
    let called = false;
    const original = el.select.bind(el);
    el.select = () => {
      called = true;
      original();
    };
    el.dispatchEvent(new FocusEvent('focus'));
    return called;
  });
  expect(selectedOnFocus).toBe(true);
});

test('password field shows a right-aligned lock icon', async ({ page }) => {
  await page.goto('/');
  const wrap = page.locator('.input-with-icon');
  await expect(wrap.getByTestId('password-input')).toBeVisible();
  await expect(wrap.locator('.field-icon svg')).toBeVisible();
});
