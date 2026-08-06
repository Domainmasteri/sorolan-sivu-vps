let currentUser = null;
let currentAuthHeader = null;
let contentState = { sections: [], buttons: [], changelog: [] };

function authHeaders(extra = {}) {
  return { ...extra, Authorization: currentAuthHeader };
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Pyyntö epäonnistui.');
  }
  return data;
}

function toggleMode() {
  document.getElementById('login-section').classList.toggle('hidden');
  document.getElementById('register-section').classList.toggle('hidden');
}

async function login() {
  const u = document.getElementById('login-username').value;
  const p = document.getElementById('login-password').value;
  if (!u || !p) return alert('Syötä tunnus ja salasana.');

  try {
    const data = await jsonRequest('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', username: u, password: p })
    });
    if (data.success) {
      currentUser = u;
      currentAuthHeader = 'Bearer ' + btoa([u, p].join(':'));
      document.getElementById('login-section').classList.add('hidden');
      document.getElementById('dashboard-section').classList.remove('hidden');
      await lataaTiedot();
    }
  } catch (error) {
    alert(error.message || 'Virheellinen tunnus tai salasana.');
  }
}

async function register() {
  const inv = document.getElementById('reg-invite').value;
  const u = document.getElementById('reg-username').value;
  const p = document.getElementById('reg-password').value;
  if (!inv || !u || !p) return alert('Täytä kaikki kentät.');

  try {
    const data = await jsonRequest('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'register', inviteCode: inv, username: u, password: p })
    });
    if (data.success) {
      alert('Tunnus luotu! Voit kirjautua sisään.');
      toggleMode();
      document.getElementById('login-username').value = u;
    }
  } catch (error) {
    alert(error.message || 'Rekisteröinti epäonnistui.');
  }
}

async function vaihdaSalasana(buttonEl) {
  const oldP = document.getElementById('change-old-password').value;
  const newP = document.getElementById('change-new-password').value;
  const confirmP = document.getElementById('change-new-password-confirm').value;
  if (!oldP || !newP || !confirmP) return alert('Täytä kaikki salasanakentät.');
  if (newP !== confirmP) return alert('Uudet salasanat eivät täsmää.');

  const btn = buttonEl;
  btn.disabled = true;
  btn.textContent = 'Vaihdetaan...';

  try {
    const data = await jsonRequest('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'change_password', username: currentUser, oldPassword: oldP, newPassword: newP })
    });
    if (data.success) {
      alert('Salasana vaihdettu onnistuneesti!');
      currentAuthHeader = 'Bearer ' + btoa([currentUser, newP].join(':'));
      document.getElementById('change-old-password').value = '';
      document.getElementById('change-new-password').value = '';
      document.getElementById('change-new-password-confirm').value = '';
    }
  } catch (error) {
    alert(error.message || 'Virhe salasanan vaihdossa.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Vaihda';
  }
}

function logout() {
  currentUser = null;
  currentAuthHeader = null;
  contentState = { sections: [], buttons: [], changelog: [] };
  document.getElementById('dashboard-section').classList.add('hidden');
  document.getElementById('login-section').classList.remove('hidden');
  document.getElementById('login-password').value = '';
}

function toggleSection(headerEl) {
  const content = headerEl.nextElementSibling;
  const btn = headerEl.querySelector('.collapse-toggle');
  const isCollapsed = content.classList.contains('collapsed');
  content.classList.toggle('collapsed', !isCollapsed);
  btn.textContent = isCollapsed ? '▲' : '▼';
}

let editLinkState = null;

function muokkaaLinkkia(domain, pathValue, currentUrl) {
  editLinkState = { domain, originalPath: pathValue };
  document.getElementById('modal-link-path').value = pathValue;
  document.getElementById('modal-link-url').value = currentUrl;
  document.getElementById('link-edit-modal').classList.remove('hidden');
}

async function tallennaMuokattuLinkki() {
  if (!editLinkState) return;
  const { domain, originalPath } = editLinkState;
  const newPath = document.getElementById('modal-link-path').value.trim();
  const newUrl = document.getElementById('modal-link-url').value.trim();
  if (!newUrl) return alert('Kohdeosoite ei voi olla tyhjä.');
  try {
    await jsonRequest('/api/links', {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ domain, path: originalPath, newOriginalURL: newUrl, newShortPath: newPath !== originalPath ? newPath : undefined })
    });
    suljeLinkkireditointi();
    await lataaTiedot();
  } catch (error) {
    alert(error.message || 'Virhe päivityksessä.');
  }
}

function suljeLinkkireditointi() {
  editLinkState = null;
  document.getElementById('link-edit-modal').classList.add('hidden');
}

