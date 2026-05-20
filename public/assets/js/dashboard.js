// ProvenLedgerVN — Admin Dashboard Data Loader
//
// Data strategy (two layers):
//   1. localStorage — primary store. Every batch registered in this browser
//      is saved immediately and survives page refreshes indefinitely.
//   2. On-chain event query — background supplement. Merges any events found
//      (e.g. batches registered from another device) into the local cache.
//      If the Amoy public RPC rejects the eth_getLogs request, the localStorage
//      layer is already rendered and the failure is silent.

'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
var ANOMALY_THRESHOLD = 10;

// Key is contract-address–scoped so a re-deploy starts clean.
function _lsKey() {
  var cfg = window.PROVENLEDGER_CONFIG;
  return cfg ? 'plvn_batches_' + cfg.CONTRACT_ADDRESS.toLowerCase() : 'plvn_batches';
}

// ── In-memory cache (newest first) ────────────────────────────────────────
var _dash = { batches: [], activity: [], checkpoints: [], scans: [] };

// ── Bootstrap ──────────────────────────────────────────────────────────────
(function () {
  // 1. Render localStorage immediately — no async wait, no spinner needed.
  _loadFromStorage();
  _renderAll();
  _setLoadingState(false);

  // 2. Try on-chain event query in the background to pick up any batches
  //    registered from other browsers / the simulate script.
  _fetchChainEvents().catch(function (err) {
    console.warn('[Dashboard] Background event query failed (RPC limit?):', err.message);
  });
})();

// ── localStorage helpers ───────────────────────────────────────────────────
function _loadFromStorage() {
  try {
    var raw = localStorage.getItem(_lsKey());
    var saved = raw ? JSON.parse(raw) : [];
    // Ensure newest-first order
    _dash.batches  = Array.isArray(saved) ? saved.map(_normalizeBatch) : [];
    _rebuildActivity();
  } catch (e) {
    _dash.batches  = [];
    _dash.activity = [];
    _dash.checkpoints = [];
    _dash.scans = [];
  }
}

function _saveToStorage() {
  try {
    localStorage.setItem(_lsKey(), JSON.stringify(_dash.batches));
  } catch (e) { /* storage full or private mode — silently skip */ }
}

function _rebuildActivity() {
  _dash.activity = _dash.batches.map(function (b) {
    return {
      type:   'batch',
      block:  b.block  || 0,
      txHash: b.txHash || '',
      title:  'Batch Registered — ' + (b.productName || b.origin || '—'),
      actor:  b.manufacturer || '',
    };
  });
  // CheckpointAdded entries are appended by _fetchChainEvents if available
}

// ── Background on-chain event query ───────────────────────────────────────
async function _fetchChainEvents() {
  var cfg = window.PROVENLEDGER_CONFIG;
  var placeholder = '0x0000000000000000000000000000000000000000';
  if (!cfg || !ethers.isAddress(cfg.CONTRACT_ADDRESS) || cfg.CONTRACT_ADDRESS === placeholder) return;

  var provider = new ethers.JsonRpcProvider(cfg.PUBLIC_RPC);
  var contract  = new ethers.Contract(cfg.CONTRACT_ADDRESS, window.PROVENLEDGER_ABI, provider);

  // Some public RPCs reject unbounded eth_getLogs; catch and continue.
  var batchEvents = [], cpEvents = [], scanEvents = [];
  try {
    batchEvents = await _queryEvents(provider, contract, cfg.CONTRACT_ADDRESS, 'BatchRegistered');
  } catch (e) {
    console.warn('[Dashboard] BatchRegistered query failed:', e.message);
  }
  try {
    cpEvents = await _queryEvents(provider, contract, cfg.CONTRACT_ADDRESS, 'CheckpointAdded');
  } catch (e) {
    console.warn('[Dashboard] CheckpointAdded query failed:', e.message);
  }
  try {
    scanEvents = await _queryEvents(provider, contract, cfg.CONTRACT_ADDRESS, 'UnitScanned');
  } catch (e) {
    console.warn('[Dashboard] UnitScanned query failed:', e.message);
  }

  // Merge on-chain batches into the in-memory cache (deduplicate by batchId)
  var known = new Set(_dash.batches.map(function (b) { return _key(b.batchId); }));
  // Events are oldest-first; reverse so we unshift newest-first
  batchEvents.slice().reverse().forEach(function (e) {
    var batchKey = _key(e.args.batchId);
    if (!known.has(batchKey)) {
      _dash.batches.push(_parseBatch(e)); // push then re-sort below
      known.add(batchKey);
    } else {
      // Back-fill txHash / block for batches that were registered in this session
      var existing = _findBatch(e.args.batchId);
      if (existing && !existing.txHash) {
        existing.txHash = e.transactionHash;
        existing.block  = e.blockNumber;
      }
    }
  });

  // Sort newest-first by block (batches with block=0 stay at the top)
  _dash.batches.sort(function (a, b) { return (b.block || Infinity) - (a.block || Infinity); });

  _applyCheckpointEvents(cpEvents);
  _applyScanEvents(scanEvents);
  await _backfillLiveBatchCounts(contract);

  // Build enriched activity that also includes checkpoints
  var cpActivity = cpEvents.map(function (e) {
    return {
      type:   'checkpoint',
      block:  e.blockNumber,
      txHash: e.transactionHash,
      title:  'Checkpoint — ' + e.args.status + ' · ' + e.args.location,
      actor:  e.args.actor,
    };
  });
  var batchActivity = _dash.batches.map(function (b) {
    return {
      type:   'batch',
      block:  b.block  || 0,
      txHash: b.txHash || '',
      title:  'Batch Registered — ' + (b.productName || b.origin || '—'),
      actor:  b.manufacturer || '',
    };
  });
  _dash.activity = [...batchActivity, ...cpActivity]
    .sort(function (a, b) { return (b.block || Infinity) - (a.block || Infinity); });

  _saveToStorage(); // persist newly discovered batches and live counts
  _renderAll();
  _renderConfigTab(cfg);
}

