import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localizeEnglishRouteSegment } from './route-localization.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const I18N_DIR = path.join(SRC, 'i18n');
const SITE_ORIGIN = 'https://sorola.fi';
const SITE_ORIGIN_PATTERN = new RegExp(`${escapeRegExp(SITE_ORIGIN)}(?:/en)?(?:/[^"'\\s<]*)?`, 'g');
const TEXT_FILE_EXTENSIONS = new Set(['.html', '.js', '.xml', '.txt']);
const ROOT_ONLY_FILES = new Set(['_headers', 'robots.txt', 'sitemap.xml']);
const IGNORE_NAMES = new Set([
  'i18n'
]);
// data-i18n="key" → translate element text content by key
const DATA_I18N_PATTERN = /(<[^>]+\sdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/[a-z][a-z0-9]*>)/gi;
// data-i18n-attr-NAME="key" → translate attribute value by key
const DATA_I18N_ATTR_PATTERN = /\sdata-i18n-attr-([a-z-]+)="([^"]+)"/gi;
const ATTRIBUTE_PATTERN = /(placeholder|aria-label|content|title|alt)=(["'])(.*?)\2/gi;
const URL_ATTRIBUTE_PATTERN = /\b(href|src|action)=(["'])(.*?)\2/gi;

// Key-based translation tables: flat { key: translated_text }
const locales = {
  fi: JSON.parse(await fs.readFile(path.join(I18N_DIR, 'fi.json'), 'utf8')),
  en: JSON.parse(await fs.readFile(path.join(I18N_DIR, 'en.json'), 'utf8'))
};

// Translation metadata: norm_to_key (fi_norm → key), html_raw, js_raw page maps
const meta = JSON.parse(await fs.readFile(path.join(I18N_DIR, 'meta.json'), 'utf8'));

await fs.rm(DIST, { recursive: true, force: true });
await fs.mkdir(DIST, { recursive: true });

const siteFiles = await collectFiles(SRC);

for (const locale of ['fi', 'en']) {
  const baseDir = locale === 'fi' ? DIST : path.join(DIST, 'en');
  await fs.mkdir(baseDir, { recursive: true });

  for (const relativePath of siteFiles) {
    if (locale === 'en' && ROOT_ONLY_FILES.has(relativePath)) continue;
    await writeLocalizedFile(relativePath, locale, baseDir);
  }
}

await writeSitemap();

console.log('Built localized site to dist/');

async function collectFiles(startDir) {
  const results = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (IGNORE_NAMES.has(entry.name)) continue;
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(startDir, absolutePath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        results.push(relativePath);
      }
    }
  }

  await walk(startDir);
  return results.sort();
}

async function writeLocalizedFile(relativePath, locale, baseDir) {
  const sourcePath = path.join(SRC, relativePath);
  const targetPath = path.join(baseDir, localizeRelativePath(relativePath, locale));
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const extension = path.extname(relativePath).toLowerCase();
  if (!TEXT_FILE_EXTENSIONS.has(extension)) {
    await fs.copyFile(sourcePath, targetPath);
    return;
  }

  let content = await fs.readFile(sourcePath, 'utf8');

  if (extension === '.html') {
    content = localizeHtml(content, relativePath, locale);
  } else if (extension === '.js') {
    content = localizeJs(content, relativePath, locale);
  }

  await fs.writeFile(targetPath, content, 'utf8');
}

function localizeHtml(content, relativePath, locale) {
  const rules = getRules(relativePath, locale);
  let localized = translateHtmlStructure(content, rules);
  localized = translateDataI18nAttributes(localized, locale);
  localized = applyRawReplacements(localized, rules.raw);
  localized = rewriteDocumentUrls(localized, relativePath, locale);
  localized = setHtmlLanguage(localized, locale);
  localized = rewriteAbsoluteSiteUrls(localized, locale);
  localized = upsertCanonical(localized, relativePath, locale);
  localized = upsertOgUrl(localized, relativePath, locale);
  localized = upsertAlternateLinks(localized, relativePath);
  localized = injectLanguageOverlay(localized, relativePath, locale);
  return localized;
}

function localizeJs(content, relativePath, locale) {
  const rules = getRules(relativePath, locale);
  return applyRawReplacements(content, rules.raw);
}

/**
 * Build translation rules for a given page and locale.
 *
 * The translation JSON files use a flat key→value format (key-based system).
 * The metadata file (meta.json) provides:
 *   - norm_to_key: fi_norm → key  (for backward-compat text matching)
 *   - html_raw: page → { fi_exact → key }  (raw string replacements)
 *   - js_raw:   page → { fi_exact → key }  (raw JS string replacements)
 *
 * For each locale, the translated value is locales[locale][key].
 * Finnish (fi) is the source language; for the fi locale we return the fi
 * translation (which matches the source text, so no visible change).
 */
function getRules(relativePath, locale) {
  const translations = locales[locale];

  // Text / attribute rules: fi_norm → translated_text (via key lookup)
  const text = {};
  const attributes = {};
  for (const [fiNorm, key] of Object.entries(meta.norm_to_key)) {
    const translated = translations[key];
    if (translated !== undefined) {
      text[fiNorm] = translated;
      attributes[fiNorm] = translated;
    }
  }

  // Raw replacement rules: fi_exact → translated_exact (via key lookup)
  const raw = {};
  const commonRaw = meta.html_raw['__all__'] || {};
  const pageRaw = meta.html_raw[relativePath] || {};
  for (const [fiExact, key] of Object.entries({ ...commonRaw, ...pageRaw })) {
    const translated = translations[key];
    if (translated !== undefined) {
      raw[fiExact] = translated;
    }
  }
  // JS raw (used when localizeJs is called)
  const jsRaw = meta.js_raw[relativePath] || {};
  for (const [fiExact, key] of Object.entries(jsRaw)) {
    const translated = translations[key];
    if (translated !== undefined) {
      raw[fiExact] = translated;
    }
  }

  return { text, attributes, raw };
}

/**
 * Apply key-based translations to elements with data-i18n="key" (text content)
 * and data-i18n-attr-NAME="key" (attribute values).
 * These attributes are stripped from the output.
 */
function translateDataI18nAttributes(content, locale) {
  const translations = locales[locale];

  // Replace text content of elements with data-i18n="key"
  let result = content.replace(DATA_I18N_PATTERN, (match, openTag, key, innerContent, closeTag) => {
    const translated = translations[key];
    if (translated === undefined) return match;
    const cleanOpen = openTag.replace(/\s+data-i18n="[^"]*"/, '');
    // Preserve leading/trailing whitespace of the inner content
    const leading = innerContent.match(/^\s*/)[0];
    const trailing = innerContent.match(/\s*$/)[0];
    return `${cleanOpen}${leading}${translated}${trailing}${closeTag}`;
  });

  // Replace attribute values specified by data-i18n-attr-NAME="key"
  // Process tag by tag to correctly associate attributes
  result = result.replace(/<[a-z][^>]*data-i18n-attr-[a-z-]+="[^"]*"[^>]*>/gi, (tag) => {
    const attrKeyPairs = [];
    let attrMatch;
    DATA_I18N_ATTR_PATTERN.lastIndex = 0;
    while ((attrMatch = DATA_I18N_ATTR_PATTERN.exec(tag)) !== null) {
      attrKeyPairs.push({ attrName: attrMatch[1], key: attrMatch[2] });
    }
    if (attrKeyPairs.length === 0) return tag;

    // Strip all data-i18n-attr-* attributes
    let updated = tag.replace(/\s+data-i18n-attr-[a-z-]+="[^"]*"/gi, '');

    // Replace the actual attribute values
    for (const { attrName, key } of attrKeyPairs) {
      const translated = translations[key];
      if (translated === undefined) continue;
      const escapedName = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      updated = updated.replace(
        new RegExp(`(${escapedName}=)(["']).*?\\2`, 'i'),
        (m, prefix, quote) => `${prefix}${quote}${translated}${quote}`
      );
    }
    return updated;
  });

  return result;
}