let editGbState = null;

function muokkaaGbViestia(id, name, message, reply) {
  editGbState = { id };
  document.getElementById('modal-gb-name').value = name;
  document.getElementById('modal-gb-message').value = message;
  document.getElementById('modal-gb-reply').value = reply || '';
  document.getElementById('gb-edit-modal').classList.remove('hidden');
}

async function tallennaMuokattuGbViesti() {
  if (!editGbState) return;
  const { id } = editGbState;
  const name = document.getElementById('modal-gb-name').value.trim();
  const message = document.getElementById('modal-gb-message').value.trim();
  const adminReply = document.getElementById('modal-gb-reply').value.trim();
  if (!name || !message) return alert('Nimi ja viesti ovat pakollisia.');
  try {
    await jsonRequest('/api/guestbook', {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id, name, message, adminReply })
    });
    suljeGbMuokkaus();
    await lataaTiedot();
  } catch (error) {
    alert(error.message || 'Virhe päivityksessä.');
  }
}

function suljeGbMuokkaus() {
  editGbState = null;
  document.getElementById('gb-edit-modal').classList.add('hidden');
}

function renderLinkTable(tableId, links, domain) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = '';
  if (!links.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#a0aec0;">Ei vielä linkkejä domainissa.</td></tr>';
    return;
  }

  links.forEach((link) => {
    const baseUrl = domain === 'soro.la' ? 'soro.la' : domain;
    const date = new Date(link.created_at).toLocaleDateString('fi-FI');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><a href="https://${baseUrl}/${link.short_path}" target="_blank" style="color:#ffaa00;">/${link.short_path}</a></td>
      <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <a href="${link.original_url}" target="_blank" style="color:#60a5fa;">${link.original_url}</a>
      </td>
      <td>${link.clicks}</td>
      <td>${date}</td>
      <td>
        <button class="action-btn edit-btn link-edit-btn">Muokkaa</button>
        <button class="action-btn link-delete-btn">Poista</button>
      </td>
    `;
    const editBtn = tr.querySelector('.link-edit-btn');
    editBtn.dataset.domain = domain;
    editBtn.dataset.path = link.short_path;
    editBtn.dataset.url = link.original_url;
    editBtn.addEventListener('click', () => muokkaaLinkkia(domain, link.short_path, link.original_url));
    const deleteBtn = tr.querySelector('.link-delete-btn');
    deleteBtn.addEventListener('click', () => poistaLinkki(domain, link.short_path));
    tbody.appendChild(tr);
  });
}

async function lataaTiedot() {
  if (!currentAuthHeader) return;
  try {
    const [linksData, pastesData, guestbookData, usersData, invitesData] = await Promise.all([
      jsonRequest('/api/links', { headers: authHeaders() }),
      jsonRequest('/api/pastes', { headers: authHeaders() }),
      jsonRequest('/api/guestbook'),
      jsonRequest('/api/users', { headers: authHeaders() }),
      jsonRequest('/api/invites', { headers: authHeaders() })
    ]);

    renderLinkTable('sorola-table', linksData.sorola || [], 'soro.la');
    renderLinkTable('srla-table', linksData.srla || [], 'srla.fi');
    renderLinkTable('srlla-table', linksData.srl || [], 'srl.la');

    const pastesBody = document.querySelector('#pastes-table tbody');
    pastesBody.innerHTML = '';
    if (!(pastesData.pastes || []).length) {
      pastesBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#a0aec0;">Ei vielä pasteja.</td></tr>';
    } else {
      pastesData.pastes.forEach((paste) => {
        const date = new Date(paste.created_at).toLocaleDateString('fi-FI');
        const snippet = (paste.content.length > 40 ? `${paste.content.substring(0, 40)}...` : paste.content)
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        pastesBody.innerHTML += `
          <tr>
            <td><a href="/p/${paste.short_path}" target="_blank" style="color:#4ade80;">/p/${paste.short_path}</a></td>
            <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${snippet}</td>
            <td>${date}</td>
            <td><button onclick="poistaPaste(${paste.id})" class="action-btn">Poista</button></td>
          </tr>
        `;
      });
    }

    const guestbookBody = document.querySelector('#guestbook-table tbody');
    guestbookBody.innerHTML = '';
    if (!(guestbookData.messages || []).length) {
      guestbookBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#a0aec0;">Ei vieraskirjaviestejä.</td></tr>';
    } else {
      guestbookData.messages.forEach((message) => {
        const date = new Date(message.created_at).toLocaleDateString('fi-FI');
        const nameHtml = message.is_admin ? `<span style="color:#f472b6;font-weight:bold;">👑 </span>` : '';
        const replyHtml = message.admin_reply || '';
        const tr = document.createElement('tr');

        const nameTd = document.createElement('td');
        if (message.is_admin) {
          const badge = document.createElement('span');
          badge.style.cssText = 'color:#f472b6;font-weight:bold;';
          badge.textContent = '👑 ';
          nameTd.appendChild(badge);
        }
        nameTd.appendChild(document.createTextNode(message.name));

        const msgTd = document.createElement('td');
        msgTd.style.cssText = 'max-width: 200px; overflow: hidden; text-overflow: ellipsis;';
        msgTd.textContent = message.message;

        const replyTd = document.createElement('td');
        replyTd.style.cssText = 'max-width: 200px; overflow: hidden; text-overflow: ellipsis;';
        if (replyHtml) {
          replyTd.textContent = replyHtml;
        } else {
          const em = document.createElement('em');
          em.style.color = '#64748b';
          em.textContent = 'Ei vastausta';
          replyTd.appendChild(em);
        }

        const dateTd = document.createElement('td');
        dateTd.textContent = date;

        const actionsTd = document.createElement('td');
        const editBtn = document.createElement('button');
        editBtn.className = 'action-btn edit-btn';
        editBtn.textContent = 'Muokkaa';
        editBtn.addEventListener('click', () => muokkaaGbViestia(message.id, message.name, message.message, message.admin_reply || ''));
        actionsTd.appendChild(editBtn);

        if (!message.is_admin) {
          const replyBtn = document.createElement('button');
          replyBtn.className = 'action-btn edit-btn';
          replyBtn.textContent = 'Vastaa';
          replyBtn.addEventListener('click', () => vastaaVieraskirjaan(message.id));
          actionsTd.appendChild(replyBtn);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'action-btn';
        deleteBtn.textContent = 'Poista';
        deleteBtn.addEventListener('click', () => poistaVieraskirjaviesti(message.id));
        actionsTd.appendChild(deleteBtn);

        tr.appendChild(nameTd);
        tr.appendChild(msgTd);
        tr.appendChild(replyTd);
        tr.appendChild(dateTd);
        tr.appendChild(actionsTd);
        guestbookBody.appendChild(tr);
      });
    }

    const usersBody = document.querySelector('#users-table tbody');
    usersBody.innerHTML = '';
    (usersData.users || []).forEach((user) => {
      const date = new Date(user.created_at).toLocaleDateString('fi-FI');
      const isMe = user.username === currentUser;
      usersBody.innerHTML += `
        <tr>
          <td>${user.username} ${isMe ? '<span style="color:#4ade80; font-size:0.8rem;">(Sinä)</span>' : ''}</td>
          <td>${date}</td>
          <td>${!isMe ? `<button onclick="poistaKayttaja(${user.id})" class="action-btn">Poista</button>` : ''}</td>
        </tr>
      `;
    });

    const invitesBody = document.querySelector('#invites-table tbody');
    invitesBody.innerHTML = '';
    (invitesData.invites || []).forEach((invite) => {
      const date = new Date(invite.created_at).toLocaleDateString('fi-FI');
      const status = invite.is_used
        ? '<span style="color:#ef4444;">Käytetty</span>'
        : '<span style="color:#4ade80;">Vapaa</span>';
      invitesBody.innerHTML += `
        <tr>
          <td style="font-family: monospace;">${invite.code}</td>
          <td>${status}</td>
          <td>${date}</td>
          <td><button onclick="poistaKutsu(${invite.id})" class="action-btn">Poista</button></td>
        </tr>
      `;
    });

    await Promise.all([lataaAdminTiedostot(), lataaSisaltoHallinta()]);
  } catch (error) {
    console.error(error);
    alert(error.message || 'Virhe ladattaessa tietoja.');
  }
}

async function luoUusiLinkki(buttonEl) {
  const domain = document.getElementById('new-domain').value;
  const url = document.getElementById('new-url').value;
  const path = document.getElementById('new-path').value;
  if (!url) return alert('Kohdeosoite on pakollinen.');

  const btn = buttonEl;
  btn.textContent = 'Luodaan...';
  btn.disabled = true;
  try {
    await jsonRequest('/api/links', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ domain, originalURL: url, path })
    });
    document.getElementById('new-url').value = '';
    document.getElementById('new-path').value = '';
    await lataaTiedot();
  } catch (error) {
    alert(error.message || 'Virhe.');
  } finally {
    btn.textContent = 'Luo';
    btn.disabled = false;
  }
}

async function poistaLinkki(domain, pathValue) {
  if (!confirm(`Poistetaanko /${pathValue}?`)) return;
  try {
    await jsonRequest(`/api/links?domain=${encodeURIComponent(domain)}&path=${encodeURIComponent(pathValue)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    await lataaTiedot();
  } catch (error) {
    alert(error.message || 'Virhe poistossa.');
  }
}

async function poistaPaste(id) {
  if (!confirm('Poistetaanko tämä pastebin-teksti?')) return;
  try {
    await jsonRequest(`/api/pastes?id=${id}`, { method: 'DELETE', headers: authHeaders() });
    await lataaTiedot();
  } catch (error) {
    alert(error.message || 'Virhe poistossa.');
  }
}

async function poistaKayttaja(id) {
  if (!confirm('Poistetaanko käyttäjä?')) return;
  try {
    await jsonRequest(`/api/users?id=${id}`, { method: 'DELETE', headers: authHeaders() });
    await lataaTiedot();
  } catch (error) {
    alert(error.message || 'Virhe poistossa.');
  }
}

async function luoKutsukoodi() {
  const koodi = document.getElementById('new-invite').value;
  if (!koodi) return alert('Syötä uusi koodisana.');

  try {
    await jsonRequest('/api/invites', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code: koodi })
    });
    document.getElementById('new-invite').value = '';
    await lataaTiedot();
  } catch (error) {
    alert(error.message || 'Virhe koodin luonnissa.');
  }
}