async function _queryEvents(provider, contract, address, eventName) {
  var fragment = contract.interface.getEvent(eventName);
  var topic = fragment.topicHash || ethers.id(fragment.format('sighash'));
  var logs = await provider.getLogs({ address: address, topics: [topic] });
  return logs.map(function (log) {
    var parsed = contract.interface.parseLog(log);
    return {
      args: parsed.args,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
    };
  });
}

function _applyCheckpointEvents(events) {
  _dash.checkpoints = events.map(function (e) {
    return {
      batchId: _hex(e.args.batchId),
      block:   e.blockNumber,
      txHash:  e.transactionHash,
    };
  });

  var counts = {};
  _dash.checkpoints.forEach(function (cp) {
    var batchKey = _key(cp.batchId);
    counts[batchKey] = (counts[batchKey] || 0) + 1;
  });
  _dash.batches.forEach(function (b) {
    var batchKey = _key(b.batchId);
    if (Object.prototype.hasOwnProperty.call(counts, batchKey)) {
      b.checkpointCount = counts[batchKey];
    }
  });
}

function _applyScanEvents(events) {
  _dash.scans = events.map(function (e) {
    return {
      batchId:   _hex(e.args.batchId),
      unitIndex: Number(e.args.unitIndex),
      newCount:  Number(e.args.newCount),
      block:     e.blockNumber,
      txHash:    e.transactionHash,
    };
  });

  var perBatch = {};
  var latestPerUnit = {};
  _dash.scans.forEach(function (scan) {
    var batchKey = _key(scan.batchId);
    perBatch[batchKey] = (perBatch[batchKey] || 0) + 1;
    var unitKey = batchKey + ':' + scan.unitIndex;
    latestPerUnit[unitKey] = Math.max(latestPerUnit[unitKey] || 0, scan.newCount);
  });

  _dash.batches.forEach(function (b) {
    var batchKey = _key(b.batchId);
    b.scanCount = perBatch[batchKey] || 0;
    b.anomalyCount = 0;
  });

  Object.keys(latestPerUnit).forEach(function (unitKey) {
    if (latestPerUnit[unitKey] <= ANOMALY_THRESHOLD) return;
    var batchKey = unitKey.split(':')[0];
    var b = _findBatch(batchKey);
    if (b && !_isExpired(b)) b.anomalyCount = (b.anomalyCount || 0) + 1;
  });
}

