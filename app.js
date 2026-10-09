/* GesFrío — Catálogo y ubicaciones de almacén de congelados.
 * 100 % offline: datos en IndexedDB, app cacheada por el service worker. */
'use strict';

/* ============================================================
 * Constantes del almacén
 * ============================================================ */
const CAMARAS = ['FRÍO', 'K', 'N', 'L', 'S'];
const POSICIONES = 20;
const LETRAS = ['A', 'B', 'C'];
const CATEGORIAS = ['Pescado', 'Marisco', 'Carne', 'Verduras', 'Precocinados', 'Helados', 'Panadería', 'Postres', 'Otros'];
const FORMATOS = ['Caja', 'Kg', 'Unidades', 'Bolsa', 'Bandeja'];
const APP_VERSION = '1.0.0';

/* ============================================================
 * Utilidades
 * ============================================================ */
const $ = (sel, root = document) => root.querySelector(sel);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Normaliza texto para buscar: minúsculas y sin tildes. */
function norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const byName = (a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });

/** Construye el texto canónico de una ubicación: "K-12-B". */
function locKey(cam, num, letra) { return `${cam}-${num}-${letra}`; }

/** Interpreta una ubicación escrita de muchas formas ("frio 3 a", "K12B", "k-012-b").
 *  Devuelve {cam, num, letra, key} o null si no es válida. */
function parseLoc(text) {
  const t = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  const m = t.match(/^(FRIO|K|N|L|S)[\s\-_.]*0*(\d{1,2})[\s\-_.]*([ABC])$/);
  if (!m) return null;
  const num = parseInt(m[2], 10);
  if (num < 1 || num > POSICIONES) return null;
  const cam = m[1] === 'FRIO' ? 'FRÍO' : m[1];
  return { cam, num, letra: m[3], key: locKey(cam, num, m[3]) };
}

/** Orden natural de ubicaciones: cámara, número, letra. */
function locSort(a, b) {
  const pa = parseLoc(a), pb = parseLoc(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  return (CAMARAS.indexOf(pa.cam) - CAMARAS.indexOf(pb.cam)) || (pa.num - pb.num) || pa.letra.localeCompare(pb.letra);
}

/* ============================================================
 * Base de datos (IndexedDB)
 * ============================================================ */
const DB = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('gesfrio', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('productos')) db.createObjectStore('productos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  },
  tx(stores, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(stores, mode);
      let result;
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Operación cancelada'));
      result = fn(t);
    });
  },
  all() {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction('productos').objectStore('productos').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },
  put(p) { return this.tx(['productos'], 'readwrite', t => { t.objectStore('productos').put(p); }); },
  del(id) { return this.tx(['productos'], 'readwrite', t => { t.objectStore('productos').delete(id); }); },
  replaceAll(list) {
    return this.tx(['productos'], 'readwrite', t => {
      const s = t.objectStore('productos');
      s.clear();
      list.forEach(p => s.put(p));
    });
  },
  putMany(list) {
    return this.tx(['productos'], 'readwrite', t => {
      const s = t.objectStore('productos');
      list.forEach(p => s.put(p));
    });
  },
  getMeta(k) {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction('meta').objectStore('meta').get(k);
      req.onsuccess = () => resolve(req.result ? req.result.v : undefined);
      req.onerror = () => reject(req.error);
    });
  },
  setMeta(k, v) { return this.tx(['meta'], 'readwrite', t => { t.objectStore('meta').put({ k, v }); }); }
};

/* ============================================================
 * Estado en memoria (copia de la base de datos, para ir rápido)
 * ============================================================ */
const state = {
  productos: [],          // lista de productos
  view: 'catalogo',
  q: '',
  fCamara: '',            // '' = todas
  fCategoria: '',
  camara: 'FRÍO',         // cámara seleccionada en la vista de cuadrícula
  highlight: ''           // ubicación a resaltar en la cuadrícula
};

/** Prepara campos derivados para buscar rápido. */
function indexar(p) {
  p.ubicaciones = Array.from(new Set((p.ubicaciones || []).map(u => (parseLoc(u) || {}).key).filter(Boolean))).sort(locSort);
  Object.defineProperty(p, '_q', { value: norm(p.nombre + ' ' + (p.codigo || '')), enumerable: false, writable: true, configurable: true });
  return p;
}

function limpio(p) {
  return {
    id: p.id, nombre: p.nombre, codigo: p.codigo || '', categoria: p.categoria || '',
    formato: p.formato || '', notas: p.notas || '', ubicaciones: p.ubicaciones.slice(),
    actualizado: p.actualizado || new Date().toISOString()
  };
}

async function guardarProducto(p) {
  p.actualizado = new Date().toISOString();
  indexar(p);
  await DB.put(limpio(p));
  const i = state.productos.findIndex(x => x.id === p.id);
  if (i >= 0) state.productos[i] = p; else state.productos.push(p);
  state.productos.sort(byName);
}

async function eliminarProducto(id) {
  await DB.del(id);
  state.productos = state.productos.filter(p => p.id !== id);
}

function getProducto(id) { return state.productos.find(p => p.id === id); }

/** Mapa ubicación -> [productos] */
function mapaUbicaciones() {
  const m = new Map();
  for (const p of state.productos) for (const u of p.ubicaciones) {
    if (!m.has(u)) m.set(u, []);
    m.get(u).push(p);
  }
  return m;
}

function productosEn(key) { return state.productos.filter(p => p.ubicaciones.includes(key)); }

/* ============================================================
 * Datos de ejemplo
 * ============================================================ */
