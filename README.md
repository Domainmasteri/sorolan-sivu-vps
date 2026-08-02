# Sorolan Sivut 🌐
🇬🇧 English | 🇫🇮 Suomi
## 🇬🇧 English
Welcome to the **Sorolan Sivut** repository. This is a side project of our family for coding. It is a comprehensive, multilingual web project built for Cloudflare Pages. It serves as a personal hub, offering various custom-built tools and guides.
### ✨ Features & Tools
 * **🔗 Link Shortener (srl.la):** Custom URL shortener with API backend.
 * **🔐 Password Generator:** Secure password creation tool.
 * **📁 File Sharing:** Secure upload and download service.
 * **📱 QR Code Generator:** Quick QR code creation.
 * **📖 IT Guides:** Tutorials for software like Bitwarden and Cryptomator.
 * **🌐 Multilingual Support:** Fully localized in Finnish and English using custom routing.
 * **🛡️ Admin Panel:** Backend management with invite and user systems.
### 🛠 Tech Stack
 * **Frontend:** HTML5, CSS3, Vanilla JS
 * **Backend / API:** Cloudflare Pages Functions (Serverless Workers) + Express VPS server
 * **Build Tool:** Node.js (build.mjs)
 * **Deployment:** Cloudflare Pages
### 🚀 Getting Started
 1. **Clone the repo:**
   ```
   git clone https://github.com/Domainmasteri/sorolan-sivut.git
   
   
   ```
 2. **Install dependencies:**
   ```
   npm install
   
   
   ```
 3. **Build the project:**
   ```
   node build.mjs
   
   
   ```
   *The compiled site will be output to the /dist directory.*
   *Source pages, static assets, localization files and sitemap inputs now live under `/src`, while runtime and deployment files stay in the repository root.*

 4. **Run with Docker (Coolify compatible):**
   ```
   docker build -t sorolan-sivu-vps .
   docker run -p 3000:3000 --env-file .env -v $(pwd)/data:/app/data sorolan-sivu-vps
   ```
   *Repository now includes a Dockerfile and can be deployed directly from Git in Coolify.*
    
   `docker-compose.yml` example:
   ```yaml
   services:
     sorolan-sivu-vps:
       build: .
       ports:
         - "3000:3000"
       env_file:
         - .env
       volumes:
         - ./data:/app/data
       restart: unless-stopped
   ```
  5. **Local database:**
   * The VPS server stores app data in a local SQLite file (`/app/data/database.sqlite` inside container, `data/database.sqlite` locally by default).
   * Override the file location with `DATABASE_PATH` if needed.
   * Keep `/app/data` mounted to host to avoid SQLite reset on container restart.
  6. **Reverse proxy upload limit (important):**
   * If you run Nginx/Caddy in front of this app, set upload limit to at least **1024 MB** to avoid `413` on `/api/upload` (e.g. Nginx: `client_max_body_size 1024M;`).
## 🇫🇮 Suomi
Tervetuloa **Sorolan Sivut** -repositorioon. Tämä on perheemme sivuprojekti koodaamisen suhteen. Se on laaja, monikielinen verkkoprojekti, joka on suunniteltu Cloudflare Pages -alustalle. Se toimii henkilökohtaisena portaalina ja tarjoaa useita itse koodattuja työkaluja ja oppaita.
### ✨ Ominaisuudet & Työkalut
 * **🔗 Linkinlyhennin (srl.la):** Oma URL-lyhennin API-taustajärjestelmällä.
 * **🔐 Salasanageneraattori:** Työkalu turvallisten salasanojen luontiin.
 * **📁 Tiedostonjako:** Turvallinen tiedostojen lähetys- ja latauspalvelu.
 * **📱 QR-koodigeneraattori:** Nopea QR-koodien luonti.
 * **📖 IT-oppaat:** Käyttöohjeita ohjelmistoille, kuten Bitwarden ja Cryptomator.
 * **🌐 Monikielisyys:** Täysin lokalisoitu suomeksi ja englanniksi räätälöidyllä reitityksellä.
 * **🛡️ Hallintapaneeli:** Ylläpitopaneeli kutsu- ja käyttäjähallinnalla.
### 🛠 Teknologiat
 * **Frontend:** HTML5, CSS3, Vanilla JS
 * **Backend / API:** Cloudflare Pages Functions (Serverless Workers) + Express VPS-palvelin
 * **Build-työkalu:** Node.js (build.mjs)
 * **Julkaisu:** Cloudflare Pages
### 🚀 Aloitusopas
 1. **Kloonaa repo:**
   ```
   git clone https://github.com/Domainmasteri/sorolan-sivut.git
   
   
   ```
 2. **Asenna riippuvuudet:**
   ```
   npm install
   
   
   ```
 3. **Käännä projekti:**
   ```
   node build.mjs
   
   
   ```
   *Valmis sivusto generoituu /dist -kansioon.*
   *Sivujen lähdetiedostot, staattiset assetit, lokalisoinnit ja sitemapin syötteet ovat nyt `/src`-kansiossa, kun taas ajonaikaiset ja julkaisuun liittyvät tiedostot jäävät repon juureen.*

 4. **Aja Dockerilla (Coolify-yhteensopiva):**
   ```
   docker build -t sorolan-sivu-vps .
   docker run -p 3000:3000 --env-file .env -v $(pwd)/data:/app/data sorolan-sivu-vps
   ```
   *Repossa on nyt Dockerfile, joten voit ottaa koodin suoraan Coolifyyn Gitistä.*
    
   `docker-compose.yml`-esimerkki:
   ```yaml
   services:
     sorolan-sivu-vps:
       build: .
       ports:
         - "3000:3000"
       env_file:
         - .env
       volumes:
         - ./data:/app/data
       restart: unless-stopped
   ```
  5. **Paikallinen tietokanta:**
   * VPS-palvelin tallentaa sovelluksen datan paikalliseen SQLite-tiedostoon (`/app/data/database.sqlite` kontin sisällä, paikallisesti oletus `data/database.sqlite`).
   * Voit vaihtaa tiedoston sijainnin `DATABASE_PATH`-muuttujalla.
   * Pidä `/app/data` liitettynä hostiin, jotta tietokanta ei nollaudu kontin uudelleenkäynnistyksessä.
  6. **Reverse proxy -latausraja (tärkeä):**
   * Jos kontti on Nginx/Caddy-reverse proxyn takana, aseta vähintään **1024 MB** tiedostokokoraja välttääksesi `/api/upload`-reitillä `413`-virheen (Nginx: `client_max_body_size 1024M;`).
*Repository maintained by @Domainmasteri*