async function _backfillLiveBatchCounts(contract) {
  if (!_dash.batches.length) return;
  await Promise.all(_dash.batches.map(async function (b) {
    if (!b.batchId) return;
    try {
      var count = await contract.getCheckpointCount(b.batchId);
      b.checkpointCount = Number(count);
    } catch (e) { /* batch may not exist on current network */ }

    // The consumer UI records scans for unit 0. Event logs cover all units;
    // this fallback gives useful live stats even when an RPC refuses log queries.
    try {
      var scan = await contract.getUnitScan(b.batchId, 0);
      var unitZeroCount = Number(scan.count);
      if (!_dash.scans.length) {
        b.scanCount = unitZeroCount;
      }
      if (unitZeroCount > ANOMALY_THRESHOLD && !_isExpired(b)) {
        b.anomalyCount = Math.max(b.anomalyCount || 0, 1);
      }
    } catch (e) { /* scan lookup can fail for stale localStorage rows */ }
  }));
}

// ── Called by submitRegister() after a confirmed tx ───────────────────────
function pushToDashboard(batch) {
  // Avoid duplicates if the background query already added this batch
  batch = _normalizeBatch(batch);
  var exists = _dash.batches.some(function (b) { return _key(b.batchId) === _key(batch.batchId); });
  if (!exists) {
    _dash.batches.unshift(batch); // newest-first
    _dash.activity.unshift({
      type:   'batch',
      block:  0,
      txHash: '',
      title:  'Batch Registered — ' + (batch.productName || batch.origin || '—'),
      actor:  batch.manufacturer || '',
    });
  }
  _saveToStorage();
  _renderAll();
}

function pushCheckpointToDashboard(checkpoint) {
  var batch = _findBatch(checkpoint.batchId);
  if (batch) {
    batch.checkpointCount = Number(batch.checkpointCount || 0) + 1;
  }
  _dash.checkpoints.push({
    batchId: _hex(checkpoint.batchId),
    block:   checkpoint.block || 0,
    txHash:  checkpoint.txHash || '',
  });
  _dash.activity.unshift({
    type:   'checkpoint',
    block:  checkpoint.block || 0,
    txHash: checkpoint.txHash || '',
    title:  'Checkpoint — ' + (checkpoint.status || '—') + ' · ' + (checkpoint.location || '—'),
    actor:  checkpoint.actor || '',
  });
  _saveToStorage();
  _renderAll();
}

// ── Render helpers ─────────────────────────────────────────────────────────
function _renderAll() {
  _renderStats();
  _renderRecentBatches();
  _renderAllBatches(_dash.batches);
  _renderActivityLog();
  var cfg = window.PROVENLEDGER_CONFIG;
  if (cfg) _renderConfigTab(cfg);
}

function _renderStats() {
  var stats = _computeStats();
  _setText('stat-total-batches', stats.totalBatches);
  _setText('stat-active-checkpoints', stats.activeCheckpoints);
  _setText('stat-consumer-scans', stats.consumerScans);
  _setText('stat-anomaly-flags', stats.anomalyFlags);
}