function translateHtmlStructure(content, rules) {
  let output = '';
  let index = 0;
  let rawTag = null;
  const lowerContent = content.toLowerCase();

  while (index < content.length) {
    if (rawTag) {
      const closeTag = `</${rawTag}>`;
      const closeIndex = lowerContent.indexOf(closeTag, index);
      if (closeIndex === -1) {
        output += content.slice(index);
        break;
      }
      output += content.slice(index, closeIndex);
      output += content.slice(closeIndex, closeIndex + closeTag.length);
      index = closeIndex + closeTag.length;
      rawTag = null;
      continue;
    }

    const tagStart = content.indexOf('<', index);
    if (tagStart === -1) {
      output += translateTextSegment(content.slice(index), rules.text);
      break;
    }

    output += translateTextSegment(content.slice(index, tagStart), rules.text);
    const tagEnd = content.indexOf('>', tagStart);
    if (tagEnd === -1) {
      output += content.slice(tagStart);
      break;
    }

    let tag = content.slice(tagStart, tagEnd + 1);
    tag = tag.replace(ATTRIBUTE_PATTERN, (match, name, quote, value) => {
      const translated = translateLookup(value, rules.attributes);
      return `${name}=${quote}${translated}${quote}`;
    });

    const lowerTag = tag.toLowerCase();
    if (/^<script\b/.test(lowerTag)) rawTag = 'script';
    if (/^<style\b/.test(lowerTag)) rawTag = 'style';

    output += tag;
    index = tagEnd + 1;
  }

  return output;
}

