import { loadCatalog }                        from './catalog.js';
import { planIrrigationLine, DEFAULT_CONFIG } from './engine.js';
import { STRINGS, HTML_LANG, detectLang }     from './i18n.js';

let currentLang = 'en';
function t(key, data) {
  const val = STRINGS[currentLang]?.[key] ?? STRINGS.en[key] ?? key;
  return typeof val === 'function' ? val(data) : val;
}

function setLang(lang) {
  if (!STRINGS[lang]) return;
  currentLang = lang;
  localStorage.setItem('ndp-lang', lang);
  document.documentElement.lang = HTML_LANG[lang] || lang;
  document.querySelectorAll('.lang-bar a[data-lang]').forEach(a => {
    a.classList.toggle('active', a.dataset.lang === lang);
  });
  applyI18nStatic();
  renderResults();
}

// Contact for catalog additions — change this to the maintainer's actual address.
const CATALOG_CONTACT_EMAIL = 'drake69b@gmail.com';

// ---------------------------------------------------------------------------
// Stato globale
// ---------------------------------------------------------------------------
const state = {
  catalog:    null,
  nextNodeId: 1,
  lineInput: {
    name:           '',
    irrigationType: 'drip',
    nodes:          [],
    config:         { ...DEFAULT_CONFIG },
  },
  linePlan:  null,
  error:     null,
};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function init() {
  currentLang = detectLang();
  document.documentElement.lang = HTML_LANG[currentLang] || currentLang;
  applyI18nStatic();
  bindLangBar();
  try {
    state.catalog = await loadCatalog('./data/catalog.json');
  } catch (e) {
    showFatalError(t('fatalCatalog', e.message));
    return;
  }
  addNode();
  bindStaticEvents();
  renderResults();
}

function bindLangBar() {
  document.querySelectorAll('.lang-bar a[data-lang]').forEach(a => {
    a.classList.toggle('active', a.dataset.lang === currentLang);
    a.addEventListener('click', e => { e.preventDefault(); setLang(a.dataset.lang); });
  });
}

// Apply i18n strings to static DOM elements (those that exist before any data loads).
function applyI18nStatic() {
  document.getElementById('how-step1').textContent = t('step1');
  document.getElementById('how-step2').textContent = t('step2');
  document.getElementById('how-step3').textContent = t('step3');
  document.getElementById('how-step4').textContent = t('step4');
  document.title                                            = t('appTitle');
  document.getElementById('app-title').textContent         = t('appTitle');
  document.getElementById('app-tagline').textContent       = t('appTagline');
  document.getElementById('btn-import').textContent   = t('importJson');
  document.getElementById('btn-export').textContent   = t('exportJson');
  document.getElementById('lbl-line-name').textContent = t('lineName');
  document.getElementById('line-name').placeholder    = t('lineNamePh');
  document.getElementById('lbl-line-type').textContent = t('irrigationType');
  document.querySelector('#line-type option[value="drip"]').textContent         = t('typeDrip');
  document.querySelector('#line-type option[value="sprinkler"]').textContent    = t('typeSprinkler');
  document.querySelector('#line-type option[value="micro-sprinkler"]').textContent = t('typeMicro');
  document.getElementById('nodes-title').textContent  = t('nodesTitle');
  document.getElementById('th-num').textContent       = t('colNum');
  document.getElementById('th-plant').textContent     = t('colPlant');
  document.getElementById('th-count').textContent     = t('colCount');
  document.getElementById('th-diam').innerHTML        = `${t('colDiam')} <small>${t('colDiamHint')}</small>`;
  document.getElementById('btn-add-node').textContent = t('addNode');
  document.getElementById('missing-plant-label').textContent = t('missingPlant');
  document.getElementById('missing-plant-cta').textContent   = t('missingPlantCta');
  document.getElementById('missing-plant-cta').href =
    `mailto:${CATALOG_CONTACT_EMAIL}?subject=${encodeURIComponent('NeverDry Planner — plant request')}`;
  document.getElementById('results-title').textContent = t('resultsTitle');
  document.getElementById('cfg-toggle').textContent    = t('cfgTitle');
  document.getElementById('lbl-cfg-eto').textContent        = t('cfgEto');
  document.getElementById('lbl-cfg-runtime').textContent    = t('cfgRuntime');
  document.getElementById('lbl-cfg-max-flow').textContent   = t('cfgMaxFlow');
  document.getElementById('lbl-cfg-emitters').textContent   = t('cfgEmitters');
  document.getElementById('lbl-cfg-max-emitters').textContent = t('cfgMaxEmitters');
  document.getElementById('lbl-cfg-max-err').textContent    = t('cfgMaxErr');
  const haEl1 = document.getElementById('ha-cta-eyebrow');
  const haEl2 = document.getElementById('ha-cta-body');
  const haEl3 = document.getElementById('ha-cta-learn-more');
  if (haEl1) haEl1.textContent = t('haCta1');
  if (haEl2) haEl2.textContent = t('haCta2');
  if (haEl3) haEl3.textContent = t('haCtaLearnMore');
}

