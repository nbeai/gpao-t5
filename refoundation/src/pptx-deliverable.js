import { randomUUID } from 'node:crypto';
import { chmod, lstat, readFile, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

import PptxGenJS from '@lofcz/pptxgenjs';
import { strFromU8, unzipSync } from 'fflate';

const MAX_SLIDES = 40; const MAX_TEXT = 20_000; const MAX_SPEC = 1_000_000;
const FONT = 'Apple SD Gothic Neo';
const unesc = (value) => String(value ?? '').replace(/&(?:amp|lt|gt|quot|apos);/gu, (v) => ({
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
})[v]);
const text = (value, label, optional = false) => {
  const result = String(value ?? '').trim();
  if ((!optional && !result) || result.length > MAX_TEXT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result)) {
    throw new TypeError(`PPTX ${label} is invalid`);
  }
  return result;
};
const color = (value, fallback) => /^[A-F0-9]{6}$/iu.test(String(value ?? ''))
  ? String(value).toUpperCase() : fallback;
const font = (value) => {
  const result = String(value ?? FONT).trim();
  if (!result || result.length > 100 || /[\u0000-\u001f<>]/u.test(result)) throw new TypeError('PPTX font is invalid');
  return result;
};
const source = (value) => {
  const result = text(value, 'source');
  if (result.length > 2_000) throw new TypeError('PPTX source is invalid');
  return result;
};

function validate(spec) {
  if (!spec || typeof spec !== 'object' || JSON.stringify(spec).length > MAX_SPEC
    || !Array.isArray(spec.slides) || !spec.slides.length || spec.slides.length > MAX_SLIDES) {
    throw new TypeError('PPTX spec is invalid');
  }
  const theme = { background: color(spec.theme?.background, 'F8FAFC'), text: color(spec.theme?.text, '0F172A'),
    accent: color(spec.theme?.accent, '2563EB'), muted: color(spec.theme?.muted, '475569'),
    fontFace: font(spec.theme?.fontFace) };
  const slides = spec.slides.map((slide, index) => {
    const title = text(slide?.title, `slide ${index + 1} title`);
    const subtitle = text(slide?.subtitle, `slide ${index + 1} subtitle`, true);
    const body = text(slide?.body, `slide ${index + 1} body`, true);
    const bullets = slide?.bullets ?? [];
    const sources = slide?.sources ?? [];
    if (!Array.isArray(bullets) || bullets.length > 12) throw new TypeError('PPTX bullets are invalid');
    if (!Array.isArray(sources) || sources.length > 12) throw new TypeError('PPTX sources are invalid');
    return { title, subtitle, body, bullets: bullets.map((item) => text(item, 'bullet')),
      sources: sources.map(source) };
  });
  return { title: text(spec.title ?? slides[0].title, 'document title'), subject: text(spec.subject, 'subject', true),
    author: text(spec.author ?? 'GPAO-T5', 'author'), theme, slides };
}

function addSlide(pptx, spec, index) {
  const { theme } = spec; const content = spec.slides[index]; const slide = pptx.addSlide();
  slide.background = { color: theme.background };
  slide.addText(content.title, { x: 0.7, y: 0.38, w: 11.9, h: 0.84, fontFace: theme.fontFace,
    fontSize: 36, bold: true, color: theme.text, margin: 0, breakLine: false, fit: 'shrink' });
  slide.addShape(pptx.ShapeType.rect, { x: 0.7, y: 1.42, w: 1.95, h: 0.07,
    fill: { color: theme.accent }, line: { color: theme.accent, transparency: 100 } });
  const runs = [];
  if (content.subtitle) runs.push({ text: content.subtitle, options: { color: theme.muted,
    fontSize: 17, breakLine: Boolean(content.body || content.bullets.length) } });
  if (content.body) runs.push({ text: content.body, options: { color: theme.text,
    fontSize: 19, breakLine: Boolean(content.bullets.length), paraSpaceAfterPt: 12 } });
  for (const [bulletIndex, bullet] of content.bullets.entries()) runs.push({ text: bullet,
    options: { color: theme.text, fontSize: 18, bullet: { indent: 18 },
      breakLine: bulletIndex < content.bullets.length - 1, paraSpaceAfterPt: 8 } });
  slide.addText(runs.length ? runs : ' ', { x: 0.75, y: 1.72, w: 11.75, h: 4.72,
    fontFace: theme.fontFace, fontSize: 18, color: theme.text, margin: 0.08, valign: 'top', breakLine: false,
    fit: 'shrink', isTextBox: true });
  slide.addText(String(index + 1), { x: 11.8, y: 7.02, w: 0.6, h: 0.2,
    fontFace: theme.fontFace, fontSize: 9, color: theme.muted, align: 'right', margin: 0 });
  if (content.sources.length) slide.addNotes(`[Sources]\n${content.sources.map((source) => `- ${source}`).join('\n')}`);
  return slide;
}