function translateTextSegment(segment, translations) {
  const normalized = normalizeWhitespace(segment);
  if (!normalized) return segment;
  const translated = translations[normalized];
  if (!translated) return segment;
  const leading = segment.match(/^\s*/)?.[0] || '';
  const trailing = segment.match(/\s*$/)?.[0] || '';
  return `${leading}${translated}${trailing}`;
}

function translateLookup(value, translations) {
  const normalized = normalizeWhitespace(value);
  return translations[normalized] || value;
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function applyRawReplacements(content, replacements = {}) {
  const entries = Object.entries(replacements).sort((a, b) => b[0].length - a[0].length);
  let output = content;
  for (const [search, replace] of entries) {
    output = output.split(search).join(replace);
  }
  return output;
}

function setHtmlLanguage(content, locale) {
  if (/<html\b[^>]*lang=/i.test(content)) {
    return content.replace(/<html\b([^>]*)lang=["'][^"']*["']([^>]*)>/i, `<html$1lang="${locale}"$2>`);
  }
  return content.replace(/<html\b([^>]*)>/i, `<html$1 lang="${locale}">`);
}

function rewriteAbsoluteSiteUrls(content, locale) {
  return content.replace(SITE_ORIGIN_PATTERN, (match) => localizeAbsoluteUrl(match, locale));
}

function rewriteDocumentUrls(content, relativePath, locale) {
  if (locale !== 'en') return content;

  return content.replace(URL_ATTRIBUTE_PATTERN, (match, attribute, quote, value) => {
    const localized = localizeDocumentUrl(value, relativePath, locale);
    return `${attribute}=${quote}${localized}${quote}`;
  });
}

function localizeDocumentUrl(value, relativePath, locale) {
  if (
    !value ||
    value.startsWith('#') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:') ||
    value.startsWith('data:') ||
    value.startsWith('javascript:')
  ) {
    return value;
  }

  try {
    const baseUrl = new URL(`${SITE_ORIGIN}${sourceRelativeToWebPath(relativePath)}`);
    const parsed = new URL(value, baseUrl);
    if (parsed.origin !== SITE_ORIGIN) return value;
    if (parsed.pathname.startsWith('/api/') || parsed.pathname.startsWith('/functions/')) return value;
    if (parsed.pathname.startsWith('/tyylit/') || parsed.pathname.startsWith('/styles/')) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    parsed.pathname = localizeSitePathname(parsed.pathname, locale);

    if (/^https?:\/\//i.test(value)) {
      return parsed.toString();
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return value;
  }
}

function upsertCanonical(content, relativePath, locale) {
  const canonicalUrl = `${SITE_ORIGIN}${localizedWebPath(relativePath, locale)}`;
  const canonicalTag = `<link rel="canonical" href="${canonicalUrl}">`;
  if (/<link\s+rel=["']canonical["'][^>]*>/i.test(content)) {
    return content.replace(/<link\s+rel=["']canonical["'][^>]*>/i, canonicalTag);
  }
  return content.replace(/<head>/i, `<head>\n    ${canonicalTag}`);
}

function upsertOgUrl(content, relativePath, locale) {
  const ogUrl = `${SITE_ORIGIN}${localizedWebPath(relativePath, locale)}`;
  const ogTag = `<meta property="og:url" content="${ogUrl}">`;
  if (/<meta\s+property=["']og:url["'][^>]*>/i.test(content)) {
    return content.replace(/<meta\s+property=["']og:url["'][^>]*>/i, ogTag);
  }
  return content.replace(/<head>/i, `<head>\n    ${ogTag}`);
}

function upsertAlternateLinks(content, relativePath) {
  const fiHref = `${SITE_ORIGIN}${localizedWebPath(relativePath, 'fi')}`;
  const enHref = `${SITE_ORIGIN}${localizedWebPath(relativePath, 'en')}`;
  content = content.replace(/\n?\s*<link\s+rel=["']alternate["'][^>]*hreflang=["'][^"']+["'][^>]*>/gi, '');
  const alternate = `\n    <link rel="alternate" hreflang="fi" href="${fiHref}">\n    <link rel="alternate" hreflang="en" href="${enHref}">\n    <link rel="alternate" hreflang="x-default" href="${fiHref}">`;
  return content.replace(/(<link\s+rel="canonical"[^>]*>)/i, `$1${alternate}`);
}

function injectLanguageOverlay(content, relativePath, locale) {
  if (content.includes('language-overlay')) return content;
  const overlayLabel = locales[locale]['overlay.label'] || (locale === 'fi' ? 'Kieli' : 'Language');
  const fiHref = localizedWebPath(relativePath, 'fi');
  const enHref = localizedWebPath(relativePath, 'en');
  const overlay = `\n    <nav class="language-overlay" aria-label="${escapeHtml(overlayLabel)}">\n        <span class="language-overlay__label">${escapeHtml(overlayLabel)}</span>\n        <a class="language-overlay__link${locale === 'fi' ? ' is-active' : ''}" href="${fiHref}"${locale === 'fi' ? ' aria-current="page"' : ''}>🇫🇮</a>\n        <a class="language-overlay__link${locale === 'en' ? ' is-active' : ''}" href="${enHref}"${locale === 'en' ? ' aria-current="page"' : ''}>🇬🇧</a>\n    </nav>`;
  const style = `\n    <style>\n        .language-overlay { position: fixed; top: 16px; left: 16px; z-index: 10001; display: inline-flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 999px; border: 1px solid rgba(255, 170, 0, 0.35); background: rgba(11, 13, 19, 0.92); box-shadow: 0 10px 25px rgba(0, 0, 0, 0.35); backdrop-filter: blur(8px); }\n        .language-overlay__label { color: #cbd5e1; font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }\n        .language-overlay__link { display: inline-flex; align-items: center; justify-content: center; min-width: 42px; padding: 8px 12px; border-radius: 999px; border: 1px solid #334155; color: #f8fafc; text-decoration: none; font-weight: 700; font-size: 0.9rem; transition: all 0.2s ease; }\n        .language-overlay__link:hover, .language-overlay__link:focus-visible { border-color: #ffaa00; color: #ffaa00; outline: none; }\n        .language-overlay__link.is-active { background: #ffaa00; color: #111827; border-color: #ffaa00; }\n        @media (max-width: 768px) { .language-overlay { top: auto; bottom: 12px; left: 12px; right: 12px; justify-content: center; } }\n    </style>`;
  content = content.replace(/<\/head>/i, `${style}\n</head>`);
  return content.replace(/<body([^>]*)>/i, `<body$1>${overlay}`);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function localizedWebPath(relativePath, locale) {
  const basePath = sourceRelativeToWebPath(localizeRelativePath(relativePath, locale));
  if (locale === 'en') {
    return basePath === '/' ? '/en/' : `/en${basePath}`;
  }
  return basePath;
}

function sourceRelativeToWebPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized === 'index.html') return '/';
  if (normalized.endsWith('/index.html')) return `/${normalized.slice(0, -'index.html'.length)}`;
  if (normalized.endsWith('.html')) return `/${normalized.slice(0, -'.html'.length)}`;
  return `/${normalized}`;
}

function localizeAbsoluteUrl(url, locale) {
  const parsed = new URL(url);
  if (parsed.pathname.startsWith('/api/') || parsed.pathname.startsWith('/functions/')) {
    return url;
  }

  parsed.pathname = localizeSitePathname(parsed.pathname, locale);
  return parsed.toString();
}

function localizeRelativePath(relativePath, locale) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (locale !== 'en') return normalized;
  return normalized
    .split('/')
    .map((segment) => localizeEnglishRouteSegment(segment))
    .join('/');
}

function localizeSitePathname(pathname, locale) {
  const normalized = stripEnglishPrefix(pathname);
  const trailingSlash = normalized.endsWith('/');
  const localizedSegments = normalized
    .split('/')
    .filter(Boolean)
    .map((segment) => (locale === 'en' ? localizeEnglishRouteSegment(segment) : segment));

  let localizedPath = localizedSegments.length ? `/${localizedSegments.join('/')}` : '/';
  if (trailingSlash && localizedPath !== '/' && !localizedPath.endsWith('/')) {
    localizedPath += '/';
  }

  if (locale === 'en') {
    return localizedPath === '/' ? '/en/' : `/en${localizedPath}`;
  }

  return localizedPath;
}

function stripEnglishPrefix(pathname) {
  if (pathname === '/en') return '/';
  if (pathname.startsWith('/en/')) return pathname.slice(3);
  return pathname;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeSitemap() {
  const sitemapPath = path.join(SRC, 'sitemap.xml');
  const source = await fs.readFile(sitemapPath, 'utf8');
  const blocks = source.match(/<url>[\s\S]*?<\/url>/g) || [];
  const output = [];

  for (const block of blocks) {
    const locMatch = block.match(/<loc>(.*?)<\/loc>/);
    if (!locMatch) continue;
    const fiLoc = locMatch[1];
    const enLoc = localizeAbsoluteUrl(fiLoc, 'en');

    output.push(addAlternatesToSitemapBlock(block, fiLoc, enLoc));
    output.push(addAlternatesToSitemapBlock(block.replace(fiLoc, enLoc), fiLoc, enLoc));
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${output.join('\n')}\n</urlset>\n`;
  await fs.writeFile(path.join(DIST, 'sitemap.xml'), sitemap, 'utf8');
}

function addAlternatesToSitemapBlock(block, fiLoc, enLoc) {
  return block.replace(/<loc>.*?<\/loc>/, `$&\n      <xhtml:link rel="alternate" hreflang="fi" href="${fiLoc}" />\n      <xhtml:link rel="alternate" hreflang="en" href="${enLoc}" />`);
}
