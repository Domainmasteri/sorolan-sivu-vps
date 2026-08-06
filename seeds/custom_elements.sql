-- SQL seed file: custom_elements
-- Aja tämä kanta-kantaan siirtääksesi kovakoodatut elementit tietokantaan.
-- Varmista ennen ajoa, että taulukko on tyhjä (tai poista vain haluamasi osiot).
-- Run this seed file to migrate hardcoded page elements into the database.

-- ============================================================
-- lista-sorola-links  (etusivu / index.html)
-- ============================================================
INSERT INTO custom_elements (target_section, element_type, url, content_fi, content_en, sort_order) VALUES
  ('lista-sorola-links', 'button', 'ansioluettelot',        '📄 Maken Ansioluettelot',        '📄 Markus''s CVs',                          0),
  ('lista-sorola-links', 'button', 'makelink',               '📞 Maken yhteystiedot',           '📞 Markus''s contact details',               1),
  ('lista-sorola-links', 'button', 'ohjeet',                 '📖 Sorolan ohjeita',              '📖 Sorola guides',                           2),
  ('lista-sorola-links', 'button', 'https://soro.la/pienoismallit', '✈️ Taven pienoismallikerho', '✈️ Tave''s plastic scale models group',    3),
  ('lista-sorola-links', 'button', 'vieraskirja',            '📖 Vieraskirja',                  '📖 Guestbook',                               4),
  ('lista-sorola-links', 'button', 'privacy',                '🔒 Yksityisyyskäytännöt',         '🔒 Privacy policies',                        5),
  ('lista-sorola-links', 'button', 'muutokset',              '📋 Viimeisimmät muutokset',       '📋 Latest changes',                          6);

-- ============================================================
-- lista-perustyokalut  (etusivu / index.html)
-- ============================================================
INSERT INTO custom_elements (target_section, element_type, url, content_fi, content_en, sort_order) VALUES
  ('lista-perustyokalut', 'button', 'https://soro.la/sovellus',  '📱 Lataa Android-sovellus (.apk)', '📱 Download the Android app (.apk)',  0),
  ('lista-perustyokalut', 'button', 'qr',                         '📱 QR-koodin luoja',               '📱 QR code generator',                1),
  ('lista-perustyokalut', 'button', 'lyhennin',                   '🔗 Linkin lyhennin',               '🔗 Link shortener',                   2),
  ('lista-perustyokalut', 'button', 'salasanat',                  '🔑 Salasanageneraattori',           '🔑 Password generator',               3),
  ('lista-perustyokalut', 'button', 'pastebin',                   '📝 Pastebin (Koodinjako)',          '📝 Pastebin (Code sharing)',           4),
  ('lista-perustyokalut', 'button', 'https://vault.sorola.fi/',   '🔐 SorolaVault (kutsutut)',         '🔐 SorolaVault (invite only)',         5),
  ('lista-perustyokalut', 'button', 'jako',                       '📁 Sorolan tiedostojako',           '📁 Sorola file sharing',              6);

-- ============================================================
-- lista-edistyneet  (etusivu / index.html)
-- ============================================================
INSERT INTO custom_elements (target_section, element_type, url, content_fi, content_en, sort_order) VALUES
  ('lista-edistyneet', 'button', 'https://webtools.sorola.fi/', '🌐 Verkkotyökalut',                      '🌐 Web tools',                          0),
  ('lista-edistyneet', 'button', 'json',                         '🔧 JSON-muotoilija & validaattori',       '🔧 JSON Formatter & Validator',          1),
  ('lista-edistyneet', 'button', 'base64',                       '🔐 Base64 Kooderi / Dekooderi',           '🔐 Base64 Encoder / Decoder',            2),
  ('lista-edistyneet', 'button', 'uuid',                         '🔑 UUID / GUID Generaattori',             '🔑 UUID / GUID Generator',               3);

-- ============================================================
-- lista-ohjeet-perus  (ohjeet/index.html)
-- ============================================================
INSERT INTO custom_elements (target_section, element_type, url, content_fi, content_en, sort_order) VALUES
  ('lista-ohjeet-perus', 'button', 'qr',             'QR-koodin luoja',      'QR code generator',   0),
  ('lista-ohjeet-perus', 'button', 'linkinlyhennin',  'Linkin lyhennin',      'URL shortener',       1),
  ('lista-ohjeet-perus', 'button', 'salasanat',       'Salasanageneraattori', 'Password generator',  2),
  ('lista-ohjeet-perus', 'button', 'pastebin',        'Pastebin',             'Pastebin',            3),
  ('lista-ohjeet-perus', 'button', 'tiedostojako',    'Tiedostonjako',        'File sharing',        4);

-- ============================================================
-- lista-ohjeet-edistyneet  (ohjeet/index.html)
-- ============================================================
INSERT INTO custom_elements (target_section, element_type, url, content_fi, content_en, sort_order) VALUES
  ('lista-ohjeet-edistyneet', 'button', 'json',      'JSON-muotoilija',               'JSON Formatter',           0),
  ('lista-ohjeet-edistyneet', 'button', 'base64',    'Base64 Kooderi',                'Base64 Encoder',           1),
  ('lista-ohjeet-edistyneet', 'button', 'cryptomator','Cryptomator',                  'Cryptomator',              2),
  ('lista-ohjeet-edistyneet', 'button', 'bitwarden',  'Bitwarden – salasananhallinta','Bitwarden – password manager', 3);

-- ============================================================
-- lista-makelink  (makelink/index.html)
-- ============================================================
INSERT INTO custom_elements (target_section, element_type, url, content_fi, content_en, sort_order) VALUES
  ('lista-makelink', 'button', 'mailto:contact.make@sorola.fi',                               '📧 Sähköposti', '📧 Email',     0),
  ('lista-makelink', 'button', 'https://www.instagram.com/bannivasara?igsh=dWlmZ3J4d3liMHFy','📷 Instagram',  '📷 Instagram', 1),
  ('lista-makelink', 'button', 'https://github.com/Domainmasteri',                            '💻 GitHub',     '💻 GitHub',    2);

-- ============================================================
-- lista-privacy  (privacy/index.html)
-- ============================================================
INSERT INTO custom_elements (target_section, element_type, url, content_fi, content_en, sort_order) VALUES
  ('lista-privacy', 'button', 'lyhennin',  '🔗 Linkkilyhennin',  '🔗 Link Shortener',     0),
  ('lista-privacy', 'button', 'salasanat', '🎲 Salasanakone',    '🎲 Password Generator', 1),
  ('lista-privacy', 'button', 'qr',        '📱 QR-koodin luoja', '📱 QR code generator',  2),
  ('lista-privacy', 'button', 'pastebin',  '📝 Pastebin',        '📝 Pastebin',           3),
  ('lista-privacy', 'button', 'jako',      '📁 Tiedostojako',    '📁 File Sharing',       4),
  ('lista-privacy', 'button', 'json',      '🔧 JSON-muotoilija', '🔧 JSON Formatter',     5),
  ('lista-privacy', 'button', 'base64',    '🔐 Base64',          '🔐 Base64',             6);
