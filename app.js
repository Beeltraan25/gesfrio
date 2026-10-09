/* GesFrío — Catálogo y ubicaciones de almacén de congelados.
 * Funciona sin conexión: datos en IndexedDB, app cacheada por el service worker.
 * Opcionalmente sincroniza los datos entre móviles a través de una hoja de Google Sheets. */
'use strict';

/* ============================================================
 * Estructura del almacén: cámaras y sus pasillos.
 * Cada pasillo tiene posiciones 1-20 y letras A, B, C.
 * ============================================================ */
const ALMACEN = [
  { cam: 'FRÍO', pasillos: ['1', '2'] },
  { cam: 'K', pasillos: ['1', '2', '3', '4'] },
  { cam: 'N', pasillos: ['1', '2', '3', '4', '5', '6', '7', '8', 'TRÁNSITO'] },
  { cam: 'L', pasillos: ['1', '2', '3'] },
  { cam: 'S', pasillos: ['SA', 'SB', '2', '7', '8', 'SCE', 'SOFI', 'SOFIALTO', 'TRANS'] }
];
const CAMARAS = ALMACEN.map(c => c.cam);
const PASILLOS = Object.fromEntries(ALMACEN.map(c => [c.cam, c.pasillos]));
const POSICIONES = 20;
const LETRAS = ['A', 'B', 'C'];
const TOTAL_HUECOS = ALMACEN.reduce((s, c) => s + c.pasillos.length, 0) * POSICIONES * LETRAS.length;
const CATEGORIAS = ['Pescado', 'Marisco', 'Carne', 'Verduras', 'Precocinados', 'Helados', 'Panadería', 'Postres', 'Otros'];
const FORMATOS = ['Caja', 'Kg', 'Unidades', 'Bolsa', 'Bandeja'];
const APP_VERSION = '2.0.0';
const CONFIG = window.GESFRIO_CONFIG || {};

/* ============================================================
 * Utilidades
 * ============================================================ */
const $ = (sel, root = document) => root.querySelector(sel);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Quita tildes. */
function sinTildes(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }

/** Normaliza texto para buscar: minúsculas y sin tildes. */
function norm(s) { return sinTildes(s).toLowerCase().trim(); }

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const ahora = () => new Date().toISOString();
const byName = (a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });

/** Etiqueta de un pasillo: los numéricos llevan «P» delante para no confundirlos con la posición. */
function pasLabel(nombre) { return /^\d+$/.test(nombre) ? 'P' + nombre : nombre; }

/** Texto canónico de una ubicación: "K-P3-12-B", "S-SOFIALTO-4-A". */
function locKey(cam, pas, num, letra) { return `${cam}-${pasLabel(pas)}-${num}-${letra}`; }

/** Prefijo de una cámara o de un pasillo, para filtrar ubicaciones. */
function prefijo(cam, pas) { return pas ? `${cam}-${pasLabel(pas)}-` : `${cam}-`; }

/** Interpreta una ubicación escrita de muchas formas ("k 3 12 b", "K-P3-12B", "n transito 5 a").
 *  Con legacy=true acepta el formato antiguo sin pasillo ("K-12-B") y lo pone en el primer pasillo.
 *  Devuelve {cam, pas, num, letra, key, legacy} o null si no es válida. */
function parseLoc(text, legacy = false) {
  const tokens = [];
  sinTildes(text).toUpperCase().trim().split(/[\s\-_.\/·:]+/).filter(Boolean).forEach(t => {
    const m = t.match(/^(\d{1,2})([ABC])$/);
    if (m) tokens.push(m[1], m[2]); else tokens.push(t);
  });
  let camT, pasT, numT, letT, esLegacy = false;
  if (tokens.length === 4) [camT, pasT, numT, letT] = tokens;
  else if (tokens.length === 3 && legacy) { [camT, numT, letT] = tokens; esLegacy = true; }
  else return null;
  const cam = CAMARAS.find(c => sinTildes(c) === camT);
  if (!cam || !/^\d{1,2}$/.test(numT) || !LETRAS.includes(letT)) return null;
  const num = parseInt(numT, 10);
  if (num < 1 || num > POSICIONES) return null;
  let pas;
  if (esLegacy) pas = PASILLOS[cam][0];
  else {
    const p = /^P\d+$/.test(pasT) ? pasT.slice(1) : pasT;
    pas = PASILLOS[cam].find(x => sinTildes(x).toUpperCase() === p || (/^\d+$/.test(x) && /^\d+$/.test(p) && +x === +p));
    if (!pas) return null;
  }
  return { cam, pas, num, letra: letT, key: locKey(cam, pas, num, letT), legacy: esLegacy };
}