function _renderRecentBatches() {
  var tbody = document.getElementById('recent-batches-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  var slice = _dash.batches.slice(0, 5);
  if (!slice.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:24px 0;">No batches registered yet. Register the first one above.</td></tr>';
    return;
  }
  slice.forEach(function (b) { tbody.appendChild(_makeRecentRow(b)); });
}

function _renderAllBatches(list) {
  var tbody = document.getElementById('all-batches-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);padding:24px 0;">No batches found.</td></tr>';
    return;
  }
  list.forEach(function (b) { tbody.appendChild(_makeAllBatchRow(b)); });
}

function _renderActivityLog() {
  var el = document.getElementById('activity-timeline');
  if (!el) return;
  el.innerHTML = '';
  if (!_dash.activity.length) {
    el.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:32px 0;">No on-chain activity found.</p>';
    return;
  }
  var cfg = window.PROVENLEDGER_CONFIG;
  _dash.activity.slice(0, 30).forEach(function (ev) {
    var item = document.createElement('div');
    item.className = 'timeline__item';
    var txPart = (ev.txHash && cfg)
      ? 'Tx: <a href="' + cfg.EXPLORER_BASE + '/tx/' + ev.txHash + '" target="_blank" style="color:var(--accent-purple-light);">' + _sh(ev.txHash) + ' ↗</a>'
      : '';
    var blockPart = ev.block ? '· Block #' + ev.block : '';
    item.innerHTML =
      '<div class="timeline__dot"></div>' +
      '<div class="timeline__content">' +
        '<div class="timeline__title">' + _esc(ev.title) + '</div>' +
        '<div class="timeline__meta">' +
          '<span>🔑 ' + _sa(ev.actor) + '</span>' +
          (txPart   ? '<span>' + txPart   + '</span>' : '') +
          (blockPart ? '<span>' + blockPart + '</span>' : '') +
        '</div>' +
      '</div>';
    el.appendChild(item);
  });
}

function _renderConfigTab(cfg) {
  var body = document.getElementById('config-info-body');
  if (!body || body.children.length) return;
  var rows = [
    ['Contract Address', cfg.CONTRACT_ADDRESS],
    ['Network',          cfg.EXPECTED_NETWORK_NAME],
    ['Chain ID',         cfg.EXPECTED_CHAIN_ID.toString()],
    ['Public RPC',       cfg.PUBLIC_RPC],
    ['Explorer',
      '<a href="' + cfg.EXPLORER_BASE + '/address/' + cfg.CONTRACT_ADDRESS +
      '" target="_blank" style="color:var(--accent-purple-light);">View on PolygonScan ↗</a>'],
  ];
  rows.forEach(function (r) {
    var div = document.createElement('div');
    div.className = 'result__row';
    div.innerHTML =
      '<span class="result__row-label">'  + r[0] + '</span>' +
      '<span class="result__row-value result__row-value--mono" style="word-break:break-all;">' + r[1] + '</span>';
    body.appendChild(div);
  });
}

// ── Row builders ───────────────────────────────────────────────────────────
function _makeRecentRow(b) {
  var now     = Math.floor(Date.now() / 1000);
  var expired = b.expiryDate && b.expiryDate < now;
  var tr = document.createElement('tr');
  var tdExp = _cell(_fd(b.expiryDate));
  if (expired) tdExp.style.color = 'var(--accent-red-light)';
  var anomaly = Number(b.anomalyCount || 0) > 0;
  var tdScans = document.createElement('td');
  tdScans.innerHTML = '<span class="scan-count ' + (anomaly ? 'scan-count--warning' : 'scan-count--normal') + '">' +
    _fmtNumber(b.scanCount || 0) + (anomaly ? ' — Review' : '') + '</span>';
  var tdSt = document.createElement('td');
  tdSt.innerHTML = anomaly ? '<span class="badge badge--amber">Review</span>'
                           : expired ? '<span class="badge badge--red">Expired</span>'
                                     : '<span class="badge badge--purple">Registered</span>';
  tr.append(
    _copyCell(b.batchId), _cell(b.productName), _cell(b.origin),
    tdExp, _cell(_fmtNumber(b.checkpointCount || 0)), tdScans, tdSt
  );
  return tr;
}

function _makeAllBatchRow(b) {
  var now     = Math.floor(Date.now() / 1000);
  var expired = b.expiryDate && b.expiryDate < now;
  var tr = document.createElement('tr');
  tr.dataset.batchId     = (b.batchId     || '').toLowerCase();
  tr.dataset.productName = (b.productName || '').toLowerCase();
  var tdExp = _cell(_fd(b.expiryDate));
  if (expired) tdExp.style.color = 'var(--accent-red-light)';
  var tdScans = document.createElement('td');
  var anomaly = Number(b.anomalyCount || 0) > 0;
  tdScans.innerHTML = '<span class="scan-count ' + (anomaly ? 'scan-count--warning' : 'scan-count--normal') + '">' +
    _fmtNumber(b.scanCount || 0) + (anomaly ? ' — Review' : '') + '</span>';
  var tdSt = document.createElement('td');
  tdSt.innerHTML = anomaly ? '<span class="badge badge--amber">Review</span>'
                           : expired ? '<span class="badge badge--red">Expired</span>'
                                     : '<span class="badge badge--purple">Registered</span>';
  tr.append(
    _copyCell(b.batchId), _cell(b.productName), _cell(b.origin),
    _cell(_fd(b.productionDate)), tdExp,
    _cell(b.unitCount ? b.unitCount.toLocaleString() : '—'),
    tdScans, tdSt
  );
  return tr;
}

// ── Parsers ────────────────────────────────────────────────────────────────
function _parseBatch(e) {
  return {
    batchId:        e.args.batchId,
    manufacturer:   e.args.manufacturer,
    unitCount:      Number(e.args.unitCount),
    productionDate: Number(e.args.productionDate),
    expiryDate:     Number(e.args.expiryDate),
    origin:         e.args.origin,
    metadataURI:    e.args.metadataURI,
    productName:    _safeJson(e.args.metadataURI, 'productName') || '—',
    category:       _safeJson(e.args.metadataURI, 'category')    || '—',
    txHash:         e.transactionHash,
    block:          e.blockNumber,
    checkpointCount: 0,
    scanCount:       0,
    anomalyCount:    0,
  };
}

function _safeJson(str, field) {
  try { return JSON.parse(str)[field] || ''; } catch (e) { return ''; }
}

// ── DOM helpers ────────────────────────────────────────────────────────────
function _normalizeBatch(batch) {
  return {
    batchId:         batch.batchId || '',
    manufacturer:    batch.manufacturer || '',
    unitCount:       Number(batch.unitCount || 0),
    productionDate:  Number(batch.productionDate || 0),
    expiryDate:      Number(batch.expiryDate || 0),
    origin:          batch.origin || '',
    metadataURI:     batch.metadataURI || '',
    productName:     batch.productName || _safeJson(batch.metadataURI, 'productName') || '—',
    category:        batch.category || _safeJson(batch.metadataURI, 'category') || '—',
    txHash:          batch.txHash || '',
    block:           Number(batch.block || 0),
    checkpointCount: Number(batch.checkpointCount || 0),
    scanCount:       Number(batch.scanCount || 0),
    anomalyCount:    Number(batch.anomalyCount || 0),
  };
}

function _computeStats() {
  var checkpointTotalFromBatches = _dash.batches.reduce(function (sum, b) {
    return sum + Number(b.checkpointCount || 0);
  }, 0);
  var activeCheckpointTotal = Math.max(checkpointTotalFromBatches, _dash.checkpoints.length);
  var scanTotal = _dash.scans.length || _dash.batches.reduce(function (sum, b) {
    return sum + Number(b.scanCount || 0);
  }, 0);
  var anomalyTotal = _dash.batches.reduce(function (sum, b) {
    return sum + Number(b.anomalyCount || 0);
  }, 0);
  return {
    totalBatches:      _fmtNumber(_dash.batches.length),
    activeCheckpoints: _fmtNumber(activeCheckpointTotal),
    consumerScans:     _fmtNumber(scanTotal),
    anomalyFlags:      _fmtNumber(anomalyTotal),
  };
}

function _setText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}