async function poistaKutsu(id) {
  if (!confirm('Poistetaanko tämä kutsukoodi järjestelmästä?')) return;
  try {
    await jsonRequest(`/api/invites?id=${id}`, { method: 'DELETE', headers: authHeaders() });
    await lataaTiedot();
  } catch (error) {
    alert(error.message || 'Virhe poistossa.');
  }
}

async function lahetaAdminViesti() {
  const msg = document.getElementById('admin-gb-message').value;
  if (!msg) return alert('Kirjoita viesti ensin.');

  try {
    await jsonRequest('/api/guestbook', {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'admin_message', name: currentUser, message: msg })
    });
    document.getElementById('admin-gb-message').value = '';
    await lataaTiedot();
  } catch (error) {
    alert(error.message || 'Virhe viestin lähetyksessä.');
  }
}

async function vastaaVieraskirjaan(id) {
  const vastaus = prompt('Kirjoita ylläpidon vastaus viestiin (tyhjä poistaa vastauksen):', '');
  if (vastaus === null) return;
  try {
    await jsonRequest('/api/guestbook', {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'reply', id, reply: vastaus })
    });
    await lataaTiedot();
  } catch (error) {
    alert(error.message || 'Virhe vastauksen tallennuksessa.');
  }
}

async function poistaVieraskirjaviesti(id) {
  if (!confirm('Poistetaanko tämä viesti pysyvästi?')) return;
  try {
    await jsonRequest(`/api/guestbook?id=${id}`, { method: 'DELETE', headers: authHeaders() });
    await lataaTiedot();
  } catch (error) {
    alert(error.message || 'Virhe viestin poistossa.');
  }
}

