const FALLBACKS = {
  Door: { width: 900, height: 2100, thickness: 45, frameWidth: 100, openingAngle: 90, material: 'Generic' },
  Window: { width: 1200, height: 1200, frameDepth: 80, frameWidth: 60, panelCount: 2 },
  Beam: { length: 3000, width: 200, height: 400 },
  Roof: { length: 4000, width: 3000, thickness: 150, slope: 15 },
  ConstructionBlock: { length: 390, width: 190, height: 190 },
  Pipe: { length: 1000, diameter: 100, innerDiameter: 80 },
  Duct: { length: 1000, width: 400, height: 250, thickness: 10, ductShape: 'rectangular' },
  Furniture: { width: 600, depth: 600, height: 900 },
  Fixture: { width: 600, depth: 600, height: 900 },
  Foundation: { length: 1500, width: 1500, height: 500 },
  Vegetation: { height: 3000, diameter: 1500 },
  GenericBIMObject: { width: 1000, depth: 1000, height: 1000 }
};

const dom = {};
let assets = [];
let selected = null;
let state = null;
let debounce = null;
let drag = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

function ensureElement(id, tagName = 'div', parent = document.body) {
  let element = document.getElementById(id);
  if (!element) {
    element = document.createElement(tagName);
    element.id = id;
    element.className = 'runtime-created';
    element.textContent = `Missing UI element #${id} was created automatically.`;
    parent.appendChild(element);
    console.warn(`Phase 4 UI: created missing element #${id}`);
  }
  return element;
}

function bootDom() {
  dom.search = ensureElement('search', 'input');
  dom.typeFilter = ensureElement('typeFilter', 'select');
  dom.assetList = ensureElement('assetList');
  dom.preview = ensureElement('preview', 'canvas');
  dom.stateJson = ensureElement('stateJson', 'pre');
  dom.downloadState = ensureElement('downloadState', 'button');
  dom.toolbar = ensureElement('toolbar', 'section');
  dom.toolbarHeader = ensureElement('toolbarHeader');
  dom.toolbarBody = ensureElement('toolbarBody');
  dom.collapseBtn = ensureElement('collapseBtn', 'button');
  dom.debugStatus = document.getElementById('debugStatus') || document.createElement('div');
  dom.debugStatus.id = 'debugStatus';
  dom.debugStatus.className = 'debug-status';
  if (!dom.debugStatus.parentElement) document.body.appendChild(dom.debugStatus);
}

function setDebugStatus(extra = {}) {
  const status = {
    assetsLoaded: assets.length,
    selectedAssetId: selected ? selected.id : null,
    toolbarRendered: Boolean(extra.toolbarRendered),
    previewRendered: Boolean(extra.previewRendered)
  };
  dom.debugStatus.textContent = `Debug: assets=${status.assetsLoaded}, selected=${status.selectedAssetId || 'none'}, toolbar=${status.toolbarRendered}, preview=${status.previewRendered}`;
  console.log('Phase 4 toolbar status', status);
}

async function loadData() {
  bootDom();
  try {
    const response = await fetch('../assets.json');
    assets = (await response.json()).assets || [];
  } catch (error) {
    console.warn('Phase 4 UI: falling back to bundled sample data.', error);
    const response = await fetch('sample_data/sample_assets.json');
    assets = (await response.json()).assets || [];
  }
  renderFilters();
  renderAssets();
  setDebugStatus();
}

function renderFilters() {
  if (!dom.typeFilter) return;
  const types = [...new Set(assets.map((asset) => asset.elementType).filter(Boolean))].sort();
  dom.typeFilter.innerHTML = '<option value="">All element types</option>' + types.map((type) => `<option>${type}</option>`).join('');
}

function renderAssets() {
  if (!dom.assetList) return;
  const query = (dom.search && dom.search.value ? dom.search.value : '').toLowerCase();
  const type = dom.typeFilter ? dom.typeFilter.value : '';
  dom.assetList.innerHTML = '';
  assets
    .filter((asset) => (!type || asset.elementType === type) && String(asset.displayName || asset.id || '').toLowerCase().includes(query))
    .forEach((asset) => {
      const item = document.createElement('div');
      item.className = 'asset' + (selected && selected.id === asset.id ? ' active' : '');
      item.innerHTML = `<b>${asset.displayName || asset.id}</b><small>${asset.elementType || 'GenericBIMObject'}</small><small>${asset.category || 'uncategorized'}</small>`;
      item.onclick = () => selectAsset(asset);
      dom.assetList.appendChild(item);
    });
}

