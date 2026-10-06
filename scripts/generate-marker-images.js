#!/usr/bin/env node
/**
 * 본문 [IMAGE: 설명] 마커마다 이미지를 생성하고 post.html의 마커 자리에 삽입합니다.
 * Nano Banana Pro (Gemini 3 Pro Image) — generate-images.js의 브랜드 스타일/호출 함수 재사용.
 *
 * Usage:
 *   GEMINI_API_KEY=xxx node scripts/generate-marker-images.js --folder "output/폴더" [--force]
 *
 * 결과:
 *   <folder>/images/marker-01.png, marker-02.png ...  (마커 순서대로)
 *   <folder>/images/markers.json                      (마커 설명 ↔ 파일 매핑)
 *   <folder>/post.html                                (마커 → <img> 치환)
 *
 * post.md의 [IMAGE:] 마커는 그대로 둡니다 (품질검사·유사도검사 기준 원본).
 * 이미 생성된 이미지는 건너뜀 (--force 시 재생성).
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { BRAND_STYLE, generateOne } from './generate-images.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

const MARKER_RE = /\[IMAGE:\s*([^\]]+?)\s*\]/g;

const exists = (p) => access(p).then(() => true, () => false);

const escapeHtmlAttr = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const unescapeHtml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

function markerPrompt({ description, title, keyword }) {
  return [
    `Create a 4:3 Korean blog body image that visually explains: "${description}"`,
    `Context — this image sits inside a blog post titled "${title}" (topic: ${keyword}).`,
    `If the description is a screen (화면), draw a clean simplified UI mockup / wireframe of that screen, not a real screenshot.`,
    `If it is a comparison, structure or process, draw it as a clear schematic diagram.`,
    `The only readable text in the image is a short caption at the top: "${description}". Any other UI labels must be abstract bars or placeholders, not words.`,
    BRAND_STYLE,
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const folder = args.folder;
  if (!folder) {
    console.error('Usage: --folder <output/폴더> [--force]');
    process.exit(2);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY environment variable is required.');
    process.exit(1);
  }

  const htmlPath = join(folder, 'post.html');
  const mdPath = join(folder, 'post.md');
  const html = (await exists(htmlPath)) ? await readFile(htmlPath, 'utf8') : null;
  const md = await readFile(mdPath, 'utf8');

  let meta = {};
  try {
    meta = JSON.parse(await readFile(join(folder, 'metadata.json'), 'utf8'));
  } catch {}
  const h1 = md.match(/^#\s+(.+)$/m);
  const title = meta.title || (h1 ? h1[1].trim() : '');
  const keyword = meta.keyword || title;

  // post.md 마커가 기준 (post.html은 이미 치환됐을 수 있음)
  const descriptions = [...md.matchAll(MARKER_RE)].map((m) => m[1]);
  if (!descriptions.length) {
    console.log('마커 없음 — 건너뜀');
    return;
  }

  const imgDir = join(folder, 'images');
  await mkdir(imgDir, { recursive: true });

  const mapping = [];
  let generated = 0;
  const errors = [];
  for (let i = 0; i < descriptions.length; i++) {
    const description = descriptions[i];
    const file = `marker-${String(i + 1).padStart(2, '0')}.png`;
    const path = join(imgDir, file);
    mapping.push({ marker: description, file });
    if (!args.force && (await exists(path))) {
      console.log(`  - ${file} 이미 있음 (건너뜀)`);
      continue;
    }
    try {
      console.log(`[generate] ${file} — ${description}`);
      const buf = await generateOne(markerPrompt({ description, title, keyword }));
      await writeFile(path, buf);
      console.log(`  ✓ ${path} (${buf.length} bytes)`);
      generated++;
    } catch (e) {
      console.error(`  ✗ ${file}: ${e.message}`);
      errors.push(file);
    }
  }

  await writeFile(join(imgDir, 'markers.json'), JSON.stringify(mapping, null, 2) + '\n');

  // post.html 마커 → <img> 치환 (설명 텍스트로 매칭, 이미지 파일이 있는 것만)
  if (html) {
    let replaced = 0;
    const out = html.replace(MARKER_RE, (whole, desc) => {
      const hit = mapping.find((m) => m.marker === unescapeHtml(desc) && !errors.includes(m.file));
      if (!hit) return whole;
      replaced++;
      return `<img src="images/${hit.file}" alt="${escapeHtmlAttr(hit.marker)}" />`;
    });
    if (replaced) await writeFile(htmlPath, out);
    console.log(`post.html 마커 ${replaced}개를 이미지로 치환`);
  }

  console.log(`\nDone: 새로 생성 ${generated}장 / 마커 ${descriptions.length}개 / 실패 ${errors.length}건`);
  if (errors.length) process.exit(1);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
