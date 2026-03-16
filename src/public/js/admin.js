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

  function loadConfig() {
    document.getElementById('cfgAccountId').textContent = 'Configure dans .env';
    document.getElementById('cfgDiscord').textContent = 'Configure dans .env';
  }

  logoutBtn.addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  });

  checkAdobeStatus();
  loadUploads();
  loadProjects();
  loadConfig();
})();