async function lataaTiedosto(buttonEl) {
  const fileInput = document.getElementById('admin-file-input');
  const expiryDays = document.getElementById('admin-file-expiry').value;
  const maxDownloads = document.getElementById('admin-file-maxdownloads').value;
  const resultDiv = document.getElementById('admin-upload-result');

  if (!fileInput.files[0]) return alert('Valitse tiedosto ensin.');

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('expiryDays', expiryDays);
  formData.append('maxDownloads', maxDownloads);

  const btn = buttonEl;
  btn.textContent = 'Ladataan...';
  btn.disabled = true;
  resultDiv.style.display = 'none';

  try {
    const data = await jsonRequest('/api/admin/upload', {
      method: 'POST',
      headers: authHeaders(),
      body: formData
    });

    resultDiv.style.display = 'block';
    const shareEl = document.getElementById('admin-share-url');
    const dlEl = document.getElementById('admin-download-url');
    shareEl.href = data.shareUrl;
    shareEl.textContent = data.shareUrl;
    dlEl.href = data.downloadUrl;
    dlEl.textContent = data.downloadUrl;
    fileInput.value = '';
    await lataaAdminTiedostot();
  } catch (error) {
    alert(error.message || 'Lataus epäonnistui.');
  } finally {
    btn.textContent = '📤 Lataa tiedosto';
    btn.disabled = false;
  }
}

