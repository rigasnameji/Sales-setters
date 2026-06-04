// State Management
let crmConfig = { googleSheetUrl: '' };
let crmData = [];
let charts = {};

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

// Format date helper
function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  return d.toLocaleDateString();
}

function parseCRMDate(dateStr) {
  if (!dateStr || dateStr.trim() === '') return null;
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    let [m, d, y] = parts.map(Number);
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

// Config Management using Local Storage
async function loadCrmConfig() {
  const saved = localStorage.getItem('crmConfig');
  if (saved) {
    try {
      crmConfig = JSON.parse(saved);
      if (crmConfig.googleSheetUrl) {
        document.getElementById('crm-sheet-url').value = crmConfig.googleSheetUrl;
      }
    } catch(e) {
      console.error(e);
    }
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
  
  let exportUrl = url;
  if (exportUrl.includes('/edit')) {
    exportUrl = exportUrl.replace(/\/edit.*$/, '/export?format=csv');
  }

  crmConfig.googleSheetUrl = exportUrl;
  localStorage.setItem('crmConfig', JSON.stringify(crmConfig));
  
  document.getElementById('crm-sheet-url').value = exportUrl;
  
  showToast('Configuration saved! Syncing data...');
  await initCrmDashboard();
  
  btn.disabled = false;
  btn.innerText = 'Save & Sync';
});

async function initCrmDashboard() {
  await loadCrmConfig();
  
  if (!crmConfig.googleSheetUrl) {
    showToast('Please configure your Google Sheet link above.', 'info');
    crmData = [];
    renderCrmDashboard();
    return;
  }

  try {
    const response = await fetch(crmConfig.googleSheetUrl);
    if (!response.ok) throw new Error('Network response was not ok');
    const csvText = await response.text();
    
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: function(results) {
        crmData = processCrmData(results.data);
        renderCrmDashboard();
      },
      error: function(error) {
        showToast('Failed to parse CSV: ' + error.message, 'error');
      }
    });
  } catch (err) {
    showToast('Failed to load CRM data from Google Sheets', 'error');
  }
}

function processCrmData(rawData) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return rawData.map(row => {
    const status = row['Outreach Status'] || 'NEW';
    const rawLastContact = row['Last Contact Date (MM-DD-YY)'] || row['Last Contact Date (DD-MM-YY)'] || '';
    const rawFollowUp = row['Follow-Up Date (MM-DD-YY)'] || row['Follow-Up Date'] || '';
    const rawFirstContact = row['First contact (mm-dd-yy)'] || '';
    const notes = row['Outreach Notes'] || '';
    const attempts = parseInt(row['Attempts'], 10) || 0;
    
    const salesRep = row['Sales pers.'] || row['Sales Rep'] || row['Contact'] || 'Unassigned';
    const goal = row['Goal'] || 0;

    const lastContactDate = parseCRMDate(rawLastContact);
    const followUpDate = parseCRMDate(rawFollowUp);
    const firstContactDate = parseCRMDate(rawFirstContact);

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
  
  const contactedLeads = crmData.filter(d => d.firstContactDate !== null);
  const totalContacted = contactedLeads.length;
  
  const totalAttempts = contactedLeads.reduce((sum, d) => sum + d.attempts, 0);
  const avgAttempts = totalContacted ? (totalAttempts / totalContacted).toFixed(1) : 0;
  
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
        font: { weight: 'bold', size: 12 },
        display: function(context) { return context.dataset.data[context.dataIndex] > 0; }
      }
    },
    scales: {
      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#cbd5e1' } },
      x: { grid: { display: false }, ticks: { color: '#cbd5e1' } }
    }
  });
}

