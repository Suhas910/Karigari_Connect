#!/usr/bin/env node

/**
 * Checks translation files for gaps that i18next would otherwise hide by
 * silently falling back to English:
 *  1. every key in en.json exists in each other locale (and no extra keys)
 *  2. {{placeholders}} match between en and each other locale
 *  3. every literal t('some.key') used in src/ exists in en.json
 * Exits with code 1 if any problem is found.
 */

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const localesDir = path.join(root, "src", "i18n", "locales");
const srcDir = path.join(root, "src");
const BASE = "en";

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") flatten(value, full, out);
    else out[full] = String(value);
  }
  return out;
}

function placeholders(str) {
  return [...str.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort().join(",");
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const locales = Object.fromEntries(
  fs
    .readdirSync(localesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [path.basename(f, ".json"), flatten(JSON.parse(fs.readFileSync(path.join(localesDir, f), "utf8")))])
);

const base = locales[BASE];
const problems = [];

for (const [lang, keys] of Object.entries(locales)) {
  if (lang === BASE) continue;
  for (const key of Object.keys(base)) {
    if (!(key in keys)) problems.push(`[${lang}] missing key: ${key}`);
    else if (placeholders(base[key]) !== placeholders(keys[key]))
      problems.push(`[${lang}] placeholder mismatch in ${key}: en has {${placeholders(base[key])}}, ${lang} has {${placeholders(keys[key])}}`);
  }
  for (const key of Object.keys(keys)) {
    if (!(key in base)) problems.push(`[${lang}] extra key not in ${BASE}.json: ${key}`);
  }
}

// Only literal keys can be checked; dynamic keys like t(`listingState.${state}`) are skipped.
const usedKeys = new Map();
for (const file of walk(srcDir)) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/\bt\(\s*["']([\w.-]+)["']/g)) {
    if (!usedKeys.has(m[1])) usedKeys.set(m[1], path.relative(root, file));
  }
  // Keys stored in constants, e.g. labelKey: 'submit.checklist.catalogue'
  for (const m of text.matchAll(/["']((?:[a-zA-Z]+\.){1,}[a-zA-Z_]+)["']/g)) {
    const key = m[1];
    const namespace = key.split(".")[0];
    if (Object.keys(base).some((k) => k.startsWith(`${namespace}.`)) && !usedKeys.has(key)) {
      usedKeys.set(key, path.relative(root, file));
    }
  }
}
for (const [key, file] of usedKeys) {
  const isParent = Object.keys(base).some((k) => k.startsWith(`${key}.`));
  if (!(key in base) && !isParent) problems.push(`[code] ${file} uses missing key: ${key}`);
}

const langs = Object.keys(locales).join(", ");
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n✖ ${problems.length} i18n problem(s) across ${langs}`);
  process.exit(1);
}
console.log(`✔ ${Object.keys(base).length} keys consistent across ${langs}; ${usedKeys.size} referenced keys found`);
