import { test, expect } from '@playwright/test';
import { crc32, gzipSync } from 'node:zlib';

function makeStoredZip(filename, contents) {
  const name = Buffer.from(filename);
  const data = Buffer.from(contents);
  const crc = crc32(data) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const localPart = Buffer.concat([local, name, data]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(localPart.length, 42);
  const centralPart = Buffer.concat([central, name]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralPart.length, 12);
  end.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, end]);
}

function makeTar(filename, contents) {
  const data = Buffer.from(contents);
  const header = Buffer.alloc(512);
  Buffer.from(filename).copy(header, 0);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(padded);
  return Buffer.concat([header, padded, Buffer.alloc(1024)]);
}

const zip = makeStoredZip('hello.txt', 'hello from zip');
const tar = makeTar('hello.txt', 'hello from tar');
const tarGz = gzipSync(tar);
const plainGz = gzipSync(Buffer.from('hello from gzip'));

const archives = [
  { name: 'notes.zip', mimeType: 'application/zip', buffer: zip, mime: 'application/zip' },
  { name: 'notes.7z', mimeType: 'application/x-7z-compressed', buffer: Buffer.from([0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]), mime: 'application/x-7z-compressed' },
  { name: 'notes.tar.gz', mimeType: 'application/gzip', buffer: tarGz, mime: 'application/gzip' },
  { name: 'notes.tgz', mimeType: 'application/gzip', buffer: tarGz, mime: 'application/gzip' },
  { name: 'notes.gz', mimeType: 'application/gzip', buffer: plainGz, mime: 'application/gzip' },
  { name: 'notes.tar', mimeType: 'application/x-tar', buffer: tar, mime: 'application/x-tar' },
  { name: 'notes.tar.bz2', mimeType: 'application/x-bzip2', buffer: Buffer.from('BZh91AY&SY'), mime: 'application/x-bzip2' },
  { name: 'notes.tar.xz', mimeType: 'application/x-xz', buffer: Buffer.from([0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00]), mime: 'application/x-xz' },
  { name: 'notes.rar', mimeType: 'application/x-rar-compressed', buffer: Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00]), mime: 'application/x-rar-compressed' },
  { name: 'notes.zst', mimeType: 'application/zstd', buffer: Buffer.from([0x28, 0xB5, 0x2F, 0xFD]), mime: 'application/zstd' },
  { name: 'not-a-photo.png', mimeType: 'image/png', buffer: zip, mime: 'application/zip' }
];

test('accepts compressed archives and downloads the original bytes', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(archives.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer })));
  await expect(page.getByTestId('selected-file-item')).toHaveCount(archives.length);
  await page.getByTestId('stash-name-input').fill('Archive stash');
  await page.getByTestId('ttl-input').fill('1');
  await page.getByTestId('stash-button').click();
  await expect(page.getByTestId('result-card')).toBeVisible();
  const shareUrl = await page.getByTestId('share-url').inputValue();

  await page.goto(shareUrl);
  await expect(page.locator('#fileName')).toHaveText('Archive stash');
  await expect(page.getByTestId('archive-placeholder')).toBeVisible();
  await expect(page.getByTestId('archive-placeholder')).toContainText('Archive ready');
  await expect(page.getByTestId('media-preview')).toHaveCount(0);

  const rows = page.getByTestId('stash-file-row');
  await expect(rows).toHaveCount(archives.length);
  for (const archive of archives) {
    const namePattern = new RegExp(`^${archive.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    await rows.filter({ has: page.locator('.stash-file-name', { hasText: namePattern }) }).click();
    await expect(page.getByTestId('archive-placeholder')).toBeVisible();
    await expect(page.locator('[data-testid="media-preview"]')).toHaveCount(0);
  }

  const shareId = new URL(shareUrl).pathname.split('/').filter(Boolean).at(-1);
  const metaResponse = await page.request.get(new URL(`../api/shares/${shareId}`, shareUrl).href);
  expect(metaResponse.status()).toBe(200);
  const meta = await metaResponse.json();

  for (const archive of archives) {
    const file = meta.files.find((entry) => entry.originalName === archive.name);
    expect(file, archive.name).toBeTruthy();
    expect(file.mime).toBe(archive.mime);
    const response = await page.request.get(new URL(`${file.contentUrl}?download=1`, shareUrl).href);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain(archive.mime);
    expect(response.headers()['content-disposition']).toContain('attachment');
    expect(decodeURIComponent(response.headers()['content-disposition'])).toContain(archive.name);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(await response.body(), archive.buffer)).toBe(0);
  }
});

test('preview-only archive stays on the placeholder and rejects attachment requests', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'notes.zip',
    mimeType: 'application/zip',
    buffer: zip
  });
  await page.getByTestId('ttl-input').fill('1');
  await page.getByTestId('allow-download').uncheck();
  await page.getByTestId('stash-button').click();
  await expect(page.getByTestId('result-card')).toBeVisible();
  const shareUrl = await page.getByTestId('share-url').inputValue();

  await page.goto(shareUrl);
  await expect(page.getByTestId('preview-only-pill')).toBeVisible();
  await expect(page.getByTestId('download-button')).toBeHidden();
  await expect(page.getByTestId('archive-placeholder')).toContainText('downloads are disabled');

  const shareId = new URL(shareUrl).pathname.split('/').filter(Boolean).at(-1);
  const meta = await (await page.request.get(new URL(`../api/shares/${shareId}`, shareUrl).href)).json();
  const downloadResponse = await page.request.get(new URL(`${meta.files[0].contentUrl}?download=1`, shareUrl).href);
  expect(downloadResponse.status()).toBe(403);
});