/** Orden natural de ubicaciones: cámara, pasillo, número, letra. */
function locSort(a, b) {
  const pa = parseLoc(a), pb = parseLoc(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  return (CAMARAS.indexOf(pa.cam) - CAMARAS.indexOf(pb.cam)) ||
    (PASILLOS[pa.cam].indexOf(pa.pas) - PASILLOS[pb.cam].indexOf(pb.pas)) ||
    (pa.num - pb.num) || pa.letra.localeCompare(pb.letra);
}

/** Normaliza una lista de ubicaciones (formato canónico, sin repetidos, ordenada). */
function normUbic(lista, legacy = true) {
  return Array.from(new Set((lista || []).map(u => (parseLoc(u, legacy) || {}).key).filter(Boolean))).sort(locSort);
}

/* ============================================================
 * Base de datos (IndexedDB)
 * Cada registro: {id, nombre, codigo, categoria, formato, notas, ubicaciones[], actualizado,
 *                 borrado, pend (cambio sin enviar), base (ubicaciones según la hoja), forzar}
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
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Operación cancelada'));
      fn(t);
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
  /** Escribe y borra varios registros en una sola operación. clear=true vacía antes. */
  bulk({ put = [], del = [], clear = false }) {
    return this.tx(['productos'], 'readwrite', t => {
      const s = t.objectStore('productos');
      if (clear) s.clear();
      del.forEach(id => s.delete(id));
      put.forEach(p => s.put(p));
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
  productos: [],          // productos visibles (sin los borrados)
  view: 'catalogo',
  q: '',
  fCamara: '',            // '' = todas
  fPasillo: '',           // '' = todos
  fCategoria: '',
  camara: 'FRÍO',         // vista de cuadrícula
  pasillo: '1',
  highlight: ''           // ubicación a resaltar en la cuadrícula
};

/** Prepara campos derivados para buscar rápido. */
function indexar(p) {
  p.ubicaciones = normUbic(p.ubicaciones);
  Object.defineProperty(p, '_q', { value: norm(p.nombre + ' ' + (p.codigo || '')), enumerable: false, writable: true, configurable: true });
  return p;
}

/** Datos de un producto para exportar (sin campos internos). */
function limpio(p) {
  return {
    id: p.id, nombre: p.nombre, codigo: p.codigo || '', categoria: p.categoria || '',
    formato: p.formato || '', notas: p.notas || '', ubicaciones: (p.ubicaciones || []).slice(),
    actualizado: p.actualizado || ahora()
  };
}

/** Registro completo para guardar en IndexedDB. */
function registro(p) {
  return {
    ...limpio(p), borrado: !!p.borrado, pend: !!p.pend, forzar: !!p.forzar,
    base: Array.isArray(p.base) ? p.base.slice() : null
  };
}

/** Marca un producto como modificado en este móvil y lo guarda. */
async function guardarProducto(p) {
  p.actualizado = ahora();
  p.pend = true;
  indexar(p);
  await DB.put(registro(p));
  const i = state.productos.findIndex(x => x.id === p.id);
  if (i >= 0) state.productos[i] = p; else state.productos.push(p);
  state.productos.sort(byName);
  Sync.cambioLocal();
}

async function eliminarProducto(id) {
  const p = getProducto(id);
  if (!p) return;
  if (Sync.activo()) {
    // Se guarda una «lápida» para que el borrado llegue a los demás móviles.
    await DB.put(registro({ ...p, ubicaciones: [], borrado: true, pend: true, actualizado: ahora() }));
  } else {
    await DB.bulk({ del: [id] });
  }
  state.productos = state.productos.filter(x => x.id !== id);
  Sync.cambioLocal();
}

/** Sustituye todo el catálogo (importar, ejemplo, borrar todo). Con sincronización, afecta a todos los móviles. */
async function reemplazarCatalogo(nuevos) {
  const t = ahora();
  const recs = nuevos.map(p => registro({ ...indexar(p), actualizado: t, pend: true, forzar: true }));
  if (Sync.activo()) {
    const idsNuevos = new Set(recs.map(r => r.id));
    const lapidas = state.productos.filter(p => !idsNuevos.has(p.id))
      .map(p => registro({ ...p, ubicaciones: [], borrado: true, pend: true, forzar: true, actualizado: t }));
    await DB.bulk({ put: [...lapidas, ...recs] });
  } else {
    await DB.bulk({ clear: true, put: recs });
  }
  await cargarDesdeDB();
  Sync.cambioLocal();
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

async function cargarDesdeDB() {
  const recs = await DB.all();
  const migrar = [];
  for (const r of recs) {
    // Datos de la versión 1 (sin pasillos): se pasan al primer pasillo de cada cámara.
    const n = normUbic(r.ubicaciones);
    if (n.join('|') !== (r.ubicaciones || []).join('|')) { r.ubicaciones = n; r.pend = true; migrar.push(r); }
  }
  if (migrar.length) await DB.bulk({ put: migrar });
  state.productos = recs.filter(r => !r.borrado).map(indexar).sort(byName);
}

/* ============================================================
 * Datos de ejemplo
 * ============================================================ */
function datosEjemplo() {
  const d = [
    ['Merluza en rodajas', 'PES-001', 'Pescado', 'Caja', ['FRÍO-P1-1-A', 'K-P2-4-B']],
    ['Lomos de bacalao', 'PES-002', 'Pescado', 'Kg', ['FRÍO-P2-2-B']],
    ['Calamar troceado', 'PES-003', 'Pescado', 'Bolsa', ['N-P7-7-C']],
    ['Gamba pelada', 'MAR-001', 'Marisco', 'Caja', ['K-P3-12-B', 'K-P3-13-B']],
    ['Mejillón cocido', 'MAR-002', 'Marisco', 'Kg', ['L-P1-3-A']],
    ['Guisantes finos', 'VER-001', 'Verduras', 'Bolsa', ['N-P1-1-A', 'N-P1-1-B']],
    ['Judía verde plana', 'VER-002', 'Verduras', 'Caja', ['N-P2-2-A']],
    ['Espinacas en hojas', 'VER-003', 'Verduras', 'Bolsa', ['N-TRÁNSITO-2-C', 'S-SOFI-18-A']],
    ['Pechuga de pollo', 'CAR-001', 'Carne', 'Kg', ['L-P2-10-A', 'L-P2-10-B']],
    ['Hamburguesa de ternera', 'CAR-002', 'Carne', 'Unidades', ['L-P3-11-C']],
    ['Croquetas de jamón', 'PRE-001', 'Precocinados', 'Caja', ['K-P1-1-A', 'S-SA-5-B']],
    ['Pizza cuatro quesos', 'PRE-002', 'Precocinados', 'Unidades', ['S-SB-6-A']],
    ['Lasaña boloñesa', 'PRE-003', 'Precocinados', 'Bandeja', ['S-SCE-6-B', 'S-P7-7-B']],
    ['Helado de vainilla 1 L', 'HEL-001', 'Helados', 'Unidades', ['FRÍO-P1-15-A', 'FRÍO-P1-15-B']],
    ['Cono de chocolate', 'HEL-002', 'Helados', 'Caja', ['FRÍO-P2-16-C', 'K-P4-20-A', 'S-SOFIALTO-3-A']]
  ];
  const t = ahora();
  return d.map(([nombre, codigo, categoria, formato, ubicaciones]) =>
    ({ id: uid(), nombre, codigo, categoria, formato, notas: '', ubicaciones, actualizado: t }));
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
  toastTimer = setTimeout(() => { el.hidden = true; }, bad ? 4500 : 2400);
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
function confirmar(msg, { ok = 'Sí, continuar', peligro = false, cancelar = 'Cancelar' } = {}) {
  return new Promise(resolve => {
    let decided = false;
    const m = openModal({
      title: 'Confirmar',
      full: false,
      body: `<p class="confirm-msg">${msg}</p>`,
      foot: `<button type="button" class="btn ${peligro ? 'btn-danger-solid' : 'btn-primary'}" data-ok>${esc(ok)}</button>
             <button type="button" class="btn" data-close>${esc(cancelar)}</button>`,
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
  else if (state.view === 'copia') renderCopia();
}

/** Repinta la vista principal y los modales abiertos (fichas, huecos). */
function refrescar() {
  render();
  for (const m of modalStack) {
    if (m._prodId) pintarFicha(m);
    if (m._slot) pintarHueco(m);
  }
}

/* ---------- Catálogo + buscador ---------- */
function renderFiltros() {
  $('#f-camara').innerHTML = ['', ...CAMARAS].map(c =>
    `<button type="button" class="chip" data-cam="${esc(c)}" aria-pressed="${state.fCamara === c}">${c || 'Todas'}</button>`).join('');
  const fp = $('#f-pasillo');
  fp.hidden = !state.fCamara;
  fp.innerHTML = state.fCamara ? ['', ...PASILLOS[state.fCamara]].map(p =>
    `<button type="button" class="chip" data-pas="${esc(p)}" aria-pressed="${state.fPasillo === p}">${p ? esc(pasLabel(p)) : 'Todos los pasillos'}</button>`).join('') : '';
  const cats = Array.from(new Set([...CATEGORIAS, ...state.productos.map(p => p.categoria).filter(Boolean)]))
    .sort((a, b) => a.localeCompare(b, 'es'));
  if (state.fCategoria && !cats.includes(state.fCategoria)) cats.push(state.fCategoria);
  $('#f-categoria').innerHTML = `<option value="">Todas las categorías</option>` +
    cats.map(c => `<option value="${esc(c)}" ${c === state.fCategoria ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

function htmlLocs(p, pref = '') {
  if (!p.ubicaciones.length) return `<div class="noloc">⚠ Sin ubicación asignada</div>`;
  const locs = pref
    ? [...p.ubicaciones.filter(u => u.startsWith(pref)), ...p.ubicaciones.filter(u => !u.startsWith(pref))]
    : p.ubicaciones;
  return `<div class="locs">${locs.map(u =>
    `<span class="loc ${pref && !u.startsWith(pref) ? 'dim' : ''}">${esc(u)}</span>`).join('')}</div>`;
}

function htmlItem(p, pref = '') {
  const meta = [p.codigo && `<b>${esc(p.codigo)}</b>`, esc(p.categoria), esc(p.formato)].filter(Boolean).join(' · ');
  return `<li><button type="button" class="item" data-prod="${esc(p.id)}">
    <div class="item-name">${esc(p.nombre)}</div>
    ${meta ? `<div class="item-meta">${meta}</div>` : ''}
    ${htmlLocs(p, pref)}
  </button></li>`;
}

const MAX_LISTA = 300;

function renderCatalogo() {
  renderFiltros();
  const q = norm(state.q);
  const palabras = q.split(/\s+/).filter(Boolean);
  const pref = state.fCamara ? prefijo(state.fCamara, state.fPasillo) : '';
  let lista = state.productos;
  if (pref) lista = lista.filter(p => p.ubicaciones.some(u => u.startsWith(pref)));
  if (state.fCategoria) lista = lista.filter(p => p.categoria === state.fCategoria);

  // Si lo escrito es una ubicación ("k 3 12 b"), mostrar su contenido arriba.
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
  let html = lista.slice(0, MAX_LISTA).map(p => htmlItem(p, pref)).join('');
  if (lista.length > MAX_LISTA) html += `<li class="empty-msg">Mostrando ${MAX_LISTA} de ${lista.length}. Escribe más para afinar la búsqueda.</li>`;
  $('#lista').innerHTML = html;
}

function score(p, q) {
  const c = norm(p.codigo);
  if (c && c === q) return 3;
  if (c.startsWith(q) || norm(p.nombre).startsWith(q)) return 2;
  return 0;
}

/* ---------- Vista por cámara y pasillo ---------- */
function renderCamara() {
  if (!PASILLOS[state.camara].includes(state.pasillo)) state.pasillo = PASILLOS[state.camara][0];
  const mapa = mapaUbicaciones();
  const ocupadosEn = pref => Array.from(mapa.keys()).filter(k => k.startsWith(pref)).length;

  $('#cam-sel').innerHTML = CAMARAS.map(c =>
    `<button type="button" class="chip" data-selcam="${esc(c)}" aria-pressed="${state.camara === c}">${c}</button>`).join('');
  $('#pas-sel').innerHTML = PASILLOS[state.camara].map(p => {
    const n = ocupadosEn(prefijo(state.camara, p));
    return `<button type="button" class="chip" data-selpas="${esc(p)}" aria-pressed="${state.pasillo === p}">${esc(pasLabel(p))}${n ? `<small>(${n})</small>` : ''}</button>`;
  }).join('');

  let ocupados = 0;
  let head = '<thead><tr><th></th>';
  for (let n = 1; n <= POSICIONES; n++) head += `<th>${n}</th>`;
  head += '</tr></thead>';
  let body = '<tbody>';
  for (const l of LETRAS) {
    body += `<tr><th scope="row">${l}</th>`;
    for (let n = 1; n <= POSICIONES; n++) {
      const key = locKey(state.camara, state.pasillo, n, l);
      const ps = mapa.get(key) || [];
      if (ps.length) ocupados++;
      const label = ps.length ? `${key}: ${ps.map(p => p.nombre).join(', ')}` : `${key}: vacío`;
      body += `<td><button type="button" class="cell ${ps.length ? 'full' : ''} ${state.highlight === key ? 'hl' : ''}" data-slot="${esc(key)}" aria-label="${esc(label)}">
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
  $('#cam-resumen').textContent = `Cámara ${state.camara} · Pasillo ${pasLabel(state.pasillo)}: ${ocupados} ocupados · ${total - ocupados} vacíos`;

  if (state.highlight && state.highlight.startsWith(prefijo(state.camara, state.pasillo))) {
    const el = $(`[data-slot="${CSS.escape(state.highlight)}"]`, $('#grid'));
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', inline: 'center' }));
  }
}

function irACamara(key) {
  const loc = parseLoc(key);
  if (!loc) return;
  closeAllModals();
  state.camara = loc.cam;
  state.pasillo = loc.pas;
  state.highlight = loc.key;
  setView('camaras');
}

/* ---------- Copia / ajustes ---------- */
async function renderCopia() {
  renderSyncPanel();
  const n = state.productos.length;
  const ocup = mapaUbicaciones().size;
  let persist = 'desconocido';
  try { if (navigator.storage && navigator.storage.persisted) persist = (await navigator.storage.persisted()) ? 'sí' : 'no'; } catch (e) { /* sin soporte */ }
  const ultima = await DB.getMeta('ultimaExportacion');
  $('#info').innerHTML = `
    <div>Productos: <b>${n}</b></div>
    <div>Ubicaciones ocupadas: <b>${ocup}</b> de ${TOTAL_HUECOS}</div>
    <div>Última copia exportada: <b>${ultima ? new Date(ultima).toLocaleString('es-ES') : 'nunca'}</b></div>
    <div>Almacenamiento protegido: <b>${persist}</b></div>
    <div>Funciona sin conexión: <b>${navigator.serviceWorker && navigator.serviceWorker.controller ? 'sí' : 'tras la primera carga'}</b></div>
    <div>Versión: <b>${APP_VERSION}</b></div>`;
  $('#ejemplo').hidden = Sync.activo();
  $('#borrar-todo').textContent = Sync.activo() ? '🗑 Borrar todo el catálogo (en todos los móviles)' : '🗑 Borrar todos los datos';
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
        const sugerida = prod.ubicaciones[prod.ubicaciones.length - 1] ||
          (state.fCamara ? locKey(state.fCamara, state.fPasillo || PASILLOS[state.fCamara][0], 1, 'A') : null);
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
        const extra = Sync.activo() ? '<br>Se borrará también en los demás móviles.' : '';
        if (!(await confirmar(`¿Eliminar <b>${esc(prod.nombre)}</b> del catálogo?<br>Se quitarán también todas sus ubicaciones. No se puede deshacer.${extra}`, { ok: 'Sí, eliminar', peligro: true }))) return;
        await eliminarProducto(prod.id);
        closeModal(m);
        toast('Producto eliminado');
        refrescar();
      }
    });
  }
}

/* ============================================================
 * Selector de ubicación (Cámara + Pasillo + Número + Letra)
 * ============================================================ */
function elegirUbicacion({ titulo, inicial, producto }) {
  return new Promise(resolve => {
    const def = state.view === 'camaras'
      ? { cam: state.camara, pas: state.pasillo, num: 1, letra: 'A' }
      : { cam: CAMARAS[0], pas: PASILLOS[CAMARAS[0]][0], num: 1, letra: 'A' };
    const ini = parseLoc(inicial) || def;
    const sel = { cam: ini.cam, pas: ini.pas, num: ini.num, letra: ini.letra };
    let decided = false;
    const m = openModal({
      title: esc(titulo),
      body: `
        <div class="picker-preview" id="pk-prev"></div>
        <div class="picker-state" id="pk-state"></div>
        <div class="sec-title">Cámara</div>
        <div class="pick-grid pick-cam" id="pk-cam"></div>
        <div class="sec-title">Pasillo</div>
        <div class="pick-grid pick-pas" id="pk-pas"></div>
        <div class="sec-title">Posición (1-20)</div>
        <div class="pick-grid pick-num" id="pk-num"></div>
        <div class="sec-title">Letra</div>
        <div class="pick-grid pick-let" id="pk-let"></div>`,
      foot: `<button type="button" class="btn btn-ok" data-ok>✔ Guardar ubicación</button>`,
      onClose: () => { if (!decided) resolve(null); }
    });
    const mapa = mapaUbicaciones();
    const claves = Array.from(mapa.keys());
    const pintar = () => {
      const key = locKey(sel.cam, sel.pas, sel.num, sel.letra);
      $('#pk-prev', m).textContent = key;
      const en = (mapa.get(key) || []).filter(p => !producto || p.id !== producto.id);
      const yaEsta = producto && producto.ubicaciones.includes(key);
      $('#pk-state', m).innerHTML = yaEsta ? 'Este producto ya está aquí'
        : en.length ? `Ocupado por: <b>${en.map(p => esc(p.nombre)).join(', ')}</b>` : 'Hueco vacío';
      $('#pk-cam', m).innerHTML = CAMARAS.map(c => `<button type="button" class="pick" data-c="${esc(c)}" aria-pressed="${c === sel.cam}">${c}</button>`).join('');
      $('#pk-pas', m).innerHTML = PASILLOS[sel.cam].map(p => {
        const used = claves.some(k => k.startsWith(prefijo(sel.cam, p)));
        return `<button type="button" class="pick ${used ? 'used' : ''}" data-p="${esc(p)}" aria-pressed="${p === sel.pas}">${esc(pasLabel(p))}</button>`;
      }).join('');
      let nums = '';
      for (let n = 1; n <= POSICIONES; n++) {
        const used = LETRAS.some(l => mapa.has(locKey(sel.cam, sel.pas, n, l)));
        nums += `<button type="button" class="pick ${used ? 'used' : ''}" data-n="${n}" aria-pressed="${n === sel.num}">${n}</button>`;
      }
      $('#pk-num', m).innerHTML = nums;
      $('#pk-let', m).innerHTML = LETRAS.map(l => `<button type="button" class="pick ${mapa.has(locKey(sel.cam, sel.pas, sel.num, l)) ? 'used' : ''}" data-l="${l}" aria-pressed="${l === sel.letra}">${l}</button>`).join('');
    };
    pintar();
    $('.sheet-body', m).addEventListener('click', e => {
      const b = e.target.closest('.pick');
      if (!b) return;
      if (b.dataset.c && b.dataset.c !== sel.cam) { sel.cam = b.dataset.c; sel.pas = PASILLOS[sel.cam][0]; }
      if (b.dataset.p) sel.pas = b.dataset.p;
      if (b.dataset.n) sel.num = +b.dataset.n;
      if (b.dataset.l) sel.letra = b.dataset.l;
      pintar();
    });
    $('[data-ok]', m).addEventListener('click', () => {
      decided = true;
      closeModal(m);
      resolve(locKey(sel.cam, sel.pas, sel.num, sel.letra));
    });
  });
}

/* ============================================================
 * Hueco (contenido de una ubicación)
 * ============================================================ */
function abrirHueco(key) {
  const m = openModal({ title: `Ubicación <span class="loc" style="font-size:22px">${esc(key)}</span>`, body: '' });
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
    const obj = nuevo ? { id: uid(), ubicaciones: [], base: [], ...datos } : Object.assign(p, datos);
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
 * Sincronización con Google Sheets (opcional)
 *
 * Cada móvil trabaja siempre con sus datos locales (funciona sin cobertura).
 * Cuando hay conexión, envía sus cambios pendientes a la hoja y recibe el catálogo completo.
 * Las ubicaciones se combinan: si dos personas añaden o quitan ubicaciones distintas del mismo
 * producto sin cobertura, se conservan los cambios de ambas.
 * ============================================================ */
const Sync = {
  cfg: { url: '', clave: '' },
  enCurso: false,
  pendientes: 0,
  ultima: null,         // fecha de la última sincronización correcta
  error: '',            // último error (vacío si fue bien)
  sinRed: false,
  timer: null,

  activo() { return !!(this.cfg.url && this.cfg.clave); },

  async cargarConfig() {
    const guardada = await DB.getMeta('sync');
    if (guardada && (guardada.url || guardada.desconectado)) this.cfg = guardada;
    else if (CONFIG.syncUrl && CONFIG.syncClave) this.cfg = { url: CONFIG.syncUrl.trim(), clave: CONFIG.syncClave.trim(), deConfig: true };
    this.ultima = await DB.getMeta('syncUltima') || null;
  },

  /** Llamada a la aplicación web de Google Apps Script. */
  async llamar(datos, cfg = this.cfg) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try {
      res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // evita la petición previa CORS
        body: JSON.stringify({ ...datos, clave: cfg.clave }),
        redirect: 'follow',
        signal: ctrl.signal
      });
    } catch (e) {
      const err = new Error('Sin conexión con la hoja');
      err.red = true;
      throw err;
    } finally { clearTimeout(to); }
    let json;
    try { json = await res.json(); } catch (e) { throw new Error('La dirección no es la de la hoja de GesFrío (respuesta no válida)'); }
    if (!json || !json.ok) throw new Error((json && json.error) || 'Error en la hoja');
    return json;
  },

  cambioLocal() {
    this.contarPendientes();
    if (this.activo()) this.programar(1500);
  },

  async contarPendientes() {
    try { this.pendientes = (await DB.all()).filter(r => r.pend).length; } catch (e) { /* nada */ }
    pintarSyncBar();
  },

  programar(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sincronizar(), ms);
  },

  /** Envía los cambios pendientes y descarga el catálogo de la hoja. */
  async sincronizar({ avisar = false } = {}) {
    if (!this.activo()) return false;
    if (this.enCurso) { this.programar(2000); return false; }
    this.enCurso = true;
    pintarSyncBar();
    try {
      const recs = await DB.all();
      const pend = recs.filter(r => r.pend);
      const cambios = pend.map(r => ({
        ...limpio(r), borrado: !!r.borrado,
        base: r.forzar || !Array.isArray(r.base) ? null : r.base, forzar: !!r.forzar
      }));
      const res = await this.llamar({ accion: 'sincronizar', cambios });
      const cambiado = await this.aplicarServidor(res.productos || [], new Map(pend.map(r => [r.id, r.actualizado])));
      this.ultima = ahora();
      this.error = '';
      this.sinRed = false;
      await DB.setMeta('syncUltima', this.ultima);
      if (cambiado) refrescar();
      if (avisar) toast('Sincronizado con la hoja ✓');
      return true;
    } catch (e) {
      this.sinRed = !!e.red;
      this.error = e.red ? '' : (e.message || String(e));
      if (avisar) toast(e.red ? 'Sin conexión. Los cambios se enviarán cuando haya cobertura.' : 'Error al sincronizar: ' + this.error, true);
      return false;
    } finally {
      this.enCurso = false;
      await this.contarPendientes();
      if (state.view === 'copia') renderSyncPanel();
    }
  },

  /** Aplica el catálogo recibido de la hoja. Respeta los cambios hechos en este móvil durante el envío.
   *  Devuelve true si algo cambió. */
  async aplicarServidor(lista, enviados) {
    const actuales = new Map((await DB.all()).map(r => [r.id, r]));
    // Registro con cambios locales posteriores a lo enviado: no se toca.
    const protegido = r => r && r.pend && enviados.get(r.id) !== r.actualizado;
    const put = [], del = [], vistos = new Set();
    let cambiado = false;
    for (const s of lista) {
      const id = String(s.id || '');
      if (!id) continue;
      vistos.add(id);
      const loc = actuales.get(id);
      if (protegido(loc)) continue;
      if (s.borrado) { if (loc) { del.push(id); cambiado = true; } continue; }
      const r = desdeServidor(s);
      if (!loc || JSON.stringify(registro(loc)) !== JSON.stringify(registro(r))) { put.push(r); cambiado = true; }
    }
    // Lo que ya no está en la hoja (borrado a mano en la hoja) desaparece, salvo cambios sin enviar.
    for (const [id, r] of actuales) {
      if (!vistos.has(id) && !protegido(r)) { del.push(id); cambiado = true; }
    }
    if (put.length || del.length) await DB.bulk({ put, del });
    if (cambiado) await cargarDesdeDB();
    return cambiado;
  },

  /** Conecta este móvil a una hoja. Decide qué hacer con los datos que ya hay en el móvil. */
  async conectar(url, clave) {
    const cfg = { url: url.trim(), clave: clave.trim() };
    const res = await this.llamar({ accion: 'leer' }, cfg);
    const srv = (res.productos || []).filter(s => !s.borrado);
    const locales = state.productos.length;
    let subir = false;
    if (srv.length) {
      if (locales && !(await confirmar(`La hoja ya tiene <b>${srv.length}</b> productos.<br>Este móvil usará los datos de la hoja y se descartarán sus <b>${locales}</b> productos actuales.`, { ok: 'Conectar y usar la hoja' }))) return false;
    } else if (locales) {
      subir = await confirmar(`La hoja está vacía.<br>¿Subir los <b>${locales}</b> productos de este móvil para compartirlos?<br><small>Si eliges «No», este móvil empezará con el catálogo vacío.</small>`, { ok: 'Sí, subir mis productos', cancelar: 'No, empezar vacío' });
    }
    const t = ahora();
    const recs = subir
      ? state.productos.map(p => registro({ ...p, pend: true, forzar: true, actualizado: t }))
      : srv.map(desdeServidor);
    await DB.bulk({ clear: true, put: recs });
    this.cfg = cfg;
    await DB.setMeta('sync', cfg);
    await cargarDesdeDB();
    await this.sincronizar();
    refrescar();
    return true;
  },

  async desconectar() {
    this.cfg = { url: '', clave: '' };
    await DB.setMeta('sync', { url: '', clave: '', desconectado: true });
    this.error = ''; this.ultima = null;
    pintarSyncBar();
  }
};

/** Convierte una fila de la hoja en un registro local. */
function desdeServidor(s) {
  const crudas = (Array.isArray(s.ubicaciones) ? s.ubicaciones : String(s.ubicaciones || '').split(/[,;|\n]+/))
    .map(x => String(x).trim()).filter(Boolean);
  const r = {
    id: String(s.id), nombre: String(s.nombre || '').trim(), codigo: String(s.codigo || '').trim().toUpperCase(),
    categoria: String(s.categoria || '').trim(), formato: String(s.formato || '').trim(), notas: String(s.notas || '').trim(),
    ubicaciones: normUbic(crudas), actualizado: String(s.actualizado || ''), borrado: false, pend: false, forzar: false
  };
  r.base = r.ubicaciones.slice();
  // Si en la hoja alguien escribió una ubicación con otro formato, se corrige en la hoja.
  if (crudas.some(u => (parseLoc(u) || {}).key !== u)) { r.pend = true; r.forzar = true; }
  return r;
}

function horaCorta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = new Date().toDateString() === d.toDateString();
  return hoy ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function textoSync() {
  if (Sync.enCurso) return { cls: '', txt: '⟳ Sincronizando…' };
  if (Sync.error) return { cls: 'err', txt: `⚠ ${Sync.error}` };
  if (Sync.pendientes) return { cls: 'pend', txt: `● ${Sync.pendientes} cambio${Sync.pendientes > 1 ? 's' : ''} sin enviar${Sync.sinRed ? ' (sin cobertura)' : ''}` };
  if (Sync.sinRed) return { cls: 'pend', txt: `● Sin cobertura · datos del ${horaCorta(Sync.ultima) || '—'}` };
  return { cls: 'ok', txt: `✓ Al día${Sync.ultima ? ' · ' + horaCorta(Sync.ultima) : ''}` };
}

function pintarSyncBar() {
  const b = $('#sync-bar');
  if (!Sync.activo()) { b.hidden = true; return; }
  const { cls, txt } = textoSync();
  b.hidden = false;
  b.className = 'sync-bar ' + cls;
  b.textContent = txt;
}

function renderSyncPanel() {
  const el = $('#sync-panel');
  if (Sync.activo()) {
    const { cls, txt } = textoSync();
    el.innerHTML = `
      <div class="info">
        <div>Estado: <b class="${cls === 'ok' ? 'okmsg' : cls === 'err' ? 'err' : ''}">${esc(txt)}</b></div>
        <div>Última sincronización: <b>${Sync.ultima ? new Date(Sync.ultima).toLocaleString('es-ES') : 'nunca'}</b></div>
        ${Sync.cfg.deConfig ? '<div>Conectado automáticamente (config.js)</div>' : ''}
      </div>
      <button type="button" class="btn btn-primary" id="sync-ahora">⟳ Sincronizar ahora</button>
      <button type="button" class="btn btn-danger" id="sync-off">Desconectar este móvil</button>
      <p class="help">Los cambios hechos sin cobertura se guardan en el móvil y se envían solos al recuperar la conexión.</p>`;
  } else {
    el.innerHTML = `
      <p class="help">Conecta este móvil a la hoja de Google de la empresa para que todos los móviles vean los mismos productos y ubicaciones. Las instrucciones para crear la hoja están en el archivo README.</p>
      <div class="field"><label for="sync-url">Dirección de la hoja (termina en /exec)</label>
        <input id="sync-url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(Sync.cfg.url || '')}"></div>
      <div class="field"><label for="sync-clave">Clave</label>
        <input id="sync-clave" autocomplete="off" autocapitalize="off" spellcheck="false" value=""></div>
      <p class="err" id="sync-err"></p>
      <button type="button" class="btn btn-primary" id="sync-on">🔗 Conectar</button>`;
  }
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
  const data = { app: 'GesFrío', formato: 2, exportado: ahora(), productos: state.productos.map(limpio) };
  if (await entregarArchivo(`gesfrio_copia_${fecha()}.json`, JSON.stringify(data, null, 2), 'application/json')) {
    await DB.setMeta('ultimaExportacion', ahora());
    toast('Copia exportada');
    renderCopia();
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
    await DB.setMeta('ultimaExportacion', ahora());
    toast('CSV exportado');
    renderCopia();
  }
}

function descargarPlantilla() {
  const ejemplo = [
    { codigo: 'PES-001', nombre: 'Merluza en rodajas', categoria: 'Pescado', formato: 'Caja', ubicaciones: ['FRÍO-P1-1-A', 'K-P2-4-B'], notas: '' },
    { codigo: 'VER-001', nombre: 'Guisantes finos', categoria: 'Verduras', formato: 'Bolsa', ubicaciones: ['S-SOFIALTO-1-A'], notas: 'Ejemplo: borra estas filas' }
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

/** Añade a la lista las ubicaciones válidas de los textos y anota avisos de las que no lo son. */
function leerUbicaciones(textos, destino, avisos, donde) {
  for (const t of textos) {
    const l = parseLoc(t, true);
    if (!l) { avisos.push(`${donde}: ubicación «${t}» no válida`); continue; }
    if (l.legacy) avisos.push(`${donde}: «${t}» no indica pasillo; se ha puesto en ${l.key}`);
    if (!destino.includes(l.key)) destino.push(l.key);
  }
}

/** Convierte las filas del CSV en productos. Admite varias filas con el mismo código
 *  (una por ubicación) y columnas separadas cámara/pasillo/posición/letra. */
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
    pasillo: ['pasillo', 'pas'],
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
    if (col.camara != null && get(f, 'camara')) {
      textos.push([get(f, 'camara'), get(f, 'pasillo'), get(f, 'posicion'), get(f, 'letra')].filter(Boolean).join('-'));
    }
    leerUbicaciones(textos, p.ubicaciones, avisos, `Fila ${idx + 2}`);
  });
  return { productos: Array.from(porClave.values()), avisos };
}

function productosDesdeJSON(text) {
  const data = JSON.parse(text);
  const lista = Array.isArray(data) ? data : data && Array.isArray(data.productos) ? data.productos : null;
  if (!lista) throw new Error('El archivo JSON no contiene una lista de productos.');
  const avisos = [];
  const productos = lista.filter(x => x && x.nombre).map(x => {
    const ubic = (Array.isArray(x.ubicaciones) ? x.ubicaciones : String(x.ubicaciones || '').split(/[|,;]+/))
      .map(s => String(s).trim()).filter(Boolean);
    const ok = [];
    leerUbicaciones(ubic, ok, avisos, `«${x.nombre}»`);
    return {
      id: x.id ? String(x.id) : uid(), nombre: String(x.nombre).trim(), codigo: String(x.codigo || '').trim().toUpperCase(),
      categoria: String(x.categoria || '').trim(), formato: String(x.formato || '').trim(), notas: String(x.notas || '').trim(),
      ubicaciones: ok, actualizado: x.actualizado || ahora()
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
  const todos = Sync.activo() ? ' en <b>todos los móviles</b>' : ' de este móvil';
  const m = openModal({
    title: 'Importar datos',
    body: `
      <p class="confirm-msg">Archivo: <b>${esc(file.name)}</b><br>
      ${productos.length} productos y ${nUbic} ubicaciones.</p>
      ${avisos.length ? `<p class="err">⚠ ${avisos.length} aviso${avisos.length > 1 ? 's' : ''}:<br>${avisos.slice(0, 8).map(esc).join('<br>')}${avisos.length > 8 ? '<br>…' : ''}</p>` : ''}
      <p class="help"><b>Combinar:</b> añade los productos nuevos y actualiza los que tengan el mismo código (o nombre si no tienen código); si el archivo trae ubicaciones para un producto, sustituyen a las que tenía. No borra productos.<br>
      <b>Reemplazar todo:</b> borra el catálogo actual${todos} y lo sustituye por el del archivo.</p>`,
    foot: `<button type="button" class="btn btn-primary" data-merge>Combinar con lo actual</button>
           <button type="button" class="btn btn-danger" data-replace>Reemplazar todo</button>
           <button type="button" class="btn" data-close>Cancelar</button>`
  });
  $('[data-merge]', m).addEventListener('click', async () => {
    const claveDe = p => p.codigo ? 'c:' + norm(p.codigo) : 'n:' + norm(p.nombre);
    const actuales = new Map(state.productos.map(p => [claveDe(p), p]));
    let nuevos = 0, act = 0;
    const t = ahora();
    const recs = productos.map(np => {
      const ex = actuales.get(claveDe(np));
      if (ex) {
        act++;
        return registro(indexar({ ...ex, nombre: np.nombre, categoria: np.categoria || ex.categoria, formato: np.formato || ex.formato,
          notas: np.notas || ex.notas, ubicaciones: np.ubicaciones.length ? np.ubicaciones : ex.ubicaciones,
          actualizado: t, pend: true, forzar: true }));
      }
      nuevos++;
      const id = state.productos.some(p => p.id === np.id) ? uid() : np.id;
      return registro(indexar({ ...np, id, actualizado: t, pend: true, forzar: true }));
    });
    await DB.bulk({ put: recs });
    await cargarDesdeDB();
    Sync.cambioLocal();
    closeModal(m);
    toast(`Importado: ${nuevos} nuevos, ${act} actualizados`);
    render();
  });
  $('[data-replace]', m).addEventListener('click', async () => {
    if (!(await confirmar(`Se borrarán los <b>${state.productos.length}</b> productos actuales${todos} y se cargarán <b>${productos.length}</b> del archivo. ¿Continuar?`, { ok: 'Sí, reemplazar', peligro: true }))) return;
    await reemplazarCatalogo(productos);
    closeModal(m);
    toast(`Catálogo reemplazado: ${productos.length} productos`);
    render();
  });
}

/* ============================================================
 * Instalación y actualizaciones de la app
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

let swReg = null;
function registrarSW() {
  if (!('serviceWorker' in navigator)) return;
  const habiaVersion = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => { swReg = reg; }).catch(err => console.warn('Service worker no registrado', err));
  // Cuando se publica una versión nueva, el móvil la descarga sola y avisa para recargar.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (habiaVersion) $('#update-bar').hidden = false;
  });
}
function buscarActualizacion() {
  if (swReg && navigator.onLine) swReg.update().catch(() => { /* sin conexión */ });
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
    state.fPasillo = '';
    renderCatalogo();
  });
  $('#f-pasillo').addEventListener('click', e => {
    const b = e.target.closest('[data-pas]');
    if (!b) return;
    state.fPasillo = b.dataset.pas;
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
    if (cam) { state.camara = cam.dataset.selcam; state.pasillo = PASILLOS[state.camara][0]; state.highlight = ''; renderCamara(); $('#grid-wrap').scrollLeft = 0; return; }
    const pas = e.target.closest('[data-selpas]');
    if (pas) { state.pasillo = pas.dataset.selpas; state.highlight = ''; renderCamara(); $('#grid-wrap').scrollLeft = 0; }
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
    await reemplazarCatalogo(datosEjemplo());
    toast('Productos de ejemplo cargados');
    render();
  });
  $('#borrar-todo').addEventListener('click', async () => {
    const donde = Sync.activo() ? '<b>en todos los móviles</b> conectados a la hoja' : 'de este móvil';
    if (!(await confirmar(`¿Borrar <b>todos</b> los productos y ubicaciones ${donde}?`, { ok: 'Sí, borrar todo', peligro: true }))) return;
    if (!(await confirmar('Última confirmación: esta acción <b>no se puede deshacer</b>. Exporta antes una copia si la necesitas.', { ok: 'Borrar definitivamente', peligro: true }))) return;
    await reemplazarCatalogo([]);
    toast('Datos borrados');
    render();
  });

  // Sincronización
  $('#sync-bar').addEventListener('click', () => Sync.sincronizar({ avisar: true }));
  $('#sync-panel').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'sync-ahora') {
      await Sync.sincronizar({ avisar: true });
    } else if (b.id === 'sync-off') {
      if (!(await confirmar('¿Desconectar este móvil de la hoja?<br>Los datos se quedan en el móvil pero dejarán de actualizarse.', { ok: 'Sí, desconectar', peligro: true }))) return;
      await Sync.desconectar();
      toast('Móvil desconectado de la hoja');
      renderCopia();
    } else if (b.id === 'sync-on') {
      const url = $('#sync-url').value.trim(), clave = $('#sync-clave').value.trim();
      const err = $('#sync-err');
      if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(url)) { err.textContent = 'Pega la dirección de la aplicación web de Google (empieza por https://script.google.com/ y termina en /exec).'; return; }
      if (!clave) { err.textContent = 'Escribe la clave de la hoja.'; return; }
      err.textContent = '';
      b.disabled = true; b.textContent = 'Conectando…';
      try {
        if (await Sync.conectar(url, clave)) { toast('Conectado a la hoja ✓'); renderCopia(); return; }
      } catch (ex) {
        err.textContent = ex.red ? 'No hay conexión con la hoja. Comprueba internet y la dirección.' : ex.message;
      }
      b.disabled = false; b.textContent = '🔗 Conectar';
    }
  });
  $('#update-bar').addEventListener('click', () => location.reload());

  window.addEventListener('online', () => { Sync.sincronizar(); buscarActualizacion(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { Sync.sincronizar(); buscarActualizacion(); }
  });
  // Mientras la app está abierta, comprobar cambios de otros móviles cada 2 minutos.
  setInterval(() => { if (document.visibilityState === 'visible') Sync.sincronizar(); }, 120000);

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
    await Sync.cargarConfig();
    const iniciado = await DB.getMeta('iniciado');
    if (!iniciado) {
      // Los productos de ejemplo solo se cargan si el móvil no está conectado a una hoja.
      if (!Sync.activo()) await DB.bulk({ put: datosEjemplo().map(p => registro(indexar(p))) });
      await DB.setMeta('iniciado', true);
    }
    await cargarDesdeDB();
  } catch (e) {
    console.error(e);
    toast('No se puede acceder al almacenamiento del navegador. ¿Modo privado?', true);
  }
  render();
  await Sync.contarPendientes();
  Sync.sincronizar();

  // Pedir almacenamiento persistente (el navegador no borrará los datos por falta de espacio).
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* opcional */ }
  registrarSW();
}

init();