async function lataaAdminTiedostot() {
  if (!currentAuthHeader) return;
  try {
    const data = await jsonRequest('/api/admin/files', { headers: authHeaders() });
    const tbody = document.querySelector('#admin-files-table tbody');
    tbody.innerHTML = '';
    if (!(data.files || []).length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#a0aec0;">Ei ladattuja tiedostoja.</td></tr>';
      return;
    }

    const siteOrigin = window.location.origin;
    data.files.forEach((file) => {
      const date = new Date(file.created_at).toLocaleDateString('fi-FI');
      const sizeStr = formatFileSize(file.file_size);
      const expiryStr = !file.expires_at || file.expires_at === 0
        ? '<span style="color:#4ade80;">Ei vanhene</span>'
        : (() => {
            const expiryDate = new Date(file.expires_at);
            const expired = Date.now() > file.expires_at;
            return expired
              ? `<span style="color:#ef4444;">${expiryDate.toLocaleDateString('fi-FI')} (vanhentunut)</span>`
              : expiryDate.toLocaleDateString('fi-FI');
          })();
      const maxDl = file.max_downloads === 0 ? '<span style="color:#a0aec0;">Rajaton</span>' : file.max_downloads;
      const shareUrl = `${siteOrigin}/s/${encodeURIComponent(file.s3_key)}`;
      tbody.innerHTML += `
        <tr>
          <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <a href="${shareUrl}" target="_blank" style="color:#34d399;">${file.original_name}</a>
          </td>
          <td>${sizeStr}</td>
          <td>${expiryStr}</td>
          <td>${maxDl}</td>
          <td>${date}<br><small style="color:#64748b;">${file.created_by || ''}</small></td>
          <td>
            <button onclick="kopioiLinkki('${shareUrl}')" class="action-btn edit-btn" style="background:#374151; margin-bottom:4px;">Kopioi</button>
            <button onclick="poistaAdminTiedosto(${file.id})" class="action-btn">Poista</button>
          </td>
        </tr>
      `;
    });
  } catch (error) {
    console.error(error);
  }
}

