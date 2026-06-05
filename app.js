/* =========================================================
   SchemaVision — Core Application Logic
   ========================================================= */

// ──────────────────────────────────────────────
//  STATE
// ──────────────────────────────────────────────
let state = {
  tables: [],
  relationships: [],
  nextId: 1,
  selectedTable: null,
  editingTableId: null,
};

let canvas = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  isPanning: false,
  panStart: { x: 0, y: 0 },
};

// Column types for dropdowns
const COL_TYPES = [
  'INT','BIGINT','SMALLINT','TINYINT',
  'VARCHAR(255)','VARCHAR(100)','TEXT','CHAR(1)',
  'FLOAT','DOUBLE','DECIMAL(10,2)',
  'BOOLEAN',
  'DATE','DATETIME','TIMESTAMP','TIME',
  'UUID','JSON','BLOB',
];

const TABLE_COLORS = [
  '#3b82f6','#8b5cf6','#10b981','#f59e0b',
  '#ef4444','#06b6d4','#f97316','#ec4899',
  '#84cc16','#a78bfa','#34d399','#fb923c',
];

let colorIndex = 0;
let currentExportMode = 'sql';
let editingColId = null; // for modal

// ──────────────────────────────────────────────
//  INIT
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  setupCanvas();
  renderAll();

  // Auto-save on any state change
  setInterval(saveToStorage, 3000);

  // Populate selects when relModal opens
  document.getElementById('relFrom').addEventListener('change', () => {
    populateColSelect('relFrom', 'relFromCol');
  });
  document.getElementById('relTo').addEventListener('change', () => {
    populateColSelect('relTo', 'relToCol');
  });
});

// ──────────────────────────────────────────────
//  PANEL SWITCHING
// ──────────────────────────────────────────────
function switchPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('panel-' + name).classList.remove('hidden');
  const btn = document.querySelector(`.nav-item[data-panel="${name}"]`);
  if (btn) btn.classList.add('active');

  if (name === 'tables') renderTablesList();
  if (name === 'relationships') renderRelationshipsList();
  if (name === 'export') { renderSQL(); }
}

// ──────────────────────────────────────────────
//  SIDEBAR TOGGLE
// ──────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
  setTimeout(() => { setupCanvasSize(); drawRelationships(); }, 320);
}

// ──────────────────────────────────────────────
//  CANVAS SETUP & DRAWING
// ──────────────────────────────────────────────
function setupCanvas() {
  const wrapper = document.getElementById('canvasWrapper');
  const relCanvas = document.getElementById('relCanvas');

  setupCanvasSize();

  // Panning
  wrapper.addEventListener('mousedown', (e) => {
    if (e.target === wrapper || e.target === relCanvas || e.target.id === 'canvasStage') {
      canvas.isPanning = true;
      canvas.panStart = { x: e.clientX - canvas.offsetX, y: e.clientY - canvas.offsetY };
      wrapper.classList.add('panning');
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!canvas.isPanning) return;
    canvas.offsetX = e.clientX - canvas.panStart.x;
    canvas.offsetY = e.clientY - canvas.panStart.y;
    applyTransform();
    drawRelationships();
  });
  window.addEventListener('mouseup', () => {
    canvas.isPanning = false;
    document.getElementById('canvasWrapper').classList.remove('panning');
  });

  // Scroll to zoom
  wrapper.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = wrapper.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    canvas.offsetX = mx - (mx - canvas.offsetX) * delta;
    canvas.offsetY = my - (my - canvas.offsetY) * delta;
    canvas.scale = Math.min(Math.max(canvas.scale * delta, 0.2), 3);
    applyTransform();
    drawRelationships();
    updateZoomLabel();
  }, { passive: false });

  window.addEventListener('resize', () => {
    setupCanvasSize();
    drawRelationships();
  });
}

function setupCanvasSize() {
  const wrapper = document.getElementById('canvasWrapper');
  const relCanvas = document.getElementById('relCanvas');
  relCanvas.width = wrapper.offsetWidth;
  relCanvas.height = wrapper.offsetHeight;
}

function applyTransform() {
  const stage = document.getElementById('canvasStage');
  stage.style.transform = `translate(${canvas.offsetX}px, ${canvas.offsetY}px) scale(${canvas.scale})`;
}

function updateZoomLabel() {
  document.getElementById('zoomLabel').textContent = Math.round(canvas.scale * 100) + '%';
}

function zoomIn() {
  canvas.scale = Math.min(canvas.scale * 1.2, 3);
  applyTransform(); drawRelationships(); updateZoomLabel();
}
function zoomOut() {
  canvas.scale = Math.max(canvas.scale / 1.2, 0.2);
  applyTransform(); drawRelationships(); updateZoomLabel();
}
function resetView() {
  canvas.scale = 1; canvas.offsetX = 0; canvas.offsetY = 0;
  applyTransform(); drawRelationships(); updateZoomLabel();
}