// ---------------------------------------------------------------------------
// Nodi
// ---------------------------------------------------------------------------
function addNode() {
  const node = {
    id:              `node-${state.nextNodeId++}`,
    plantName:       '',
    plantCount:      1,
    canopyDiameterM: null,
  };
  state.lineInput.nodes.push(node);
  appendNodeRow(node);
  recalculate();
}

function removeNode(nodeId) {
  if (state.lineInput.nodes.length <= 1) return;
  state.lineInput.nodes = state.lineInput.nodes.filter(n => n.id !== nodeId);
  const row = document.querySelector(`tr[data-node-id="${nodeId}"]`);
  row?._comboDropdown?.remove();   // clean up body-appended dropdown
  row?.remove();
  renumberRows();
  recalculate();
}

function appendNodeRow(node) {
  const tbody = document.getElementById('nodes-body');
  const tr = document.createElement('tr');
  tr.dataset.nodeId = node.id;

  // --- plant combobox ---
  const comboCell = document.createElement('td');
  comboCell.className = 'col-plant';
  const { wrapper, setVal, dropdown } = makeCombobox(node);
  comboCell.appendChild(wrapper);
  tr._comboDropdown = dropdown;   // for cleanup on row removal

  // --- count & diameter ---
  const countCell = document.createElement('td');
  countCell.className = 'col-count';
  const countInput = document.createElement('input');
  countInput.type = 'number'; countInput.min = 1; countInput.step = 1;
  countInput.value = node.plantCount;
  countInput.addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    updateNodeField(node.id, 'plantCount', isNaN(v) || v < 1 ? 1 : v);
  });
  countCell.appendChild(countInput);

  const diamCell = document.createElement('td');
  diamCell.className = 'col-diam';
  const diamInput = document.createElement('input');
  diamInput.type = 'number'; diamInput.min = 0.1; diamInput.step = 0.1;
  diamInput.placeholder = 'auto';
  if (node.canopyDiameterM != null) diamInput.value = node.canopyDiameterM;
  diamInput.addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    updateNodeField(node.id, 'canopyDiameterM', isNaN(v) ? null : v);
  });
  diamCell.appendChild(diamInput);

  const delCell = document.createElement('td');
  delCell.className = 'col-del';
  const delBtn = document.createElement('button');
  delBtn.className = 'btn-del'; delBtn.title = t('removeNode'); delBtn.textContent = '×';
  delBtn.addEventListener('click', () => removeNode(node.id));
  delCell.appendChild(delBtn);

  const numCell = document.createElement('td');
  numCell.className = 'col-num';

  tr.append(numCell, comboCell, countCell, diamCell, delCell);
  tr._comboSetVal = setVal;   // exposed for applyImport
  tbody.appendChild(tr);
  renumberRows();
}

