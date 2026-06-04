// State Management
let currentFilter = 'all';
let rawFiles = [];
let pipelineRuns = [];
let activeRunCard = null; // For rename / run actions

// DOM Elements
const cardsRaw = document.getElementById('cards-raw');
const cardsStep1 = document.getElementById('cards-step1');
const cardsStep2 = document.getElementById('cards-step2');
const cardsStep3 = document.getElementById('cards-step3');
const cardsStep4 = document.getElementById('cards-step4');

const countRaw = document.getElementById('count-raw');
const countStep1 = document.getElementById('count-step1');
const countStep2 = document.getElementById('count-step2');
const countStep3 = document.getElementById('count-step3');
const countStep4 = document.getElementById('count-step4');

const statTotalRuns = document.getElementById('stat-total-runs');
const statStarredRuns = document.getElementById('stat-starred-runs');

// Navigation Filters
const filterButtons = document.querySelectorAll('.nav-item');
filterButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    filterButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    
    // Update headers and view toggle
    if (currentFilter === 'crm') {
      document.getElementById('pipeline-title').innerText = 'CRM Dashboard';
      document.getElementById('pipeline-desc').innerText = 'Visual overview of your outbound sales pipeline and lead hygiene.';
      document.querySelector('.pipeline-board').style.display = 'none';
      document.getElementById('crm-dashboard-view').style.display = 'flex';
      initCrmDashboard();
    } else {
      const title = btn.innerText.split(' ').slice(1).join(' ');
      document.getElementById('pipeline-title').innerText = `${title} Pipeline`;
      document.getElementById('pipeline-desc').innerText = `Manage, monitor, and run ${title} data enrichment steps`;
      document.getElementById('crm-dashboard-view').style.display = 'none';
      document.querySelector('.pipeline-board').style.display = 'grid';
      updateColumnLayout();
      renderBoard();
    }
  });
});