function autoArrange() {
  const cols = Math.ceil(Math.sqrt(state.tables.length)) || 1;
  const padX = 60, padY = 60, gapX = 280, gapY = 220;
  state.tables.forEach((t, i) => {
    t.x = padX + (i % cols) * gapX;
    t.y = padY + Math.floor(i / cols) * gapY;
  });
  renderTableCards();
  drawRelationships();
  saveToStorage();
  showToast('Tables arranged');
}

// ──────────────────────────────────────────────
//  TABLE CARD DRAG
// ──────────────────────────────────────────────
function makeDraggable(el, tableId) {
  let dragging = false, startX, startY, origX, origY;

  el.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    e.stopPropagation();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const t = state.tables.find(t => t.id === tableId);
    origX = t.x; origY = t.y;
    el.style.zIndex = 50;

    // Select
    state.selectedTable = tableId;
    document.querySelectorAll('.table-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - startX) / canvas.scale;
    const dy = (e.clientY - startY) / canvas.scale;
    const t = state.tables.find(t => t.id === tableId);
    if (!t) return;
    t.x = Math.max(0, origX + dx);
    t.y = Math.max(0, origY + dy);
    el.style.left = t.x + 'px';
    el.style.top  = t.y + 'px';
    drawRelationships();
  });

  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      el.style.zIndex = '';
      saveToStorage();
    }
  });
}

// ──────────────────────────────────────────────
//  DRAW RELATIONSHIPS (SVG canvas)
// ──────────────────────────────────────────────
function drawRelationships() {
  const relCanvas = document.getElementById('relCanvas');
  const ctx = relCanvas.getContext('2d');
  ctx.clearRect(0, 0, relCanvas.width, relCanvas.height);

  const stage = document.getElementById('canvasStage');
  const stageRect = stage.getBoundingClientRect();
  const wrapperRect = document.getElementById('canvasWrapper').getBoundingClientRect();

  state.relationships.forEach(rel => {
    const fromTable = state.tables.find(t => t.id === rel.fromTable);
    const toTable = state.tables.find(t => t.id === rel.toTable);
    if (!fromTable || !toTable) return;

    const fromEl = document.getElementById('table-' + fromTable.id);
    const toEl   = document.getElementById('table-' + toTable.id);
    if (!fromEl || !toEl) return;

    const fRect = fromEl.getBoundingClientRect();
    const tRect = toEl.getBoundingClientRect();

    // Convert to canvas coords
    const fx1 = fRect.left - wrapperRect.left;
    const fx2 = fRect.right - wrapperRect.left;
    const fy  = fRect.top - wrapperRect.top + fRect.height / 2;
    const tx1 = tRect.left - wrapperRect.left;
    const tx2 = tRect.right - wrapperRect.left;
    const ty  = tRect.top - wrapperRect.top + tRect.height / 2;

    // Smart port selection
    let x1, x2;
    if (fx2 < tx1) { x1 = fx2; x2 = tx1; }
    else if (tx2 < fx1) { x1 = fx1; x2 = tx2; }
    else { x1 = (fx1 + fx2) / 2; x2 = (tx1 + tx2) / 2; }

    const y1 = fy, y2 = ty;
    const cpx = (x1 + x2) / 2;

    // Line style by type
    const colors = { 'one-to-one': 'rgba(16,185,129,0.65)', 'one-to-many': 'rgba(96,165,250,0.65)', 'many-to-many': 'rgba(167,139,250,0.65)' };
    ctx.strokeStyle = colors[rel.type] || 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(cpx, y1, cpx, y2, x2, y2);
    ctx.stroke();

    // Arrowhead on target end
    drawArrow(ctx, cpx, y2, x2, y2, rel.type);

    // Source marker
    drawSourceMarker(ctx, cpx, y1, x1, y1, rel.type);
  });
}

function drawArrow(ctx, fromX, fromY, toX, toY, type) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const size = 8;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - size * Math.cos(angle - Math.PI/7), toY - size * Math.sin(angle - Math.PI/7));
  ctx.lineTo(toX - size * Math.cos(angle + Math.PI/7), toY - size * Math.sin(angle + Math.PI/7));
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}

function drawSourceMarker(ctx, cpx, cpy, x1, y1, type) {
  if (type === 'one-to-one') {
    // Single tick
    const angle = Math.atan2(cpy - y1, cpx - x1);
    const perp = angle + Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(x1 + 8 * Math.cos(angle) + 5 * Math.cos(perp),
               y1 + 8 * Math.sin(angle) + 5 * Math.sin(perp));
    ctx.lineTo(x1 + 8 * Math.cos(angle) - 5 * Math.cos(perp),
               y1 + 8 * Math.sin(angle) - 5 * Math.sin(perp));
    ctx.stroke();
  } else if (type === 'many-to-many') {
    // Crow's foot at source
    const angle = Math.atan2(cpy - y1, cpx - x1);
    const perp = angle + Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(x1 + 12 * Math.cos(angle), y1 + 12 * Math.sin(angle));
    ctx.lineTo(x1 + 4 * Math.cos(angle) + 6 * Math.cos(perp), y1 + 4 * Math.sin(angle) + 6 * Math.sin(perp));
    ctx.moveTo(x1 + 12 * Math.cos(angle), y1 + 12 * Math.sin(angle));
    ctx.lineTo(x1 + 4 * Math.cos(angle) - 6 * Math.cos(perp), y1 + 4 * Math.sin(angle) - 6 * Math.sin(perp));
    ctx.stroke();
  }
}

