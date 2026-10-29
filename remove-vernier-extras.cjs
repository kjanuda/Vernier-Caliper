// Run from the root of the Vernier Caliper Next.js project: node remove-vernier-extras.cjs
// Removes only the listed legacy author/site navigation/footer/article-link UI.
// Leaves the 2D/3D engine, CSS, simulation controls and other page content intact.
const fs = require('node:fs');
const path = require('node:path');

const htmlPath = path.resolve('public/tools/vernier-caliper/simulator.html');
const relatedPath = path.resolve('public/shared/related.js');

for (const file of [htmlPath, relatedPath]) {
  if (!fs.existsSync(file)) {
    console.error(`Missing ${file}\nRun this script in the vernier-nextjs project root.`);
    process.exit(1);
  }
}

const originals = [fs.readFileSync(htmlPath, 'utf8'), fs.readFileSync(relatedPath, 'utf8')];
let [html, related] = originals;

function exactlyOne(text, pattern, replacement, label) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${label}: expected exactly 1 block, found ${matches.length}. No files were changed.`);
  }
  return text.replace(pattern, replacement);
}

try {
  html = exactlyOne(html,
    /<!-- Fixed brand logo[^>]*-->\s*<a class="logo-fixed"[^>]*>[\s\S]*?<\/a>\s*/g,
    '', 'Fixed brand logo');
  html = exactlyOne(html,
    /<!-- Site nav -->[\s\S]*?(?=<header>)/g,
    '', 'Home / Library / Measuring Instruments navigation');
  html = exactlyOne(html,
    /<!--[^>]*Author byline[^>]*-->\s*<aside aria-label="About the author" class="author-byline">[\s\S]*?<\/aside>\s*/g,
    '', 'Author photo and written/reviewed byline');
  html = exactlyOne(html,
    /<h3>Explore Related Simulators<\/h3>[\s\S]*?<p class="page-updated"[^>]*>[\s\S]*?<\/p>\s*/g,
    '', 'Explore Related Simulators and updated date');
  html = exactlyOne(html,
    /<!--[^>]*Site Footer[^>]*-->\s*<footer class="site-footer">[\s\S]*?<\/footer>\s*/g,
    '', 'Site footer with Home / About / Privacy / Terms / Contact / copyright');
  html = exactlyOne(html,
    /<main id="app">/g,
    '<main id="app" data-hide-free-note="1">', 'Page-specific note flag');

  // Keep the existing Related Simulators cards, Share bar, Continue Learning,
  // and all other related.js features. Only disable the extra footer note.
  // Disable only its "Free to use" note for this one page.
  related = exactlyOne(related,
    /if \(seoArticle\) \{/g,
    "if (seoArticle && !(app && app.hasAttribute('data-hide-free-note'))) {",
    'Free-to-use note injection');

  // Make backups before changing either file.
  for (const [file, oldText] of [[htmlPath, originals[0]], [relatedPath, originals[1]]]) {
    const backupPath = file + '.before-ui-removal.bak';
    if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, oldText, 'utf8');
  }
  fs.writeFileSync(htmlPath, html, 'utf8');
  fs.writeFileSync(relatedPath, related, 'utf8');
  console.log('Done: requested author, navigation, article links, updated date, and footer UI removed.');
  console.log('Simulator logic, CSS, Related Simulators cards, Share bar, Continue Learning left unchanged.');
  console.log('Backups: *.before-ui-removal.bak');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