function formatFileSize(bytes) {
  if (!bytes) return '–';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function kopioiLinkki(url) {
  navigator.clipboard.writeText(url)
    .then(() => alert('Linkki kopioitu leikepöydälle!'))
    .catch(() => alert(url));
}

async function poistaAdminTiedosto(id) {
  if (!confirm('Poistetaanko tämä tiedosto pysyvästi tallennustilasta?')) return;
  try {
    await jsonRequest(`/api/admin/files?id=${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    await lataaAdminTiedostot();
  } catch (error) {
    alert(error.message || 'Virhe poistossa.');
  }
}

function sectionNameById(id) {
  const section = contentState.sections.find((item) => item.id === id);
  return section ? section.section_key : 'tuntematon';
}

function renderSisaltoTaulut() {
  const sectionsBody = document.querySelector('#home-sections-table tbody');
  const buttonsBody = document.querySelector('#home-buttons-table tbody');
  const changelogBody = document.querySelector('#changelog-table tbody');
  const buttonSectionSelect = document.getElementById('new-button-section-id');

  sectionsBody.innerHTML = '';
  buttonsBody.innerHTML = '';
  changelogBody.innerHTML = '';
  buttonSectionSelect.innerHTML = '';

  contentState.sections.forEach((section) => {
    sectionsBody.innerHTML += `
      <tr>
        <td>${section.section_key}</td>
        <td>${section.title_fi}<br><small style="color:#94a3b8;">${section.title_en || ''}</small></td>
        <td>${section.description_fi || '–'}<br><small style="color:#94a3b8;">${section.description_en || ''}</small></td>
        <td>${section.sort_order}</td>
        <td>${Number(section.is_searchable) === 1 ? 'Kyllä' : 'Ei'}</td>
        <td>
          <button onclick="muokkaaOsiota(${section.id})" class="action-btn edit-btn">Muokkaa</button>
          <button onclick="siirraOsiota(${section.id}, 'up')" class="action-btn edit-btn" style="background:#475569;">↑</button>
          <button onclick="siirraOsiota(${section.id}, 'down')" class="action-btn edit-btn" style="background:#475569;">↓</button>
          <button onclick="poistaOsio(${section.id})" class="action-btn">Poista</button>
        </td>
      </tr>
    `;
    buttonSectionSelect.innerHTML += `<option value="${section.id}">${section.section_key}</option>`;
  });

  contentState.buttons.forEach((button) => {
    buttonsBody.innerHTML += `
      <tr>
        <td>${sectionNameById(button.section_id)}</td>
        <td>${button.icon || ''}</td>
        <td>${button.label_fi}<br><small style="color:#94a3b8;">${button.label_en || ''}</small></td>
        <td>${button.href_fi}<br><small style="color:#94a3b8;">${button.href_en || ''}</small></td>
        <td>${button.sort_order}</td>
        <td>${Number(button.target_blank) === 1 ? '_blank' : 'sama'}</td>
        <td>
          <button onclick="muokkaaNappia(${button.id})" class="action-btn edit-btn">Muokkaa</button>
          <button onclick="siirraNappia(${button.id}, 'up')" class="action-btn edit-btn" style="background:#475569;">↑</button>
          <button onclick="siirraNappia(${button.id}, 'down')" class="action-btn edit-btn" style="background:#475569;">↓</button>
          <button onclick="poistaNappi(${button.id})" class="action-btn">Poista</button>
        </td>
      </tr>
    `;
  });

  contentState.changelog.forEach((entry) => {
    changelogBody.innerHTML += `
      <tr>
        <td>${entry.date_label_fi}<br><small style="color:#94a3b8;">${entry.date_label_en || ''}</small></td>
        <td>${entry.title_fi}<br><small style="color:#94a3b8;">${entry.title_en || ''}</small></td>
        <td style="max-width: 320px; white-space: pre-wrap;">${entry.details_fi || '–'}</td>
        <td>${entry.sort_order}</td>
        <td>
          <button onclick="muokkaaMuutoskirjausta(${entry.id})" class="action-btn edit-btn">Muokkaa</button>
          <button onclick="siirraMuutoskirjausta(${entry.id}, 'up')" class="action-btn edit-btn" style="background:#475569;">↑</button>
          <button onclick="siirraMuutoskirjausta(${entry.id}, 'down')" class="action-btn edit-btn" style="background:#475569;">↓</button>
          <button onclick="poistaMuutoskirjaus(${entry.id})" class="action-btn">Poista</button>
        </td>
      </tr>
    `;
  });
}

async function lataaSisaltoHallinta() {
  const data = await jsonRequest('/api/admin/content', { headers: authHeaders() });
  contentState = {
    sections: data.sections || [],
    buttons: data.buttons || [],
    changelog: data.changelog || []
  };
  renderSisaltoTaulut();
}

async function lisaaOsio() {
  const payload = {
    sectionKey: document.getElementById('new-section-key').value.trim(),
    titleFi: document.getElementById('new-section-title-fi').value.trim(),
    titleEn: document.getElementById('new-section-title-en').value.trim(),
    descriptionFi: document.getElementById('new-section-description-fi').value.trim(),
    descriptionEn: document.getElementById('new-section-description-en').value.trim(),
    sortOrder: Number.parseInt(document.getElementById('new-section-sort').value, 10) || 0,
    isSearchable: document.getElementById('new-section-searchable').checked ? 1 : 0
  };

  if (!payload.sectionKey || !payload.titleFi) return alert('Anna osion avain ja otsikko (fi).');

  try {
    await jsonRequest('/api/admin/home/sections', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    document.getElementById('new-section-key').value = '';
    document.getElementById('new-section-title-fi').value = '';
    document.getElementById('new-section-title-en').value = '';
    document.getElementById('new-section-description-fi').value = '';
    document.getElementById('new-section-description-en').value = '';
    document.getElementById('new-section-sort').value = '0';
    document.getElementById('new-section-searchable').checked = false;
    await lataaSisaltoHallinta();
  } catch (error) {
    alert(error.message);
  }
}

async function muokkaaOsiota(id) {
  const row = contentState.sections.find((section) => section.id === id);
  if (!row) return;

  const sectionKey = prompt('Osion avain', row.section_key);
  if (sectionKey === null) return;
  const titleFi = prompt('Otsikko (fi)', row.title_fi);
  if (titleFi === null) return;
  const titleEn = prompt('Otsikko (en)', row.title_en || '');
  if (titleEn === null) return;
  const descriptionFi = prompt('Kuvaus (fi)', row.description_fi || '');
  if (descriptionFi === null) return;
  const descriptionEn = prompt('Kuvaus (en)', row.description_en || '');
  if (descriptionEn === null) return;
  const sortOrder = prompt('Järjestysnumero', row.sort_order);
  if (sortOrder === null) return;
  const searchable = confirm('Onko osio hakukentän piirissä? OK = kyllä, Peruuta = ei');

  try {
    await jsonRequest(`/api/admin/home/sections/${id}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        sectionKey,
        titleFi,
        titleEn,
        descriptionFi,
        descriptionEn,
        sortOrder: Number.parseInt(sortOrder, 10) || 0,
        isSearchable: searchable ? 1 : 0
      })
    });
    await lataaSisaltoHallinta();
  } catch (error) {
    alert(error.message);
  }
}

async function siirraOsiota(id, direction) {
  try {
    await jsonRequest(`/api/admin/home/sections/${id}/move`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ direction })
    });
    await lataaSisaltoHallinta();
  } catch (error) {
    alert(error.message);
  }
}

