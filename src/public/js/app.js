(function () {
  const clientSelect = document.getElementById('clientSelect');
  const weekSelect = document.getElementById('weekSelect');
  const showAllWeeksBtn = document.getElementById('showAllWeeks');
  const fileInput = document.getElementById('fileInput');
  const dropzone = document.getElementById('dropzone');
  const dropzoneInner = document.getElementById('dropzoneInner');
  const fileSelected = document.getElementById('fileSelected');
  const fileName = document.getElementById('fileName');
  const fileSize = document.getElementById('fileSize');
  const removeFile = document.getElementById('removeFile');
  const browseBtn = document.getElementById('browseBtn');
  const uploadForm = document.getElementById('uploadForm');
  const uploadBtn = document.getElementById('uploadBtn');
  const progressSection = document.getElementById('progressSection');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const uploadError = document.getElementById('uploadError');
  const successPanel = document.getElementById('successPanel');
  const successMsg = document.getElementById('successMsg');
  const frameioLink = document.getElementById('frameioLink');
  const resetBtn = document.getElementById('resetBtn');

  let selectedFile = null;
  let allWeeksVisible = false;

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

  // ---- Week dropdown: S11-S20 by default, expandable to S01-S52 + Youtube ----
  function generateWeeks(showAll) {
    const currentValue = weekSelect.value;
    weekSelect.innerHTML = '<option value="">Selectionner une semaine...</option>';

    const start = showAll ? 1 : 11;
    const end = showAll ? 52 : 20;

    for (let w = start; w <= end; w++) {
      const opt = document.createElement('option');
      const label = 'S' + String(w).padStart(2, '0');
      opt.value = label;
      opt.textContent = label;
      weekSelect.appendChild(opt);
    }

    // Youtube option
    const ytOpt = document.createElement('option');
    ytOpt.value = 'Youtube';
    ytOpt.textContent = 'Youtube';
    weekSelect.appendChild(ytOpt);

    // Restore selection if still in range
    if (currentValue) {
      for (let i = 0; i < weekSelect.options.length; i++) {
        if (weekSelect.options[i].value === currentValue) {
          weekSelect.options[i].selected = true;
          break;
        }
      }
    }

    showAllWeeksBtn.textContent = showAll ? 'Semaines courantes' : 'Toutes les semaines';
    allWeeksVisible = showAll;
  }

  showAllWeeksBtn.addEventListener('click', (e) => {
    e.preventDefault();
    generateWeeks(!allWeeksVisible);
  });

  // ---- File handling ----
  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' o';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' Ko';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' Mo';
    return (bytes / 1073741824).toFixed(2) + ' Go';
  }

  function selectFile(file) {
    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    dropzoneInner.style.display = 'none';
    fileSelected.style.display = 'flex';
    updateUploadBtn();
  }

  function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    dropzoneInner.style.display = 'flex';
    fileSelected.style.display = 'none';
    updateUploadBtn();
  }

  function updateUploadBtn() {
    uploadBtn.disabled = !(selectedFile && clientSelect.value && weekSelect.value);
  }

  browseBtn.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('click', (e) => {
    if (e.target === dropzone || e.target.closest('.dropzone-inner')) {
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) selectFile(fileInput.files[0]);
  });

  removeFile.addEventListener('click', (e) => {
    e.stopPropagation();
    clearFile();
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
    const file = e.dataTransfer.files[0];
    if (file) selectFile(file);
  });

  // ---- Upload ----
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

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
    formData.append('video', selectedFile);
    formData.append('projectId', projectId);
    formData.append('clientName', clientName);
    formData.append('week', week);

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
      successMsg.textContent = result.asset.name + ' a ete uploade avec succes.';
      frameioLink.href = result.asset.link;
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
    clearFile();
    uploadBtn.textContent = 'Envoyer vers Frame.io';
    progressFill.style.width = '0%';
  });

  // ---- Init ----
  loadClients();
  generateWeeks(false);
})();