function normalizeParameter(parameter) {
  return {
    name: parameter.name || 'unnamed',
    label: parameter.label || parameter.name || 'Unnamed',
    description: parameter.description || '',
    type: parameter.type || 'text',
    unit: parameter.unit || null,
    default: parameter.default ?? null,
    min: parameter.min ?? null,
    max: parameter.max ?? null,
    options: parameter.options || null,
    uiControl: parameter.uiControl || (parameter.options ? 'select' : parameter.type === 'number' || parameter.type === 'integer' ? 'number_input' : parameter.type === 'boolean' ? 'checkbox' : 'text_input'),
    toolbarGroup: parameter.toolbarGroup || 'general',
    validation: parameter.validation || {}
  };
}

function parametersFor(asset) {
  const raw = Array.isArray(asset.parameters) ? asset.parameters : [];
  const normalized = raw.map(normalizeParameter).filter((parameter) => parameter.name);
  const fallbacks = FALLBACKS[asset.elementType] || FALLBACKS.GenericBIMObject;
  Object.keys(fallbacks).forEach((name) => {
    if (!normalized.some((parameter) => parameter.name === name)) {
      normalized.push(normalizeParameter({ name, label: name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), default: fallbacks[name], type: typeof fallbacks[name] === 'number' ? 'number' : 'text', uiControl: typeof fallbacks[name] === 'number' ? 'number_input' : 'text_input', toolbarGroup: name === 'material' ? 'materials' : 'dimensions', validation: typeof fallbacks[name] === 'number' ? { positive: true } : {} }));
    }
  });
  return normalized;
}

function defaults(asset) {
  const fallbacks = FALLBACKS[asset.elementType] || FALLBACKS.GenericBIMObject;
  const values = {};
  parametersFor(asset).forEach((parameter) => {
    values[parameter.name] = parameter.default ?? fallbacks[parameter.name] ?? null;
  });
  return values;
}

function selectAsset(asset) {
  selected = { ...asset, parameters: parametersFor(asset) };
  state = {
    instanceId: 'object_' + Date.now(),
    assetId: selected.id,
    elementType: selected.elementType || 'GenericBIMObject',
    category: selected.category || 'uncategorized',
    parameters: defaults(selected),
    placement: { x: 0, y: 0, z: 0, rotation: 0 },
    editability: selected.editability || {}
  };
  renderAssets();
  const toolbarRendered = renderToolbar();
  const previewRendered = draw();
  renderState();
  setDebugStatus({ toolbarRendered, previewRendered });
}

function groups(asset) {
  if (asset && asset.toolbar && Array.isArray(asset.toolbar.groups) && asset.toolbar.groups.length) return asset.toolbar.groups;
  const grouped = {};
  parametersFor(asset || {}).forEach((parameter) => {
    (grouped[parameter.toolbarGroup || 'general'] ??= []).push(parameter.name);
  });
  return Object.entries(grouped).map(([groupId, parameterNames]) => ({ groupId, label: groupId.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), parameters: parameterNames }));
}

function renderToolbar() {
  if (!dom.toolbar || !dom.toolbarBody) {
    showVisibleError('Floating toolbar cannot render because toolbar DOM elements are missing.');
    return false;
  }
  if (dom.toolbar.classList) dom.toolbar.classList.remove('hidden');
  dom.toolbarBody.innerHTML = '';
  const params = parametersFor(selected || {});
  const byName = Object.fromEntries(params.map((parameter) => [parameter.name, parameter]));
  groups(selected || {}).forEach((group) => {
    const wrap = document.createElement('div');
    wrap.className = 'group';
    wrap.innerHTML = `<h3>${group.label || group.groupId || 'Parameters'}</h3>`;
    (group.parameters || []).forEach((name) => {
      const parameter = byName[name];
      if (!parameter) return;
      const field = document.createElement('div');
      field.className = 'field';
      const value = state && state.parameters ? state.parameters[name] ?? '' : '';
      field.innerHTML = fieldHtml(parameter, value);
      wrap.appendChild(field);
    });
    dom.toolbarBody.appendChild(wrap);
  });
  dom.toolbarBody.querySelectorAll('[data-param]').forEach((input) => {
    input.oninput = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => update(input), 180);
    };
  });
  return true;
}

function fieldHtml(parameter, value) {
  let input;
  if (parameter.uiControl === 'select') {
    input = `<select data-param="${parameter.name}">${(parameter.options || []).map((option) => `<option ${option == value ? 'selected' : ''}>${option}</option>`).join('')}</select>`;
  } else if (parameter.uiControl === 'checkbox') {
    input = `<input type="checkbox" data-param="${parameter.name}" ${value ? 'checked' : ''}>`;
  } else if (parameter.uiControl === 'textarea') {
    input = `<textarea data-param="${parameter.name}">${value ?? ''}</textarea>`;
  } else {
    const type = parameter.uiControl === 'color_picker' ? 'color' : parameter.uiControl === 'number_input' ? 'number' : 'text';
    input = `<input type="${type}" data-param="${parameter.name}" value="${value ?? ''}">`;
  }
  return `<label>${parameter.label || parameter.name} ${parameter.unit ? `(${parameter.unit})` : ''}</label>${input}<div class="help">${parameter.description || ''}${parameter.min != null ? ' min ' + parameter.min : ''}${parameter.max != null ? ' max ' + parameter.max : ''}</div><div class="error" id="err_${parameter.name}"></div>`;
}

