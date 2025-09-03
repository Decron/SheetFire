#!/usr/bin/env node
/*
 * Switch the Apps Script manifest between base and add-on modes.
 *
 * Usage:
 *   node scripts/switch-manifest.js base
 *   node scripts/switch-manifest.js addon [--name "Your Name"] [--logo "https://.../logo.png"]
 */
const fs = require('fs');
const path = require('path');

const mode = process.argv[2];
if (!mode || !['base', 'addon'].includes(mode)) {
  console.error('Usage: node scripts/switch-manifest.js <base|addon> [--name <name>] [--logo <url>]');
  process.exit(1);
}

// Parse optional flags for addon
const args = new Map();
for (let i = 3; i < process.argv.length; i += 2) {
  const k = process.argv[i];
  const v = process.argv[i + 1];
  if (!k || !k.startsWith('--')) break;
  args.set(k.slice(2), v);
}

const appsScriptDir = path.join(__dirname, '..', 'apps-script');
const targetPath = path.join(appsScriptDir, 'appsscript.json');

if (mode === 'base') {
  const src = path.join(appsScriptDir, 'manifest.base.json');
  fs.copyFileSync(src, targetPath);
  console.log('Wrote', path.relative(process.cwd(), targetPath), 'in base mode');
  process.exit(0);
}

// addon mode: load template and substitute simple tokens ${ADDON_NAME:-...} and ${ADDON_LOGO_URL:-...}
const tplPath = path.join(appsScriptDir, 'manifest.addon.json');
let tpl = fs.readFileSync(tplPath, 'utf8');
const name = args.get('name') || process.env.ADDON_NAME || 'SheetFire';
const logo = args.get('logo') || process.env.ADDON_LOGO_URL || 'https://example.com/logo.png';

tpl = tpl.replace(/\$\{ADDON_NAME:-[^}]+\}/g, name)
         .replace(/\$\{ADDON_LOGO_URL:-[^}]+\}/g, logo);

fs.writeFileSync(targetPath, tpl);
console.log('Wrote', path.relative(process.cwd(), targetPath), 'in addon mode with name="' + name + '" logo="' + logo + '"');