// ---------------------------------------------------------------------------
// Combobox
// ---------------------------------------------------------------------------
function makeCombobox(node) {
  const wrapper = document.createElement('div');
  wrapper.className = 'combobox';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'combo-input';
  input.placeholder = t('plantPh');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = node.plantName;
  wrapper.appendChild(input);

  // Dropdown appended to body to escape table clipping.
  const dropdown = document.createElement('ul');
  dropdown.className = 'combo-list';
  dropdown.hidden = true;
  document.body.appendChild(dropdown);

  let lastValid = node.plantName;

  function position() {
    const r = input.getBoundingClientRect();
    dropdown.style.top   = `${r.bottom + window.scrollY}px`;
    dropdown.style.left  = `${r.left  + window.scrollX}px`;
    dropdown.style.width = `${r.width}px`;
  }

  function show(results) {
    dropdown.innerHTML = '';
    if (!results.length) { dropdown.hidden = true; return; }
    for (const item of results) {
      const { name, common } = item;
      const li = document.createElement('li');
      const sciSpan = document.createElement('span');
      sciSpan.className = 'combo-sci';
      sciSpan.textContent = name;
      li.appendChild(sciSpan);
      // Show common name only when it differs meaningfully from scientific name.
      if (common && common.toLowerCase() !== name.toLowerCase()) {
        const comSpan = document.createElement('span');
        comSpan.className = 'combo-common';
        comSpan.textContent = common;
        li.appendChild(comSpan);
      }
      li.addEventListener('mousedown', e => {
        e.preventDefault();
        confirm(name);
      });
      dropdown.appendChild(li);
    }
    position();
    dropdown.hidden = false;
    dropdown.querySelector('li')?.classList.add('active');
  }

  function hide() { dropdown.hidden = true; }

  function confirm(name) {
    input.value = name;
    lastValid = name;
    updateNodeField(node.id, 'plantName', name);
    hide();
  }

  function activeItem() { return dropdown.querySelector('li.active'); }

  function moveActive(dir) {
    const items = [...dropdown.querySelectorAll('li')];
    if (!items.length) return;
    const idx = items.indexOf(activeItem());
    items.forEach(li => li.classList.remove('active'));
    const next = items[(idx + dir + items.length) % items.length];
    next.classList.add('active');
    next.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', () => {
    const q = input.value;
    if (!q.trim()) { updateNodeField(node.id, 'plantName', ''); hide(); return; }
    show(state.catalog.searchPlants(q, 10));
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) show(state.catalog.searchPlants(input.value, 10));
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      hide();
      // Revert to last valid if current text is not a catalog entry.
      if (!state.catalog.isValidDisplayName(input.value)) {
        input.value = lastValid;
        updateNodeField(node.id, 'plantName', lastValid);
      }
    }, 150);
  });

  input.addEventListener('keydown', e => {
    if (dropdown.hidden) return;
    if (e.key === 'ArrowDown')  { e.preventDefault(); moveActive(+1); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Enter')     { e.preventDefault(); if (activeItem()) confirm(activeItem().querySelector('.combo-sci').textContent); }
    else if (e.key === 'Escape')    { hide(); }
  });

  window.addEventListener('scroll', () => { if (!dropdown.hidden) position(); }, { passive: true });

  function setVal(name) {
    input.value = name;
    lastValid   = name;
  }

  return { wrapper, setVal, dropdown };
}

function renumberRows() {
  document.querySelectorAll('#nodes-body tr .col-num')
    .forEach((td, i) => { td.textContent = i + 1; });
}

function updateNodeField(nodeId, field, value) {
  const node = state.lineInput.nodes.find(n => n.id === nodeId);
  if (node) node[field] = value;
  recalculate();
}

// ---------------------------------------------------------------------------
// Calcolo
// ---------------------------------------------------------------------------
function recalculate() {
  const validNodes = state.lineInput.nodes.filter(n => n.plantName);
  if (validNodes.length === 0) {
    state.linePlan = null;
    state.error    = null;
    renderResults();
    return;
  }
  const lineInput = {
    ...state.lineInput,
    nodes: validNodes.map(n => ({
      ...n,
      plantName: state.catalog.keyFromDisplayName(n.plantName),
    })),
  };
  try {
    state.linePlan = planIrrigationLine(state.catalog, lineInput);
    state.error    = null;
  } catch (e) {
    state.linePlan = null;
    state.error    = e.message;
  }
  renderResults();
}