function validate(parameter, value) {
  const errors = [];
  if (!parameter) return ['Unknown parameter.'];
  if (parameter.uiControl === 'number_input') {
    const number = Number(value);
    if (Number.isNaN(number)) errors.push('Must be numeric');
    if (parameter.validation && parameter.validation.positive && number <= 0) errors.push('Must be positive');
    if (parameter.min != null && number < Number(parameter.min)) errors.push('Below minimum');
    if (parameter.max != null && number > Number(parameter.max)) errors.push('Above maximum');
  }
  return errors;
}

function update(input) {
  if (!selected || !state || !input) return;
  const parameter = parametersFor(selected).find((item) => item.name === input.dataset.param);
  let value = input.type === 'checkbox' ? input.checked : input.value;
  if (input.type === 'number') value = Number(value);
  const errors = validate(parameter, value);
  const errorElement = document.getElementById('err_' + (parameter ? parameter.name : input.dataset.param));
  if (errorElement) errorElement.textContent = errors.join(', ');
  if (!errors.length && parameter) {
    state.parameters[parameter.name] = value;
    const previewRendered = draw();
    renderState();
    setDebugStatus({ toolbarRendered: true, previewRendered });
  }
}

function draw() {
  if (!dom.preview || typeof dom.preview.getContext !== 'function') {
    showVisibleError('Preview canvas is missing, so the asset preview cannot be rendered.');
    return false;
  }
  if (!state) return false;
  const context = dom.preview.getContext('2d');
  if (!context) return false;
  context.clearRect(0, 0, dom.preview.width, dom.preview.height);
  context.save();
  context.translate(dom.preview.width / 2, dom.preview.height / 2 + 20);
  context.strokeStyle = '#1d3557';
  context.fillStyle = '#8ecae6';
  const p = state.parameters || {};
  const e = state.elementType;
  function box(width, height, depth = 60) {
    context.fillRect(-width / 2, -height / 2, width, height);
    context.strokeRect(-width / 2, -height / 2, width, height);
    context.beginPath();
    context.moveTo(-width / 2, -height / 2);
    context.lineTo(-width / 2 + depth, -height / 2 - depth);
    context.lineTo(width / 2 + depth, -height / 2 - depth);
    context.lineTo(width / 2, -height / 2);
    context.stroke();
  }
  if (e === 'Pipe') {
    context.beginPath();
    context.ellipse(0, 0, (p.diameter || 100) / 2, 60, 0, 0, 7);
    context.fill();
    context.stroke();
  } else if (e === 'Vegetation') {
    context.fillStyle = '#8b5a2b';
    context.fillRect(-15, 0, 30, 120);
    context.fillStyle = '#3a7d44';
    context.beginPath();
    context.arc(0, -50, (p.diameter || 1500) / 20, 0, 7);
    context.fill();
    context.stroke();
  } else {
    box(Math.min((p.width || p.length || 1000) / 5, 500), Math.min((p.height || p.thickness || 500) / 5, 420));
  }
  context.restore();
  return true;
}

function renderState() {
  if (!dom.stateJson) return;
  dom.stateJson.textContent = state ? JSON.stringify(state, null, 2) : 'Select an asset.';
}

function showVisibleError(message) {
  console.error(message);
  if (dom.debugStatus) dom.debugStatus.textContent = message;
}

function wireEvents() {
  if (dom.downloadState) {
    dom.downloadState.onclick = () => {
      if (!state) return;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
      link.download = state.instanceId + '.json';
      link.click();
    };
  }
  if (dom.search) dom.search.oninput = renderAssets;
  if (dom.typeFilter) dom.typeFilter.onchange = renderAssets;
  if (dom.collapseBtn && dom.toolbar && dom.toolbar.classList) dom.collapseBtn.onclick = () => dom.toolbar.classList.toggle('collapsed');
  if (dom.toolbarHeader && dom.toolbar) {
    dom.toolbarHeader.onmousedown = (event) => {
      drag = true;
      dragOffsetX = event.clientX - dom.toolbar.offsetLeft;
      dragOffsetY = event.clientY - dom.toolbar.offsetTop;
    };
  }
  document.onmouseup = () => { drag = false; };
  document.onmousemove = (event) => {
    if (drag && dom.toolbar) {
      dom.toolbar.style.left = event.clientX - dragOffsetX + 'px';
      dom.toolbar.style.top = event.clientY - dragOffsetY + 'px';
    }
  };
}

bootDom();
wireEvents();
loadData();