// Toast notification helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
    <span class="toast-message">${message}</span>
  `;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Format bytes helper
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format date helper
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Fetch files and pipeline runs from API
async function fetchPipelines() {
  try {
    const res = await fetch('/api/pipelines');
    const data = await res.json();
    if (data.success) {
      rawFiles = data.rawFiles;
      pipelineRuns = data.pipelineRuns;
      updateColumnLayout();
      renderBoard();
      updateStats();
    } else {
      showToast('Failed to fetch pipeline data: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('Connection error: ' + err.message, 'error');
  }
}

// Update sidebar stats
function updateStats() {
  statTotalRuns.innerText = pipelineRuns.length;
  statStarredRuns.innerText = pipelineRuns.filter(r => r.starred).length + rawFiles.filter(r => r.starred).length;
}

// Determine pipeline category based on file history / audit trail
function detectPipelineCategory(run) {
  if (run.airbnbOutreach && run.airbnbOutreach.status && run.airbnbOutreach.status !== 'filtered') {
    return 'airbnb';
  }
  // Check if it has a custom status or check audit trail
  if (run.audit && run.audit.steps && run.audit.steps.length > 0) {
    const step1Name = run.audit.steps[0].name.toLowerCase();
    if (step1Name.includes('python_listing_filter_01')) {
      return 'cold_caller';
    } else if (step1Name.includes('python_airbnb_filter_01')) {
      return 'airbnb';
    }
  }
  // Check if explicit database entry exists
  if (run.airbnbOutreach && run.airbnbOutreach.status === 'filtered') {
    return 'airbnb';
  }
  // Fallback to name match
  const lowerName = run.name.toLowerCase();
  if (lowerName.includes('airbnb')) return 'airbnb';
  return 'cold_caller';
}

// Render cards on the Kanban board
function renderBoard() {
  // Clear lists
  cardsRaw.innerHTML = '';
  cardsStep1.innerHTML = '';
  cardsStep2.innerHTML = '';
  cardsStep3.innerHTML = '';
  cardsStep4.innerHTML = '';

  let rawCount = 0;
  let s1Count = 0;
  let s2Count = 0;
  let s3Count = 0;
  let s4Count = 0;

  // 1. Render Raw Uploads
  if (currentFilter !== 'airbnb') {
    rawFiles.forEach(file => {
      rawCount++;
      const card = createRawCard(file);
      cardsRaw.appendChild(card);
    });
  }

  // 2. Render Pipeline Steps
  pipelineRuns.forEach(run => {
    const category = detectPipelineCategory(run);
    
    // Filter check
    if (currentFilter !== 'all' && currentFilter !== category) {
      return;
    }

    if (currentFilter === 'airbnb') {
      const status = run.airbnbOutreach ? run.airbnbOutreach.status : 'filtered';
      const card = createAirbnbPipelineCard(run);
      
      if (status === 'filtered') {
        cardsStep1.appendChild(card);
        s1Count++;
      } else if (status === 'working_on') {
        cardsStep2.appendChild(card);
        s2Count++;
      } else if (status === 'done') {
        cardsStep3.appendChild(card);
        s3Count++;
      }
    } else {
      // Determine current step (highest completed step)
      let currentStep = 0;
      if (run.steps[4].complete) {
        currentStep = 4;
        s4Count++;
      } else if (run.steps[3].complete) {
        currentStep = 3;
        s3Count++;
      } else if (run.steps[2].complete) {
        currentStep = 2;
        s2Count++;
      } else if (run.steps[1].complete) {
        currentStep = 1;
        s1Count++;
      }

      const card = createPipelineCard(run, currentStep, category);
      
      // Append to corresponding column
      if (currentStep === 1) cardsStep1.appendChild(card);
      if (currentStep === 2) cardsStep2.appendChild(card);
      if (currentStep === 3) cardsStep3.appendChild(card);
      if (currentStep === 4) cardsStep4.appendChild(card);
    }
  });

  // Update counts
  countRaw.innerText = rawCount;
  countStep1.innerText = s1Count;
  countStep2.innerText = s2Count;
  countStep3.innerText = s3Count;
  countStep4.innerText = s4Count;
}

// Create a Raw File Card element
function createRawCard(file) {
  const card = document.createElement('div');
  card.className = 'pipeline-card card-raw';
  
  card.innerHTML = `
    <div class="card-top">
      <span class="card-title">${file.filename}</span>
      <button class="btn-star ${file.starred ? 'active' : ''}" onclick="toggleStar('${file.filename}', ${!file.starred}, event)">★</button>
    </div>
    <div class="card-meta">
      <div class="meta-row">📁 <span>${formatBytes(file.size)}</span></div>
      <div class="meta-row">⏰ <span>${formatDate(file.uploadedAt)}</span></div>
    </div>
    <div class="card-actions">
      <button class="card-btn card-btn-run" onclick="openRunModal('${file.filename}', 'raw', event)">▶ Run Filter</button>
      <button class="card-btn card-btn-delete" onclick="deleteFile('${file.filename}', 'raw', event)">Delete</button>
    </div>
  `;
  
  return card;
}

// Create a Pipeline Run Card element
function createPipelineCard(run, stepNum, category) {
  const card = document.createElement('div');
  card.className = `pipeline-card card-step${stepNum}`;
  card.onclick = () => openAuditModal(run);
  
  const stepInfo = run.steps[stepNum];
  const formattedSize = stepInfo ? formatBytes(stepInfo.size) : '';
  const modifiedTime = stepInfo ? formatDate(stepInfo.modifiedAt) : '';

  // Generate actions based on current step
  let actionButtons = '';
  if (stepNum === 1) {
    actionButtons = `
      <button class="card-btn card-btn-run" onclick="openLogModal('${run.name}', 2, event)">▶ Log Phone</button>
      <button class="card-btn" style="color: var(--primary)" onclick="sendToAirbnbOutreach('${run.name}', event)">➕ Airbnb Outreach</button>
    `;
  } else if (stepNum === 2) {
    actionButtons = `<button class="card-btn card-btn-run" onclick="openLogModal('${run.name}', 3, event)">▶ Log Picture</button>`;
  } else if (stepNum === 3) {
    actionButtons = `<button class="card-btn card-btn-run" onclick="openRunModal('${stepInfo.filename}', 'notion', event)">▶ Process Notion</button>`;
  }

  const categoryTag = category === 'cold_caller' 
    ? '<span class="tag tag-cold">AI Cold Caller</span>' 
    : '<span class="tag tag-airbnb">Airbnb Outreach</span>';

  card.innerHTML = `
    <div class="card-top">
      <span class="card-title">${run.name}</span>
      <button class="btn-star ${run.starred ? 'active' : ''}" onclick="toggleStar('${run.name}', ${!run.starred}, event)">★</button>
    </div>
    <div class="card-meta">
      <div class="meta-row">📁 <span>${formattedSize}</span></div>
      <div class="meta-row">⏰ <span>${modifiedTime}</span></div>
      <div class="card-tags">${categoryTag}</div>
    </div>
    <div class="card-actions">
      ${actionButtons}
      <button class="card-btn" onclick="openRenameModal('${run.name}', event)">Rename</button>
      <button class="card-btn card-btn-delete" onclick="deleteFile('${run.name}', 'pipeline', event)">Delete</button>
    </div>
  `;
  
  return card;
}

// Star / Unstar
async function toggleStar(name, starred, event) {
  if (event) event.stopPropagation();
  try {
    const res = await fetch('/api/star', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, starred })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`${starred ? 'Starred' : 'Unstarred'} ${name}`);
      fetchPipelines();
    }
  } catch (err) {
    showToast('Failed to star item', 'error');
  }
}

// Delete file
async function deleteFile(name, type, event) {
  if (event) event.stopPropagation();
  const confirmed = confirm(`Are you sure you want to permanently delete "${name}" from disk? This cannot be undone.`);
  if (!confirmed) return;

  try {
    const res = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Deleted "${name}"`);
      fetchPipelines();
    } else {
      showToast(`Delete failed: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast('Failed to delete file', 'error');
  }
}

// Upload Trigger & Drawer Controls
const uploadDrawer = document.getElementById('upload-drawer');
const btnUploadTrigger = document.getElementById('btn-upload-trigger');
const btnCloseUpload = document.getElementById('btn-close-upload');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const progressContainer = document.getElementById('upload-progress-container');
const progressFill = document.getElementById('progress-fill');
const progressStatus = document.getElementById('progress-status');

btnUploadTrigger.addEventListener('click', () => {
  uploadDrawer.style.display = uploadDrawer.style.display === 'block' ? 'none' : 'block';
});

btnCloseUpload.addEventListener('click', () => {
  uploadDrawer.style.display = 'none';
});

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleFileUpload(files[0]);
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    handleFileUpload(fileInput.files[0]);
  }
});

function handleFileUpload(file) {
  const formData = new FormData();
  formData.append('file', file);

  progressContainer.style.display = 'block';
  progressFill.style.style = '0%';
  progressStatus.innerText = 'Initializing upload...';

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload', true);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const percentage = Math.round((e.loaded / e.total) * 100);
      progressFill.style.width = percentage + '%';
      progressStatus.innerText = `Uploading: ${percentage}%`;
    }
  };

  xhr.onload = () => {
    if (xhr.status === 200) {
      const res = JSON.parse(xhr.responseText);
      if (res.success) {
        showToast(`Successfully uploaded "${file.name}"`);
        uploadDrawer.style.display = 'none';
        progressContainer.style.display = 'none';
        fetchPipelines();
      } else {
        showToast(`Upload failed: ${res.error}`, 'error');
        progressContainer.style.display = 'none';
      }
    } else {
      showToast('Error uploading file', 'error');
      progressContainer.style.display = 'none';
    }
  };

  xhr.send(formData);
}

// Rename Modal Controls
const renameModal = document.getElementById('rename-modal');
const btnCloseRenameModal = document.getElementById('btn-close-rename-modal');
const inputNewName = document.getElementById('input-new-name');
const btnCancelRename = document.getElementById('btn-cancel-rename');
const btnSubmitRename = document.getElementById('btn-submit-rename');

function openRenameModal(name, event) {
  if (event) event.stopPropagation();
  activeRunCard = name;
  inputNewName.value = name;
  renameModal.classList.add('active');
}

function closeRenameModal() {
  renameModal.classList.remove('active');
  activeRunCard = null;
}

[btnCloseRenameModal, btnCancelRename].forEach(btn => btn.addEventListener('click', closeRenameModal));

btnSubmitRename.addEventListener('click', async () => {
  const newName = inputNewName.value.trim();
  if (!newName) {
    showToast('Name cannot be empty', 'error');
    return;
  }

  try {
    const res = await fetch('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldName: activeRunCard, newName })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Renamed to "${newName}"`);
      closeRenameModal();
      fetchPipelines();
    } else {
      showToast(`Rename failed: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast('Error renaming file', 'error');
  }
});

// Run / Execute Script Modal Controls
const runModal = document.getElementById('run-modal');
const btnCloseRunModal = document.getElementById('btn-close-run-modal');
const runStepForm = document.getElementById('run-step-form');
const selectPurpose = document.getElementById('select-purpose');
const runCommandPreview = document.getElementById('run-command-preview');
const logEnrichmentFields = document.getElementById('log-enrichment-fields');
const selectAfterFile = document.getElementById('select-after-file');
const btnCancelRun = document.getElementById('btn-cancel-run');
const executionLog = document.getElementById('execution-log');
const logOutput = document.getElementById('log-output');
const logSpinner = document.getElementById('log-spinner');

let currentRunAction = '';
let currentRunInputFile = '';
let currentRunStepNum = 0;

function openRunModal(filename, mode, event) {
  if (event) event.stopPropagation();
  currentRunInputFile = filename;
  
  document.getElementById('run-modal-title').innerText = mode === 'raw' ? 'Run Filter Step' : 'Process Notion Ready';
  document.getElementById('group-purpose').style.display = mode === 'raw' ? 'block' : 'none';
  logEnrichmentFields.style.display = 'none';
  
  executionLog.style.display = 'none';
  logOutput.innerText = 'Waiting for execution...';
  logSpinner.style.display = 'none';
  
  if (mode === 'raw') {
    currentRunAction = 'filter_cold_caller'; // Default
    selectPurpose.value = 'cold_caller';
    updateCommandPreview();
  } else {
    // mode === 'notion' (Step 4)
    currentRunAction = 'notion_ready';
    runCommandPreview.innerText = `python3 scripts/python_listing_filter_end_01.py "outputs/03_picture_enriched/${filename}"`;
  }
  
  runModal.classList.add('active');
}

function openLogModal(runName, stepNum, event) {
  if (event) event.stopPropagation();
  currentRunInputFile = runName;
  currentRunStepNum = stepNum;
  currentRunAction = 'log_enrichment';
  
  document.getElementById('run-modal-title').innerText = `Log Step ${stepNum} Enrichment`;
  document.getElementById('group-purpose').style.display = 'none';
  logEnrichmentFields.style.display = 'block';
  
  executionLog.style.display = 'none';
  logOutput.innerText = 'Waiting for execution...';
  logSpinner.style.display = 'none';
  
  // Populate the "after" file options.
  // We look at pipeline runs that are already at this step or raw files that could match
  selectAfterFile.innerHTML = '';
  
  // Also offer inputting a custom filename. We'll populate with files in the target directories
  const filesList = [];
  pipelineRuns.forEach(run => {
    // If it's step 2, we look for phone enriched files.
    // If it's step 3, we look for picture enriched files.
    // In practice, since phone_enrichment_02.md instructions save to 02_phone_enriched, we scan the workspace
    // files to see if a file matches or let them type/select.
    const ext = run.name.endsWith('.csv') ? '' : '.csv';
    filesList.push(run.name + ext);
  });
  
  // Add direct match first, then others
  const directMatch = runName + (runName.endsWith('.csv') ? '' : '.csv');
  const uniqueFiles = [...new Set([directMatch, ...filesList])];
  
  uniqueFiles.forEach(file => {
    const opt = document.createElement('option');
    opt.value = file;
    opt.innerText = file;
    selectAfterFile.appendChild(opt);
  });
  
  // Add a manual input option
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.innerText = '➕ Custom filename...';
  selectAfterFile.appendChild(customOpt);
  
  updateCommandPreview();
  runModal.classList.add('active');
}

selectPurpose.addEventListener('change', () => {
  currentRunAction = selectPurpose.value === 'cold_caller' ? 'filter_cold_caller' : 'filter_airbnb';
  updateCommandPreview();
});

selectAfterFile.addEventListener('change', () => {
  if (selectAfterFile.value === '__custom__') {
    const customName = prompt("Enter the exact name of the file in the enriched outputs directory:", currentRunInputFile + ".csv");
    if (customName) {
      const opt = document.createElement('option');
      opt.value = customName;
      opt.innerText = customName;
      selectAfterFile.insertBefore(opt, selectAfterFile.firstChild);
      selectAfterFile.value = customName;
    } else {
      selectAfterFile.selectedIndex = 0;
    }
  }
  updateCommandPreview();
});

function updateCommandPreview() {
  if (currentRunAction === 'filter_cold_caller') {
    runCommandPreview.innerText = `python3 scripts/python_listing_filter_01.py "outputs/raw_uploads/${currentRunInputFile}"`;
  } else if (currentRunAction === 'filter_airbnb') {
    runCommandPreview.innerText = `python3 scripts/python_airbnb_filter_01.py "outputs/raw_uploads/${currentRunInputFile}"`;
  } else if (currentRunAction === 'log_enrichment') {
    const afterFile = selectAfterFile.value;
    const beforeDir = currentRunStepNum === 2 ? '01_filtered' : '02_phone_enriched';
    const afterDir = currentRunStepNum === 2 ? '02_phone_enriched' : '03_picture_enriched';
    const extBefore = currentRunInputFile.endsWith('.csv') ? '' : '.csv';
    runCommandPreview.innerText = `python3 scripts/log_enrichment_step.py --step ${currentRunStepNum} --before "outputs/${beforeDir}/${currentRunInputFile}${extBefore}" --after "outputs/${afterDir}/${afterFile}"`;
  }
}

function closeRunModal() {
  runModal.classList.remove('active');
}

[btnCloseRunModal, btnCancelRun].forEach(btn => btn.addEventListener('click', closeRunModal));

runStepForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  executionLog.style.display = 'block';
  logOutput.innerText = 'Executing script... Please wait.\n';
  logSpinner.style.display = 'block';
  document.getElementById('btn-submit-run').disabled = true;
  
  const payload = {
    action: currentRunAction,
    inputFile: currentRunInputFile,
    stepNum: currentRunStepNum,
    afterFile: selectAfterFile.value
  };

  try {
    const res = await fetch('/api/run-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    
    logSpinner.style.display = 'none';
    document.getElementById('btn-submit-run').disabled = false;
    
    let output = '';
    if (data.stdout) output += `[STDOUT]\n${data.stdout}\n`;
    if (data.stderr) output += `[STDERR]\n${data.stderr}\n`;
    
    if (data.success) {
      logOutput.innerText = output + '\n🎉 SUCCESS: Step completed successfully!';
      showToast('Step completed successfully!');
      fetchPipelines();
    } else {
      logOutput.innerText = output + `\n❌ ERROR: Step execution failed!\n${data.error}`;
      showToast('Step execution failed', 'error');
    }
  } catch (err) {
    logSpinner.style.display = 'none';
    document.getElementById('btn-submit-run').disabled = false;
    logOutput.innerText = `\n❌ Connection error: ${err.message}`;
    showToast('Network error during script run', 'error');
  }
});

// Audit Modal Controls
const auditModal = document.getElementById('audit-modal');
const btnCloseAuditModal = document.getElementById('btn-close-audit-modal');
const auditMetaFile = document.getElementById('audit-meta-file');
const auditMetaCreated = document.getElementById('audit-meta-created');
const auditTimeline = document.getElementById('audit-timeline');

function openAuditModal(run) {
  auditMetaFile.innerText = run.baseStem;
  
  if (run.audit) {
    auditMetaCreated.innerText = formatDate(run.audit.metadata.created);
    auditTimeline.innerHTML = '';
    
    if (run.audit.steps && run.audit.steps.length > 0) {
      run.audit.steps.forEach(step => {
        const stepDiv = document.createElement('div');
        stepDiv.className = 'audit-step';
        stepDiv.dataset.step = step.step;
        
        let detailsHtml = '';
        Object.entries(step.details).forEach(([key, val]) => {
          detailsHtml += `<li><strong>${key}:</strong> ${val}</li>`;
        });
        
        const noteHtml = step.notes ? `<div class="audit-step-note">${step.notes}</div>` : '';
        
        stepDiv.innerHTML = `
          <span class="audit-step-dot"></span>
          <div class="audit-step-header">
            <span class="audit-step-title">Step ${step.step} — ${step.name}</span>
            <span class="audit-step-time">${step.runAt}</span>
          </div>
          <ul class="audit-details-list">
            ${detailsHtml}
          </ul>
          ${noteHtml}
        `;
        auditTimeline.appendChild(stepDiv);
      });
    } else {
      auditTimeline.innerHTML = '<p class="text-muted">No step trails logged yet.</p>';
    }
  } else {
    auditMetaCreated.innerText = 'No audit trail md file exists.';
    auditTimeline.innerHTML = `
      <p class="text-muted" style="margin-bottom: 12px;">This pipeline run has not generated an audit file yet.</p>
      <p class="text-muted">Audit trail markdown logs are generated automatically when steps are executed.</p>
    `;
  }
  
  auditModal.classList.add('active');
}

function closeAuditModal() {
  auditModal.classList.remove('active');
}

btnCloseAuditModal.addEventListener('click', closeAuditModal);

// Close modals when clicking on background overlay
[runModal, renameModal, auditModal].forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
      activeRunCard = null;
    }
  });
});

// Initialize Polling
fetchPipelines();
setInterval(fetchPipelines, 5000);

// Dynamic Column Layout Management
function updateColumnLayout() {
  const board = document.querySelector('.pipeline-board');
  const colRaw = document.getElementById('col-raw');
  const colStep1 = document.getElementById('col-step1');
  const colStep2 = document.getElementById('col-step2');
  const colStep3 = document.getElementById('col-step3');
  const colStep4 = document.getElementById('col-step4');
  
  if (currentFilter === 'airbnb') {
    board.classList.add('board-3-cols');
    colRaw.style.display = 'none';
    colStep4.style.display = 'none';
    
    colStep1.querySelector('h3').innerText = '01 Filtered';
    colStep2.querySelector('h3').innerText = '02 Working on';
    colStep3.querySelector('h3').innerText = '03 Done';
  } else {
    board.classList.remove('board-3-cols');
    colRaw.style.display = 'flex';
    colStep4.style.display = 'flex';
    
    colStep1.querySelector('h3').innerText = '01 Filtered';
    colStep2.querySelector('h3').innerText = '02 Phone Enriched';
    colStep3.querySelector('h3').innerText = '03 Picture Enriched';
  }
}

// Create Airbnb-specific pipeline card
function createAirbnbPipelineCard(run) {
  const card = document.createElement('div');
  const status = run.airbnbOutreach ? run.airbnbOutreach.status : 'filtered';
  const sheetLink = run.airbnbOutreach ? run.airbnbOutreach.googleSheetLink : '';
  
  let stepClass = 'card-step1';
  if (status === 'working_on') stepClass = 'card-step2';
  if (status === 'done') stepClass = 'card-step3';
  
  card.className = `pipeline-card ${stepClass}`;
  card.onclick = () => openAuditModal(run);
  
  const stepInfo = run.steps[1].complete ? run.steps[1] : (run.steps[2].complete ? run.steps[2] : null);
  const formattedSize = stepInfo ? formatBytes(stepInfo.size) : '';
  const modifiedTime = stepInfo ? formatDate(stepInfo.modifiedAt) : '';

  let actionButtons = '';
  let sheetBadgeHtml = '';

  if (status === 'filtered') {
    actionButtons = `<button class="card-btn card-btn-run" onclick="moveAirbnbStatus('${run.name}', 'working_on', event)">▶ Start Work</button>`;
  } else if (status === 'working_on') {
    actionButtons = `
      <button class="card-btn card-btn-run" onclick="moveAirbnbStatus('${run.name}', 'done', event)">✅ Mark Done</button>
      <button class="card-btn" onclick="editAirbnbSheetLink('${run.name}', '${sheetLink}', event)">Edit Link</button>
    `;
    if (sheetLink) {
      sheetBadgeHtml = `<a href="${sheetLink}" target="_blank" class="badge-sheet" onclick="event.stopPropagation()">📊 Google Sheet</a>`;
    }
  } else if (status === 'done') {
    actionButtons = `
      <button class="card-btn card-btn-run" onclick="moveAirbnbStatus('${run.name}', 'working_on', event)">🔄 Re-open</button>
      <button class="card-btn" onclick="editAirbnbSheetLink('${run.name}', '${sheetLink}', event)">Edit Link</button>
    `;
    if (sheetLink) {
      sheetBadgeHtml = `<a href="${sheetLink}" target="_blank" class="badge-sheet" onclick="event.stopPropagation()">📊 Google Sheet</a>`;
    }
  }

  card.innerHTML = `
    <div class="card-top">
      <span class="card-title">${run.name}</span>
      <button class="btn-star ${run.starred ? 'active' : ''}" onclick="toggleStar('${run.name}', ${!run.starred}, event)">★</button>
    </div>
    <div class="card-meta">
      <div class="meta-row">📁 <span>${formattedSize}</span></div>
      <div class="meta-row">⏰ <span>${modifiedTime}</span></div>
      ${sheetBadgeHtml}
    </div>
    <div class="card-actions">
      ${actionButtons}
      <button class="card-btn" onclick="openRenameModal('${run.name}', event)">Rename</button>
      <button class="card-btn card-btn-delete" onclick="deleteFile('${run.name}', 'pipeline', event)">Delete</button>
    </div>
  `;
  
  return card;
}

// Move Airbnb Status
async function moveAirbnbStatus(name, status, event) {
  if (event) event.stopPropagation();
  
  let googleSheetLink = undefined;
  
  if (status === 'working_on') {
    const run = pipelineRuns.find(r => r.name === name);
    const currentLink = run && run.airbnbOutreach ? run.airbnbOutreach.googleSheetLink : '';
    
    const link = prompt("Paste your Google Sheet link for this outreach run:", currentLink);
    if (link === null) return;
    googleSheetLink = link.trim();
  }

  await updateAirbnbStatusAPI(name, status, googleSheetLink);
}

// Edit Google Sheet Link
async function editAirbnbSheetLink(name, currentLink, event) {
  if (event) event.stopPropagation();
  const link = prompt("Edit your Google Sheet link:", currentLink);
  if (link === null) return;
  
  const run = pipelineRuns.find(r => r.name === name);
  const status = run && run.airbnbOutreach ? run.airbnbOutreach.status : 'working_on';
  
  await updateAirbnbStatusAPI(name, status, link.trim());
}

// Switch category to Airbnb Outreach
async function sendToAirbnbOutreach(name, event) {
  if (event) event.stopPropagation();
  const confirmed = confirm(`Add "${name}" to the Airbnb Outreach pipeline board?`);
  if (!confirmed) return;
  await updateAirbnbStatusAPI(name, 'filtered', '');
}

// Call status update endpoint
async function updateAirbnbStatusAPI(name, status, googleSheetLink) {
  try {
    const payload = { name, status };
    if (googleSheetLink !== undefined) {
      payload.googleSheetLink = googleSheetLink;
    }
    
    const res = await fetch('/api/airbnb/update-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (data.success) {
      showToast(`Status updated successfully`);
      fetchPipelines();
    } else {
      showToast('Error updating status', 'error');
    }
  } catch (err) {
    showToast('Network error updating status', 'error');
  }
}

// ----------------------------------------------------
// CRM DASHBOARD LOGIC
// ----------------------------------------------------

// Register the chartjs datalabels plugin
if (typeof ChartDataLabels !== 'undefined') {
  Chart.register(ChartDataLabels);
}

let crmData = [];
let charts = {};

// Helper to parse dates like DD-MM-YY or MM-DD-YY consistently
function parseCRMDate(dateStr) {
  if (!dateStr || dateStr.trim() === '') return null;
  // Try parsing. Assume the format is MM-DD-YY based on standard sheet output, 
  // but if day > 12, swap.
  const parts = dateStr.trim().split('-');
  if (parts.length === 3) {
    let m = parseInt(parts[0], 10);
    let d = parseInt(parts[1], 10);
    let y = parseInt(parts[2], 10);
    if (m > 12) {
      // It was DD-MM-YY
      const temp = m;
      m = d;
      d = temp;
    }
    y = y < 100 ? 2000 + y : y;
    const date = new Date(y, m - 1, d);
    if (!isNaN(date.getTime())) return date;
  }
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

async function loadCrmConfig() {
  try {
    const res = await fetch('/api/crm-config');
    const data = await res.json();
    if (data.success && data.crmConfig.googleSheetUrl) {
      document.getElementById('crm-sheet-url').value = data.crmConfig.googleSheetUrl;
    }
  } catch (err) {
    console.error('Failed to load CRM config', err);
  }
}

document.getElementById('btn-save-crm-config').addEventListener('click', async () => {
  const url = document.getElementById('crm-sheet-url').value.trim();
  if (!url) {
    showToast('Please enter a Google Sheet URL', 'error');
    return;
  }
  
  const btn = document.getElementById('btn-save-crm-config');
  btn.disabled = true;
  btn.innerText = 'Saving...';
  
  try {
    const res = await fetch('/api/crm-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Configuration saved! Syncing data...');
      // If the backend auto-converted the link, update the input field visually
      if (data.crmConfig && data.crmConfig.googleSheetUrl) {
        document.getElementById('crm-sheet-url').value = data.crmConfig.googleSheetUrl;
      }
      await initCrmDashboard();
    } else {
      showToast('Failed to save config: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('Network error saving config', 'error');
  }
  btn.disabled = false;
  btn.innerText = 'Save & Sync';
});

async function initCrmDashboard() {
  await loadCrmConfig();
  
  try {
    const res = await fetch('/api/crm-data');
    const data = await res.json();
    if (data.success) {
      crmData = processCrmData(data.data);
      renderCrmDashboard();
    } else if (data.error === 'NO_URL_CONFIGURED') {
      showToast('Please configure your Google Sheet link above.', 'info');
      // Clear charts if they exist
      crmData = [];
      renderCrmDashboard();
    } else {
      showToast('Failed to fetch CRM data: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('Failed to load CRM data', 'error');
  }
}

function processCrmData(rawData) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return rawData.map(row => {
    // Normalization handles missing fields by checking standard and alternative names
    const status = row['Outreach Status'] || 'NEW';
    const rawLastContact = row['Last Contact Date (MM-DD-YY)'] || row['Last Contact Date (DD-MM-YY)'] || '';
    const rawFollowUp = row['Follow-Up Date (MM-DD-YY)'] || row['Follow-Up Date'] || '';
    const rawFirstContact = row['First contact (mm-dd-yy)'] || '';
    const notes = row['Outreach Notes'] || '';
    const attempts = parseInt(row['Attempts'], 10) || 0;
    
    // Look for Sales rep, default to 'Contact' or 'Unassigned'
    const salesRep = row['Sales pers.'] || row['Sales Rep'] || row['Contact'] || 'Unassigned';
    const goal = row['Goal'] || 0;

    const lastContactDate = parseCRMDate(rawLastContact);
    const followUpDate = parseCRMDate(rawFollowUp);
    const firstContactDate = parseCRMDate(rawFirstContact);

    // Calculated fields
    const daysSinceFirst = firstContactDate ? Math.floor((today - firstContactDate) / (1000 * 60 * 60 * 24)) : null;
    const daysSinceLast = lastContactDate ? Math.floor((today - lastContactDate) / (1000 * 60 * 60 * 24)) : null;
    const daysUntilFollowUp = followUpDate ? Math.floor((followUpDate - today) / (1000 * 60 * 60 * 24)) : null;

    let followUpStatus = 'None';
    if (daysUntilFollowUp !== null) {
      if (daysUntilFollowUp < 0) followUpStatus = 'Overdue';
      else if (daysUntilFollowUp === 0) followUpStatus = 'Due Today';
      else if (daysUntilFollowUp <= 3) followUpStatus = 'Upcoming';
      else followUpStatus = 'Future';
    }

    let ageBucket = 'Unknown';
    if (daysSinceFirst !== null) {
      if (daysSinceFirst <= 3) ageBucket = '0-3 Days';
      else if (daysSinceFirst <= 7) ageBucket = '4-7 Days';
      else if (daysSinceFirst <= 14) ageBucket = '8-14 Days';
      else ageBucket = '15+ Days';
    }

    const isStale = daysSinceLast !== null && daysSinceLast > 7;
    const missingNotes = notes.trim() === '';
    const missingFollowUp = !followUpDate;

    return {
      ...row,
      normalizedStatus: status,
      salesRep,
      goal,
      attempts,
      hasNotes: !missingNotes,
      lastContactDate,
      followUpDate,
      firstContactDate,
      daysSinceFirst,
      daysSinceLast,
      daysUntilFollowUp,
      followUpStatus,
      ageBucket,
      isStale,
      missingNotes,
      missingFollowUp
    };
  });
}

function renderCrmDashboard() {
  renderKpis();
  renderPipelineChart();
  renderFollowUpTable();
  renderAgingChart();
  renderAttemptsChart();
  renderWorkloadTable();
  renderHygieneStats();
  renderActivityChart();
  renderSalesRepCharts();
}

function renderKpis() {
  const totalLeads = crmData.length;
  const newLeads = crmData.filter(d => d.normalizedStatus.toLowerCase().includes('new')).length;
  const dueToday = crmData.filter(d => d.followUpStatus === 'Due Today').length;
  const overdue = crmData.filter(d => d.followUpStatus === 'Overdue').length;
  const upcoming = crmData.filter(d => d.followUpStatus === 'Upcoming').length;
  
  // Calculate Avg attempts only for leads with a First contact date
  const contactedLeads = crmData.filter(d => d.firstContactDate !== null);
  const totalContacted = contactedLeads.length;
  
  const totalAttempts = contactedLeads.reduce((sum, d) => sum + d.attempts, 0);
  const avgAttempts = totalContacted ? (totalAttempts / totalContacted).toFixed(1) : 0;
  
  // Calculate Missing notes only for leads with a First contact date
  const missingNotes = contactedLeads.filter(d => d.missingNotes).length;
  const noFollowup = crmData.filter(d => d.missingFollowUp).length;

  document.getElementById('kpi-total').innerText = totalLeads;
  document.getElementById('kpi-new').innerText = newLeads;
  document.getElementById('kpi-due-today').innerText = dueToday;
  document.getElementById('kpi-overdue').innerText = overdue;
  document.getElementById('kpi-upcoming').innerText = upcoming;
  document.getElementById('kpi-avg-attempts').innerText = avgAttempts;
  document.getElementById('kpi-missing-notes').innerText = missingNotes;
  document.getElementById('kpi-no-followup').innerText = noFollowup;
}

function initOrUpdateChart(id, type, data, options) {
  const ctx = document.getElementById(id).getContext('2d');
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, { type, data, options });
}

function renderPipelineChart() {
  const statusCounts = {};
  crmData.forEach(d => {
    statusCounts[d.normalizedStatus] = (statusCounts[d.normalizedStatus] || 0) + 1;
  });

  const data = {
    labels: Object.keys(statusCounts),
    datasets: [{
      label: 'Leads by Status',
      data: Object.values(statusCounts),
      backgroundColor: 'rgba(20, 184, 166, 0.8)',
      borderColor: 'rgba(20, 184, 166, 1)',
      borderWidth: 1,
      borderRadius: 4
    }]
  };

  initOrUpdateChart('chart-pipeline-status', 'bar', data, {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { 
      legend: { display: false },
      datalabels: {
        color: '#ffffff',
        anchor: 'end',
        align: 'top',
        font: { weight: 'bold' },
        display: function(context) { return context.dataset.data[context.dataIndex] > 0; }
      }
    },
    scales: {
      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#cbd5e1' }, suggestedMax: Math.max(...Object.values(statusCounts)) * 1.2 },
      x: { grid: { display: false }, ticks: { color: '#cbd5e1' } }
    }
  });
}

function renderFollowUpTable() {
  const tbody = document.querySelector('#table-followups tbody');
  tbody.innerHTML = '';

  const followups = crmData.filter(d => d.followUpStatus !== 'None' && d.followUpStatus !== 'Future');
  followups.sort((a, b) => a.daysUntilFollowUp - b.daysUntilFollowUp);

  followups.forEach(d => {
    const tr = document.createElement('tr');
    let statusClass = '';
    if (d.followUpStatus === 'Overdue') statusClass = 'text-danger';
    else if (d.followUpStatus === 'Due Today') statusClass = 'text-alert';
    else statusClass = 'text-warning';

    tr.innerHTML = `
      <td><span class="${statusClass} font-bold">${d.followUpStatus}</span></td>
      <td>${d['Listing URL'] || d['Title'] || 'Unknown Lead'}</td>
      <td>${d.salesRep}</td>
      <td>${d.followUpDate ? d.followUpDate.toLocaleDateString() : '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderAgingChart() {
  const buckets = { '0-3 Days': 0, '4-7 Days': 0, '8-14 Days': 0, '15+ Days': 0, 'Unknown': 0 };
  crmData.forEach(d => {
    if (buckets[d.ageBucket] !== undefined) buckets[d.ageBucket]++;
  });

  const data = {
    labels: Object.keys(buckets),
    datasets: [{
      data: Object.values(buckets),
      backgroundColor: ['rgba(16, 185, 129, 0.7)', 'rgba(52, 211, 153, 0.7)', 'rgba(245, 158, 11, 0.7)', 'rgba(239, 68, 68, 0.7)', 'rgba(100, 116, 139, 0.7)']
    }]
  };

  initOrUpdateChart('chart-aging', 'bar', data, {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#cbd5e1' } },
      x: { grid: { display: false }, ticks: { color: '#cbd5e1' } }
    }
  });
}

function renderAttemptsChart() {
  const attemptsDist = { '1': 0, '2': 0, '3': 0, '4+': 0 };
  crmData.forEach(d => {
    if (d.attempts === 1) attemptsDist['1']++;
    else if (d.attempts === 2) attemptsDist['2']++;
    else if (d.attempts === 3) attemptsDist['3']++;
    else if (d.attempts >= 4) attemptsDist['4+']++;
  });

  const data = {
    labels: Object.keys(attemptsDist),
    datasets: [{
      data: Object.values(attemptsDist),
      backgroundColor: ['#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe']
    }]
  };

  initOrUpdateChart('chart-attempts', 'doughnut', data, {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'right', labels: { color: '#fff' } } }
  });
}

