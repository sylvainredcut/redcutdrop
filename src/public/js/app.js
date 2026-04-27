(function () {
  // ---- DOM refs ----
  const clientSelect = document.getElementById('clientSelect');
  const weekSelect = document.getElementById('weekSelect');
  const brandSelect = document.getElementById('brandSelect');
  const publishWeekSelect = document.getElementById('publishWeekSelect');
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

  const transcriptionInput = document.getElementById('transcriptionInput');
  const transcriptionDrop = document.getElementById('transcriptionDrop');
  const transcriptionBrowse = document.getElementById('transcriptionBrowse');
  const transcriptionPlaceholder = document.getElementById('transcriptionPlaceholder');
  const transcriptionSelected = document.getElementById('transcriptionSelected');
  const transcriptionName = document.getElementById('transcriptionName');
  const transcriptionRemove = document.getElementById('transcriptionRemove');

  let currentMode = 'revision';
  let selectedFiles = [];
  let transcriptionFile = null;
  let transcriptionFiles = []; // Multi-transcription for publish mode

  function getMaxFiles() {
    return currentMode === 'revision' ? 3 : 20;
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
        if (transcriptionDrop) transcriptionDrop.style.display = '';
        const transcriptionLabelRev = document.querySelector('label[for="transcriptionInput"]');
        if (transcriptionLabelRev) transcriptionLabelRev.style.display = '';
      } else {
        revisionFields.style.display = 'none';
        publishFields.style.display = 'block';
        fileHint.textContent = '(videos + transcriptions .txt)';
        fileInput.multiple = true;
        uploadBtn.textContent = 'Mettre en ligne';
        // Hide single transcription zone + label — matching is automatic via filename
        if (transcriptionDrop) transcriptionDrop.style.display = 'none';
        const transcriptionLabel = document.querySelector('label[for="transcriptionInput"]');
        if (transcriptionLabel) transcriptionLabel.style.display = 'none';
      }

      clearFiles();
      clearTranscription();
      transcriptionFiles = [];
      uploadError.style.display = 'none';
      updateUploadBtn();
    });
  });

  // ---- Load clients (Frame.io projects) ----
  async function loadClients() {
    try {
      const res = await fetch('/api/clients', { headers: { 'Accept': 'application/json' } });
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (!res.ok) throw new Error('Erreur serveur');
      const clients = await res.json();
      clients.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

      clientSelect.innerHTML = '<option value="">Selectionner un client...</option>';
      publishClientSelect.innerHTML = '<option value="">Selectionner un client...</option>';

      clients.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        opt.dataset.name = c.name;
        clientSelect.appendChild(opt);

        const opt2 = opt.cloneNode(true);
        publishClientSelect.appendChild(opt2);
      });
    } catch {
      clientSelect.innerHTML = '<option value="">Erreur de chargement</option>';
    }
  }

  // ---- Load brands (Baserow) ----
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

  // ---- Week helpers ----
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

  function populateWeekSelect(selectEl, options) {
    const year = new Date().getFullYear();
    selectEl.innerHTML = '<option value="">Selectionner une semaine...</option>';
    for (let w = 1; w <= 52; w++) {
      const opt = document.createElement('option');
      const label = 'S' + String(w).padStart(2, '0');
      const { monday, sunday } = getWeekDates(w, year);
      opt.value = label;
      opt.textContent = label + '  (' + formatShortDate(monday) + ' — ' + formatShortDate(sunday) + ')';
      selectEl.appendChild(opt);
    }
    if (options?.includeYoutube) {
      const ytOpt = document.createElement('option');
      ytOpt.value = 'Youtube';
      ytOpt.textContent = 'Youtube';
      selectEl.appendChild(ytOpt);
    }
  }

  // ---- File handling ----
  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' o';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' Ko';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' Mo';
    return (bytes / 1073741824).toFixed(2) + ' Go';
  }

  function getBaseName(filename) {
    return filename.replace(/\.[^.]+$/, '').toLowerCase().trim();
  }

  function findMatchingTranscription(videoFile) {
    const videoBase = getBaseName(videoFile.name);
    return transcriptionFiles.find(t => getBaseName(t.name) === videoBase) || null;
  }

  function renderFileList() {
    fileList.innerHTML = '';
    if (selectedFiles.length === 0 && transcriptionFiles.length === 0) {
      dropzoneInner.style.display = 'flex';
      return;
    }
    dropzoneInner.style.display = 'none';
    selectedFiles.forEach((file, idx) => {
      const matched = currentMode === 'publish' ? findMatchingTranscription(file) : null;
      const matchLabel = matched ? ' + ' + matched.name : (currentMode === 'publish' ? ' (pas de transcription)' : '');
      const matchColor = matched ? '#2a9d8f' : '#999';
      const row = document.createElement('div');
      row.className = 'file-selected';
      row.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="#e63946" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline points="14 2 14 8 20 8" stroke="#e63946" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div>
          <p class="file-name">${file.name}</p>
          <p class="file-size">${formatFileSize(file.size)}${currentMode === 'publish' ? '<span style="color:' + matchColor + '; margin-left:8px; font-size:0.85em">' + matchLabel + '</span>' : ''}</p>
        </div>
        <button type="button" class="remove-btn" data-idx="${idx}">x</button>
      `;
      fileList.appendChild(row);
    });
    // Show unmatched transcription files
    if (currentMode === 'publish') {
      const matchedBases = selectedFiles.map(f => getBaseName(f.name));
      transcriptionFiles.forEach((tf, idx) => {
        const isMatched = matchedBases.includes(getBaseName(tf.name));
        if (!isMatched) {
          const row = document.createElement('div');
          row.className = 'file-selected';
          row.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="#999" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div>
              <p class="file-name" style="color:#999">${tf.name} (pas de video correspondante)</p>
            </div>
            <button type="button" class="remove-btn" data-type="transcription" data-idx="${idx}">x</button>
          `;
          fileList.appendChild(row);
        }
      });
    }
    fileList.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.dataset.type === 'transcription') {
          transcriptionFiles.splice(parseInt(btn.dataset.idx), 1);
        } else {
          selectedFiles.splice(parseInt(btn.dataset.idx), 1);
        }
        renderFileList();
        updateUploadBtn();
      });
    });
  }

  const TEXT_EXTENSIONS = /\.(txt|srt|vtt|doc|docx|rtf)$/i;
  const VIDEO_EXTENSIONS = /\.(mp4|mov|avi|mxf|mts|m2ts|mkv|wmv|flv|webm|prores|r3d|braw|mpg|mpeg|m4v|3gp|ts)$/i;

  function addFiles(newFiles) {
    for (const file of newFiles) {
      if (currentMode === 'publish' && TEXT_EXTENSIONS.test(file.name)) {
        if (!transcriptionFiles.some(f => f.name === file.name)) {
          transcriptionFiles.push(file);
        }
      } else {
        const max = getMaxFiles();
        if (selectedFiles.length >= max) continue;
        if (!selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
          selectedFiles.push(file);
        }
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
      uploadBtn.disabled = !(selectedFiles.length > 0 && brandSelect.value && publishWeekSelect.value);
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
  publishWeekSelect.addEventListener('change', updateUploadBtn);

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

  // ---- Transcription file handling ----
  transcriptionBrowse.addEventListener('click', (e) => { e.preventDefault(); transcriptionInput.click(); });
  transcriptionDrop.addEventListener('click', (e) => {
    if (e.target.closest('.remove-btn')) return;
    if (!transcriptionFile) transcriptionInput.click();
  });
  transcriptionInput.addEventListener('change', () => {
    if (transcriptionInput.files.length) setTranscription(transcriptionInput.files[0]);
  });
  ['dragenter', 'dragover'].forEach(ev => {
    transcriptionDrop.addEventListener(ev, (e) => { e.preventDefault(); transcriptionDrop.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(ev => {
    transcriptionDrop.addEventListener(ev, (e) => { e.preventDefault(); transcriptionDrop.classList.remove('dragover'); });
  });
  transcriptionDrop.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) setTranscription(e.dataTransfer.files[0]);
  });
  transcriptionRemove.addEventListener('click', () => { clearTranscription(); });

  function setTranscription(file) {
    transcriptionFile = file;
    transcriptionPlaceholder.style.display = 'none';
    transcriptionSelected.style.display = 'flex';
    transcriptionName.textContent = file.name;
  }
  function clearTranscription() {
    transcriptionFile = null;
    transcriptionInput.value = '';
    transcriptionPlaceholder.style.display = 'flex';
    transcriptionSelected.style.display = 'none';
  }

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
    const week = publishWeekSelect.value;

    const formData = new FormData();
    formData.append('video', selectedFiles[0]);
    formData.append('brandName', brandName);
    formData.append('projectId', projectId);
    formData.append('week', week);
    formData.append('comment', commentInput.value.trim());
    if (transcriptionFile) {
      formData.append('transcription', transcriptionFile);
    }

    return { url: '/api/publish', formData };
  }

  // ---- Single file upload via XHR with NDJSON streaming ----
  function uploadSingleFile(url, formData, fileLabel) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);

      let serverUploadDone = false;
      xhr.upload.addEventListener('progress', (ev) => {
        if (ev.lengthComputable) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          progressFill.style.width = pct + '%';
          progressText.textContent = fileLabel + ' — Envoi : ' + pct + '% (' + formatFileSize(ev.loaded) + ' / ' + formatFileSize(ev.total) + ')';
        }
      });
      xhr.upload.addEventListener('load', () => {
        serverUploadDone = true;
        progressFill.style.width = '100%';
        progressText.textContent = fileLabel + ' — Transfert vers Frame.io...';
      });

      let lastProcessed = 0;
      xhr.addEventListener('readystatechange', () => {
        if (xhr.readyState >= 3 && serverUploadDone) {
          const text = xhr.responseText.substring(lastProcessed);
          const lines = text.split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const msg = JSON.parse(line);
              if (msg.type === 'progress' && msg.step === 'frameio') {
                progressText.textContent = fileLabel + ' — Transfert vers Frame.io...';
              } else if (msg.type === 'progress' && msg.step === 'webhook') {
                progressText.textContent = fileLabel + ' — Finalisation...';
              }
            } catch {}
          }
          lastProcessed = xhr.responseText.length;
        }
      });

      xhr.onload = () => {
        try {
          const lines = xhr.responseText.trim().split('\n');
          let doneMsg = null;
          for (const line of lines) {
            try {
              const msg = JSON.parse(line);
              if (msg.type === 'done') doneMsg = msg;
            } catch {}
          }
          if (doneMsg && doneMsg.ok) resolve(doneMsg);
          else if (doneMsg) reject(new Error(doneMsg.error || 'Upload echoue'));
          else reject(new Error('Reponse serveur invalide'));
        } catch { reject(new Error('Reponse serveur invalide')); }
      };
      xhr.onerror = () => reject(new Error('Erreur reseau'));
      xhr.send(formData);
    });
  }

  // ---- Form submit ----
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (selectedFiles.length === 0) return;

    uploadError.style.display = 'none';
    uploadBtn.disabled = true;
    progressSection.style.display = 'block';
    progressFill.style.width = '0%';

    try {
      if (currentMode === 'revision') {
        // Revision mode: single request with all files (unchanged)
        uploadBtn.textContent = 'Upload en cours...';
        progressText.textContent = 'Envoi en cours...';
        const { url, formData } = submitRevision();
        const result = await uploadSingleFile(url, formData, '');

        progressSection.style.display = 'none';
        uploadForm.style.display = 'none';
        const names = result.assets.map(a => a.name).join(', ');
        successTitle.textContent = 'Upload reussi !';
        successMsg.textContent = names + (result.assets.length > 1 ? ' ont ete uploades avec succes.' : ' a ete uploade avec succes.');
        shareLink.href = result.shareLink;
        shareLink.textContent = 'Voir et commenter sur Frame.io';
        shareLink.style.display = '';
        successPanel.style.display = 'flex';

      } else {
        // Publish mode: send each file sequentially with 30s delay
        const total = selectedFiles.length;
        const brandName = brandSelect.value;
        const projectId = publishClientSelect.value || '';
        const week = publishWeekSelect.value;
        const comment = commentInput.value.trim();
        const results = [];

        uploadBtn.textContent = 'Mise en ligne en cours...';

        for (let i = 0; i < total; i++) {
          const file = selectedFiles[i];
          const fileLabel = total > 1 ? '(' + (i + 1) + '/' + total + ') ' + file.name : file.name;

          // Wait 30s between files (not before the first one)
          if (i > 0) {
            for (let sec = 30; sec > 0; sec--) {
              progressText.textContent = fileLabel + ' — Envoi dans ' + sec + 's (synchronisation N8N)...';
              progressFill.style.width = '0%';
              await new Promise(r => setTimeout(r, 1000));
            }
          }

          progressText.textContent = fileLabel + ' — Envoi en cours...';
          progressFill.style.width = '0%';

          const formData = new FormData();
          formData.append('video', file);
          formData.append('brandName', brandName);
          formData.append('projectId', projectId);
          formData.append('week', week);
          formData.append('comment', comment);
          // Match transcription by filename (e.g. video.mov → video.txt)
          const matchedTranscription = findMatchingTranscription(file);
          if (matchedTranscription) {
            formData.append('transcription', matchedTranscription);
          } else if (transcriptionFile) {
            // Fallback: single transcription from legacy input (first file only)
            if (i === 0) formData.append('transcription', transcriptionFile);
          }

          const result = await uploadSingleFile('/api/publish', formData, fileLabel);
          results.push(result);
        }

        progressSection.style.display = 'none';
        uploadForm.style.display = 'none';
        const names = results.map(r => r.asset.name).join(', ');
        successTitle.textContent = total > 1 ? total + ' fichiers mis en ligne !' : 'Mise en ligne lancee !';
        successMsg.textContent = names + ' — Les brouillons Metricool vont etre crees par N8N.';
        if (results[0].shareLink) {
          shareLink.href = results[0].shareLink;
          shareLink.textContent = 'Voir sur Frame.io';
          shareLink.style.display = '';
        } else {
          shareLink.style.display = 'none';
        }
        successPanel.style.display = 'flex';
      }

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
    clearTranscription();
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
  populateWeekSelect(weekSelect, { includeYoutube: true });
  populateWeekSelect(publishWeekSelect);
})();