function slideObservation(xml, number, notesXml = '') {
  const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gu)].map((match) => unesc(match[1]));
  const shapes = [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/gu)].map((match) => {
    const body = match[1]; const off = /<a:off x="(\d+)" y="(\d+)"\/>/u.exec(body);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/u.exec(body);
    const localTexts = [...body.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gu)].map((item) => unesc(item[1]));
    const sizes = [...body.matchAll(/\bsz="(\d+)"/gu)].map((item) => Number(item[1]) / 100);
    const area = off && ext ? { x: Number(off[1]), y: Number(off[2]), width: Number(ext[1]), height: Number(ext[2]) } : null;
    const chars = localTexts.join('').length; const minSize = sizes.length ? Math.min(...sizes) : null;
    const capacity = area && minSize ? (area.width / 914400) * (area.height / 914400) * (900 / Math.max(10, minSize)) : null;
    return { texts: localTexts, area, fontSizesPt: [...new Set(sizes)], overflowCandidate: capacity != null && chars > capacity };
  });
  const notesText = [...notesXml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gu)].map((match) => unesc(match[1])).join('\n');
  return { number, texts, text: texts.join('\n'), shapes,
    sourceNotes: notesText.includes('[Sources]') ? notesText : '',
    overflowCandidates: shapes.filter((shape) => shape.overflowCandidate).length };
}

export function inspectPptxBytes(input) {
  const archive = unzipSync(new Uint8Array(input));
  if (!archive['ppt/presentation.xml']) throw new Error('PPTX presentation part is missing');
  const presentation = strFromU8(archive['ppt/presentation.xml']);
  const size = /<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/u.exec(presentation);
  const canvas = size ? { width: Number(size[1]), height: Number(size[2]) }
    : { width: 12_192_000, height: 6_858_000 };
  const names = Object.keys(archive).filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort((a, b) => Number(/\d+/u.exec(a)?.[0]) - Number(/\d+/u.exec(b)?.[0]));
  if (!names.length || names.length > MAX_SLIDES) throw new Error('PPTX slide count is invalid');
  const slides = names.map((name, index) => slideObservation(strFromU8(archive[name]), index + 1,
    archive[`ppt/notesSlides/notesSlide${index + 1}.xml`]
      ? strFromU8(archive[`ppt/notesSlides/notesSlide${index + 1}.xml`]) : ''));
  return { schema: 't5.pptx-observation.v1', format: 'pptx', medium: 'presentation_editable',
    editable: true, canvas, slideCount: slides.length, slides,
    totals: { texts: slides.reduce((sum, slide) => sum + slide.texts.length, 0),
      shapes: slides.reduce((sum, slide) => sum + slide.shapes.length, 0),
      overflowCandidates: slides.reduce((sum, slide) => sum + slide.overflowCandidates, 0),
      sourceTracedSlides: slides.filter((slide) => slide.sourceNotes).length },
    coverage: { slidesObserved: slides.length, complete: true } };
}

export async function inspectPptx(file) {
  if (!isAbsolute(file ?? '') || extname(file).toLowerCase() !== '.pptx') throw new TypeError('PPTX path is invalid');
  return inspectPptxBytes(await readFile(file));
}

export async function createPptxFromSpec({ output, spec, replace = false } = {}) {
  if (!isAbsolute(output ?? '') || extname(output).toLowerCase() !== '.pptx') throw new TypeError('output must end in .pptx');
  const target = join(await realpath(dirname(resolve(output))), basename(output));
  try { const stat = await lstat(target); if (!replace) throw new Error('output already exists');
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('output target is not replaceable');
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const validated = validate(spec); const temporary = join(dirname(target), `.${randomUUID()}.pptx`);
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; pptx.author = validated.author;
  pptx.subject = validated.subject; pptx.title = validated.title; pptx.company = 'GPAO-T5';
  pptx.compression = 'best';
  pptx.lang = 'ko-KR'; pptx.theme = { headFontFace: FONT, bodyFontFace: FONT, lang: 'ko-KR' };
  validated.slides.forEach((_, index) => addSlide(pptx, validated, index));
  try { await pptx.writeFile({ fileName: temporary }); await chmod(temporary, 0o600);
    await rename(temporary, target); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
  return { created: true, observation: await inspectPptx(target) };
}
