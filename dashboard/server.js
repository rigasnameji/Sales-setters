const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const Papa = require('papaparse');

const app = express();
const PORT = 3030;

// Setup paths
const WORKSPACE_DIR = '/Users/kristapsjansons/Documents_Local/Clone - Antigravity/AI SALES';
const OUTPUTS_DIR = path.join(WORKSPACE_DIR, 'outputs');
const RAW_UPLOADS_DIR = path.join(OUTPUTS_DIR, 'raw_uploads');
const FILTERED_DIR = path.join(OUTPUTS_DIR, '01_filtered');
const PHONE_DIR = path.join(OUTPUTS_DIR, '02_phone_enriched');
const PICTURE_DIR = path.join(OUTPUTS_DIR, '03_picture_enriched');
const NOTION_DIR = path.join(OUTPUTS_DIR, '04_notion_ready');
const AUDIT_DIR = path.join(OUTPUTS_DIR, 'audit_trail');
const DB_FILE = path.join(OUTPUTS_DIR, 'dashboard_db.json');

// Ensure all directories exist
[OUTPUTS_DIR, RAW_UPLOADS_DIR, FILTERED_DIR, PHONE_DIR, PICTURE_DIR, NOTION_DIR, AUDIT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure static files
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for CSV uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, RAW_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Keep original file name but ensure it's safe
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_ ]/g, '');
    cb(null, safeName);
  }
});
const upload = multer({ storage });

// Database helper
function readDB() {
  let db = { starred: [], notes: {}, airbnbOutreach: {}, crmConfig: {} };
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db = { ...db, ...data };
    } catch (e) {
      console.error("Error reading db file, resetting:", e);
    }
  }
  // Ensure defaults exist
  if (!db.crmConfig) db.crmConfig = {};
  if (!db.airbnbOutreach) db.airbnbOutreach = {};
  return db;
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error("Error writing db file:", e);
  }
}

// Strip date suffix from filename stem (matches Python behavior)
function getBaseStem(filename) {
  const stem = path.basename(filename, path.extname(filename));
  return stem.replace(/\s*\d{4}-\d{2}-\d{2}$/, '').trim();
}

