(function () {
  const uploadsTable = document.getElementById('uploadsTable');
  const uploadsBody = document.getElementById('uploadsBody');
  const uploadsLoading = document.getElementById('uploadsLoading');
  const uploadsEmpty = document.getElementById('uploadsEmpty');
  const projectsLoading = document.getElementById('projectsLoading');
  const projectsList = document.getElementById('projectsList');
  const logoutBtn = document.getElementById('logoutBtn');
  const adobeStatus = document.getElementById('adobeStatus');
  const adobeActions = document.getElementById('adobeActions');
  const adobeConnected = document.getElementById('adobeConnected');

  // Access modal elements
  const accessModal = document.getElementById('accessModal');
  const accessModalTitle = document.getElementById('accessModalTitle');
  const accessClientsList = document.getElementById('accessClientsList');
  const closeAccessModal = document.getElementById('closeAccessModal');
  const cancelAccessBtn = document.getElementById('cancelAccessBtn');
  const saveAccessBtn = document.getElementById('saveAccessBtn');

  let allProjects = []; // cached Frame.io projects
  let allUserClients = {}; // userId -> Set of projectIds
  let currentEditUserId = null;

  function formatSize(bytes) {
    if (!bytes) return '--';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' Ko';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' Mo';
    return (bytes / 1073741824).toFixed(2) + ' Go';
  }

  function formatDate(iso) {
    if (!iso) return '--';
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function checkAdobeStatus() {
    try {
      const res = await fetch('/auth/status');
      const data = await res.json();
      adobeStatus.style.display = 'none';
      if (data.connected) {
        adobeConnected.style.display = 'flex';
      } else {
        adobeActions.style.display = 'block';
      }
    } catch {
      adobeStatus.textContent = 'Erreur de verification';
    }
  }

  async function loadUploads() {
    try {
      const res = await fetch('/api/admin/uploads', { headers: { Accept: 'application/json' } });
      if (res.status === 401) { window.location.href = '/admin/login'; return; }
      const uploads = await res.json();
      uploadsLoading.style.display = 'none';

      if (!uploads.length) { uploadsEmpty.style.display = 'block'; return; }

      uploadsTable.style.display = 'table';
      uploads.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td class="cell-filename">' + escapeHtml(u.filename) + '</td>' +
          '<td>' + escapeHtml(u.client) + '</td>' +
          '<td>' + escapeHtml(u.week) + '</td>' +
          '<td>' + formatSize(u.filesize) + '</td>' +
          '<td>' + formatDate(u.uploaded_at) + '</td>' +
          '<td>' + (u.frameio_link ? '<a href="' + escapeHtml(u.frameio_link) + '" target="_blank" class="link-btn">Voir</a>' : '--') + '</td>';
        uploadsBody.appendChild(tr);
      });
    } catch {
      uploadsLoading.textContent = 'Erreur de chargement';
    }
  }

  async function loadProjects() {
    try {
      const res = await fetch('/api/admin/projects', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error();
      const projects = await res.json();
      allProjects = projects;
      projectsLoading.style.display = 'none';

      if (!projects.length) { projectsList.innerHTML = '<p class="empty-text">Aucun projet trouve.</p>'; return; }

      let html = '<div class="projects-grid">';
      projects.forEach(p => {
        html += '<div class="project-item"><strong>' + escapeHtml(p.name) + '</strong><code>' + escapeHtml(p.id) + '</code></div>';
      });
      html += '</div>';
      projectsList.innerHTML = html;
    } catch {
      projectsLoading.textContent = 'Erreur (verifiez la connexion Adobe)';
    }
  }

  async function loadAllUserClients() {
    try {
      const res = await fetch('/api/admin/users-clients', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      allUserClients = {};
      data.forEach(uc => {
        if (!allUserClients[uc.user_id]) allUserClients[uc.user_id] = new Set();
        allUserClients[uc.user_id].add(uc.client_project_id);
      });
    } catch {}
  }

  function getAccessBadge(userId) {
    const userSet = allUserClients[userId];
    if (!userSet || userSet.size === 0) {
      return '<span class="access-badge none">Aucun</span>';
    }
    if (allProjects.length > 0 && userSet.size >= allProjects.length) {
      return '<span class="access-badge all">Tous (' + userSet.size + ')</span>';
    }
    return '<span class="access-badge partial">' + userSet.size + ' client' + (userSet.size > 1 ? 's' : '') + '</span>';
  }

  function loadConfig() {
    document.getElementById('cfgAccountId').textContent = 'Configure dans .env';
    document.getElementById('cfgDiscord').textContent = 'Configure dans .env';
  }

  logoutBtn.addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  });

  // ---- Users management ----
  const usersTable = document.getElementById('usersTable');
  const usersBody = document.getElementById('usersBody');
  const usersLoading = document.getElementById('usersLoading');
  const usersEmpty = document.getElementById('usersEmpty');
  const addUserForm = document.getElementById('addUserForm');
  const userError = document.getElementById('userError');

  async function loadUsers() {
    try {
      const res = await fetch('/api/admin/users', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error();
      const users = await res.json();
      usersLoading.style.display = 'none';
      usersBody.innerHTML = '';

      if (!users.length) { usersEmpty.style.display = 'block'; usersTable.style.display = 'none'; return; }

      usersEmpty.style.display = 'none';
      usersTable.style.display = 'table';
      users.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + escapeHtml(u.name) + '</td>' +
          '<td>' + escapeHtml(u.email) + '</td>' +
          '<td>' + getAccessBadge(u.id) + '</td>' +
          '<td>' + formatDate(u.created_at) + '</td>' +
          '<td style="white-space:nowrap">' +
            '<button class="btn btn-outline btn-sm access-btn" data-id="' + u.id + '" data-name="' + escapeHtml(u.name) + '" style="margin-right:4px">Acces</button>' +
            '<button class="btn btn-ghost btn-sm delete-user-btn" data-id="' + u.id + '">Supprimer</button>' +
          '</td>';
        usersBody.appendChild(tr);
      });

      usersBody.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Supprimer ce monteur ?')) return;
          try {
            await fetch('/api/admin/users/' + btn.dataset.id, { method: 'DELETE' });
            await loadAllUserClients();
            loadUsers();
          } catch {}
        });
      });

      usersBody.querySelectorAll('.access-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          openAccessModal(parseInt(btn.dataset.id), btn.dataset.name);
        });
      });
    } catch {
      usersLoading.textContent = 'Erreur de chargement';
    }
  }

  // ---- Access modal ----
  async function openAccessModal(userId, userName) {
    currentEditUserId = userId;
    accessModalTitle.textContent = 'Acces — ' + userName;

    // Get current user's clients
    let userClientIds = new Set();
    try {
      const res = await fetch('/api/admin/users/' + userId + '/clients');
      if (res.ok) {
        const data = await res.json();
        data.forEach(c => userClientIds.add(c.client_project_id));
      }
    } catch {}

    // Build checkbox list
    const sorted = [...allProjects].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    accessClientsList.innerHTML = '';

    if (sorted.length === 0) {
      accessClientsList.innerHTML = '<p class="empty-text">Aucun projet Frame.io disponible. Verifiez la connexion Adobe.</p>';
      accessModal.style.display = 'flex';
      return;
    }

    // Select all / none
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex; gap:12px; margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--border);';
    controls.innerHTML = '<button type="button" class="btn btn-ghost btn-sm" id="selectAllClients">Tout selectionner</button>' +
                         '<button type="button" class="btn btn-ghost btn-sm" id="selectNoneClients">Tout deselectionner</button>';
    accessClientsList.appendChild(controls);

    sorted.forEach(p => {
      const label = document.createElement('label');
      label.className = 'client-checkbox';
      label.innerHTML = '<input type="checkbox" value="' + escapeHtml(p.id) + '" data-name="' + escapeHtml(p.name) + '"' +
                        (userClientIds.has(p.id) ? ' checked' : '') + '>' +
                        '<span>' + escapeHtml(p.name) + '</span>';
      accessClientsList.appendChild(label);
    });

    document.getElementById('selectAllClients').addEventListener('click', () => {
      accessClientsList.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);
    });
    document.getElementById('selectNoneClients').addEventListener('click', () => {
      accessClientsList.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
    });

    accessModal.style.display = 'flex';
  }

  function closeModal() {
    accessModal.style.display = 'none';
    currentEditUserId = null;
  }

  closeAccessModal.addEventListener('click', closeModal);
  cancelAccessBtn.addEventListener('click', closeModal);
  accessModal.addEventListener('click', (e) => {
    if (e.target === accessModal) closeModal();
  });

  saveAccessBtn.addEventListener('click', async () => {
    if (!currentEditUserId) return;

    const checkboxes = accessClientsList.querySelectorAll('input[type=checkbox]:checked');
    const clients = Array.from(checkboxes).map(cb => ({
      id: cb.value,
      name: cb.dataset.name
    }));

    saveAccessBtn.disabled = true;
    saveAccessBtn.textContent = 'Enregistrement...';

    try {
      const res = await fetch('/api/admin/users/' + currentEditUserId + '/clients', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clients })
      });
      if (!res.ok) throw new Error();
      await loadAllUserClients();
      loadUsers();
      closeModal();
    } catch {
      alert('Erreur lors de l\'enregistrement');
    } finally {
      saveAccessBtn.disabled = false;
      saveAccessBtn.textContent = 'Enregistrer';
    }
  });

  addUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    userError.style.display = 'none';
    const name = document.getElementById('newUserName').value.trim();
    const email = document.getElementById('newUserEmail').value.trim();
    const password = document.getElementById('newUserPassword').value;

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });
      const data = await res.json();
      if (!res.ok) {
        userError.textContent = data.error || 'Erreur';
        userError.style.display = 'block';
        return;
      }
      addUserForm.reset();
      loadUsers();
    } catch {
      userError.textContent = 'Erreur réseau';
      userError.style.display = 'block';
    }
  });

  // ---- Init ----
  async function init() {
    checkAdobeStatus();
    loadUploads();
    loadConfig();
    await loadProjects(); // need projects first for access badges
    await loadAllUserClients();
    loadUsers();
  }

  init();
})();