// ---------------------------------------------------------------------------
// Render risultati
// ---------------------------------------------------------------------------
function renderResults() {
  const section = document.getElementById('results');

  if (!state.linePlan && !state.error) {
    section.innerHTML = `<p class="hint">${esc(t('hintNoPlant'))}</p>`;
    return;
  }
  if (state.error) {
    section.innerHTML = `<p class="error-msg">${esc(state.error)}</p>`;
    return;
  }

  const p = state.linePlan;

  const flowHtml = p.lineFlowLph !== null
    ? `<strong>${p.lineFlowLph} l/h</strong>`
    : `<span class="muted">${t('noFlowSprinkler')}</span>`;

  const classKey  = { bilanciata: 'classBalanced', 'da verificare': 'classCheck', 'non bilanciata': 'classUnbalanced' };
  const classCss  = { bilanciata: 'ok', 'da verificare': 'warn', 'non bilanciata': 'crit' };
  const classIcon = { bilanciata: '✓', 'da verificare': '⚠', 'non bilanciata': '✗' };
  const classLabel = t(classKey[p.classification] || 'classBalanced');
  const classCssVal = classCss[p.classification] || '';
  const classIconVal = classIcon[p.classification] || '';

  const nodeRows = p.nodePlans.map((n, i) => {
    const errPct   = Math.round(n.errorRatio * 100);
    const errSign  = n.errorLph >= 0 ? '+' : '';
    const errCss   = n.compatibility === 'coerente' ? 'ok' : n.compatibility === 'da verificare' ? 'warn' : 'crit';
    const compatIcon = n.compatibility === 'coerente' ? t('compatOk')
                     : n.compatibility === 'da verificare' ? t('compatWarn') : t('compatCrit');
    const emitLabel  = p.irrigationType === 'drip'
      ? n.breakdown.map(b => `${b.count}×${b.lph}`).join(', ')
      : '—';
    const instLabel  = p.irrigationType === 'drip' ? n.installedLph : '—';

    return `
      <tr>
        <td class="col-num">${i + 1}</td>
        <td>${esc(n.plantName)}</td>
        <td class="num muted">${n.kc}</td>
        <td class="num">${n.targetLph}</td>
        <td class="num">${instLabel}</td>
        <td class="num">${emitLabel}</td>
        <td class="num ${errCss}">${errSign}${errPct}%</td>
        <td class="compat ${errCss}">${compatIcon}</td>
      </tr>`;
  }).join('');

  // Total installed row: green ✓ if within limit, red ⚠ if over
  const maxFlow   = state.lineInput.config.maxLineFlowLph;
  const totalInst = p.totalInstalledLph;
  const overLimit = maxFlow != null && totalInst > maxFlow;
  const totalCss  = overLimit ? 'crit' : 'ok';
  const totalIcon = overLimit ? '⚠' : '✓';
  const totalFooter = p.irrigationType === 'drip' ? `
    <tfoot>
      <tr class="tfoot-total">
        <td colspan="4" class="tfoot-label">${t('totalInstalled')}</td>
        <td class="num ${totalCss} tfoot-val">${totalIcon} ${totalInst} l/h${maxFlow != null ? ` / ${maxFlow}` : ''}</td>
        <td colspan="3"></td>
      </tr>
    </tfoot>` : '';

  const notesHtml = p.notes.length
    ? '<ul class="notes">' + p.notes.map(note => {
        const icon = note.code === 'NOTE_CRITICAL' ? '⚠' : 'ⓘ';
        const text = note.code === 'NOTE_MULTIFAMILY' ? t('noteMultifamily')
                   : note.code === 'NOTE_CRITICAL'    ? t('noteCritical', note.data)
                   : note.code === 'NOTE_UNKNOWN'      ? t('noteUnknown', note.data)
                   : note.code;
        return `<li>${icon} ${esc(text)}</li>`;
      }).join('') + '</ul>'
    : '';

  section.innerHTML = `
    <div class="summary-cards">
      <div class="card">
        <span class="label">${t('cardFlow')}</span>
        <span class="value">${flowHtml}</span>
      </div>
      <div class="card">
        <span class="label">${t('cardArea')}</span>
        <span class="value"><strong>${p.areaEquivalentM2} m²</strong></span>
      </div>
      <div class="card">
        <span class="label">${t('cardKc')}</span>
        <span class="value"><strong>${p.kcLine}</strong></span>
      </div>
      <div class="card wide">
        <span class="label">${t('cardFamily')}</span>
        <span class="value">${esc(p.virtualBotanicalFamily)}</span>
      </div>
      <div class="card">
        <span class="label">${t('cardWater')}</span>
        <span class="value">${esc(p.virtualWaterClass)}</span>
      </div>
      <div class="card">
        <span class="label">${t('cardStatus')}</span>
        <span class="value status ${classCssVal}">${classIconVal} ${classLabel}</span>
      </div>
    </div>

    <table class="result-table">
      <thead>
        <tr>
          <th class="col-num">${t('colNum')}</th>
          <th>${t('colPlant')}</th>
          <th class="num">${t('colKc')}</th>
          <th class="num">${t('colTarget')}</th>
          <th class="num">${t('colInst')}</th>
          <th class="num">${t('colEmitters')}</th>
          <th class="num">${t('colError')}</th>
          <th class="num">${t('colStatus')}</th>
        </tr>
      </thead>
      <tbody>${nodeRows}</tbody>
      ${totalFooter}
    </table>
    ${notesHtml}`;
}

