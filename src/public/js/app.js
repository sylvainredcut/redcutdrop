(function () {
  const clientSelect = document.getElementById('clientSelect');
  const weekSelect = document.getElementById('weekSelect');
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
  const successMsg = document.getElementById('successMsg');
  const shareLink = document.getElementById('shareLink');
  const resetBtn = document.getElementById('resetBtn');
  const commentInput = document.getElementById('commentInput');

  const MAX_FILES = 3;
  let selectedFiles = [];

  // ---- Load clients (= Frame.io projects) ----
  async function loadClients() {
    try {
      const res = await fetch('/api/clients');
      if (!res.ok) throw new Error('Erreur serveur');
      const clients = await res.json();
      clientSelect.innerHTML = '<option value="">Selectionner un client...</option>';
      clients.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        opt.dataset.name = c.name;
        clientSelect.appendChild(opt);
      });
    } catch {
      clientSelect.innerHTML = '<option value="">Erreur de chargement</option>';
    }
  }

  // ---- Week dropdown: S01-S52 + Youtube ----
  function generateWeeks() {
    weekSelect.innerHTML = '<option value="">Selectionner une semaine...</option>';
    for (let w = 1; w <= 52; w++) {
      const opt = document.createElement('option');
      const label = 'S' + String(w).padStart(2, '0');
      opt.value = label;
      opt.textContent = label;
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
    for (const file of newFiles) {
      if (selectedFiles.length >= MAX_FILES) break;
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
    uploadBtn.disabled = !(selectedFiles.length > 0 && clientSelect.value && weekSelect.value);
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

  // ---- Upload ----
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (selectedFiles.length === 0) return;

    const projectId = clientSelect.value;
    const selectedOption = clientSelect.options[clientSelect.selectedIndex];
    const clientName = selectedOption.dataset.name || selectedOption.textContent;
    const week = weekSelect.value;

    uploadError.style.display = 'none';
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Upload en cours...';
    progressSection.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Envoi en cours...';

    const formData = new FormData();
    selectedFiles.forEach(f => formData.append('videos', f));
    formData.append('projectId', projectId);
    formData.append('clientName', clientName);
    formData.append('week', week);
    formData.append('comment', commentInput.value.trim());

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');

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
      const names = result.assets.map(a => a.name).join(', ');
      successMsg.textContent = names + (result.assets.length > 1 ? ' ont ete uploades avec succes.' : ' a ete uploade avec succes.');
      shareLink.href = result.shareLink;
      successPanel.style.display = 'flex';

    } catch (err) {
      progressSection.style.display = 'none';
      uploadError.textContent = err.message;
      uploadError.style.display = 'block';
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Envoyer vers Frame.io';
    }
  });

  // ---- Reset ----
  resetBtn.addEventListener('click', () => {
    successPanel.style.display = 'none';
    uploadForm.style.display = 'block';
    clearFiles();
    commentInput.value = '';
    uploadBtn.textContent = 'Envoyer vers Frame.io';
    progressFill.style.width = '0%';
  });

  // ---- Init ----
  loadClients();
  generateWeeks();
})();
