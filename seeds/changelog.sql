-- SQL seed file: changelog
-- Aja tämä kanta-kantaan siirtääksesi kovakoodatut muutoslokimerkinnät tietokantaan.
-- Järjestys: vanhin ensin (INSERT asteittain kasvavat ID:t → DESC-järjestys näyttää uusimmat ensin).
-- Run this seed file to migrate hardcoded changelog entries into the database.

INSERT INTO changelog (date_str, title_fi, title_en, content_fi, content_en) VALUES
  (
    '31.7.2026',
    'Android-sovelluksen julkaisu',
    'Android app release',
    'Luotu ja julkaistu Sorolan oma Android-sovellus (.apk-lataus), joka helpottaa perustyökalujen käyttöä mobiililaitteilla.',
    'Sorola''s own Android app (.apk download) created and released, making it easier to use the basic tools on mobile devices.'
  ),
  (
    '1.8.2026',
    'Työkalujen ryhmittely & webtools.sorola.fi',
    'Tool grouping & webtools.sorola.fi',
    'Työkalut ryhmitelty selkeämmin erikseen perustyökaluihin ja kehittäjille suunnattuihin edistyneisiin työkaluihin.'||char(10)||'Avattu uusi aliverkkotunnus webtools.sorola.fi verkkotyökalukokoelmaa varten.',
    'Tools reorganised into basic tools and developer-oriented advanced tools.'||char(10)||'New subdomain webtools.sorola.fi opened for the web tools collection.'
  ),
  (
    '3.8.2026',
    'JSON-muotoilija',
    'JSON Formatter',
    'Lisätty uusi JSON-muotoilija & validaattori edistyneiden työkalujen joukkoon.'||char(10)||'Työkalu toimii täysin paikallisesti selaimessa ilman tietojen lähettämistä palvelimelle.',
    'Added new JSON Formatter & Validator to the advanced tools section.'||char(10)||'The tool works entirely locally in the browser without sending any data to the server.'
  ),
  (
    '4.8.2026',
    'Uusia ohjeita ja tietosuojaselosteita',
    'New guides and privacy policies',
    'Lisätty uusia kattavia käyttöohjeita palveluiden ja IT-työkalujen sujuvaan käyttöön.'||char(10)||'Päivitetty ja lisätty asianmukaiset tietosuojaselosteet verkkotyökaluille ja palveluille.',
    'Added new comprehensive usage guides for services and IT tools.'||char(10)||'Updated and added proper privacy policies for web tools and services.'
  ),
  (
    '5.8.2026',
    'Ohjeet ja tietosuojaselosteet kaikille työkaluille',
    '5.8.2026 – Guides and privacy policies for all tools',
    'Lisätty käyttöohjeet QR-koodin luojalle, salasanageneraattorille, pastebinille, JSON-muotoilijalle ja Base64 kooderille.'||char(10)||'Lisätty tietosuojaselosteet kaikille palveluille: QR, Pastebin, Tiedostojako, JSON-muotoilija ja Base64.'||char(10)||'Poistettu Sorolan Holvi -selainlaajennus (korvattu Vaultwardenilla).',
    'Added usage guides for QR code creator, password generator, pastebin, JSON formatter and Base64 encoder.'||char(10)||'Added privacy policies for all services: QR, Pastebin, File sharing, JSON formatter and Base64.'||char(10)||'Removed Sorolan Holvi browser extension (replaced by Vaultwarden).'
  ),
  (
    '5.8.2026',
    'UUID-generaattori & kielen vaihtajan parannus',
    'UUID generator & improved language selector',
    'Lisätty UUID/GUID v4 -generaattori etusivun edistyneiden työkalujen joukkoon.'||char(10)||'Kielen vaihtajasta tehty siirrettävä – voit nyt raahata sen pois tieltä, jos se peittää tärkeää sisältöä.'||char(10)||'Lisätty käyttöohjeet ja tietosuojaselosteet QR-koodin luojalle, salasanageneraattorille, pastebinille, JSON-muotoilijalle ja Base64 kooderille.',
    'Added UUID/GUID v4 generator to the advanced tools section on the front page.'||char(10)||'Language selector is now draggable – you can move it out of the way if it covers important content.'||char(10)||'Added user guides and privacy policies for the QR code generator, password generator, pastebin, JSON formatter, and Base64 encoder.'
  );