function _findBatch(batchId) {
  var batchKey = _key(batchId);
  return _dash.batches.find(function (b) { return _key(b.batchId) === batchKey; });
}

function _key(value) {
  return _hex(value).toLowerCase();
}

function _hex(value) {
  return value == null ? '' : String(value);
}

function _isExpired(batch) {
  return Boolean(batch && batch.expiryDate && Number(batch.expiryDate) < Math.floor(Date.now() / 1000));
}

function _fmtNumber(n) {
  return Number(n || 0).toLocaleString();
}

function _cell(text) {
  var td = document.createElement('td');
  td.textContent = text || '—';
  return td;
}

function _copyCell(hash) {
  var td = document.createElement('td');
  td.className    = 'mono';
  td.title        = hash;
  td.style.cursor = 'pointer';
  td.textContent  = _sh(hash) + ' 📋';
  td.onclick = function () {
    navigator.clipboard.writeText(hash).then(function () {
      td.style.color = 'var(--accent-green-light)';
      setTimeout(function () { td.style.color = ''; }, 2000);
    });
  };
  return td;
}

function _fd(unix) {
  if (!unix) return '—';
  return new Date(Number(unix) * 1000).toISOString().slice(0, 10);
}
function _sh(h) { return h ? h.slice(0, 6) + '…' + h.slice(-4) : '—'; }
function _sa(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : '—'; }
function _esc(s) {
  return String(s || '').replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function _setLoadingState(loading) {
  var el = document.getElementById('dashboard-loading');
  if (el) el.style.display = loading ? '' : 'none';
}

// ── Search (All Batches tab) ───────────────────────────────────────────────
function filterAllBatches(query) {
  var q     = (query || '').toLowerCase().trim();
  var tbody = document.getElementById('all-batches-body');
  if (!tbody) return;
  Array.from(tbody.rows).forEach(function (row) {
    if (!q) { row.style.display = ''; return; }
    var id   = row.dataset.batchId     || '';
    var name = row.dataset.productName || '';
    row.style.display = (id.includes(q) || name.includes(q)) ? '' : 'none';
  });
}