function datosEjemplo() {
  const d = [
    ['Merluza en rodajas', 'PES-001', 'Pescado', 'Caja', ['FRÍO-1-A', 'K-4-B']],
    ['Lomos de bacalao', 'PES-002', 'Pescado', 'Kg', ['FRÍO-2-B']],
    ['Calamar troceado', 'PES-003', 'Pescado', 'Bolsa', ['N-7-C']],
    ['Gamba pelada', 'MAR-001', 'Marisco', 'Caja', ['K-12-B', 'K-13-B']],
    ['Mejillón cocido', 'MAR-002', 'Marisco', 'Kg', ['L-3-A']],
    ['Guisantes finos', 'VER-001', 'Verduras', 'Bolsa', ['N-1-A', 'N-1-B']],
    ['Judía verde plana', 'VER-002', 'Verduras', 'Caja', ['N-2-A']],
    ['Espinacas en hojas', 'VER-003', 'Verduras', 'Bolsa', ['N-2-C', 'S-18-A']],
    ['Pechuga de pollo', 'CAR-001', 'Carne', 'Kg', ['L-10-A', 'L-10-B']],
    ['Hamburguesa de ternera', 'CAR-002', 'Carne', 'Unidades', ['L-11-C']],
    ['Croquetas de jamón', 'PRE-001', 'Precocinados', 'Caja', ['K-1-A', 'S-5-B']],
    ['Pizza cuatro quesos', 'PRE-002', 'Precocinados', 'Unidades', ['S-6-A']],
    ['Lasaña boloñesa', 'PRE-003', 'Precocinados', 'Bandeja', ['S-6-B', 'S-7-B']],
    ['Helado de vainilla 1 L', 'HEL-001', 'Helados', 'Unidades', ['FRÍO-15-A', 'FRÍO-15-B']],
    ['Cono de chocolate', 'HEL-002', 'Helados', 'Caja', ['FRÍO-16-C', 'K-20-A']]
  ];
  const ahora = new Date().toISOString();
  return d.map(([nombre, codigo, categoria, formato, ubicaciones]) =>
    ({ id: uid(), nombre, codigo, categoria, formato, notas: '', ubicaciones, actualizado: ahora }));
}

/* ============================================================
 * Toast y modales
 * ============================================================ */
let toastTimer;
function toast(msg, bad = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, bad ? 4000 : 2400);
}

const modalStack = [];
let modalHistory = false;   // hay una entrada en el historial para el botón «Atrás» de Android

