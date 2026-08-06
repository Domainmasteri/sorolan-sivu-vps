CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_hash TEXT NOT NULL UNIQUE,
    is_used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS guestbook (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_admin INTEGER NOT NULL DEFAULT 0,
    admin_reply TEXT,
    CONSTRAINT guestbook_name_length CHECK (length(name) <= 100),
    CONSTRAINT guestbook_message_length CHECK (length(message) <= 2000),
    CONSTRAINT guestbook_reply_length CHECK (admin_reply IS NULL OR length(admin_reply) <= 2000)
);

CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_path TEXT NOT NULL UNIQUE,
    original_url TEXT NOT NULL,
    clicks INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS srla_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_path TEXT NOT NULL UNIQUE,
    original_url TEXT NOT NULL,
    clicks INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS srl_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_path TEXT NOT NULL UNIQUE,
    original_url TEXT NOT NULL,
    clicks INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pastes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_path TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS admin_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    s3_key TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    expires_at INTEGER,
    max_downloads INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO invites (code_hash) VALUES ('root');

CREATE TABLE IF NOT EXISTS home_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_key TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    title_fi TEXT NOT NULL,
    title_en TEXT NOT NULL,
    description_fi TEXT NOT NULL DEFAULT '',
    description_en TEXT NOT NULL DEFAULT '',
    is_searchable INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS home_buttons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    icon TEXT NOT NULL DEFAULT '',
    label_fi TEXT NOT NULL,
    label_en TEXT NOT NULL,
    href_fi TEXT NOT NULL,
    href_en TEXT NOT NULL,
    target_blank INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (section_id) REFERENCES home_sections(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS changelog_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    date_iso TEXT,
    date_label_fi TEXT NOT NULL,
    date_label_en TEXT NOT NULL,
    title_fi TEXT NOT NULL,
    title_en TEXT NOT NULL,
    details_fi TEXT NOT NULL DEFAULT '',
    details_en TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO home_sections (section_key, sort_order, title_fi, title_en, description_fi, description_en, is_searchable)
VALUES
  ('sorolan-linkit', 10, 'Sorolan linkit', 'Sorola links', 'Kokoelma perheen omia sivuja, teknisiä oppaita sekä hyödyllistä tietoa.', 'Collection of family pages, guides and useful links.', 0),
  ('perustyokalut', 20, 'Perustyökalut', 'Basic tools', 'Itse koodatut, nopeat ja ilman mainoksia toimivat apuvälineet digiarjen tueksi.', 'Fast in-house tools for everyday use.', 1),
  ('edistyneet', 30, 'Edistyneet työkalut', 'Advanced tools', 'Tehokkaammat apuvälineet kehittäjille ja teknisiin tarpeisiin.', 'Power tools for developers and technical needs.', 1);

INSERT OR IGNORE INTO home_buttons (section_id, sort_order, icon, label_fi, label_en, href_fi, href_en, target_blank)
VALUES
  ((SELECT id FROM home_sections WHERE section_key = 'sorolan-linkit'), 10, '📄', 'Maken Ansioluettelot', 'Markus CVs', 'ansioluettelot', 'resume', 0),
  ((SELECT id FROM home_sections WHERE section_key = 'sorolan-linkit'), 20, '📞', 'Maken yhteystiedot', 'Markus contact', 'makelink', 'makelink', 0),
  ((SELECT id FROM home_sections WHERE section_key = 'sorolan-linkit'), 30, '📖', 'Sorolan ohjeita', 'Sorola guides', 'ohjeet', 'guides', 0),
  ((SELECT id FROM home_sections WHERE section_key = 'sorolan-linkit'), 40, '✈️', 'Taven pienoismallikerho', 'Tave model club', 'https://soro.la/pienoismallit', 'https://soro.la/pienoismallit', 1),
  ((SELECT id FROM home_sections WHERE section_key = 'sorolan-linkit'), 50, '📖', 'Vieraskirja', 'Guestbook', 'vieraskirja', 'guestbook', 0),
  ((SELECT id FROM home_sections WHERE section_key = 'sorolan-linkit'), 60, '🔒', 'Yksityisyyskäytännöt', 'Privacy policies', 'privacy', 'privacy', 0),
  ((SELECT id FROM home_sections WHERE section_key = 'sorolan-linkit'), 70, '📋', 'Viimeisimmät muutokset', 'Latest changes', 'muutokset', 'changes', 0),
  ((SELECT id FROM home_sections WHERE section_key = 'perustyokalut'), 10, '📱', 'Lataa Android-sovellus (.apk)', 'Download Android app (.apk)', 'https://soro.la/sovellus', 'https://soro.la/sovellus', 1),
  ((SELECT id FROM home_sections WHERE section_key = 'perustyokalut'), 20, '📱', 'QR-koodin luoja', 'QR code creator', 'qr', 'qr', 0),
  ((SELECT id FROM home_sections WHERE section_key = 'perustyokalut'), 30, '🔗', 'Linkin lyhennin', 'Link shortener', 'lyhennin', 'shortener', 0),
  ((SELECT id FROM home_sections WHERE section_key = 'perustyokalut'), 40, '🔑', 'Salasanageneraattori', 'Password generator', 'salasanat', 'passwords', 0),
  ((SELECT id FROM home_sections WHERE section_key = 'perustyokalut'), 50, '📝', 'Pastebin (Koodinjako)', 'Pastebin (code sharing)', 'pastebin', 'pastebin', 0),
  ((SELECT id FROM home_sections WHERE section_key = 'perustyokalut'), 60, '🔐', 'SorolaVault (kutsutut)', 'SorolaVault (invited)', 'https://vault.sorola.fi/', 'https://vault.sorola.fi/', 1),
  ((SELECT id FROM home_sections WHERE section_key = 'perustyokalut'), 70, '📁', 'Sorolan tiedostojako', 'File sharing', 'jako', 'share', 0),
  ((SELECT id FROM home_sections WHERE section_key = 'edistyneet'), 10, '🌐', 'Verkkotyökalut', 'Web tools', 'https://webtools.sorola.fi/', 'https://webtools.sorola.fi/', 1),
  ((SELECT id FROM home_sections WHERE section_key = 'edistyneet'), 20, '🔧', 'JSON-muotoilija & validaattori', 'JSON formatter & validator', 'json', 'json-formatter', 0),
  ((SELECT id FROM home_sections WHERE section_key = 'edistyneet'), 30, '🔐', 'Base64 Kooderi / Dekooderi', 'Base64 encoder / decoder', 'base64', 'base64', 0),
  ((SELECT id FROM home_sections WHERE section_key = 'edistyneet'), 40, '🔑', 'UUID / GUID Generaattori', 'UUID / GUID generator', 'uuid', 'uuid', 0);

INSERT OR IGNORE INTO changelog_entries (id, sort_order, date_iso, date_label_fi, date_label_en, title_fi, title_en, details_fi, details_en)
VALUES
  (1, 10, '2026-08-05', '5.8.2026', '2026-08-05', 'UUID-generaattori & kielen vaihtajan parannus', 'UUID generator & language switcher improvements', 'Lisätty UUID/GUID v4 -generaattori etusivun edistyneiden työkalujen joukkoon.' || char(10) || 'Kielen vaihtajasta tehty siirrettävä – voit nyt raahata sen pois tieltä, jos se peittää tärkeää sisältöä.' || char(10) || 'Lisätty käyttöohjeet ja tietosuojaselosteet QR-koodin luojalle, salasanageneraattorille, pastebinille, JSON-muotoilijalle ja Base64 kooderille.', 'Added UUID/GUID v4 generator to advanced tools on the home page.' || char(10) || 'Language switcher is now draggable so it can be moved away from content.' || char(10) || 'Added guides and privacy notices for QR, password generator, pastebin, JSON formatter and Base64 tool.'),
  (2, 20, '2026-08-05', '5.8.2026', '2026-08-05', 'Ohjeet ja tietosuojaselosteet kaikille työkaluille', 'Guides and privacy notices for all tools', 'Lisätty käyttöohjeet QR-koodin luojalle, salasanageneraattorille, pastebinille, JSON-muotoilijalle ja Base64 kooderille.' || char(10) || 'Lisätty tietosuojaselosteet kaikille palveluille: QR, Pastebin, Tiedostojako, JSON-muotoilija ja Base64.' || char(10) || 'Poistettu Sorolan Holvi -selainlaajennus (korvattu Vaultwardenilla).', 'Added guides for QR, password generator, pastebin, JSON formatter and Base64 tool.' || char(10) || 'Added privacy notices for QR, pastebin, file sharing, JSON formatter and Base64.' || char(10) || 'Removed Sorolan Holvi browser extension (replaced by Vaultwarden).'),
  (3, 30, '2026-08-04', '4.8.2026', '2026-08-04', 'Uusia ohjeita ja tietosuojaselosteita', 'New guides and privacy notices', 'Lisätty uusia kattavia käyttöohjeita palveluiden ja IT-työkalujen sujuvaan käyttöön.' || char(10) || 'Päivitetty ja lisätty asianmukaiset tietosuojaselosteet verkkotyökaluille ja palveluille.', 'Added more comprehensive guides for services and tools.' || char(10) || 'Updated and added proper privacy notices for web tools and services.'),
  (4, 40, '2026-08-03', '3.8.2026', '2026-08-03', 'JSON-muotoilija', 'JSON formatter', 'Lisätty uusi JSON-muotoilija & validaattori edistyneiden työkalujen joukkoon.' || char(10) || 'Työkalu toimii täysin paikallisesti selaimessa ilman tietojen lähettämistä palvelimelle.', 'Added a new JSON formatter & validator to advanced tools.' || char(10) || 'The tool works fully in-browser without sending data to a server.'),
  (5, 50, '2026-08-01', '1.8.2026', '2026-08-01', 'Työkalujen ryhmittely & webtools.sorola.fi', 'Tool grouping & webtools.sorola.fi', 'Työkalut ryhmitelty selkeämmin erikseen perustyökaluihin ja kehittäjille suunnattuihin edistyneisiin työkaluihin.' || char(10) || 'Avattu uusi aliverkkotunnus webtools.sorola.fi verkkotyökalukokoelmaa varten.', 'Tools grouped more clearly into basic and advanced categories.' || char(10) || 'Opened new subdomain webtools.sorola.fi for web tools collection.'),
  (6, 60, '2026-07-31', '31.7.2026', '2026-07-31', 'Android-sovelluksen julkaisu', 'Android app release', 'Luotu ja julkaistu Sorolan oma Android-sovellus (.apk-lataus), joka helpottaa perustyökalujen käyttöä mobiililaitteilla.', 'Created and released Sorola Android app (.apk) to make basic tools easier to use on mobile.');