async function poistaOsio(id) {
  if (!confirm('Poistetaanko osio? Tämä poistaa myös sen napit.')) return;
  try {
    await jsonRequest(`/api/admin/home/sections/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    await lataaSisaltoHallinta();
  } catch (error) {
    alert(error.message);
  }
}

async function lisaaNappi() {
  const payload = {
    sectionId: Number.parseInt(document.getElementById('new-button-section-id').value, 10),
    icon: document.getElementById('new-button-icon').value.trim(),
    labelFi: document.getElementById('new-button-label-fi').value.trim(),
    labelEn: document.getElementById('new-button-label-en').value.trim(),
    hrefFi: document.getElementById('new-button-href-fi').value.trim(),
    hrefEn: document.getElementById('new-button-href-en').value.trim(),
    sortOrder: Number.parseInt(document.getElementById('new-button-sort').value, 10) || 0,
    targetBlank: document.getElementById('new-button-target').checked ? 1 : 0
  };

  if (!payload.sectionId || !payload.labelFi || !payload.hrefFi) return alert('Anna osio, nimi (fi) ja polku (fi).');

  try {
    await jsonRequest('/api/admin/home/buttons', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    document.getElementById('new-button-icon').value = '';
    document.getElementById('new-button-label-fi').value = '';
    document.getElementById('new-button-label-en').value = '';
    document.getElementById('new-button-href-fi').value = '';
    document.getElementById('new-button-href-en').value = '';
    document.getElementById('new-button-sort').value = '0';
    document.getElementById('new-button-target').checked = false;
    await lataaSisaltoHallinta();
  } catch (error) {
    alert(error.message);
  }
}

async function muokkaaNappia(id) {
  const row = contentState.buttons.find((button) => button.id === id);
  if (!row) return;

  const sectionId = prompt('Osion ID', String(row.section_id));
  if (sectionId === null) return;
  const icon = prompt('Ikoni', row.icon || '');
  if (icon === null) return;
  const labelFi = prompt('Nimi (fi)', row.label_fi || '');
  if (labelFi === null) return;
  const labelEn = prompt('Nimi (en)', row.label_en || '');
  if (labelEn === null) return;
  const hrefFi = prompt('Polku/URL (fi)', row.href_fi || '');
  if (hrefFi === null) return;
  const hrefEn = prompt('Polku/URL (en)', row.href_en || row.href_fi || '');
  if (hrefEn === null) return;
  const sortOrder = prompt('Järjestysnumero', row.sort_order);
  if (sortOrder === null) return;
  const targetBlank = confirm('Avataanko uudessa välilehdessä? OK = kyllä, Peruuta = ei');

  try {
    await jsonRequest(`/api/admin/home/buttons/${id}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        sectionId: Number.parseInt(sectionId, 10),
        icon,
        labelFi,
        labelEn,
        hrefFi,
        hrefEn,
        sortOrder: Number.parseInt(sortOrder, 10) || 0,
        targetBlank: targetBlank ? 1 : 0
      })
    });
    await lataaSisaltoHallinta();
  } catch (error) {
    alert(error.message);
  }
}

async function siirraNappia(id, direction) {
  try {
    await jsonRequest(`/api/admin/home/buttons/${id}/move`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ direction })
    });
    await lataaSisaltoHallinta();
  } catch (error) {
    alert(error.message);
  }
}

async function poistaNappi(id) {
  if (!confirm('Poistetaanko nappi?')) return;
  try {
    await jsonRequest(`/api/admin/home/buttons/${id}`, { method: 'DELETE', headers: authHeaders() });
    await lataaSisaltoHallinta();
  } catch (error) {
    alert(error.message);
  }
}

