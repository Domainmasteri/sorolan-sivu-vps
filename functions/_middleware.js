// functions/_middleware.js
class SEOJaAnalytiikka {
  element(element) {
    // Nämä rivit lisätään jokaisen HTML-sivun <head> -osion loppuun automaattisesti
    element.append(`
      <script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "SINUN_TOKEN_TÄHÄN"}'></script>
      
      <meta property="og:type" content="website">
      <meta property="og:site_name" content="Sorolan Sakki">
    `, { html: true });
  }
}

export async function onRequest(context) {
  // Haetaan alkuperäinen sivu
  const response = await context.next();
  
  // Varmistetaan, että muokkaamme vain HTML-sivuja (ei esim. kuvia tai CSS-tiedostoja)
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("text/html")) {
    return new HTMLRewriter().on("head", new SEOJaAnalytiikka()).transform(response);
  }
  
  return response;
}