// Parse audit trail md file to extract details
function parseAuditTrail(baseStem) {
  const auditFile = path.join(AUDIT_DIR, `${baseStem}_audit.md`);
  if (!fs.existsSync(auditFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(auditFile, 'utf8');
    const steps = [];
    const sections = content.split(/\n---+\n/);

    // Extract file header metadata
    const fileMeta = {};
    const headerMatch = content.match(/# Pipeline Audit Trail\n\*\*File\*\*:\s*(.*?)\n\*\*Created\*\*:\s*(.*?)\n/);
    if (headerMatch) {
      fileMeta.file = headerMatch[1].trim();
      fileMeta.created = headerMatch[2].trim();
    }

    sections.forEach(section => {
      const stepHeader = section.match(/## Step (\d+) — (.*?)\n/);
      if (stepHeader) {
        const stepNum = parseInt(stepHeader[1]);
        const stepName = stepHeader[2].trim();
        const runAtMatch = section.match(/\*Run at:\s*(.*?)\*/);
        const runAt = runAtMatch ? runAtMatch[1].trim() : '';

        // Extract bullets
        const details = {};
        const lines = section.split('\n');
        lines.forEach(line => {
          const bullet = line.match(/^-\s+\*\*(.*?)\*\*:\s*(.*)/);
          if (bullet) {
            details[bullet[1].trim()] = bullet[2].trim();
          }
        });

        // Extract notes
        const notesMatch = section.match(/>\s*(.*)/);
        const notes = notesMatch ? notesMatch[1].trim() : '';

        steps.push({
          step: stepNum,
          name: stepName,
          runAt,
          details,
          notes
        });
      }
    });

    return {
      metadata: fileMeta,
      steps
    };
  } catch (e) {
    console.error(`Error parsing audit file ${auditFile}:`, e);
    return null;
  }
}

// API: Get all files and pipeline runs
app.get('/api/pipelines', (req, res) => {
  try {
    const db = readDB();
    const rawFiles = fs.readdirSync(RAW_UPLOADS_DIR)
      .filter(f => f.endsWith('.csv') || f.endsWith('.xlsx'))
      .map(f => {
        const stat = fs.statSync(path.join(RAW_UPLOADS_DIR, f));
        return {
          filename: f,
          size: stat.size,
          uploadedAt: stat.mtime,
          starred: db.starred.includes(f)
        };
      });

    // We scan 01-04 directories to list actual pipeline runs.
    // A pipeline run is defined by its filename (e.g. "1-20 Units (Multiple States) 2026-06-01")
    const runsMap = {};

    const scanDir = (dirPath, stepNum) => {
      if (!fs.existsSync(dirPath)) return;
      fs.readdirSync(dirPath).forEach(f => {
        if (!f.endsWith('.csv') && !f.endsWith('.xlsx')) return;
        
        // Skip files containing "_w_empty_rows" to avoid double entries
        if (f.includes('_w_empty_rows')) return;

        const stat = fs.statSync(path.join(dirPath, f));
        const runName = path.basename(f, path.extname(f)); // e.g. "1-20 Units (Multiple States) 2026-06-01"
        const baseStem = getBaseStem(runName);

        if (!runsMap[runName]) {
          const airbnbMeta = (db.airbnbOutreach && db.airbnbOutreach[runName]) || { status: 'filtered', googleSheetLink: '' };
          runsMap[runName] = {
            name: runName,
            baseStem,
            starred: db.starred.includes(runName) || db.starred.includes(baseStem),
            lastModified: stat.mtime,
            steps: {
              1: { complete: false },
              2: { complete: false },
              3: { complete: false },
              4: { complete: false }
            },
            files: {},
            audit: parseAuditTrail(baseStem),
            airbnbOutreach: airbnbMeta
          };
        }

        runsMap[runName].steps[stepNum] = {
          complete: true,
          filename: f,
          size: stat.size,
          modifiedAt: stat.mtime
        };
        runsMap[runName].files[stepNum] = path.join(dirPath, f);
        if (stat.mtime > runsMap[runName].lastModified) {
          runsMap[runName].lastModified = stat.mtime;
        }
      });
    };

    scanDir(FILTERED_DIR, 1);
    scanDir(PHONE_DIR, 2);
    scanDir(PICTURE_DIR, 3);
    scanDir(NOTION_DIR, 4);

    const pipelineRuns = Object.values(runsMap).sort((a, b) => b.lastModified - a.lastModified);

    res.json({
      success: true,
      rawFiles,
      pipelineRuns
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Upload raw file
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }
  res.json({
    success: true,
    file: {
      filename: req.file.filename,
      size: req.file.size
    }
  });
});

// API: Star/Unstar a file
app.post('/api/star', (req, res) => {
  const { name, starred } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, error: 'Missing name' });
  }

  const db = readDB();
  if (starred) {
    if (!db.starred.includes(name)) {
      db.starred.push(name);
    }
  } else {
    db.starred = db.starred.filter(item => item !== name);
  }
  writeDB(db);

  res.json({ success: true, starred });
});

// API: Rename pipeline run
app.post('/api/rename', (req, res) => {
  const { oldName, newName } = req.body;
  if (!oldName || !newName) {
    return res.status(400).json({ success: false, error: 'Missing oldName or newName' });
  }

  try {
    const db = readDB();
    
    // Rename database references
    if (db.starred.includes(oldName)) {
      db.starred = db.starred.map(x => x === oldName ? newName : x);
    }
    const oldBaseStem = getBaseStem(oldName);
    const newBaseStem = getBaseStem(newName);
    if (db.starred.includes(oldBaseStem)) {
      db.starred = db.starred.map(x => x === oldBaseStem ? newBaseStem : x);
    }
    if (db.airbnbOutreach && db.airbnbOutreach[oldName]) {
      db.airbnbOutreach[newName] = db.airbnbOutreach[oldName];
      delete db.airbnbOutreach[oldName];
    }
    writeDB(db);

    const dirs = [
      { path: FILTERED_DIR, step: 1 },
      { path: PHONE_DIR, step: 2 },
      { path: PICTURE_DIR, step: 3 },
      { path: NOTION_DIR, step: 4 }
    ];

    let renamedCount = 0;

    // Rename actual CSV/XLSX files in 01-04 folders
    dirs.forEach(({ path: dirPath }) => {
      if (!fs.existsSync(dirPath)) return;
      fs.readdirSync(dirPath).forEach(f => {
        const stem = path.basename(f, path.extname(f));
        
        // Match exact oldName or backup names starting with oldName (e.g. oldName_w_empty_rows)
        if (stem === oldName || stem.startsWith(oldName + '_')) {
          const ext = path.extname(f);
          const suffix = stem.substring(oldName.length); // e.g. "_w_empty_rows"
          const oldFilePath = path.join(dirPath, f);
          const newFilePath = path.join(dirPath, newName + suffix + ext);
          
          fs.renameSync(oldFilePath, newFilePath);
          renamedCount++;
        }
      });
    });

    // Rename audit trail file if it exists
    const oldAuditFile = path.join(AUDIT_DIR, `${oldBaseStem}_audit.md`);
    const newAuditFile = path.join(AUDIT_DIR, `${newBaseStem}_audit.md`);
    if (fs.existsSync(oldAuditFile)) {
      fs.renameSync(oldAuditFile, newAuditFile);
      
      // Update file content inside audit log (change the file label)
      let auditContent = fs.readFileSync(newAuditFile, 'utf8');
      auditContent = auditContent.replace(`**File**: ${oldBaseStem}`, `**File**: ${newBaseStem}`);
      fs.writeFileSync(newAuditFile, auditContent, 'utf8');
      renamedCount++;
    }

    res.json({ success: true, renamedCount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Delete pipeline run or raw file
app.post('/api/delete', (req, res) => {
  const { name, type } = req.body; // type can be 'raw' or 'pipeline'
  if (!name) {
    return res.status(400).json({ success: false, error: 'Missing name' });
  }

  try {
    const db = readDB();
    db.starred = db.starred.filter(item => item !== name);
    const baseStem = getBaseStem(name);
    db.starred = db.starred.filter(item => item !== baseStem);
    if (db.airbnbOutreach && db.airbnbOutreach[name]) {
      delete db.airbnbOutreach[name];
    }
    writeDB(db);

    let deletedCount = 0;

    if (type === 'raw') {
      const filePath = path.join(RAW_UPLOADS_DIR, name);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    } else {
      const dirs = [FILTERED_DIR, PHONE_DIR, PICTURE_DIR, NOTION_DIR];
      dirs.forEach(dirPath => {
        if (!fs.existsSync(dirPath)) return;
        fs.readdirSync(dirPath).forEach(f => {
          const stem = path.basename(f, path.extname(f));
          if (stem === name || stem.startsWith(name + '_')) {
            fs.unlinkSync(path.join(dirPath, f));
            deletedCount++;
          }
        });
      });

      // Delete audit log
      const auditFile = path.join(AUDIT_DIR, `${baseStem}_audit.md`);
      if (fs.existsSync(auditFile)) {
        fs.unlinkSync(auditFile);
        deletedCount++;
      }
    }

    res.json({ success: true, deletedCount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Execute pipeline steps via Python scripts
app.post('/api/run-step', (req, res) => {
  const { action, inputFile, stepNum, afterFile } = req.body;

  let command = '';

  if (action === 'filter_cold_caller') {
    const fullInputPath = path.join(RAW_UPLOADS_DIR, inputFile);
    command = `python3 "${path.join(WORKSPACE_DIR, 'scripts/python_listing_filter_01.py')}" "${fullInputPath}"`;
  } else if (action === 'filter_airbnb') {
    const fullInputPath = path.join(RAW_UPLOADS_DIR, inputFile);
    command = `python3 "${path.join(WORKSPACE_DIR, 'scripts/python_airbnb_filter_01.py')}" "${fullInputPath}"`;
  } else if (action === 'notion_ready') {
    // Run python_listing_filter_end_01.py on Step 3 picture-enriched output file
    const fullInputPath = path.join(PICTURE_DIR, inputFile);
    command = `python3 "${path.join(WORKSPACE_DIR, 'scripts/python_listing_filter_end_01.py')}" "${fullInputPath}"`;
  } else if (action === 'log_enrichment') {
    // log_enrichment_step.py needs before & after files.
    // before file is in Step 1 (for step 2) or Step 2 (for step 3)
    const beforeDir = stepNum === 2 ? FILTERED_DIR : PHONE_DIR;
    const afterDir = stepNum === 2 ? PHONE_DIR : PICTURE_DIR;
    const beforeFilePath = path.join(beforeDir, inputFile);
    const afterFilePath = path.join(afterDir, afterFile);

    command = `python3 "${path.join(WORKSPACE_DIR, 'scripts/log_enrichment_step.py')}" --step ${stepNum} --before "${beforeFilePath}" --after "${afterFilePath}"`;
  } else {
    return res.status(400).json({ success: false, error: 'Unknown action' });
  }

  console.log("Running shell command:", command);

  exec(command, { cwd: WORKSPACE_DIR }, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error running command: ${error.message}`);
      return res.json({
        success: false,
        error: error.message,
        stdout,
        stderr
      });
    }

    res.json({
      success: true,
      stdout,
      stderr
    });
  });
});

// API: Update Airbnb Outreach Status & Google Sheet Link
app.post('/api/airbnb/update-status', (req, res) => {
  const { name, status, googleSheetLink } = req.body;
  if (!name || !status) {
    return res.status(400).json({ success: false, error: 'Missing name or status' });
  }

  try {
    const db = readDB();
    if (!db.airbnbOutreach) {
      db.airbnbOutreach = {};
    }
    if (!db.airbnbOutreach[name]) {
      db.airbnbOutreach[name] = { status: 'filtered', googleSheetLink: '' };
    }
    db.airbnbOutreach[name].status = status;
    if (googleSheetLink !== undefined) {
      db.airbnbOutreach[name].googleSheetLink = googleSheetLink;
    }
    writeDB(db);
    res.json({ success: true, airbnbOutreach: db.airbnbOutreach[name] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get CRM Config
app.get('/api/crm-config', (req, res) => {
  const db = readDB();
  res.json({ success: true, crmConfig: db.crmConfig });
});

// API: Save CRM Config
app.post('/api/crm-config', (req, res) => {
  try {
    const { url } = req.body;
    let exportUrl = url || '';
    
    // Auto-convert standard share links to export CSV links
    if (exportUrl.includes('/edit')) {
      exportUrl = exportUrl.replace(/\/edit.*$/, '/export?format=csv');
    }

    const db = readDB();
    db.crmConfig.googleSheetUrl = exportUrl;
    writeDB(db);
    
    res.json({ success: true, crmConfig: db.crmConfig });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Fetch and Parse CRM Data from Google Sheets
app.get('/api/crm-data', async (req, res) => {
  try {
    const db = readDB();
    const sheetUrl = db.crmConfig && db.crmConfig.googleSheetUrl 
      ? db.crmConfig.googleSheetUrl 
      : null;

    if (!sheetUrl) {
      return res.json({ success: false, error: 'NO_URL_CONFIGURED' });
    }

    const response = await fetch(sheetUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch CSV: ${response.statusText}`);
    }
    const csvText = await response.text();
    
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: function(results) {
        res.json({ success: true, data: results.data });
      },
      error: function(error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server started at http://localhost:${PORT}`);
});
