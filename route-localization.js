export const EN_ROUTE_SEGMENTS = new Map([
  ['ansioluettelot', 'resume'],
  ['cv-make', 'cv-builder'],
  ['hakemus-it', 'it-application'],
  ['hakemus-jakelu', 'delivery-application'],
  ['hakemus-make', 'application-builder'],
  ['jako', 'share'],
  ['lataus', 'download'],
  ['linkinlyhennin', 'link-shortener'],
  ['lyhennin', 'shortener'],
  ['ohjeet', 'guides'],
  ['pastebin', 'pastebin'],
  ['lue', 'view'],
  ['salasanat', 'passwords'],
  ['tiedostojako', 'file-sharing'],
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