function renderFollowUpTable() {
  const tbody = document.querySelector('#table-followups tbody');
  tbody.innerHTML = '';

  const activeFollowUps = crmData
    .filter(d => ['Overdue', 'Due Today', 'Upcoming'].includes(d.followUpStatus))
    .sort((a, b) => (a.followUpDate || 0) - (b.followUpDate || 0))
    .slice(0, 10);

  if (activeFollowUps.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">No immediate follow-ups</td></tr>';
    return;
  }

  activeFollowUps.forEach(d => {
    let statusClass = 'tag ';
    if (d.followUpStatus === 'Overdue') statusClass += 'tag-airbnb'; 
    else if (d.followUpStatus === 'Due Today') statusClass += 'tag-cold'; 
    else statusClass += 'tag-pipeline';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="${statusClass}">${d.followUpStatus}</span></td>
      <td>
        <div style="font-weight: 500;">${d.Contact || d.Title || d.villaName || 'Unknown Contact'}</div>
        <div style="font-size: 11px; color: var(--text-muted);">${d.Phone || d.Email || ''}</div>
      </td>
      <td>${d.salesRep}</td>
      <td>${d.followUpDate ? d.followUpDate.toLocaleDateString() : 'None'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderAgingChart() {
  const buckets = { '0-3 Days': 0, '4-7 Days': 0, '8-14 Days': 0, '15+ Days': 0 };
  crmData.forEach(d => { if (d.ageBucket !== 'Unknown') buckets[d.ageBucket]++; });

  initOrUpdateChart('chart-aging', 'doughnut', {
    labels: Object.keys(buckets),
    datasets: [{
      data: Object.values(buckets),
      backgroundColor: [
        'rgba(20, 184, 166, 0.8)',
        'rgba(59, 130, 246, 0.8)',
        'rgba(245, 158, 11, 0.8)',
        'rgba(239, 68, 68, 0.8)'
      ],
      borderWidth: 1,
      borderColor: '#1e293b'
    }]
  }, {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right', labels: { color: '#cbd5e1', padding: 20 } },
      datalabels: { display: false }
    },
    cutout: '70%'
  });
}

function renderAttemptsChart() {
  const attemptCounts = {};
  crmData.forEach(d => {
    if (d.firstContactDate === null && d.attempts === 0) return;
    const bucket = d.attempts >= 5 ? '5+' : d.attempts.toString();
    attemptCounts[bucket] = (attemptCounts[bucket] || 0) + 1;
  });

  const labels = ['0', '1', '2', '3', '4', '5+'];
  const dataArray = labels.map(l => attemptCounts[l] || 0);

  initOrUpdateChart('chart-attempts', 'bar', {
    labels: labels,
    datasets: [{
      label: 'Leads',
      data: dataArray,
      backgroundColor: 'rgba(59, 130, 246, 0.8)',
      borderColor: 'rgba(59, 130, 246, 1)',
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
        font: { weight: 'bold', size: 11 },
        display: function(context) { return context.dataset.data[context.dataIndex] > 0; }
      }
    },
    scales: {
      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#cbd5e1' } },
      x: { grid: { display: false }, ticks: { color: '#cbd5e1' } }
    }
  });
}

function renderWorkloadTable() {
  const tbody = document.querySelector('#table-workload tbody');
  tbody.innerHTML = '';

  const reps = {};
  crmData.forEach(d => {
    if (!reps[d.salesRep]) reps[d.salesRep] = { total: 0, overdue: 0, dueToday: 0 };
    reps[d.salesRep].total++;
    if (d.followUpStatus === 'Overdue') reps[d.salesRep].overdue++;
    if (d.followUpStatus === 'Due Today') reps[d.salesRep].dueToday++;
  });

  const sortedReps = Object.entries(reps).sort((a, b) => b[1].total - a[1].total);

  sortedReps.forEach(([rep, stats]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 500;">${rep}</td>
      <td>${stats.total}</td>
      <td class="${stats.overdue > 0 ? 'text-danger' : ''}">${stats.overdue}</td>
      <td class="${stats.dueToday > 0 ? 'text-alert' : ''}">${stats.dueToday}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderHygieneStats() {
  const container = document.getElementById('hygiene-stats');
  
  const staleCount = crmData.filter(d => d.isStale).length;
  const contactedLeads = crmData.filter(d => d.firstContactDate !== null);
  const noNotesCount = contactedLeads.filter(d => d.missingNotes).length;
  const noFollowUpCount = crmData.filter(d => d.missingFollowUp).length;

  const total = crmData.length;
  const totalContacted = contactedLeads.length;

  const stalePct = total ? Math.round((staleCount / total) * 100) : 0;
  const notesPct = totalContacted ? Math.round((noNotesCount / totalContacted) * 100) : 0;
  const fuPct = total ? Math.round((noFollowUpCount / total) * 100) : 0;

  container.innerHTML = `
    <div class="hygiene-row">
      <div class="hygiene-info">
        <span class="hygiene-title">Stale Leads (>7 days no contact)</span>
        <span class="hygiene-val text-danger">${staleCount}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill fill-danger" style="width: ${stalePct}%"></div></div>
    </div>
    <div class="hygiene-row">
      <div class="hygiene-info">
        <span class="hygiene-title">Contacted Leads Missing Notes</span>
        <span class="hygiene-val text-warning">${noNotesCount}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill fill-warning" style="width: ${notesPct}%"></div></div>
    </div>
    <div class="hygiene-row">
      <div class="hygiene-info">
        <span class="hygiene-title">Leads Missing Follow-up Date</span>
        <span class="hygiene-val text-warning">${noFollowUpCount}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill fill-warning" style="width: ${fuPct}%"></div></div>
    </div>
  `;
}

function renderActivityChart() {
  const dates = {};
  crmData.forEach(d => {
    if (d.firstContactDate) {
      const dateStr = d.firstContactDate.toLocaleDateString();
      dates[dateStr] = (dates[dateStr] || 0) + 1;
    }
  });

  const sortedDates = Object.keys(dates).sort((a, b) => new Date(a) - new Date(b)).slice(-14);
  const dataArray = sortedDates.map(date => dates[date]);

  const displayDates = sortedDates.map(d => {
    const parts = d.split('/');
    if (parts.length === 3) {
      return `${parts[0]}/${parts[1]}`;
    }
    return d;
  });

  initOrUpdateChart('chart-activity', 'line', {
    labels: displayDates,
    datasets: [{
      label: 'New Contacts',
      data: dataArray,
      borderColor: 'rgba(20, 184, 166, 1)',
      backgroundColor: 'rgba(20, 184, 166, 0.1)',
      borderWidth: 2,
      fill: true,
      tension: 0.3,
      pointBackgroundColor: 'rgba(20, 184, 166, 1)',
      pointRadius: 4
    }]
  }, {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { 
      legend: { display: false },
      datalabels: { display: false }
    },
    scales: {
      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#cbd5e1', stepSize: 1 } },
      x: { grid: { display: false }, ticks: { color: '#cbd5e1' } }
    }
  });
}

function renderSalesRepCharts() {
  const container = document.getElementById('sales-rep-charts-container');
  if (!container) return;
  container.innerHTML = '';
  
  const reps = [...new Set(crmData.map(d => d.salesRep))];
  
  const getIsoDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const formatForDisplay = (isoStr) => {
    const parts = isoStr.split('-');
    return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
  };

  const allDates = new Set();
  crmData.forEach(d => {
    if (d.firstContactDate) {
      allDates.add(getIsoDate(d.firstContactDate));
    }
  });
  
  const sortedDatesList = Array.from(allDates).sort().slice(-30);
  const displayDates = sortedDatesList.map(formatForDisplay);

  if (displayDates.length === 0) {
    container.innerHTML = '<p style="padding: 20px; color: var(--text-muted);">No First Contact data available.</p>';
    return;
  }
  
  reps.forEach((rep, index) => {
    const repLeads = crmData.filter(d => d.salesRep === rep && d.firstContactDate !== null);
    
    const dayCounts = {};
    repLeads.forEach(lead => {
      const isoStr = getIsoDate(lead.firstContactDate);
      if (sortedDatesList.includes(isoStr)) {
        dayCounts[isoStr] = (dayCounts[isoStr] || 0) + 1;
      }
    });
    
    const dataArray = sortedDatesList.map(isoStr => dayCounts[isoStr] || 0);
    
    const card = document.createElement('div');
    card.className = 'dashboard-card';
    const canvasId = `chart-sales-rep-${index}`;
    card.innerHTML = `
      <h3>${rep} Activity</h3>
      <div class="chart-container"><canvas id="${canvasId}"></canvas></div>
    `;
    container.appendChild(card);
    
    const maxVal = Math.max(...dataArray);
    
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

// Start
initCrmDashboard();