// ---------------------------------------------------------------------------
// Import / Export
// ---------------------------------------------------------------------------
function exportJson() {
  if (!state.linePlan) { alert(t('exportNone')); return; }
  const lineName = state.lineInput.name.trim() || 'line';
  const payload = {
    schema:      'neverdry-planner-v1',
    exported_at: new Date().toISOString(),
    line_input:  serializeLineInput(),
    line_plan:   state.linePlan,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${lineName.replace(/\s+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function serializeLineInput() {
  return {
    name:            state.lineInput.name,
    irrigation_type: state.lineInput.irrigationType,
    config: {
      eto_mm_day:             state.lineInput.config.etoMmDay,
      runtime_h_day:          state.lineInput.config.runtimeHDay,
      max_line_flow_lph:      state.lineInput.config.maxLineFlowLph,
      emitter_lph_options:    state.lineInput.config.emitterLphOptions,
      max_emitters_per_node:  state.lineInput.config.maxEmittersPerNode,
      acceptable_error_ratio: state.lineInput.config.acceptableErrorRatio,
    },
    nodes: state.lineInput.nodes.map(n => ({
      id:               n.id,
      plant_name:       state.catalog.keyFromDisplayName(n.plantName) || n.plantName,
      plant_count:      n.plantCount,
      canopy_diameter_m: n.canopyDiameterM,
    })),
  };
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const raw = JSON.parse(e.target.result);
      applyImport(raw.line_input ?? raw);
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

function applyImport(li) {
  document.getElementById('nodes-body').innerHTML = '';
  state.lineInput.nodes = [];
  state.nextNodeId = 1;

  state.lineInput.name           = li.name || '';
  state.lineInput.irrigationType = li.irrigation_type || li.irrigationType || 'drip';
  document.getElementById('line-name').value = state.lineInput.name;
  document.getElementById('line-type').value = state.lineInput.irrigationType;

  if (li.config) {
    state.lineInput.config = {
      etoMmDay:             li.config.eto_mm_day             ?? DEFAULT_CONFIG.etoMmDay,
      runtimeHDay:          li.config.runtime_h_day          ?? DEFAULT_CONFIG.runtimeHDay,
      maxLineFlowLph:       li.config.max_line_flow_lph      ?? DEFAULT_CONFIG.maxLineFlowLph,
      emitterLphOptions:    li.config.emitter_lph_options    ?? DEFAULT_CONFIG.emitterLphOptions,
      maxEmittersPerNode:   li.config.max_emitters_per_node  ?? DEFAULT_CONFIG.maxEmittersPerNode,
      acceptableErrorRatio: li.config.acceptable_error_ratio ?? DEFAULT_CONFIG.acceptableErrorRatio,
    };
    syncAdvancedConfig();
  }

  for (const n of (li.nodes || [])) {
    const displayName = state.catalog.resolvePlant(n.plant_name ?? n.plantName ?? '').name;
    const node = {
      id:              `node-${state.nextNodeId++}`,
      plantName:       displayName,
      plantCount:      n.plant_count ?? n.plantCount ?? 1,
      canopyDiameterM: n.canopy_diameter_m ?? n.canopyDiameterM ?? null,
    };
    state.lineInput.nodes.push(node);
    appendNodeRow(node);
    const row = document.querySelector(`tr[data-node-id="${node.id}"]`);
    if (row) {
      row._comboSetVal?.(node.plantName);
      row.querySelector('input[type="number"]').value = node.plantCount;
      const diamInput = row.querySelectorAll('input[type="number"]')[1];
      if (diamInput && node.canopyDiameterM != null) diamInput.value = node.canopyDiameterM;
    }
  }

  if (state.lineInput.nodes.length === 0) addNode();
  recalculate();
}

// ---------------------------------------------------------------------------
// Configurazione avanzata
// ---------------------------------------------------------------------------
function syncAdvancedConfig() {
  document.getElementById('cfg-eto').value          = state.lineInput.config.etoMmDay;
  document.getElementById('cfg-runtime').value      = state.lineInput.config.runtimeHDay;
  document.getElementById('cfg-max-flow').value     = state.lineInput.config.maxLineFlowLph ?? '';
  document.getElementById('cfg-emitters').value     = state.lineInput.config.emitterLphOptions.join(', ');
  document.getElementById('cfg-max-emitters').value = state.lineInput.config.maxEmittersPerNode;
  document.getElementById('cfg-max-err').value      = Math.round(state.lineInput.config.acceptableErrorRatio * 100);
}

// ---------------------------------------------------------------------------
// Binding eventi statici
// ---------------------------------------------------------------------------
function bindStaticEvents() {
  document.getElementById('line-name').addEventListener('input', e => {
    state.lineInput.name = e.target.value;
  });

  document.getElementById('line-type').addEventListener('change', e => {
    state.lineInput.irrigationType = e.target.value;
    recalculate();
  });

  document.getElementById('btn-add-node').addEventListener('click', addNode);

  document.getElementById('btn-export').addEventListener('click', exportJson);

  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-import').click();
  });

  document.getElementById('file-import').addEventListener('change', e => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('cfg-toggle').addEventListener('click', () => {
    const body   = document.getElementById('cfg-body');
    const toggle = document.getElementById('cfg-toggle');
    body.hidden  = !body.hidden;
    toggle.textContent = body.hidden ? t('cfgTitle') : t('cfgTitleOpen');
  });

  document.getElementById('cfg-eto').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v > 0) { state.lineInput.config.etoMmDay = v; recalculate(); }
  });

  document.getElementById('cfg-runtime').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v > 0) { state.lineInput.config.runtimeHDay = v; recalculate(); }
  });

  document.getElementById('cfg-max-flow').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    state.lineInput.config.maxLineFlowLph = (!isNaN(v) && v > 0) ? v : null;
    recalculate();
  });

  document.getElementById('cfg-max-err').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v) && v > 0 && v <= 100) {
      state.lineInput.config.acceptableErrorRatio = v / 100;
      recalculate();
    }
  });

  document.getElementById('cfg-emitters').addEventListener('change', e => {
    const vals = e.target.value.split(',')
      .map(s => parseFloat(s.trim()))
      .filter(v => !isNaN(v) && v > 0);
    if (vals.length > 0) { state.lineInput.config.emitterLphOptions = vals; recalculate(); }
  });

  document.getElementById('cfg-max-emitters').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v) && v >= 1) { state.lineInput.config.maxEmittersPerNode = v; recalculate(); }
  });
}

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showFatalError(msg) {
  document.body.innerHTML =
    `<div class="fatal-error"><h2>Startup error</h2><p>${esc(msg)}</p></div>`;
}

// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init);