function renderWorkloadTable() {
  const repStats = {};
  crmData.forEach(d => {
    if (!repStats[d.salesRep]) {
      repStats[d.salesRep] = { total: 0, overdue: 0, dueToday: 0 };
    }
    repStats[d.salesRep].total++;
    if (d.followUpStatus === 'Overdue') repStats[d.salesRep].overdue++;
    if (d.followUpStatus === 'Due Today') repStats[d.salesRep].dueToday++;
  });

  const tbody = document.querySelector('#table-workload tbody');
  tbody.innerHTML = '';
  
  Object.keys(repStats).forEach(rep => {
    const stats = repStats[rep];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${rep}</strong></td>
      <td>${stats.total}</td>
      <td class="text-danger">${stats.overdue}</td>
      <td class="text-alert">${stats.dueToday}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderHygieneStats() {
  const total = crmData.length;
  if (!total) return;

  const contactedLeads = crmData.filter(d => d.firstContactDate !== null);
  const totalContacted = contactedLeads.length;

  // Notes filled based only on contacted leads
  const notesFilled = contactedLeads.filter(d => d.hasNotes).length;
  const pctNotes = totalContacted ? Math.round((notesFilled / totalContacted) * 100) : 0;

  const noActivity7Days = crmData.filter(d => d.isStale).length;
  const noFollowUp = crmData.filter(d => d.missingFollowUp).length;

  const pctStale = Math.round((noActivity7Days / total) * 100);
  const pctNoFollowUp = Math.round((noFollowUp / total) * 100);

  const container = document.getElementById('hygiene-stats');
  container.innerHTML = `
    <div class="hygiene-item">
      <span>Notes Filled</span>
      <span class="${pctNotes > 80 ? 'text-success' : 'text-danger'}">${pctNotes}%</span>
    </div>
    <div class="hygiene-item">
      <span>Stale (>7 days no touch)</span>
      <span class="${pctStale < 10 ? 'text-success' : 'text-danger'}">${pctStale}%</span>
    </div>
    <div class="hygiene-item">
      <span>Missing Follow-Up Date</span>
      <span class="${pctNoFollowUp < 5 ? 'text-success' : 'text-danger'}">${pctNoFollowUp}%</span>
    </div>
  `;
}

function renderActivityChart() {
  // Simple trend of First Contact Dates
  const dates = {};
  crmData.forEach(d => {
    if (d.firstContactDate) {
      const dateStr = d.firstContactDate.toLocaleDateString();
      dates[dateStr] = (dates[dateStr] || 0) + 1;
    }
  });

  // Sort dates
  const sortedDates = Object.keys(dates).sort((a, b) => new Date(a) - new Date(b)).slice(-14); // Last 14 dates

  const data = {
    labels: sortedDates,
    datasets: [{
      label: 'New Contacts',
      data: sortedDates.map(k => dates[k]),
      borderColor: '#8b5cf6',
      backgroundColor: 'rgba(139, 92, 246, 0.1)',
      fill: true,
      tension: 0.4
    }]
  };

  initOrUpdateChart('chart-activity', 'line', data, {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, datalabels: { display: false } },
    scales: {
      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#cbd5e1' } },
      x: { grid: { display: false }, ticks: { color: '#cbd5e1' } }
    }
  });
}

function renderSalesRepCharts() {
  const container = document.getElementById('sales-rep-charts-container');
  if (!container) return;
  container.innerHTML = '';
  
  // Find all unique sales reps
  const reps = [...new Set(crmData.map(d => d.salesRep))];
  
  // Helper to get YYYY-MM-DD
  const getIsoDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Helper to format YYYY-MM-DD to MM/DD for display
  const formatForDisplay = (isoStr) => {
    const parts = isoStr.split('-');
    return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
  };

  // Gather all unique first contact dates present in the data (YYYY-MM-DD)
  const allDates = new Set();
  crmData.forEach(d => {
    if (d.firstContactDate) {
      allDates.add(getIsoDate(d.firstContactDate));
    }
  });
  
  // Sort dates chronologically and pick the last 30
  const sortedDatesList = Array.from(allDates).sort().slice(-30);

  const displayDates = sortedDatesList.map(formatForDisplay);

  if (displayDates.length === 0) {
    container.innerHTML = '<p style="padding: 20px; color: var(--text-muted);">No First Contact data available.</p>';
    return;
  }
  
  reps.forEach((rep, index) => {
    // Filter leads for this rep
    const repLeads = crmData.filter(d => d.salesRep === rep && d.firstContactDate !== null);
    
    // Aggregate by day
    const dayCounts = {};
    repLeads.forEach(lead => {
      const isoStr = getIsoDate(lead.firstContactDate);
      if (sortedDatesList.includes(isoStr)) {
        dayCounts[isoStr] = (dayCounts[isoStr] || 0) + 1;
      }
    });
    
    const dataArray = sortedDatesList.map(isoStr => dayCounts[isoStr] || 0);
    
    // Create DOM element
    const card = document.createElement('div');
    card.className = 'dashboard-card';
    const canvasId = `chart-sales-rep-${index}`;
    card.innerHTML = `
      <h3>${rep} Activity</h3>
      <div class="chart-container"><canvas id="${canvasId}"></canvas></div>
    `;
    container.appendChild(card);
    
    const maxVal = Math.max(...dataArray);
    
    // Render Chart
    initOrUpdateChart(canvasId, 'bar', {
      labels: displayDates,
      datasets: [{
        label: 'Leads Contacted',
        data: dataArray,
        backgroundColor: 'rgba(139, 92, 246, 0.8)',
        borderColor: 'rgba(139, 92, 246, 1)',
        borderWidth: 1,
        borderRadius: 4
      }]
    }, {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { 
        legend: { display: false },
        datalabels: {
          color: '#ffffff',
          anchor: 'end',
          align: 'top',
          font: { weight: 'bold', size: 10 },
          display: function(context) { return context.dataset.data[context.dataIndex] > 0; }
        }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#cbd5e1', stepSize: 1 }, suggestedMax: maxVal > 0 ? maxVal * 1.2 : 5 },
        x: { grid: { display: false }, ticks: { color: '#cbd5e1', maxRotation: 45, minRotation: 45 } }
      }
    });
  });
}