// ──────────────────────────────────────────────
//  RENDER ALL
// ──────────────────────────────────────────────
function renderAll() {
  renderTableCards();
  drawRelationships();
  updateMetrics();
  updateEmptyState();
}

function updateEmptyState() {
  const empty = document.getElementById('canvasEmpty');
  if (state.tables.length === 0) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
  }
}

function updateMetrics() {
  const totalCols = state.tables.reduce((s, t) => s + t.columns.length, 0);
  const score = computeScore();
  document.getElementById('metric-tables').textContent = state.tables.length;
  document.getElementById('metric-cols').textContent = totalCols;
  document.getElementById('metric-rels').textContent = state.relationships.length;
  document.getElementById('metric-score').textContent = score > 0 ? score : '—';
}

function computeScore() {
  const t = state.tables.length;
  const c = state.tables.reduce((s, tb) => s + tb.columns.length, 0);
  const r = state.relationships.length;
  if (t === 0) return 0;
  return Math.min(100, Math.round((t * 5 + c * 1.2 + r * 8)));
}

// ──────────────────────────────────────────────
//  TABLE CARDS
// ──────────────────────────────────────────────
function renderTableCards() {
  const stage = document.getElementById('canvasStage');
  // Remove old cards
  stage.querySelectorAll('.table-card').forEach(el => el.remove());

  state.tables.forEach(table => {
    const el = createTableCard(table);
    stage.appendChild(el);
    makeDraggable(el, table.id);
  });
}

function createTableCard(table) {
  const el = document.createElement('div');
  el.className = 'table-card';
  el.id = 'table-' + table.id;
  el.style.left = table.x + 'px';
  el.style.top  = table.y + 'px';

  const pkCount = table.columns.filter(c => c.pk).length;
  const fkCount = table.columns.filter(c => c.fk).length;

  el.innerHTML = `
    <div class="table-card-header">
      <div class="table-color-dot" style="background:${table.color}"></div>
      <span class="table-card-name">${esc(table.name)}</span>
      <div class="table-card-actions">
        <button class="table-action-btn" title="Edit" onclick="editTable(${table.id})">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8 2l2 2-6 6H2v-2L8 2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
        </button>
        <button class="table-action-btn" title="Delete" onclick="deleteTable(${table.id})">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M4 3V2h4v1M5 5v4M7 5v4M3 3l.5 7h5L9 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
    <div class="table-card-body">
      ${table.columns.map(col => `
        <div class="table-column-row">
          <div class="col-name-wrap">
            ${col.pk ? '<span class="col-pk-badge">PK</span>' : ''}
            ${col.fk ? '<span class="col-fk-badge">FK</span>' : ''}
            <span class="col-name">${esc(col.name)}</span>
          </div>
          <span class="col-type">${esc(col.type)}</span>
        </div>
      `).join('')}
    </div>
  `;
  return el;
}

