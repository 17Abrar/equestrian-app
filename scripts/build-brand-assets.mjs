import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, '..');

const NAVY = '#0d1f34';
const OFF_WHITE = '#f7f3ec';

const svgDir = join(repo, 'brand/svg');
const webApp = join(repo, 'apps/web/app');
const webBrand = join(repo, 'apps/web/public/brand');
const mobileAssets = join(repo, 'apps/mobile/assets');
const mobileBrand = join(repo, 'apps/mobile/assets/brand');

async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

async function rasterizeSvg(svgPath, density = 300) {
  const svg = await readFile(svgPath);
  return sharp(svg, { density, limitInputPixels: false })
    .trim()
    .toBuffer({ resolveWithObject: true });
}

async function markOnSolid({ size, padFrac, bg, useDark, outPath }) {
  const svgPath = join(svgDir, useDark ? 'cavaliq-mark-dark.svg' : 'cavaliq-mark.svg');
  const inner = Math.round(size * (1 - padFrac * 2));
  const { data: mark } = await rasterizeSvg(svgPath);
  const resized = await sharp(mark)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: bg },
  })
    .composite([{ input: resized, gravity: 'center' }])
    .png()
    .toFile(outPath);
  console.log('  ✓', outPath.replace(repo + '/', ''));
}

async function lockupOnSolid({ width, height, bg, useDark, outPath }) {
  const svgPath = join(svgDir, useDark ? 'cavaliq-logo-dark.svg' : 'cavaliq-logo.svg');
  const innerW = Math.round(width * 0.7);
  const innerH = Math.round(height * 0.55);
  const { data: lockup } = await rasterizeSvg(svgPath);
  const resized = await sharp(lockup)
    .resize(innerW, innerH, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  await sharp({
    create: { width, height, channels: 4, background: bg },
  })
    .composite([{ input: resized, gravity: 'center' }])
    .png()
    .toFile(outPath);
  console.log('  ✓', outPath.replace(repo + '/', ''));
}

async function transparentMark({ size, useDark = false, outPath }) {
  const svgPath = join(svgDir, useDark ? 'cavaliq-mark-dark.svg' : 'cavaliq-mark.svg');
  const { data: mark } = await rasterizeSvg(svgPath);
  await sharp(mark)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);
  console.log('  ✓', outPath.replace(repo + '/', ''));
}

/** Tight-cropped lockup PNG (no whitespace) for inline use in headers. */
async function trimmedLockup({ height, useDark = false, outPath }) {
  const svgPath = join(svgDir, useDark ? 'cavaliq-logo-dark.svg' : 'cavaliq-logo.svg');
  const { data } = await rasterizeSvg(svgPath, 300);
  await sharp(data, { limitInputPixels: false })
    .resize({ height, withoutEnlargement: false })
    .png()
    .toFile(outPath);
  console.log('  ✓', outPath.replace(repo + '/', ''));
}

/** Tight-cropped wordmark PNG for inline use. */
async function trimmedWordmark({ height, useDark = false, outPath }) {
  const svgPath = join(svgDir, useDark ? 'cavaliq-wordmark-dark.svg' : 'cavaliq-wordmark.svg');
  const { data } = await rasterizeSvg(svgPath, 300);
  await sharp(data, { limitInputPixels: false })
    .resize({ height, withoutEnlargement: false })
    .png()
    .toFile(outPath);
  console.log('  ✓', outPath.replace(repo + '/', ''));
}

async function main() {
  await ensureDir(webApp);
  await ensureDir(webBrand);
  await ensureDir(mobileAssets);

  console.log('Trimmed inline-display PNGs (apps/web/public/brand):');
  // Retina-friendly trimmed lockup PNGs for use in headers/sidebar at ~32-64px display height
  await trimmedLockup({ height: 256, useDark: false, outPath: join(webBrand, 'cavaliq-logo-trimmed.png') });
  await trimmedLockup({ height: 256, useDark: true, outPath: join(webBrand, 'cavaliq-logo-dark-trimmed.png') });
  await trimmedWordmark({ height: 256, useDark: false, outPath: join(webBrand, 'cavaliq-wordmark-trimmed.png') });
  await trimmedWordmark({ height: 256, useDark: true, outPath: join(webBrand, 'cavaliq-wordmark-dark-trimmed.png') });

  console.log('\nWeb app icons (Next.js conventions):');
  // Favicon: light mark (navy on transparent) — works on light browser chrome
  await transparentMark({ size: 32, outPath: join(webApp, 'icon.png') });
  // Apple touch icon: white+gold mark on navy bg — Apple requires opaque
  await markOnSolid({ size: 180, padFrac: 0.14, bg: NAVY, useDark: true, outPath: join(webApp, 'apple-icon.png') });
  // OG/Twitter card: full light lockup centered on off-white — premium feel
  await lockupOnSolid({ width: 1200, height: 630, bg: OFF_WHITE, useDark: false, outPath: join(webApp, 'opengraph-image.png') });
  await lockupOnSolid({ width: 1200, height: 630, bg: OFF_WHITE, useDark: false, outPath: join(webApp, 'twitter-image.png') });

  console.log('\nMobile assets:');
  // iOS app icon: white+gold mark on navy (Apple requires opaque, no transparency)
  await markOnSolid({ size: 1024, padFrac: 0.18, bg: NAVY, useDark: true, outPath: join(mobileAssets, 'icon.png') });
  // Android adaptive foreground: white+gold mark on transparent (bg color set in app.json)
  await transparentMark({ size: 1024, useDark: true, outPath: join(mobileAssets, 'adaptive-icon.png') });
  // Splash: white+gold mark on transparent (sits on navy splash bg defined in app.json)
  await transparentMark({ size: 1024, useDark: true, outPath: join(mobileAssets, 'splash-icon.png') });

  console.log('\nMobile inline brand (for in-app screens):');
  await ensureDir(mobileBrand);
  // Light lockup for use on white screens (auth, onboarding)
  await trimmedLockup({ height: 256, useDark: false, outPath: join(mobileBrand, 'cavaliq-logo.png') });
  await trimmedLockup({ height: 256, useDark: true, outPath: join(mobileBrand, 'cavaliq-logo-dark.png') });
  // Light mark for tight spaces (header bars, badges)
  await transparentMark({ size: 256, useDark: false, outPath: join(mobileBrand, 'cavaliq-mark.png') });
  await transparentMark({ size: 256, useDark: true, outPath: join(mobileBrand, 'cavaliq-mark-dark.png') });

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
