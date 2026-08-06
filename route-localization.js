import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_JSON_PATH = path.join(__dirname, 'src', 'i18n', 'routes.json');

const _routes = JSON.parse(fs.readFileSync(ROUTES_JSON_PATH, 'utf8'));
export const EN_ROUTE_SEGMENTS = new Map(Object.entries(_routes));

export function localizeEnglishRouteSegment(segment) {
  const hasHtmlExtension = segment.endsWith('.html');
  const baseSegment = hasHtmlExtension ? segment.slice(0, -'.html'.length) : segment;
  const translatedSegment = EN_ROUTE_SEGMENTS.get(baseSegment);

  if (!translatedSegment) {
    return segment;
  }

  return hasHtmlExtension ? `${translatedSegment}.html` : translatedSegment;
}