// ──────────────────────────────────────────────
//  TABLES LIST PANEL
// ──────────────────────────────────────────────
function renderTablesList() {
  const container = document.getElementById('tablesList');
  if (state.tables.length === 0) {
    container.innerHTML = `<div style="color:var(--text-3);text-align:center;padding:40px 0;font-size:13.5px">No tables yet. Click <strong style="color:var(--text-2)">Add Table</strong> to start.</div>`;
    return;
  }
  container.innerHTML = state.tables.map(t => `
    <div class="table-list-item">
      <div class="table-list-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
        <div class="table-color-dot" style="background:${t.color}; width:9px;height:9px;border-radius:50%;flex-shrink:0"></div>
        <span class="table-list-name">${esc(t.name)}</span>
        <span class="table-list-count">${t.columns.length} col${t.columns.length!==1?'s':''}</span>
        <div class="table-list-btns" onclick="event.stopPropagation()">
          <button class="btn-ghost small" onclick="editTable(${t.id})">Edit</button>
          <button class="btn-ghost small" onclick="deleteTable(${t.id});renderTablesList()">Delete</button>
        </div>
      </div>
      <div class="table-list-body">
        ${t.columns.map(col => `
          <div class="tl-col-row">
            ${col.pk ? '<span class="col-pk-badge">PK</span>' : ''}
            ${col.fk ? '<span class="col-fk-badge">FK</span>' : ''}
            <span class="tl-col-name">${esc(col.name)}</span>
            <span class="tl-col-type">${esc(col.type)}</span>
            ${col.notNull ? '<span style="font-size:10px;color:var(--text-3)">NOT NULL</span>' : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

// ──────────────────────────────────────────────
//  RELATIONSHIPS LIST PANEL
// ──────────────────────────────────────────────
function renderRelationshipsList() {
  const container = document.getElementById('relationshipsList');
  if (state.relationships.length === 0) {
    container.innerHTML = `<div style="color:var(--text-3);text-align:center;padding:40px 0;font-size:13.5px">No relationships yet. Click <strong style="color:var(--text-2)">New Relation</strong> to connect tables.</div>`;
    return;
  }
  container.innerHTML = state.relationships.map((r, i) => {
    const fromT = state.tables.find(t => t.id === r.fromTable);
    const toT   = state.tables.find(t => t.id === r.toTable);
    const fromName = fromT ? fromT.name : 'Unknown';
    const toName   = toT   ? toT.name   : 'Unknown';
    const typeLabels = { 'one-to-one': '1 : 1', 'one-to-many': '1 : N', 'many-to-many': 'N : M' };
    return `
      <div class="rel-item">
        <div class="rel-item-info">
          <div class="rel-item-main">${esc(fromName)}.${esc(r.fromCol || '?')} → ${esc(toName)}.${esc(r.toCol || '?')}</div>
          <div class="rel-item-type">Foreign key relationship</div>
        </div>
        <span class="rel-type-badge ${r.type}">${typeLabels[r.type] || r.type}</span>
        <button class="btn-ghost small" onclick="deleteRelationship(${i});renderRelationshipsList()">Remove</button>
      </div>
    `;
  }).join('');
}

// ──────────────────────────────────────────────
//  ADD / EDIT TABLE MODAL
// ──────────────────────────────────────────────
let modalColumns = [];

function openAddTable() {
  state.editingTableId = null;
  document.getElementById('tableModalTitle').textContent = 'New Table';
  document.getElementById('tableNameInput').value = '';
  modalColumns = [{ id: Date.now(), name: 'id', type: 'INT', pk: true, fk: false, notNull: true }];
  renderModalColumns();
  openModalById('tableModal');
}

function editTable(id) {
  const t = state.tables.find(t => t.id === id);
  if (!t) return;
  state.editingTableId = id;
  document.getElementById('tableModalTitle').textContent = 'Edit Table';
  document.getElementById('tableNameInput').value = t.name;
  modalColumns = t.columns.map(c => ({ ...c }));
  renderModalColumns();
  openModalById('tableModal');
}

function addColumnRow() {
  modalColumns.push({ id: Date.now(), name: '', type: 'VARCHAR(255)', pk: false, fk: false, notNull: false });
  renderModalColumns();
}

function renderModalColumns() {
  const list = document.getElementById('columnsList');
  list.innerHTML = modalColumns.map((col, i) => `
    <div class="column-row">
      <input type="text" value="${esc(col.name)}" placeholder="column_name"
        onchange="modalColumns[${i}].name=this.value" />
      <select onchange="modalColumns[${i}].type=this.value">
        ${COL_TYPES.map(t => `<option value="${t}" ${col.type===t?'selected':''}>${t}</option>`).join('')}
      </select>
      <div class="chk-cell">
        <input type="checkbox" title="Primary Key" ${col.pk?'checked':''} onchange="modalColumns[${i}].pk=this.checked" />
      </div>
      <div class="chk-cell">
        <input type="checkbox" title="Foreign Key" ${col.fk?'checked':''} onchange="modalColumns[${i}].fk=this.checked" />
      </div>
      <div class="chk-cell">
        <input type="checkbox" title="Not Null" ${col.notNull?'checked':''} onchange="modalColumns[${i}].notNull=this.checked" />
      </div>
      <button class="col-del-btn" onclick="removeModalColumn(${i})" title="Remove">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
  `).join('');
}

function removeModalColumn(i) {
  modalColumns.splice(i, 1);
  renderModalColumns();
}

function saveTable() {
  const name = document.getElementById('tableNameInput').value.trim();
  if (!name) { showToast('Please enter a table name'); return; }
  if (modalColumns.length === 0) { showToast('Add at least one column'); return; }

  // Validate column names
  for (const col of modalColumns) {
    if (!col.name.trim()) { showToast('All columns need a name'); return; }
  }

  if (state.editingTableId !== null) {
    const t = state.tables.find(t => t.id === state.editingTableId);
    if (t) {
      t.name = name;
      t.columns = modalColumns.map(c => ({ ...c, name: c.name.trim() }));
    }
  } else {
    const newTable = {
      id: state.nextId++,
      name,
      columns: modalColumns.map(c => ({ ...c, name: c.name.trim() })),
      x: 100 + Math.random() * 200,
      y: 100 + Math.random() * 200,
      color: TABLE_COLORS[colorIndex % TABLE_COLORS.length],
    };
    colorIndex++;
    state.tables.push(newTable);
  }

  closeModalById('tableModal');
  renderAll();
  renderTablesList();
  saveToStorage();
  setSaveStatus('Saved');
  showToast(state.editingTableId !== null ? 'Table updated' : 'Table created');
}

function deleteTable(id) {
  state.tables = state.tables.filter(t => t.id !== id);
  state.relationships = state.relationships.filter(r => r.fromTable !== id && r.toTable !== id);
  renderAll();
  renderTablesList();
  renderRelationshipsList();
  saveToStorage();
  setSaveStatus('Saved');
  showToast('Table deleted');
}

// ──────────────────────────────────────────────
//  RELATIONSHIP MODAL
// ──────────────────────────────────────────────
function openAddRelationship() {
  if (state.tables.length < 2) { showToast('You need at least 2 tables to create a relationship'); return; }
  populateTableSelect('relFrom');
  populateTableSelect('relTo');
  populateColSelect('relFrom', 'relFromCol');
  populateColSelect('relTo', 'relToCol');
  openModalById('relModal');
}

function populateTableSelect(selectId) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = state.tables.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
}

function populateColSelect(tableSelectId, colSelectId) {
  const tableId = parseInt(document.getElementById(tableSelectId).value);
  const table = state.tables.find(t => t.id === tableId);
  const colSel = document.getElementById(colSelectId);
  if (!table) { colSel.innerHTML = ''; return; }
  colSel.innerHTML = table.columns.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
}

function saveRelationship() {
  const fromTable = parseInt(document.getElementById('relFrom').value);
  const toTable   = parseInt(document.getElementById('relTo').value);
  const fromCol   = document.getElementById('relFromCol').value;
  const toCol     = document.getElementById('relToCol').value;
  const type      = document.getElementById('relType').value;

  if (fromTable === toTable) { showToast('Choose two different tables'); return; }

  const exists = state.relationships.find(r =>
    r.fromTable === fromTable && r.toTable === toTable &&
    r.fromCol === fromCol && r.toCol === toCol
  );
  if (exists) { showToast('Relationship already exists'); return; }

  state.relationships.push({ fromTable, toTable, fromCol, toCol, type });
  closeModalById('relModal');
  renderAll();
  renderRelationshipsList();
  saveToStorage();
  showToast('Relationship added');
}

function deleteRelationship(i) {
  state.relationships.splice(i, 1);
  renderAll();
  saveToStorage();
  showToast('Relationship removed');
}

// ──────────────────────────────────────────────
//  EXPORT
// ──────────────────────────────────────────────
function switchExport(mode, btn) {
  currentExportMode = mode;
  document.querySelectorAll('.export-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('sqlDialect').style.display = mode === 'sql' ? 'block' : 'none';
  renderSQL();
}

function renderSQL() {
  const output = document.getElementById('exportOutput');
  if (!output) return;
  if (currentExportMode === 'json') {
    const json = JSON.stringify({ tables: state.tables, relationships: state.relationships }, null, 2);
    output.textContent = json;
    return;
  }

  const dialect = document.getElementById('sqlDialect').value;
  let sql = `-- SchemaVision Export\n-- Generated: ${new Date().toLocaleString()}\n-- Dialect: ${dialect.toUpperCase()}\n\n`;

  state.tables.forEach(table => {
    sql += `-- Table: ${table.name}\n`;
    sql += `CREATE TABLE ${quoteIdent(table.name, dialect)} (\n`;
    const lines = [];
    const pks = table.columns.filter(c => c.pk);

    table.columns.forEach(col => {
      let line = `  ${quoteIdent(col.name, dialect)} ${mapType(col.type, dialect)}`;
      if (col.pk && pks.length === 1) line += ' PRIMARY KEY';
      if (col.notNull && !col.pk) line += ' NOT NULL';
      if (col.pk && dialect === 'postgresql' && col.type === 'INT') line = line.replace('INTEGER', 'SERIAL').replace(' NOT NULL', '');
      if (col.pk && dialect === 'mysql' && col.type === 'INT') line += ' AUTO_INCREMENT';
      lines.push(line);
    });

    if (pks.length > 1) {
      lines.push(`  PRIMARY KEY (${pks.map(c => quoteIdent(c.name, dialect)).join(', ')})`);
    }

    // Foreign keys
    state.relationships.filter(r => r.fromTable === table.id).forEach(rel => {
      const refTable = state.tables.find(t => t.id === rel.toTable);
      if (!refTable) return;
      lines.push(`  CONSTRAINT fk_${table.name}_${rel.fromCol} FOREIGN KEY (${quoteIdent(rel.fromCol, dialect)}) REFERENCES ${quoteIdent(refTable.name, dialect)}(${quoteIdent(rel.toCol, dialect)})`);
    });

    sql += lines.join(',\n') + '\n);\n\n';
  });

  output.textContent = sql.trim();
}

function quoteIdent(name, dialect) {
  if (dialect === 'mysql') return '`' + name + '`';
  return '"' + name + '"';
}

function mapType(type, dialect) {
  const map = {
    postgresql: { 'INT': 'INTEGER', 'BIGINT': 'BIGINT', 'VARCHAR(255)': 'VARCHAR(255)', 'BOOLEAN': 'BOOLEAN', 'UUID': 'UUID', 'JSON': 'JSONB' },
    mysql:      { 'INT': 'INT', 'BIGINT': 'BIGINT', 'BOOLEAN': 'TINYINT(1)', 'UUID': 'CHAR(36)', 'JSON': 'JSON' },
    sqlite:     { 'INT': 'INTEGER', 'BIGINT': 'INTEGER', 'VARCHAR(255)': 'TEXT', 'VARCHAR(100)': 'TEXT', 'CHAR(1)': 'TEXT', 'FLOAT': 'REAL', 'DOUBLE': 'REAL', 'DECIMAL(10,2)': 'REAL', 'BOOLEAN': 'INTEGER', 'UUID': 'TEXT', 'JSON': 'TEXT', 'BLOB': 'BLOB' },
  };
  return (map[dialect] && map[dialect][type]) || type;
}

function copyExport() {
  const text = document.getElementById('exportOutput').textContent;
  navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    showToast('Copied!');
  });
}

function downloadExport() {
  const text = document.getElementById('exportOutput').textContent;
  const ext  = currentExportMode === 'sql' ? 'sql' : 'json';
  const mime = currentExportMode === 'sql' ? 'text/sql' : 'application/json';
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'schema.' + ext;
  a.click();
  showToast('Downloaded schema.' + ext);
}

function importJSON() {
  const raw = document.getElementById('importInput').value.trim();
  if (!raw) { showToast('Paste JSON first'); return; }
  try {
    const data = JSON.parse(raw);
    if (!data.tables) throw new Error('Missing tables');
    state.tables = data.tables || [];
    state.relationships = data.relationships || [];
    state.nextId = Math.max(0, ...state.tables.map(t => t.id)) + 1;
    colorIndex = state.tables.length;
    renderAll();
    saveToStorage();
    showToast('Schema imported successfully');
    document.getElementById('importInput').value = '';
  } catch (e) {
    showToast('Invalid JSON: ' + e.message);
  }
}

// ──────────────────────────────────────────────
//  TEMPLATES
// ──────────────────────────────────────────────
function loadTemplate(name) {
  const templates = {
    ecommerce: {
      tables: [
        { id: 1, name: 'users', color: '#3b82f6', x: 60, y: 80, columns: [
          { id: 1, name: 'id', type: 'INT', pk: true, fk: false, notNull: true },
          { id: 2, name: 'email', type: 'VARCHAR(255)', pk: false, fk: false, notNull: true },
          { id: 3, name: 'name', type: 'VARCHAR(255)', pk: false, fk: false, notNull: true },
          { id: 4, name: 'created_at', type: 'TIMESTAMP', pk: false, fk: false, notNull: false },
        ]},
        { id: 2, name: 'products', color: '#10b981', x: 380, y: 80, columns: [
          { id: 5, name: 'id', type: 'INT', pk: true, fk: false, notNull: true },
          { id: 6, name: 'name', type: 'VARCHAR(255)', pk: false, fk: false, notNull: true },
          { id: 7, name: 'price', type: 'DECIMAL(10,2)', pk: false, fk: false, notNull: true },
          { id: 8, name: 'stock', type: 'INT', pk: false, fk: false, notNull: true },
          { id: 9, name: 'category_id', type: 'INT', pk: false, fk: true, notNull: false },
        ]},
        { id: 3, name: 'orders', color: '#f59e0b', x: 60, y: 320, columns: [
          { id: 10, name: 'id', type: 'INT', pk: true, fk: false, notNull: true },
          { id: 11, name: 'user_id', type: 'INT', pk: false, fk: true, notNull: true },
          { id: 12, name: 'total', type: 'DECIMAL(10,2)', pk: false, fk: false, notNull: true },
          { id: 13, name: 'status', type: 'VARCHAR(100)', pk: false, fk: false, notNull: true },
          { id: 14, name: 'created_at', type: 'TIMESTAMP', pk: false, fk: false, notNull: false },
        ]},
        { id: 4, name: 'order_items', color: '#ef4444', x: 380, y: 320, columns: [
          { id: 15, name: 'id', type: 'INT', pk: true, fk: false, notNull: true },
          { id: 16, name: 'order_id', type: 'INT', pk: false, fk: true, notNull: true },
          { id: 17, name: 'product_id', type: 'INT', pk: false, fk: true, notNull: true },
          { id: 18, name: 'quantity', type: 'INT', pk: false, fk: false, notNull: true },
          { id: 19, name: 'price', type: 'DECIMAL(10,2)', pk: false, fk: false, notNull: true },
        ]},
        { id: 5, name: 'categories', color: '#8b5cf6', x: 680, y: 80, columns: [
          { id: 20, name: 'id', type: 'INT', pk: true, fk: false, notNull: true },
          { id: 21, name: 'name', type: 'VARCHAR(255)', pk: false, fk: false, notNull: true },
          { id: 22, name: 'slug', type: 'VARCHAR(255)', pk: false, fk: false, notNull: true },
        ]},
      ],
      relationships: [
        { fromTable: 3, toTable: 1, fromCol: 'user_id', toCol: 'id', type: 'one-to-many' },
        { fromTable: 4, toTable: 3, fromCol: 'order_id', toCol: 'id', type: 'one-to-many' },
        { fromTable: 4, toTable: 2, fromCol: 'product_id', toCol: 'id', type: 'one-to-many' },
        { fromTable: 2, toTable: 5, fromCol: 'category_id', toCol: 'id', type: 'one-to-many' },
      ],
    },
    blog: {
      tables: [
        { id: 1, name: 'users', color: '#3b82f6', x: 60, y: 80, columns: [
          { id: 1, name: 'id', type: 'INT', pk: true, fk: false, notNull: true },
          { id: 2, name: 'username', type: 'VARCHAR(100)', pk: false, fk: false, notNull: true },
          { id: 3, name: 'email', type: 'VARCHAR(255)', pk: false, fk: false, notNull: true },
          { id: 4, name: 'role', type: 'VARCHAR(100)', pk: false, fk: false, notNull: false },
        ]},
        { id: 2, name: 'posts', color: '#10b981', x: 360, y: 80, columns: [
          { id: 5, name: 'id', type: 'INT', pk: true, fk: false, notNull: true },
          { id: 6, name: 'title', type: 'VARCHAR(255)', pk: false, fk: false, notNull: true },
          { id: 7, name: 'body', type: 'TEXT', pk: false, fk: false, notNull: false },
          { id: 8, name: 'author_id', type: 'INT', pk: false, fk: true, notNull: true },
          { id: 9, name: 'published_at', type: 'DATETIME', pk: false, fk: false, notNull: false },
        ]},
        { id: 3, name: 'comments', color: '#f59e0b', x: 660, y: 80, columns: [
          { id: 10, name: 'id', type: 'INT', pk: true, fk: false, notNull: true },
          { id: 11, name: 'post_id', type: 'INT', pk: false, fk: true, notNull: true },
          { id: 12, name: 'author_id', type: 'INT', pk: false, fk: true, notNull: true },
          { id: 13, name: 'body', type: 'TEXT', pk: false, fk: false, notNull: true },
        ]},
        { id: 4, name: 'tags', color: '#8b5cf6', x: 60, y: 320, columns: [
          { id: 14, name: 'id', type: 'INT', pk: true, fk: false, notNull: true },
          { id: 15, name: 'name', type: 'VARCHAR(100)', pk: false, fk: false, notNull: true },
          { id: 16, name: 'slug', type: 'VARCHAR(100)', pk: false, fk: false, notNull: true },
        ]},
        { id: 5, name: 'post_tags', color: '#ec4899', x: 360, y: 320, columns: [
          { id: 17, name: 'post_id', type: 'INT', pk: true, fk: true, notNull: true },
          { id: 18, name: 'tag_id', type: 'INT', pk: true, fk: true, notNull: true },
        ]},
      ],
      relationships: [
        { fromTable: 2, toTable: 1, fromCol: 'author_id', toCol: 'id', type: 'one-to-many' },
        { fromTable: 3, toTable: 2, fromCol: 'post_id', toCol: 'id', type: 'one-to-many' },
        { fromTable: 3, toTable: 1, fromCol: 'author_id', toCol: 'id', type: 'one-to-many' },
        { fromTable: 5, toTable: 2, fromCol: 'post_id', toCol: 'id', type: 'many-to-many' },
        { fromTable: 5, toTable: 4, fromCol: 'tag_id', toCol: 'id', type: 'many-to-many' },
      ],
    },
    saas: {
      tables: [
        { id: 1, name: 'organizations', color: '#3b82f6', x: 60, y: 60, columns: [
          { id: 1, name: 'id', type: 'UUID', pk: true, fk: false, notNull: true },
          { id: 2, name: 'name', type: 'VARCHAR(255)', pk: false, fk: false, notNull: true },
          { id: 3, name: 'plan', type: 'VARCHAR(100)', pk: false, fk: false, notNull: true },
          { id: 4, name: 'created_at', type: 'TIMESTAMP', pk: false, fk: false, notNull: true },
        ]},
        { id: 2, name: 'users', color: '#10b981', x: 380, y: 60, columns: [
          { id: 5, name: 'id', type: 'UUID', pk: true, fk: false, notNull: true },
          { id: 6, name: 'email', type: 'VARCHAR(255)', pk: false, fk: false, notNull: true },
          { id: 7, name: 'org_id', type: 'UUID', pk: false, fk: true, notNull: true },
          { id: 8, name: 'role', type: 'VARCHAR(100)', pk: false, fk: false, notNull: true },
          { id: 9, name: 'created_at', type: 'TIMESTAMP', pk: false, fk: false, notNull: true },
        ]},
        { id: 3, name: 'sessions', color: '#f59e0b', x: 700, y: 60, columns: [
          { id: 10, name: 'id', type: 'UUID', pk: true, fk: false, notNull: true },
          { id: 11, name: 'user_id', type: 'UUID', pk: false, fk: true, notNull: true },
          { id: 12, name: 'token', type: 'TEXT', pk: false, fk: false, notNull: true },
          { id: 13, name: 'expires_at', type: 'TIMESTAMP', pk: false, fk: false, notNull: true },
        ]},
        { id: 4, name: 'subscriptions', color: '#8b5cf6', x: 60, y: 300, columns: [
          { id: 14, name: 'id', type: 'UUID', pk: true, fk: false, notNull: true },
          { id: 15, name: 'org_id', type: 'UUID', pk: false, fk: true, notNull: true },
          { id: 16, name: 'plan', type: 'VARCHAR(100)', pk: false, fk: false, notNull: true },
          { id: 17, name: 'status', type: 'VARCHAR(100)', pk: false, fk: false, notNull: true },
          { id: 18, name: 'expires_at', type: 'TIMESTAMP', pk: false, fk: false, notNull: false },
        ]},
        { id: 5, name: 'audit_logs', color: '#ef4444', x: 380, y: 300, columns: [
          { id: 19, name: 'id', type: 'UUID', pk: true, fk: false, notNull: true },
          { id: 20, name: 'user_id', type: 'UUID', pk: false, fk: true, notNull: true },
          { id: 21, name: 'action', type: 'VARCHAR(255)', pk: false, fk: false, notNull: true },
          { id: 22, name: 'resource', type: 'VARCHAR(255)', pk: false, fk: false, notNull: false },
          { id: 23, name: 'created_at', type: 'TIMESTAMP', pk: false, fk: false, notNull: true },
        ]},
      ],
      relationships: [
        { fromTable: 2, toTable: 1, fromCol: 'org_id', toCol: 'id', type: 'one-to-many' },
        { fromTable: 3, toTable: 2, fromCol: 'user_id', toCol: 'id', type: 'one-to-many' },
        { fromTable: 4, toTable: 1, fromCol: 'org_id', toCol: 'id', type: 'one-to-one' },
        { fromTable: 5, toTable: 2, fromCol: 'user_id', toCol: 'id', type: 'one-to-many' },
      ],
    },
  };

  const tpl = templates[name];
  if (!tpl) return;
  state.tables = tpl.tables;
  state.relationships = tpl.relationships;
  state.nextId = Math.max(0, ...state.tables.map(t => t.id)) + 1;
  colorIndex = state.tables.length;
  canvas.scale = 1; canvas.offsetX = 40; canvas.offsetY = 20;
  applyTransform(); updateZoomLabel();
  switchPanel('diagram');
  renderAll();
  saveToStorage();
  showToast(`Loaded ${name} template`);
}

// ──────────────────────────────────────────────
//  CLEAR
// ──────────────────────────────────────────────
function clearAll() {
  if (state.tables.length === 0 && state.relationships.length === 0) return;
  if (!confirm('Clear the entire schema? This cannot be undone.')) return;
  state.tables = [];
  state.relationships = [];
  state.nextId = 1;
  colorIndex = 0;
  renderAll();
  renderTablesList();
  renderRelationshipsList();
  saveToStorage();
  showToast('Schema cleared');
}

// ──────────────────────────────────────────────
//  MODAL HELPERS
// ──────────────────────────────────────────────
function openModalById(id) {
  document.getElementById(id).classList.add('open');
}
function closeModalById(id) {
  document.getElementById(id).classList.remove('open');
}
function closeModal(e, id) {
  if (e.target === document.getElementById(id)) closeModalById(id);
}

// ──────────────────────────────────────────────
//  TOAST
// ──────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ──────────────────────────────────────────────
//  SAVE STATUS
// ──────────────────────────────────────────────
function setSaveStatus(s) {
  const el = document.getElementById('saveStatus');
  if (el) el.textContent = s;
}

// ──────────────────────────────────────────────
//  LOCAL STORAGE
// ──────────────────────────────────────────────
function saveToStorage() {
  try {
    localStorage.setItem('schemavision_state', JSON.stringify({
      tables: state.tables,
      relationships: state.relationships,
      nextId: state.nextId,
      colorIndex,
    }));
    setSaveStatus('Saved');
  } catch(e) {}
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('schemavision_state');
    if (!raw) return;
    const data = JSON.parse(raw);
    state.tables        = data.tables || [];
    state.relationships = data.relationships || [];
    state.nextId        = data.nextId || 1;
    colorIndex          = data.colorIndex || 0;
  } catch(e) {}
}

// ──────────────────────────────────────────────
//  UTILS
// ──────────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
    e.preventDefault(); openAddTable();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
    e.preventDefault(); switchPanel('export'); renderSQL();
  }
});