async function lisaaMuutoskirjaus() {
  const payload = {
    dateIso: document.getElementById('new-change-date-iso').value.trim(),
    dateLabelFi: document.getElementById('new-change-date-fi').value.trim(),
    dateLabelEn: document.getElementById('new-change-date-en').value.trim(),
    titleFi: document.getElementById('new-change-title-fi').value.trim(),
    titleEn: document.getElementById('new-change-title-en').value.trim(),
    detailsFi: document.getElementById('new-change-details-fi').value.trim(),
    detailsEn: document.getElementById('new-change-details-en').value.trim(),
    sortOrder: Number.parseInt(document.getElementById('new-change-sort').value, 10) || 0
  };

  if (!payload.dateLabelFi || !payload.titleFi) return alert('Anna päivämäärä ja otsikko suomeksi.');

  try {
    await jsonRequest('/api/admin/changelog', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    document.getElementById('new-change-date-iso').value = '';
    document.getElementById('new-change-date-fi').value = '';
    document.getElementById('new-change-date-en').value = '';
    document.getElementById('new-change-title-fi').value = '';
    document.getElementById('new-change-title-en').value = '';
    document.getElementById('new-change-details-fi').value = '';
    document.getElementById('new-change-details-en').value = '';
    document.getElementById('new-change-sort').value = '0';
    await lataaSisaltoHallinta();
  } catch (error) {
    alert(error.message);
  }
}

async function muokkaaMuutoskirjausta(id) {
  const row = contentState.changelog.find((entry) => entry.id === id);
  if (!row) return;

  const dateIso = prompt('ISO-päivä (YYYY-MM-DD)', row.date_iso || '');
  if (dateIso === null) return;
  const dateLabelFi = prompt('Päivämäärä (fi)', row.date_label_fi || '');
  if (dateLabelFi === null) return;
  const dateLabelEn = prompt('Päivämäärä (en)', row.date_label_en || row.date_label_fi || '');
  if (dateLabelEn === null) return;
  const titleFi = prompt('Otsikko (fi)', row.title_fi || '');
  if (titleFi === null) return;
  const titleEn = prompt('Otsikko (en)', row.title_en || row.title_fi || '');
  if (titleEn === null) return;
  const detailsFi = prompt('Kohdat (fi, rivinvaihdoilla)', row.details_fi || '');
  if (detailsFi === null) return;
  const detailsEn = prompt('Kohdat (en, rivinvaihdoilla)', row.details_en || row.details_fi || '');
  if (detailsEn === null) return;
  const sortOrder = prompt('Järjestysnumero', row.sort_order);
  if (sortOrder === null) return;

  try {
    await jsonRequest(`/api/admin/changelog/${id}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        dateIso,
        dateLabelFi,
        dateLabelEn,
        titleFi,
        titleEn,
        detailsFi,
        detailsEn,
        sortOrder: Number.parseInt(sortOrder, 10) || 0
      })
    });
    await lataaSisaltoHallinta();
  } catch (error) {
    alert(error.message);
  }
}

async function siirraMuutoskirjausta(id, direction) {
  try {
    await jsonRequest(`/api/admin/changelog/${id}/move`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ direction })
    });
    await lataaSisaltoHallinta();
  } catch (error) {
    alert(error.message);
  }
}

async function poistaMuutoskirjaus(id) {
  if (!confirm('Poistetaanko muutoskirjaus?')) return;
  try {
    await jsonRequest(`/api/admin/changelog/${id}`, { method: 'DELETE', headers: authHeaders() });
    await lataaSisaltoHallinta();
  } catch (error) {
    alert(error.message);
  }
}

window.toggleMode = toggleMode;
window.login = login;
window.register = register;
window.vaihdaSalasana = vaihdaSalasana;
window.logout = logout;
window.lataaTiedot = lataaTiedot;
window.luoUusiLinkki = luoUusiLinkki;
window.muokkaaLinkkia = muokkaaLinkkia;
window.poistaLinkki = poistaLinkki;
window.poistaPaste = poistaPaste;
window.poistaKayttaja = poistaKayttaja;
window.luoKutsukoodi = luoKutsukoodi;
window.poistaKutsu = poistaKutsu;
window.lahetaAdminViesti = lahetaAdminViesti;
window.vastaaVieraskirjaan = vastaaVieraskirjaan;
window.poistaVieraskirjaviesti = poistaVieraskirjaviesti;
window.lataaTiedosto = lataaTiedosto;
window.kopioiLinkki = kopioiLinkki;
window.poistaAdminTiedosto = poistaAdminTiedosto;
window.lisaaOsio = lisaaOsio;
window.muokkaaOsiota = muokkaaOsiota;
window.siirraOsiota = siirraOsiota;
window.poistaOsio = poistaOsio;
window.lisaaNappi = lisaaNappi;
window.muokkaaNappia = muokkaaNappia;
window.siirraNappia = siirraNappia;
window.poistaNappi = poistaNappi;
window.lisaaMuutoskirjaus = lisaaMuutoskirjaus;
window.muokkaaMuutoskirjausta = muokkaaMuutoskirjausta;
window.siirraMuutoskirjausta = siirraMuutoskirjausta;
window.poistaMuutoskirjaus = poistaMuutoskirjaus;
window.toggleSection = toggleSection;
window.tallennaMuokattuLinkki = tallennaMuokattuLinkki;
window.suljeLinkkireditointi = suljeLinkkireditointi;
window.muokkaaGbViestia = muokkaaGbViestia;
window.tallennaMuokattuGbViesti = tallennaMuokattuGbViesti;
window.suljeGbMuokkaus = suljeGbMuokkaus;
