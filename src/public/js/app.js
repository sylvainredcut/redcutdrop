(function () {
  // ---- DOM refs ----
  const clientSelect = document.getElementById('clientSelect');
  const weekSelect = document.getElementById('weekSelect');
  const brandSelect = document.getElementById('brandSelect');
  const publishClientSelect = document.getElementById('publishClientSelect');
  const fileInput = document.getElementById('fileInput');
  const dropzone = document.getElementById('dropzone');
  const dropzoneInner = document.getElementById('dropzoneInner');
  const fileList = document.getElementById('fileList');
  const browseBtn = document.getElementById('browseBtn');
  const uploadForm = document.getElementById('uploadForm');
  const uploadBtn = document.getElementById('uploadBtn');
  const progressSection = document.getElementById('progressSection');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const uploadError = document.getElementById('uploadError');
  const successPanel = document.getElementById('successPanel');
  const successTitle = document.getElementById('successTitle');
  const successMsg = document.getElementById('successMsg');
  const shareLink = document.getElementById('shareLink');
  const resetBtn = document.getElementById('resetBtn');
  const commentInput = document.getElementById('commentInput');
  const revisionFields = document.getElementById('revisionFields');
  const publishFields = document.getElementById('publishFields');
  const fileHint = document.getElementById('fileHint');

  let currentMode = 'revision'; // 'revision' or 'publish'
  let selectedFiles = [];

  function getMaxFiles() {
    return currentMode === 'revision' ? 3 : 1;
  }

  // ---- Mode switching ----
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentMode = tab.dataset.mode;

      if (currentMode === 'revision') {
        revisionFields.style.display = 'block';
        publishFields.style.display = 'none';
        fileHint.textContent = '(3 max)';
        fileInput.multiple = true;
        uploadBtn.textContent = 'Envoyer vers Frame.io';
      } else {
        revisionFields.style.display = 'none';
        publishFields.style.display = 'block';
        fileHint.textContent = '(1 fichier)';
        fileInput.multiple = false;
        uploadBtn.textContent = 'Mettre en ligne';
      }

      // Clear files when switching mode
      clearFiles();
      uploadError.style.display = 'none';
      updateUploadBtn();
    });
  });

  // ---- Load clients (Frame.io projects — for revision mode) ----
  async function loadClients() {
    try {
      const res = await fetch('/api/clients', { headers: { 'Accept': 'application/json' } });
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (!res.ok) throw new Error('Erreur serveur');
      const clients = await res.json();
      clients.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

      clientSelect.innerHTML = '<option value="">Selectionner un client...</option>';
      publishClientSelect.innerHTML = '<option value="">Pas d\'archivage Frame.io</option>';

      clients.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        opt.dataset.name = c.name;
        clientSelect.appendChild(opt);

        // Also populate the optional Frame.io archive select in publish mode
        const opt2 = opt.cloneNode(true);
        publishClientSelect.appendChild(opt2);
      });
    } catch {
      clientSelect.innerHTML = '<option value="">Erreur de chargement</option>';
    }
  }

  // ---- Load brands (Baserow — for publish mode) ----
  async function loadBrands() {
    try {
      const res = await fetch('/api/brands', { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('Erreur serveur');
      const brands = await res.json();
      brandSelect.innerHTML = '<option value="">Selectionner une marque...</option>';
      brands.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.name;
        opt.textContent = b.name;
        brandSelect.appendChild(opt);
      });
    } catch {
      brandSelect.innerHTML = '<option value="">Erreur de chargement</option>';
    }
  }

  // ---- Week dropdown: S01-S52 with dates + Youtube ----
  function getWeekDates(weekNum, year) {
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { monday, sunday };
  }

  function formatShortDate(d) {
    return d.getDate() + '/' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function generateWeeks() {
    const year = new Date().getFullYear();
    weekSelect.innerHTML = '<option value="">Selectionner une semaine...</option>';
    for (let w = 1; w <= 52; w++) {
      const opt = document.createElement('option');
      const label = 'S' + String(w).padStart(2, '0');
      const { monday, sunday } = getWeekDates(w, year);
      opt.value = label;
      opt.textContent = label + '  (' + formatShortDate(monday) + ' — ' + formatShortDate(sunday) + ')';
      weekSelect.appendChild(opt);
    }
    const ytOpt = document.createElement('option');
    ytOpt.value = 'Youtube';
    ytOpt.textContent = 'Youtube';
    weekSelect.appendChild(ytOpt);
  }

  // ---- File handling ----
  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' o';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' Ko';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' Mo';
    return (bytes / 1073741824).toFixed(2) + ' Go';
  }

  function renderFileList() {
    fileList.innerHTML = '';
    if (selectedFiles.length === 0) {
      dropzoneInner.style.display = 'flex';
      return;
    }
    dropzoneInner.style.display = 'none';
    selectedFiles.forEach((file, idx) => {
      const row = document.createElement('div');
      row.className = 'file-selected';
      row.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="#e63946" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline points="14 2 14 8 20 8" stroke="#e63946" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div>
          <p class="file-name">${file.name}</p>
          <p class="file-size">${formatFileSize(file.size)}</p>
        </div>
        <button type="button" class="remove-btn" data-idx="${idx}">x</button>
      `;
      fileList.appendChild(row);
    });
    fileList.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedFiles.splice(parseInt(btn.dataset.idx), 1);
        renderFileList();
        updateUploadBtn();
      });
    });
  }

  function addFiles(newFiles) {
    const max = getMaxFiles();
    for (const file of newFiles) {
      if (selectedFiles.length >= max) break;
      if (!selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
        selectedFiles.push(file);
      }
    }
    renderFileList();
    updateUploadBtn();
  }

  function clearFiles() {
    selectedFiles = [];
    fileInput.value = '';
    renderFileList();
    updateUploadBtn();
  }

  function updateUploadBtn() {
    if (currentMode === 'revision') {
      uploadBtn.disabled = !(selectedFiles.length > 0 && clientSelect.value && weekSelect.value);
    } else {
      uploadBtn.disabled = !(selectedFiles.length > 0 && brandSelect.value);
    }
  }

  browseBtn.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('click', (e) => {
    if (e.target === dropzone || e.target.closest('.dropzone-inner')) {
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) addFiles(fileInput.files);
  });

  clientSelect.addEventListener('change', updateUploadBtn);
  weekSelect.addEventListener('change', updateUploadBtn);
  brandSelect.addEventListener('change', updateUploadBtn);

  // ---- Drag & drop ----
  ['dragenter', 'dragover'].forEach(ev => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  // ---- Upload (Revision mode) ----
  function submitRevision() {
    const projectId = clientSelect.value;
    const selectedOption = clientSelect.options[clientSelect.selectedIndex];
    const clientName = selectedOption.dataset.name || selectedOption.textContent;
    const week = weekSelect.value;

    const formData = new FormData();
    selectedFiles.forEach(f => formData.append('videos', f));
    formData.append('projectId', projectId);
    formData.append('clientName', clientName);
    formData.append('week', week);
    formData.append('comment', commentInput.value.trim());

    return { url: '/api/upload', formData };
  }

  // ---- Upload (Publish mode) ----
  function submitPublish() {
    const brandName = brandSelect.value;
    const projectId = publishClientSelect.value || '';

    const formData = new FormData();
    formData.append('video', selectedFiles[0]);
    formData.append('brandName', brandName);
    formData.append('projectId', projectId);
    formData.append('comment', commentInput.value.trim());

    return { url: '/api/publish', formData };
  }

  // ---- Form submit ----
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (selectedFiles.length === 0) return;

    uploadError.style.display = 'none';
    uploadBtn.disabled = true;
    uploadBtn.textContent = currentMode === 'revision' ? 'Upload en cours...' : 'Mise en ligne en cours...';
    progressSection.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Envoi en cours...';

    const { url, formData } = currentMode === 'revision' ? submitRevision() : submitPublish();

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);

      xhr.upload.addEventListener('progress', (ev) => {
        if (ev.lengthComputable) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          progressFill.style.width = pct + '%';
          progressText.textContent = 'Envoi : ' + pct + '% (' + formatFileSize(ev.loaded) + ' / ' + formatFileSize(ev.total) + ')';
        }
      });

      const result = await new Promise((resolve, reject) => {
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
              resolve(data);
            } else {
              reject(new Error(data.error || 'Upload echoue'));
            }
          } catch {
            reject(new Error('Reponse serveur invalide'));
          }
        };
        xhr.onerror = () => reject(new Error('Erreur reseau'));
        xhr.send(formData);
      });

      progressSection.style.display = 'none';
      uploadForm.style.display = 'none';

      if (currentMode === 'revision') {
        const names = result.assets.map(a => a.name).join(', ');
        successTitle.textContent = 'Upload reussi !';
        successMsg.textContent = names + (result.assets.length > 1 ? ' ont ete uploades avec succes.' : ' a ete uploade avec succes.');
        shareLink.href = result.shareLink;
        shareLink.textContent = 'Voir et commenter sur Frame.io';
        shareLink.style.display = '';
      } else {
        successTitle.textContent = 'Mise en ligne lancee !';
        successMsg.textContent = result.asset.name + ' a ete envoye. Le workflow N8N va creer le brouillon Metricool.';
        if (result.shareLink) {
          shareLink.href = result.shareLink;
          shareLink.textContent = 'Voir sur Frame.io';
          shareLink.style.display = '';
        } else {
          shareLink.style.display = 'none';
        }
      }

      successPanel.style.display = 'flex';

    } catch (err) {
      progressSection.style.display = 'none';
      uploadError.textContent = err.message;
      uploadError.style.display = 'block';
      uploadBtn.disabled = false;
      uploadBtn.textContent = currentMode === 'revision' ? 'Envoyer vers Frame.io' : 'Mettre en ligne';
    }
  });

  // ---- Reset ----
  resetBtn.addEventListener('click', () => {
    successPanel.style.display = 'none';
    uploadForm.style.display = 'block';
    clearFiles();
    commentInput.value = '';
    uploadBtn.textContent = currentMode === 'revision' ? 'Envoyer vers Frame.io' : 'Mettre en ligne';
    progressFill.style.width = '0%';
  });

  // ---- User info & logout ----
  async function loadUser() {
    try {
      const res = await fetch('/auth/me');
      if (res.ok) {
        const data = await res.json();
        const nameEl = document.getElementById('userName');
        if (data.user) nameEl.textContent = data.user.name;
        else if (data.admin) nameEl.textContent = 'Admin';
      }
    } catch {}
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  // ---- Init ----
  loadUser();
  loadClients();
  loadBrands();
  generateWeeks();
})();
