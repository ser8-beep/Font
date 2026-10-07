// Turns dist-artifact/index.html into the body-only page the claude.ai Artifact tool publishes
// (the tool adds its own doctype/head/body), from `vite build --mode artifact`, and copies the letter
// pictures to dist-artifact/atlases/ to publish beside it (Artifact tool `files`).
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-artifact/index.html', 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const headEnd = html.indexOf('</head>');
const styleStart = html.lastIndexOf('<style', headEnd);
const styleEnd = html.lastIndexOf('</style>', headEnd);
const css = html.slice(html.indexOf('>', styleStart) + 1, styleEnd);
const scriptStart = html.indexOf('<script type="module"');
const scriptEnd = html.lastIndexOf('</script>', styleStart);
const js = html.slice(html.indexOf('>', scriptStart) + 1, scriptEnd);
if (scriptStart < 0 || scriptStart > styleStart || !css || !js) throw new Error('Unexpected dist-artifact/index.html layout');

writeFileSync(
  'dist-artifact/artifact.html',
  `${title}\n<style>${css}</style>\n<div id="root"></div>\n<script type="module">${js}</script>\n`,
);
rmSync('dist-artifact/atlases', { recursive: true, force: true });
cpSync('src/library/atlases', 'dist-artifact/atlases', { recursive: true });
console.log('wrote dist-artifact/artifact.html and dist-artifact/atlases/');
