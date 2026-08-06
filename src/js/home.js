(function () {
  const lang = document.documentElement.lang === 'en' ? 'en' : 'fi';
  const texts = {
    fi: {
      searchPlaceholder: 'Hae työkaluja...',
      noResults: 'Ei hakutuloksia.',
      latestPrefix: 'Viimeisin muutos',
      changelogLink: 'Katso muutosloki →',
      searchTitle: 'Hae työkaluja'
    },
    en: {
      searchPlaceholder: 'Search tools...',
      noResults: 'No results.',
      latestPrefix: 'Latest change',
      changelogLink: 'View changelog →',
      searchTitle: 'Search tools'
    }
  };

  function setBanner(latestChange) {
    const banner = document.getElementById('muutos-banneri');
    if (!banner || !latestChange) return;
    const prefix = texts[lang].latestPrefix;
    const date = latestChange.date ? ` (${latestChange.date})` : '';
    banner.innerHTML = `⚡ <strong>${prefix}${date}:</strong> <span>${latestChange.text || ''}</span> <a href="${lang === 'en' ? '/en/changes' : '/muutokset'}">${texts[lang].changelogLink}</a>`;
  }

  function createButton(button) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'nappula1';
    a.href = button.href || '/';
    if (button.targetBlank) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    const icon = button.icon ? `${button.icon} ` : '';
    a.textContent = `${icon}${button.label}`.trim();
    li.appendChild(a);
    return li;
  }

  function renderSections(sections) {
    const container = document.getElementById('home-sections');
    container.innerHTML = '';

    sections.forEach((section) => {
      const sectionEl = document.createElement('div');
      sectionEl.className = 'osion-tausta';
      sectionEl.id = `osio-${section.key}`;

      const title = document.createElement('h2');
      title.style.cssText = 'margin-top: 0; margin-bottom: 5px; text-align: center; color: #ffaa00; font-size: 1.2rem;';
      title.textContent = section.title;
      sectionEl.appendChild(title);

      if (section.description) {
        const description = document.createElement('p');
        description.style.cssText = 'text-align: center; font-size: 0.9rem; margin-bottom: 15px; color: #ddd;';
        description.textContent = section.description;
        sectionEl.appendChild(description);
      }

      const nav = document.createElement('nav');
      nav.setAttribute('aria-label', section.title);

      const ul = document.createElement('ul');
      ul.className = 'nappilista-ul';
      ul.id = `lista-${section.key}`;
      section.buttons.forEach((button) => ul.appendChild(createButton(button)));
      nav.appendChild(ul);

      if (section.isSearchable) {
        const empty = document.createElement('p');
        empty.className = 'ei-tuloksia';
        empty.id = `ei-tuloksia-${section.key}`;
        empty.textContent = texts[lang].noResults;
        nav.appendChild(empty);
      }

      sectionEl.appendChild(nav);
      container.appendChild(sectionEl);
    });
  }

  function setupSearch(sections) {
    const searchInput = document.getElementById('tyokaluhaku');
    if (!searchInput) return;

    searchInput.placeholder = texts[lang].searchPlaceholder;
    searchInput.setAttribute('aria-label', texts[lang].searchTitle);

    const searchable = sections.filter((s) => s.isSearchable).map((s) => s.key);

    function filterList(sectionKey) {
      const list = document.getElementById(`lista-${sectionKey}`);
      const empty = document.getElementById(`ei-tuloksia-${sectionKey}`);
      if (!list || !empty) return;
      const query = searchInput.value.trim().toLowerCase();
      let found = 0;
      list.querySelectorAll('li').forEach((li) => {
        const text = li.textContent.trim().toLowerCase();
        if (!query || text.includes(query)) {
          li.classList.remove('piilotettu');
          found += 1;
        } else {
          li.classList.add('piilotettu');
        }
      });
      empty.style.display = found === 0 ? 'block' : 'none';
    }

    searchInput.addEventListener('input', () => searchable.forEach(filterList));
  }

  async function init() {
    try {
      const res = await fetch(`/api/public/home-content?lang=${encodeURIComponent(lang)}`);
      if (!res.ok) return;
      const data = await res.json();
      const sections = Array.isArray(data.sections) ? data.sections : [];
      renderSections(sections);
      setupSearch(sections);
      setBanner(data.latestChange || null);
    } catch (error) {
      console.error(error);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
