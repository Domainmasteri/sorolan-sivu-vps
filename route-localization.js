export const EN_ROUTE_SEGMENTS = new Map([
  ['ansioluettelot', 'resume'],
  ['cv-make', 'cv-builder'],
  ['hakemus-it', 'it-application'],
  ['hakemus-jakelu', 'delivery-application'],
  ['hakemus-make', 'application-builder'],
  ['jako', 'share'],
  ['linkinlyhennin', 'link-shortener'],
  ['lyhennin', 'shortener'],
  ['ohjeet', 'guides'],
  ['salasanat', 'passwords'],
  ['vieraskirja', 'guestbook']
]);

export function localizeEnglishRouteSegment(segment) {
  const hasHtmlExtension = segment.endsWith('.html');
  const baseSegment = hasHtmlExtension ? segment.slice(0, -'.html'.length) : segment;
  const translatedSegment = EN_ROUTE_SEGMENTS.get(baseSegment);

  if (!translatedSegment) {
    return segment;
  }

  return hasHtmlExtension ? `${translatedSegment}.html` : translatedSegment;
}
