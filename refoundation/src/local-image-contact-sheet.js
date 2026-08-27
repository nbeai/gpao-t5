import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const TILE = 240; const LABEL = 32; const COLUMNS = 3; const MAX = 12;
function escapeXml(value) { return String(value).replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character])); }

export async function buildLocalImageContactSheet(items = []) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX) throw new TypeError('visual candidate count is invalid');
  const cells = [];
  for (const [index, item] of items.entries()) {
    const bytes = await readFile(item.path); if (bytes.length > 20 * 1024 * 1024) throw new Error('visual candidate exceeds byte limit');
    const image = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate()
      .resize(TILE, TILE, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
    const label = `C${index + 1}`; const svg = Buffer.from(`<svg width="${TILE}" height="${LABEL}"><rect width="100%" height="100%" fill="#111"/><text x="12" y="23" fill="#fff" font-family="sans-serif" font-size="18" font-weight="700">${escapeXml(label)}</text></svg>`);
    cells.push({ image, label, svg });
  }
  const rows = Math.ceil(cells.length / COLUMNS); const width = COLUMNS * TILE; const height = rows * (TILE + LABEL);
  const composites = [];
  for (const [index, cell] of cells.entries()) { const left = (index % COLUMNS) * TILE; const top = Math.floor(index / COLUMNS) * (TILE + LABEL);
    composites.push({ input: cell.image, left, top }, { input: cell.svg, left, top: top + TILE }); }
  const png = await sharp({ create: { width, height, channels: 4, background: '#ececec' } }).composite(composites).png().toBuffer();
  return { png, width, height, labels: cells.map((item) => item.label) };
}
