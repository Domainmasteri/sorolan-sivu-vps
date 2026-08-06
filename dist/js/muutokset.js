(function () {
  const lang = document.documentElement.lang === 'en' ? 'en' : 'fi';

  function renderEntry(entry) {
    const wrapper = document.createElement('div');
    wrapper.className = 'osion-tausta';

    const title = document.createElement('div');
    title.className = 'muutos-pvm';
    title.textContent = `${entry.dateLabel} – ${entry.title}`;
    wrapper.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'muutos-lista';
    (entry.details || []).forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    });
    wrapper.appendChild(list);

    return wrapper;
  }

  async function init() {
    const target = document.getElementById('muutoslista');
    if (!target) return;

    try {
      const res = await fetch(`/api/public/changelog?lang=${encodeURIComponent(lang)}`);
      if (!res.ok) return;
      const data = await res.json();
      target.innerHTML = '';
      (data.entries || []).forEach((entry) => target.appendChild(renderEntry(entry)));
    } catch (error) {
      console.error(error);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