/** Abre un modal. opts: {title, body (html), foot (html), full, onClose}. Devuelve el elemento. */
function openModal({ title, body, foot = '', full = true, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `
    <div class="sheet ${full ? 'sheet-full' : ''}" role="dialog" aria-modal="true">
      <div class="sheet-head">
        <h2 class="sheet-title">${title}</h2>
        <button type="button" class="close-btn" data-close aria-label="Cerrar">✕</button>
      </div>
      <div class="sheet-body">${body}</div>
      ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
    </div>`;
  wrap._onClose = onClose;
  wrap.addEventListener('click', e => {
    if (e.target === wrap || e.target.closest('[data-close]')) closeModal(wrap);
  });
  $('#modals').appendChild(wrap);
  modalStack.push(wrap);
  if (!modalHistory) { history.pushState({ modal: true }, ''); modalHistory = true; }
  return wrap;
}

function closeModal(wrap = modalStack[modalStack.length - 1]) {
  if (!wrap) return;
  const i = modalStack.indexOf(wrap);
  if (i >= 0) modalStack.splice(i, 1);
  wrap.remove();
  if (wrap._onClose) wrap._onClose();
}

function closeAllModals() { while (modalStack.length) closeModal(); }

window.addEventListener('popstate', () => {
  modalHistory = false;
  if (modalStack.length) {
    closeModal();
    if (modalStack.length) { history.pushState({ modal: true }, ''); modalHistory = true; }
  }
});

/** Diálogo de confirmación con botones grandes. Devuelve Promise<boolean>. */
function confirmar(msg, { ok = 'Sí, continuar', peligro = false } = {}) {
  return new Promise(resolve => {
    let decided = false;
    const m = openModal({
      title: 'Confirmar',
      full: false,
      body: `<p class="confirm-msg">${msg}</p>`,
      foot: `<button type="button" class="btn ${peligro ? 'btn-danger-solid' : 'btn-primary'}" data-ok>${esc(ok)}</button>
             <button type="button" class="btn" data-close>Cancelar</button>`,
      onClose: () => { if (!decided) resolve(false); }
    });
    $('[data-ok]', m).addEventListener('click', () => { decided = true; closeModal(m); resolve(true); });
  });
}

/* ============================================================
 * Vistas principales
 * ============================================================ */
function setView(v) {
  state.view = v;
  for (const id of ['catalogo', 'camaras', 'copia']) $('#view-' + id).hidden = id !== v;
  document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (state.view === 'catalogo') renderCatalogo();
  else if (state.view === 'camaras') renderCamara();
  else if (state.view === 'copia') renderInfo();
}

/* ---------- Catálogo + buscador ---------- */
function renderFiltros() {
  $('#f-camara').innerHTML = ['', ...CAMARAS].map(c =>
    `<button type="button" class="chip" data-cam="${esc(c)}" aria-pressed="${state.fCamara === c}">${c || 'Todas'}</button>`).join('');
  const cats = Array.from(new Set([...CATEGORIAS, ...state.productos.map(p => p.categoria).filter(Boolean)]))
    .sort((a, b) => a.localeCompare(b, 'es'));
  if (state.fCategoria && !cats.includes(state.fCategoria)) cats.push(state.fCategoria);
  $('#f-categoria').innerHTML = `<option value="">Todas las categorías</option>` +
    cats.map(c => `<option value="${esc(c)}" ${c === state.fCategoria ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

function htmlLocs(p, camFiltro = '') {
  if (!p.ubicaciones.length) return `<div class="noloc">⚠ Sin ubicación asignada</div>`;
  const locs = camFiltro
    ? [...p.ubicaciones.filter(u => u.startsWith(camFiltro + '-')), ...p.ubicaciones.filter(u => !u.startsWith(camFiltro + '-'))]
    : p.ubicaciones;
  return `<div class="locs">${locs.map(u =>
    `<span class="loc ${camFiltro && !u.startsWith(camFiltro + '-') ? 'dim' : ''}">${esc(u)}</span>`).join('')}</div>`;
}

function htmlItem(p, camFiltro = '') {
  const meta = [p.codigo && `<b>${esc(p.codigo)}</b>`, esc(p.categoria), esc(p.formato)].filter(Boolean).join(' · ');
  return `<li><button type="button" class="item" data-prod="${esc(p.id)}">
    <div class="item-name">${esc(p.nombre)}</div>
    ${meta ? `<div class="item-meta">${meta}</div>` : ''}
    ${htmlLocs(p, camFiltro)}
  </button></li>`;
}

const MAX_LISTA = 300;

function renderCatalogo() {
  renderFiltros();
  const q = norm(state.q);
  const palabras = q.split(/\s+/).filter(Boolean);
  let lista = state.productos;
  if (state.fCamara) lista = lista.filter(p => p.ubicaciones.some(u => u.startsWith(state.fCamara + '-')));
  if (state.fCategoria) lista = lista.filter(p => p.categoria === state.fCategoria);

  // Si lo escrito es una ubicación ("k12b"), mostrar su contenido arriba.
  const loc = parseLoc(state.q);
  let hit = '';
  if (loc) {
    const en = productosEn(loc.key);
    hit = `<div class="lochit">
      <div class="lochit-title">Ubicación</div>
      <button type="button" class="loc loc-big" data-slot="${esc(loc.key)}">${esc(loc.key)}</button>
      <div class="item-meta" style="margin-top:8px">${en.length ? en.map(p => `<b>${esc(p.nombre)}</b>`).join(', ') : 'Vacía'}</div>
    </div>`;
    lista = lista.filter(p => p.ubicaciones.includes(loc.key) || palabras.every(w => p._q.includes(w)));
  } else if (palabras.length) {
    lista = lista.filter(p => palabras.every(w => p._q.includes(w)));
    // Primero los que empiezan por lo buscado o tienen el código exacto.
    lista = lista.slice().sort((a, b) => score(b, q) - score(a, q) || byName(a, b));
  }
  $('#loc-hit').innerHTML = hit;

  const total = state.productos.length;
  $('#count').textContent = lista.length === total
    ? `${total} producto${total === 1 ? '' : 's'}`
    : `${lista.length} de ${total} productos`;

  if (!lista.length) {
    $('#lista').innerHTML = `<li class="empty-msg">${total ? 'No hay productos que coincidan.' : 'El catálogo está vacío.<br>Pulsa «Nuevo» para añadir un producto o «Copia» para importar.'}</li>`;
    return;
  }
  let html = lista.slice(0, MAX_LISTA).map(p => htmlItem(p, state.fCamara)).join('');
  if (lista.length > MAX_LISTA) html += `<li class="empty-msg">Mostrando ${MAX_LISTA} de ${lista.length}. Escribe más para afinar la búsqueda.</li>`;
  $('#lista').innerHTML = html;
}

function score(p, q) {
  const c = norm(p.codigo);
  if (c && c === q) return 3;
  if (c.startsWith(q) || norm(p.nombre).startsWith(q)) return 2;
  return 0;
}

/* ---------- Vista por cámara ---------- */
function renderCamara() {
  $('#cam-sel').innerHTML = CAMARAS.map(c =>
    `<button type="button" class="chip" data-selcam="${esc(c)}" aria-pressed="${state.camara === c}">${c}</button>`).join('');
  const mapa = mapaUbicaciones();
  let ocupados = 0;
  let head = '<thead><tr><th></th>';
  for (let n = 1; n <= POSICIONES; n++) head += `<th>${n}</th>`;
  head += '</tr></thead>';
  let body = '<tbody>';
  for (const l of LETRAS) {
    body += `<tr><th scope="row">${l}</th>`;
    for (let n = 1; n <= POSICIONES; n++) {
      const key = locKey(state.camara, n, l);
      const ps = mapa.get(key) || [];
      if (ps.length) ocupados++;
      const label = ps.length ? `${key}: ${ps.map(p => p.nombre).join(', ')}` : `${key}: vacío`;
      body += `<td><button type="button" class="cell ${ps.length ? 'full' : ''} ${state.highlight === key ? 'hl' : ''}" data-slot="${key}" aria-label="${esc(label)}">
        ${ps.length
          ? `<span class="n">${ps.length > 1 ? ps.length : '■'}</span><span class="t">${esc(ps[0].codigo || ps[0].nombre)}</span>`
          : `<span class="t">vacío</span>`}
      </button></td>`;
    }
    body += '</tr>';
  }
  body += '</tbody>';
  $('#grid').innerHTML = head + body;
  const total = POSICIONES * LETRAS.length;
  $('#cam-resumen').textContent = `Cámara ${state.camara}: ${ocupados} ocupados · ${total - ocupados} vacíos`;

  if (state.highlight && state.highlight.startsWith(state.camara + '-')) {
    const el = $(`[data-slot="${CSS.escape(state.highlight)}"]`, $('#grid'));
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', inline: 'center' }));
  }
}

/* ---------- Info / ajustes ---------- */
async function renderInfo() {
  const n = state.productos.length;
  const ocup = mapaUbicaciones().size;
  let persist = 'desconocido';
  try { if (navigator.storage && navigator.storage.persisted) persist = (await navigator.storage.persisted()) ? 'sí' : 'no'; } catch (e) { /* sin soporte */ }
  const ultima = await DB.getMeta('ultimaExportacion');
  $('#info').innerHTML = `
    <div>Productos: <b>${n}</b></div>
    <div>Ubicaciones ocupadas: <b>${ocup}</b> de ${CAMARAS.length * POSICIONES * LETRAS.length}</div>
    <div>Última copia exportada: <b>${ultima ? new Date(ultima).toLocaleString('es-ES') : 'nunca'}</b></div>
    <div>Almacenamiento protegido: <b>${persist}</b></div>
    <div>Funciona sin conexión: <b>${navigator.serviceWorker && navigator.serviceWorker.controller ? 'sí' : 'tras la primera carga'}</b></div>
    <div>Versión: <b>${APP_VERSION}</b></div>`;
}

/* ============================================================
 * Ficha de producto
 * ============================================================ */
function abrirFicha(id) {
  const p = getProducto(id);
  if (!p) return;
  const m = openModal({ title: 'Ficha de producto', body: '', foot: '' });
  m._prodId = id;
  pintarFicha(m);
}

function pintarFicha(m) {
  const p = getProducto(m._prodId);
  if (!p) { closeModal(m); return; }
  const body = $('.sheet-body', m);
  body.innerHTML = `
    <h3 class="ficha-name">${esc(p.nombre)}</h3>
    <dl class="dl">
      <dt>Código</dt><dd>${esc(p.codigo) || '—'}</dd>
      <dt>Categoría</dt><dd>${esc(p.categoria) || '—'}</dd>
      <dt>Formato</dt><dd>${esc(p.formato) || '—'}</dd>
      ${p.notas ? `<dt>Notas</dt><dd>${esc(p.notas)}</dd>` : ''}
    </dl>
    <div class="sec-title">Ubicaciones (${p.ubicaciones.length})</div>
    ${p.ubicaciones.length ? '' : '<div class="noloc" style="margin-bottom:10px">⚠ Este producto no tiene ubicación.</div>'}
    ${p.ubicaciones.map(u => `
      <div class="locrow">
        <button type="button" class="loc loc-big" data-ver="${esc(u)}" aria-label="Ver ${esc(u)} en la cámara">${esc(u)}</button>
        <button type="button" class="btn btn-sm" data-mover="${esc(u)}">Mover</button>
        <button type="button" class="btn btn-sm btn-danger" data-quitar="${esc(u)}">Quitar</button>
      </div>`).join('')}
    <button type="button" class="btn btn-accent" data-add-loc>＋ Añadir ubicación</button>
    <div class="sec-title">Gestión</div>
    <div class="stack">
      <button type="button" class="btn" data-editar>✎ Editar datos</button>
      <button type="button" class="btn btn-danger" data-eliminar>🗑 Eliminar producto</button>
    </div>`;

  if (!m._wired) {
    m._wired = true;
    body.addEventListener('click', async e => {
      const t = e.target.closest('button');
      if (!t) return;
      const prod = getProducto(m._prodId);
      if (!prod) return;
      if (t.dataset.ver) {
        irACamara(t.dataset.ver);
      } else if (t.dataset.mover) {
        const desde = t.dataset.mover;
        const nueva = await elegirUbicacion({ titulo: `Mover ${desde} a…`, inicial: desde, producto: prod });
        if (!nueva || nueva === desde) return;
        if (prod.ubicaciones.includes(nueva)) { toast(`Ya estaba en ${nueva}`); }
        prod.ubicaciones = prod.ubicaciones.filter(u => u !== desde).concat(nueva);
        await guardarProducto(prod);
        toast(`Movido de ${desde} a ${nueva}`);
        refrescar();
      } else if (t.dataset.quitar) {
        const u = t.dataset.quitar;
        if (!(await confirmar(`¿Quitar <b>${esc(prod.nombre)}</b> de la ubicación <b>${esc(u)}</b>?`, { ok: 'Sí, quitar', peligro: true }))) return;
        prod.ubicaciones = prod.ubicaciones.filter(x => x !== u);
        await guardarProducto(prod);
        toast(`Quitado de ${u}`);
        refrescar();
      } else if ('addLoc' in t.dataset) {
        const sugerida = prod.ubicaciones[prod.ubicaciones.length - 1] || (state.fCamara ? locKey(state.fCamara, 1, 'A') : null);
        const nueva = await elegirUbicacion({ titulo: 'Añadir ubicación', inicial: sugerida, producto: prod });
        if (!nueva) return;
        if (prod.ubicaciones.includes(nueva)) { toast(`Ya está en ${nueva}`); return; }
        prod.ubicaciones.push(nueva);
        await guardarProducto(prod);
        toast(`Añadido en ${nueva}`);
        refrescar();
      } else if ('editar' in t.dataset) {
        abrirFormulario(prod);
      } else if ('eliminar' in t.dataset) {
        if (!(await confirmar(`¿Eliminar <b>${esc(prod.nombre)}</b> del catálogo?<br>Se quitarán también todas sus ubicaciones. No se puede deshacer.`, { ok: 'Sí, eliminar', peligro: true }))) return;
        await eliminarProducto(prod.id);
        closeModal(m);
        toast('Producto eliminado');
        refrescar();
      }
    });
  }
}

/** Repinta la vista principal y los modales abiertos (fichas, huecos). */
function refrescar() {
  render();
  for (const m of modalStack) {
    if (m._prodId) pintarFicha(m);
    if (m._slot) pintarHueco(m);
  }
}

function irACamara(key) {
  const loc = parseLoc(key);
  if (!loc) return;
  closeAllModals();
  state.camara = loc.cam;
  state.highlight = loc.key;
  setView('camaras');
}

/* ============================================================
 * Selector de ubicación (Cámara + Número + Letra)
 * ============================================================ */
function elegirUbicacion({ titulo, inicial, producto }) {
  return new Promise(resolve => {
    const ini = parseLoc(inicial) || { cam: state.view === 'camaras' ? state.camara : CAMARAS[0], num: 1, letra: 'A' };
    const sel = { cam: ini.cam, num: ini.num, letra: ini.letra };
    let decided = false;
    const m = openModal({
      title: esc(titulo),
      body: `
        <div class="picker-preview" id="pk-prev"></div>
        <div class="picker-state" id="pk-state"></div>
        <div class="sec-title">Cámara</div>
        <div class="pick-grid pick-cam" id="pk-cam"></div>
        <div class="sec-title">Posición (1-20)</div>
        <div class="pick-grid pick-num" id="pk-num"></div>
        <div class="sec-title">Letra</div>
        <div class="pick-grid pick-let" id="pk-let"></div>`,
      foot: `<button type="button" class="btn btn-ok" data-ok>✔ Guardar ubicación</button>`,
      onClose: () => { if (!decided) resolve(null); }
    });
    const mapa = mapaUbicaciones();
    const pintar = () => {
      const key = locKey(sel.cam, sel.num, sel.letra);
      $('#pk-prev', m).textContent = key;
      const en = (mapa.get(key) || []).filter(p => !producto || p.id !== producto.id);
      const yaEsta = producto && producto.ubicaciones.includes(key);
      $('#pk-state', m).innerHTML = yaEsta ? 'Este producto ya está aquí'
        : en.length ? `Ocupado por: <b>${en.map(p => esc(p.nombre)).join(', ')}</b>` : 'Hueco vacío';
      $('#pk-cam', m).innerHTML = CAMARAS.map(c => `<button type="button" class="pick" data-c="${c}" aria-pressed="${c === sel.cam}">${c}</button>`).join('');
      let nums = '';
      for (let n = 1; n <= POSICIONES; n++) {
        const used = LETRAS.some(l => mapa.has(locKey(sel.cam, n, l)));
        nums += `<button type="button" class="pick ${used ? 'used' : ''}" data-n="${n}" aria-pressed="${n === sel.num}">${n}</button>`;
      }
      $('#pk-num', m).innerHTML = nums;
      $('#pk-let', m).innerHTML = LETRAS.map(l => `<button type="button" class="pick ${mapa.has(locKey(sel.cam, sel.num, l)) ? 'used' : ''}" data-l="${l}" aria-pressed="${l === sel.letra}">${l}</button>`).join('');
    };
    pintar();
    $('.sheet-body', m).addEventListener('click', e => {
      const b = e.target.closest('.pick');
      if (!b) return;
      if (b.dataset.c) sel.cam = b.dataset.c;
      if (b.dataset.n) sel.num = +b.dataset.n;
      if (b.dataset.l) sel.letra = b.dataset.l;
      pintar();
    });
    $('[data-ok]', m).addEventListener('click', () => {
      decided = true;
      closeModal(m);
      resolve(locKey(sel.cam, sel.num, sel.letra));
    });
  });
}

/* ============================================================
 * Hueco de la cámara (contenido de una ubicación)
 * ============================================================ */
function abrirHueco(key) {
  const m = openModal({ title: `Ubicación <span class="loc" style="font-size:24px">${esc(key)}</span>`, body: '' });
  m._slot = key;
  pintarHueco(m);
  $('.sheet-body', m).addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.prod) {
      abrirFicha(t.dataset.prod);
    } else if (t.dataset.sacar) {
      const p = getProducto(t.dataset.sacar);
      if (!p) return;
      if (!(await confirmar(`¿Quitar <b>${esc(p.nombre)}</b> de <b>${esc(key)}</b>?`, { ok: 'Sí, quitar', peligro: true }))) return;
      p.ubicaciones = p.ubicaciones.filter(u => u !== key);
      await guardarProducto(p);
      toast(`Quitado de ${key}`);
      refrescar();
    } else if (t.dataset.moverde) {
      const p = getProducto(t.dataset.moverde);
      if (!p) return;
      const nueva = await elegirUbicacion({ titulo: `Mover ${key} a…`, inicial: key, producto: p });
      if (!nueva || nueva === key) return;
      p.ubicaciones = p.ubicaciones.filter(u => u !== key).concat(nueva);
      await guardarProducto(p);
      toast(`Movido de ${key} a ${nueva}`);
      refrescar();
    } else if ('asignar' in t.dataset) {
      const p = await elegirProducto(key);
      if (!p) return;
      if (p.ubicaciones.includes(key)) { toast('Ya estaba aquí'); return; }
      p.ubicaciones.push(key);
      await guardarProducto(p);
      toast(`${p.nombre} → ${key}`);
      refrescar();
    }
  });
}

function pintarHueco(m) {
  const key = m._slot;
  const ps = productosEn(key);
  $('.sheet-body', m).innerHTML = `
    <div class="sec-title">${ps.length ? `Contiene ${ps.length} producto${ps.length > 1 ? 's' : ''}` : 'Hueco vacío'}</div>
    ${ps.map(p => `
      <div class="locrow" style="display:block">
        <button type="button" class="item" data-prod="${esc(p.id)}" style="border:0;padding:4px">
          <div class="item-name">${esc(p.nombre)}</div>
          <div class="item-meta">${[p.codigo && `<b>${esc(p.codigo)}</b>`, esc(p.categoria), esc(p.formato)].filter(Boolean).join(' · ')}</div>
        </button>
        <div class="row" style="margin-top:8px">
          <button type="button" class="btn btn-sm" data-moverde="${esc(p.id)}">Mover</button>
          <button type="button" class="btn btn-sm btn-danger" data-sacar="${esc(p.id)}">Quitar</button>
        </div>
      </div>`).join('')}
    <button type="button" class="btn btn-accent" data-asignar>＋ Poner un producto aquí</button>`;
}

/** Lista con buscador para elegir un producto existente. */
function elegirProducto(key) {
  return new Promise(resolve => {
    let decided = false;
    const m = openModal({
      title: `¿Qué producto va en ${esc(key)}?`,
      body: `<div class="field"><input type="search" id="ep-q" placeholder="Buscar nombre o código" autocomplete="off" autocorrect="off" spellcheck="false"></div>
             <ul class="lista" id="ep-lista"></ul>`,
      onClose: () => { if (!decided) resolve(null); }
    });
    const pintar = () => {
      const ws = norm($('#ep-q', m).value).split(/\s+/).filter(Boolean);
      const l = state.productos.filter(p => ws.every(w => p._q.includes(w))).slice(0, 100);
      $('#ep-lista', m).innerHTML = l.length ? l.map(p => htmlItem(p)).join('') : '<li class="empty-msg">Sin resultados</li>';
    };
    pintar();
    $('#ep-q', m).addEventListener('input', pintar);
    $('#ep-lista', m).addEventListener('click', e => {
      const b = e.target.closest('[data-prod]');
      if (!b) return;
      decided = true;
      closeModal(m);
      resolve(getProducto(b.dataset.prod));
    });
  });
}

/* ============================================================
 * Formulario de alta / edición
 * ============================================================ */
function abrirFormulario(prod) {
  const nuevo = !prod;
  const p = prod || { nombre: '', codigo: '', categoria: '', formato: '', notas: '', ubicaciones: [] };
  const cats = Array.from(new Set([...CATEGORIAS, ...state.productos.map(x => x.categoria).filter(Boolean)])).sort((a, b) => a.localeCompare(b, 'es'));
  const fmts = Array.from(new Set([...FORMATOS, ...state.productos.map(x => x.formato).filter(Boolean)]));
  const opts = (list, val) => `<option value="">— Elegir —</option>` +
    list.map(c => `<option ${c === val ? 'selected' : ''}>${esc(c)}</option>`).join('') +
    `<option value="__otra">Otra…</option>`;
  const m = openModal({
    title: nuevo ? 'Nuevo producto' : 'Editar producto',
    body: `
      <form id="pf" novalidate autocomplete="off">
        <div class="field"><label for="pf-nombre">Nombre *</label>
          <input id="pf-nombre" name="nombre" required value="${esc(p.nombre)}" autocapitalize="sentences"></div>
        <div class="field"><label for="pf-codigo">Código / referencia</label>
          <input id="pf-codigo" name="codigo" value="${esc(p.codigo)}" autocapitalize="characters" spellcheck="false"></div>
        <div class="field"><label for="pf-cat">Categoría</label>
          <select id="pf-cat" name="categoria">${opts(cats, p.categoria)}</select>
          <input id="pf-cat-otra" placeholder="Escribe la categoría" hidden></div>
        <div class="field"><label for="pf-fmt">Formato</label>
          <select id="pf-fmt" name="formato">${opts(fmts, p.formato)}</select>
          <input id="pf-fmt-otra" placeholder="Escribe el formato" hidden></div>
        <div class="field"><label for="pf-notas">Notas</label>
          <textarea id="pf-notas" name="notas">${esc(p.notas)}</textarea></div>
        <p class="err" id="pf-err"></p>
      </form>`,
    foot: `<button type="button" class="btn btn-ok" data-save>✔ ${nuevo ? 'Crear producto' : 'Guardar cambios'}</button>`
  });
  for (const [s, i] of [['#pf-cat', '#pf-cat-otra'], ['#pf-fmt', '#pf-fmt-otra']]) {
    $(s, m).addEventListener('change', () => {
      const otra = $(s, m).value === '__otra';
      $(i, m).hidden = !otra;
      if (otra) $(i, m).focus();
    });
  }
  if (nuevo) setTimeout(() => $('#pf-nombre', m).focus(), 50);

  const guardar = async () => {
    const val = (s, o) => $(s, m).value === '__otra' ? $(o, m).value.trim() : $(s, m).value;
    const datos = {
      nombre: $('#pf-nombre', m).value.trim(),
      codigo: $('#pf-codigo', m).value.trim().toUpperCase(),
      categoria: val('#pf-cat', '#pf-cat-otra'),
      formato: val('#pf-fmt', '#pf-fmt-otra'),
      notas: $('#pf-notas', m).value.trim()
    };
    const err = $('#pf-err', m);
    if (!datos.nombre) { err.textContent = 'El nombre es obligatorio.'; $('#pf-nombre', m).focus(); return; }
    if (datos.codigo) {
      const dup = state.productos.find(x => norm(x.codigo) === norm(datos.codigo) && x.id !== p.id);
      if (dup) { err.textContent = `El código ${datos.codigo} ya lo usa «${dup.nombre}».`; $('#pf-codigo', m).focus(); return; }
    }
    const obj = nuevo ? { id: uid(), ubicaciones: [], ...datos } : Object.assign(p, datos);
    await guardarProducto(obj);
    closeModal(m);
    refrescar();
    if (nuevo) {
      abrirFicha(obj.id);
      toast('Producto creado. Añade sus ubicaciones.');
    } else {
      toast('Cambios guardados');
    }
  };
  $('[data-save]', m).addEventListener('click', guardar);
  $('#pf', m).addEventListener('submit', e => { e.preventDefault(); guardar(); });
}

/* ============================================================
 * Exportar / importar
 * ============================================================ */
function fecha() {
  const d = new Date(), z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`;
}

/** Entrega un archivo: menú «Compartir» del móvil si existe, si no, descarga. */
async function entregarArchivo(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo });
  try {
    const file = new File([blob], nombre, { type: tipo });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      const modo = await new Promise(resolve => {
        let decided = false;
        const m = openModal({
          title: 'Guardar archivo', full: false,
          body: `<p class="confirm-msg">Archivo listo:<br><b>${esc(nombre)}</b></p>`,
          foot: `<button type="button" class="btn btn-primary" data-m="share">📤 Compartir (WhatsApp, correo…)</button>
                 <button type="button" class="btn" data-m="download">⬇ Guardar en el móvil</button>
                 <button type="button" class="btn" data-close>Cancelar</button>`,
          onClose: () => { if (!decided) resolve(null); }
        });
        $('.sheet-foot', m).addEventListener('click', e => {
          const b = e.target.closest('[data-m]');
          if (!b) return;
          decided = true; closeModal(m); resolve(b.dataset.m);
        });
      });
      if (!modo) return false;
      if (modo === 'share') {
        await navigator.share({ files: [file], title: nombre });
        return true;
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return false;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

async function exportarJSON() {
  const data = { app: 'GesFrío', formato: 1, exportado: new Date().toISOString(), productos: state.productos.map(limpio) };
  if (await entregarArchivo(`gesfrio_copia_${fecha()}.json`, JSON.stringify(data, null, 2), 'application/json')) {
    await DB.setMeta('ultimaExportacion', new Date().toISOString());
    toast('Copia exportada');
    renderInfo();
  }
}

const CSV_COLS = ['codigo', 'nombre', 'categoria', 'formato', 'ubicaciones', 'notas'];

function csvCampo(v) {
  const s = String(v == null ? '' : v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** CSV separado por «;» (lo que espera Excel en español) y con BOM para que respete las tildes. */
function aCSV(productos) {
  const lineas = [CSV_COLS.join(';')];
  for (const p of productos) {
    lineas.push([p.codigo, p.nombre, p.categoria, p.formato, p.ubicaciones.join(', '), p.notas].map(csvCampo).join(';'));
  }
  return '﻿' + lineas.join('\r\n') + '\r\n';
}

async function exportarCSV() {
  if (await entregarArchivo(`gesfrio_catalogo_${fecha()}.csv`, aCSV(state.productos), 'text/csv')) {
    await DB.setMeta('ultimaExportacion', new Date().toISOString());
    toast('CSV exportado');
    renderInfo();
  }
}

function descargarPlantilla() {
  const ejemplo = [
    { codigo: 'PES-001', nombre: 'Merluza en rodajas', categoria: 'Pescado', formato: 'Caja', ubicaciones: ['FRÍO-1-A', 'K-4-B'], notas: '' },
    { codigo: 'VER-001', nombre: 'Guisantes finos', categoria: 'Verduras', formato: 'Bolsa', ubicaciones: ['N-1-A'], notas: 'Ejemplo: borra estas filas' }
  ];
  entregarArchivo('gesfrio_plantilla.csv', aCSV(ejemplo), 'text/csv');
}

/** Parser CSV con comillas; detecta el separador (; , o tabulador). */
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const primera = text.split(/\r?\n/, 1)[0] || '';
  const cuenta = ch => primera.split(ch).length - 1;
  const sep = [';', ',', '\t'].sort((a, b) => cuenta(b) - cuenta(a))[0];
  const filas = [];
  let fila = [], campo = '', comillas = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (comillas) {
      if (c === '"') {
        if (text[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.some(x => x.trim() !== ''));
}

/** Convierte las filas del CSV en productos. Admite varias filas con el mismo código
 *  (una por ubicación) y columnas separadas camara/posicion/letra. */
function productosDesdeCSV(text) {
  const filas = parseCSV(text);
  if (filas.length < 2) throw new Error('El archivo CSV no tiene filas de datos.');
  const alias = {
    codigo: ['codigo', 'cod', 'referencia', 'ref', 'sku'],
    nombre: ['nombre', 'producto', 'descripcion', 'articulo'],
    categoria: ['categoria', 'familia', 'tipo'],
    formato: ['formato', 'unidad', 'presentacion'],
    ubicaciones: ['ubicaciones', 'ubicacion', 'ubicacion(es)', 'ubic'],
    notas: ['notas', 'observaciones', 'nota', 'comentarios'],
    camara: ['camara'],
    posicion: ['posicion', 'numero', 'num', 'palet', 'pale'],
    letra: ['letra', 'altura', 'nivel']
  };
  const cab = filas[0].map(h => norm(h).replace(/[^a-z()]/g, ''));
  const col = {};
  for (const [k, names] of Object.entries(alias)) {
    const i = cab.findIndex(h => names.includes(h));
    if (i >= 0) col[k] = i;
  }
  if (col.nombre == null) throw new Error('No encuentro la columna «nombre» en la primera fila del CSV.');
  const get = (f, k) => col[k] == null ? '' : String(f[col[k]] || '').trim();
  const avisos = [];
  const porClave = new Map();
  filas.slice(1).forEach((f, idx) => {
    const nombre = get(f, 'nombre');
    if (!nombre) return;
    const codigo = get(f, 'codigo').toUpperCase();
    const clave = codigo ? 'c:' + norm(codigo) : 'n:' + norm(nombre);
    let p = porClave.get(clave);
    if (!p) {
      p = { id: uid(), nombre, codigo, categoria: get(f, 'categoria'), formato: get(f, 'formato'), notas: get(f, 'notas'), ubicaciones: [] };
      porClave.set(clave, p);
    }
    const textos = get(f, 'ubicaciones').split(/[|,;\n]+/).map(s => s.trim()).filter(Boolean);
    if (col.camara != null && get(f, 'camara')) textos.push(`${get(f, 'camara')}-${get(f, 'posicion')}-${get(f, 'letra')}`);
    for (const t of textos) {
      const l = parseLoc(t);
      if (l) { if (!p.ubicaciones.includes(l.key)) p.ubicaciones.push(l.key); }
      else avisos.push(`Fila ${idx + 2}: ubicación «${t}» no válida`);
    }
  });
  return { productos: Array.from(porClave.values()), avisos };
}

function productosDesdeJSON(text) {
  const data = JSON.parse(text);
  const lista = Array.isArray(data) ? data : data && Array.isArray(data.productos) ? data.productos : null;
  if (!lista) throw new Error('El archivo JSON no contiene una lista de productos.');
  const avisos = [];
  const productos = lista.filter(x => x && x.nombre).map(x => {
    const ubic = Array.isArray(x.ubicaciones) ? x.ubicaciones : String(x.ubicaciones || '').split(/[|,;]+/);
    const ok = [];
    ubic.map(s => String(s).trim()).filter(Boolean).forEach(s => {
      const l = parseLoc(s);
      if (l) ok.push(l.key); else avisos.push(`«${x.nombre}»: ubicación «${s}» no válida`);
    });
    return {
      id: x.id ? String(x.id) : uid(), nombre: String(x.nombre).trim(), codigo: String(x.codigo || '').trim().toUpperCase(),
      categoria: String(x.categoria || '').trim(), formato: String(x.formato || '').trim(), notas: String(x.notas || '').trim(),
      ubicaciones: ok, actualizado: x.actualizado || new Date().toISOString()
    };
  });
  return { productos, avisos };
}

/** Lee un archivo como texto; si no es UTF-8 válido (CSV antiguo de Excel), usa Windows-1252. */
async function leerTexto(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder('windows-1252').decode(buf); }
}

async function importarArchivo(file) {
  let res;
  try {
    const text = await leerTexto(file);
    const esJSON = /\.json$/i.test(file.name) || /^\s*[[{]/.test(text);
    res = esJSON ? productosDesdeJSON(text) : productosDesdeCSV(text);
  } catch (e) {
    toast('No se pudo leer el archivo: ' + (e.message || e), true);
    return;
  }
  const { productos, avisos } = res;
  if (!productos.length) { toast('El archivo no contiene productos.', true); return; }
  const nUbic = productos.reduce((s, p) => s + p.ubicaciones.length, 0);
  const m = openModal({
    title: 'Importar datos',
    body: `
      <p class="confirm-msg">Archivo: <b>${esc(file.name)}</b><br>
      ${productos.length} productos y ${nUbic} ubicaciones.</p>
      ${avisos.length ? `<p class="err">⚠ ${avisos.length} aviso${avisos.length > 1 ? 's' : ''} (se ignorarán):<br>${avisos.slice(0, 8).map(esc).join('<br>')}${avisos.length > 8 ? '<br>…' : ''}</p>` : ''}
      <p class="help"><b>Combinar:</b> añade los productos nuevos y actualiza los que tengan el mismo código (o nombre si no tienen código); si el archivo trae ubicaciones para un producto, sustituyen a las que tenía. No borra productos.<br>
      <b>Reemplazar todo:</b> borra el catálogo actual de este móvil y lo sustituye por el del archivo.</p>`,
    foot: `<button type="button" class="btn btn-primary" data-merge>Combinar con lo actual</button>
           <button type="button" class="btn btn-danger" data-replace>Reemplazar todo</button>
           <button type="button" class="btn" data-close>Cancelar</button>`
  });
  $('[data-merge]', m).addEventListener('click', async () => {
    const claveDe = p => p.codigo ? 'c:' + norm(p.codigo) : 'n:' + norm(p.nombre);
    const actuales = new Map(state.productos.map(p => [claveDe(p), p]));
    let nuevos = 0, act = 0;
    const cambios = productos.map(np => {
      const ex = actuales.get(claveDe(np));
      if (ex) {
        act++;
        return { ...limpio(ex), nombre: np.nombre, categoria: np.categoria || ex.categoria, formato: np.formato || ex.formato,
          notas: np.notas || ex.notas, ubicaciones: np.ubicaciones.length ? np.ubicaciones : ex.ubicaciones, actualizado: new Date().toISOString() };
      }
      nuevos++;
      return { ...np, id: state.productos.some(p => p.id === np.id) ? uid() : np.id };
    });
    await DB.putMany(cambios.map(p => limpio(indexar(p))));
    await cargarDesdeDB();
    closeModal(m);
    toast(`Importado: ${nuevos} nuevos, ${act} actualizados`);
    render();
  });
  $('[data-replace]', m).addEventListener('click', async () => {
    if (!(await confirmar(`Se borrarán los <b>${state.productos.length}</b> productos actuales y se cargarán <b>${productos.length}</b> del archivo. ¿Continuar?`, { ok: 'Sí, reemplazar', peligro: true }))) return;
    await DB.replaceAll(productos.map(p => limpio(indexar(p))));
    await cargarDesdeDB();
    closeModal(m);
    toast(`Catálogo reemplazado: ${productos.length} productos`);
    render();
  });
}

async function cargarDesdeDB() {
  state.productos = (await DB.all()).map(indexar).sort(byName);
}

/* ============================================================
 * Instalación como app
 * ============================================================ */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEvt = e;
  $('#install').hidden = false;
});
window.addEventListener('appinstalled', () => { $('#install').hidden = true; toast('App instalada'); });

function esIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function esStandalone() {
  return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

/* ============================================================
 * Eventos
 * ============================================================ */
function wire() {
  const q = $('#q');
  q.addEventListener('input', () => {
    state.q = q.value;
    $('#q-clear').hidden = !q.value;
    if (state.view !== 'catalogo') setView('catalogo'); else renderCatalogo();
  });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') q.blur(); });
  $('#q-clear').addEventListener('click', () => {
    q.value = ''; state.q = ''; $('#q-clear').hidden = true;
    renderCatalogo(); q.focus();
  });

  $('#f-camara').addEventListener('click', e => {
    const b = e.target.closest('[data-cam]');
    if (!b) return;
    state.fCamara = b.dataset.cam;
    renderCatalogo();
  });
  $('#f-categoria').addEventListener('change', e => { state.fCategoria = e.target.value; renderCatalogo(); });

  // Abrir ficha o hueco desde cualquier lista de la página principal
  $('#main').addEventListener('click', e => {
    const prod = e.target.closest('[data-prod]');
    if (prod) { abrirFicha(prod.dataset.prod); return; }
    const slot = e.target.closest('[data-slot]');
    if (slot) { abrirHueco(slot.dataset.slot); return; }
    const cam = e.target.closest('[data-selcam]');
    if (cam) { state.camara = cam.dataset.selcam; state.highlight = ''; renderCamara(); $('#grid-wrap').scrollLeft = 0; }
  });

  document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.addEventListener('click', () => {
    closeAllModals();
    if (b.dataset.view === 'camaras' && state.view !== 'camaras') state.highlight = '';
    setView(b.dataset.view);
  }));
  $('#nav-nuevo').addEventListener('click', () => { closeAllModals(); abrirFormulario(null); });

  $('#exp-json').addEventListener('click', exportarJSON);
  $('#exp-csv').addEventListener('click', exportarCSV);
  $('#plantilla').addEventListener('click', descargarPlantilla);
  $('#imp-file').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) importarArchivo(f);
  });
  $('#ejemplo').addEventListener('click', async () => {
    if (!(await confirmar('Se <b>borrará el catálogo actual</b> y se cargarán 15 productos de ejemplo. ¿Continuar?', { ok: 'Sí, cargar ejemplo', peligro: true }))) return;
    await DB.replaceAll(datosEjemplo());
    await cargarDesdeDB();
    toast('Productos de ejemplo cargados');
    render();
  });
  $('#borrar-todo').addEventListener('click', async () => {
    if (!(await confirmar('¿Borrar <b>todos</b> los productos y ubicaciones de este móvil?', { ok: 'Sí, borrar todo', peligro: true }))) return;
    if (!(await confirmar('Última confirmación: esta acción <b>no se puede deshacer</b>. Exporta antes una copia si la necesitas.', { ok: 'Borrar definitivamente', peligro: true }))) return;
    await DB.replaceAll([]);
    state.productos = [];
    toast('Datos borrados');
    render();
  });
  $('#install').addEventListener('click', async () => {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice;
    installEvt = null;
    $('#install').hidden = true;
  });
  $('#ios-hint').hidden = !(esIOS() && !esStandalone());
}

/* ============================================================
 * Arranque
 * ============================================================ */
async function init() {
  wire();
  try {
    await DB.open();
    const iniciado = await DB.getMeta('iniciado');
    if (!iniciado) {
      await DB.replaceAll(datosEjemplo());
      await DB.setMeta('iniciado', true);
    }
    await cargarDesdeDB();
  } catch (e) {
    console.error(e);
    toast('No se puede acceder al almacenamiento del navegador. ¿Modo privado?', true);
  }
  render();

  // Pedir almacenamiento persistente (el navegador no borrará los datos por falta de espacio).
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* opcional */ }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker no registrado', err));
  }
}

init();
