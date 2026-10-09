/**
 * GesFrío · Script de la hoja de Google para compartir datos entre móviles.
 *
 * INSTALACIÓN (una sola vez, ver README):
 *  1. Crea una hoja de cálculo nueva en Google Drive (por ejemplo «GesFrío»).
 *  2. Menú Extensiones → Apps Script. Borra lo que haya y pega este archivo entero.
 *  3. Cambia la CLAVE de abajo por una tuya (la misma que pondrás en los móviles).
 *  4. Implementar → Nueva implementación → tipo «Aplicación web».
 *       Ejecutar como: «Yo»   ·   Quién tiene acceso: «Cualquier usuario».
 *  5. Autoriza los permisos y copia la «URL de la aplicación web» (termina en /exec).
 *
 * EDITORES: solo quien tenga un código de la pestaña «Editores» puede añadir, cambiar o borrar
 * desde la app. El resto de móviles solo pueden consultar. La pestaña se crea sola la primera vez,
 * con un editor «Administrador» y un código al azar. Para dar de alta a una persona, añade una fila
 * (nombre, código, activo = SI). Para quitarle el permiso, pon activo = NO.
 * Cada cambio queda apuntado en la pestaña «Historial» con el nombre de quien lo hizo.
 *
 * La hoja «Productos» se puede consultar y editar a mano. Para añadir productos desde la hoja,
 * escribe una fila nueva con al menos el nombre (deja vacía la columna id: se rellena sola).
 * Ubicaciones separadas por comas, con el formato de la app: K-P3-12-B, S-SOFIALTO-4-A…
 */

const CLAVE = '12345';
const HOJA = 'Productos';
const COLUMNAS = ['codigo', 'nombre', 'categoria', 'formato', 'ubicaciones', 'notas', 'actualizado', 'modificado_por', 'borrado', 'id'];
const HOJA_EDITORES = 'Editores';
const HOJA_HISTORIAL = 'Historial';

/** Al abrir la hoja: crea las pestañas que falten y añade el menú «GesFrío». */
function onOpen() {
  prepararHojas();
  SpreadsheetApp.getUi().createMenu('GesFrío')
    .addItem('Añadir editor…', 'menuAnadirEditor')
    .addItem('Ver mi código de administrador', 'menuVerAdmin')
    .addItem('Crear pestañas que falten', 'prepararHojas')
    .addToUi();
}

function prepararHojas() {
  obtenerHoja();
  hojaEditores();
  hojaHistorial();
}

function menuAnadirEditor() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Añadir editor', 'Nombre de la persona:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const nombre = r.getResponseText().trim();
  if (!nombre) return;
  const sh = hojaEditores();
  const usados = sh.getDataRange().getValues().map(v => String(v[1]));
  let codigo;
  do { codigo = String(Math.floor(100000 + Math.random() * 900000)); } while (usados.indexOf(codigo) >= 0);
  sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setNumberFormat('@').setValues([[nombre, codigo, 'SI']]);
  ui.alert('Editor añadido', nombre + '\n\nCódigo: ' + codigo + '\n\nEn su móvil: Copia → Permiso para editar → escribir el código → Activar edición.', ui.ButtonSet.OK);
}

function menuVerAdmin() {
  const v = hojaEditores().getDataRange().getValues();
  const fila = v.find((f, i) => i > 0 && String(f[0]).trim() === 'Administrador');
  SpreadsheetApp.getUi().alert('Código de administrador', fila ? String(fila[1]) : 'No hay fila «Administrador» en la pestaña Editores.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function doPost(e) {
  let datos;
  try { datos = JSON.parse(e.postData.contents); }
  catch (err) { return responder({ ok: false, error: 'Petición no válida' }); }
  return responder(manejar(datos));
}

// Permite comprobar en el navegador que el script está publicado.
function doGet() {
  return responder({ ok: true, app: 'GesFrío', mensaje: 'La hoja de GesFrío está funcionando.' });
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function manejar(d) {
  if (!d || d.clave !== CLAVE) return { ok: false, error: 'Clave incorrecta' };
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const editor = buscarEditor(d.editor);
    if (d.accion === 'comprobarEditor') {
      return editor ? { ok: true, nombre: editor.nombre } : { ok: false, codigo: 'NO_EDITOR', error: 'Código de editor no válido' };
    }
    const cambios = d.accion === 'sincronizar' && Array.isArray(d.cambios) ? d.cambios.filter(c => c && c.id) : [];
    if (cambios.length && !editor) {
      return { ok: false, codigo: 'NO_EDITOR', error: 'Este móvil no tiene permiso para hacer cambios' };
    }
    const sh = obtenerHoja();
    const { filas, porId, cambiado: idsNuevos } = leer(sh);
    let cambiado = idsNuevos;
    const historial = [];
    const fecha = new Date().toISOString();
    cambios.forEach(c => {
      const i = porId[c.id];
      const antes = i === undefined ? null : filas[i];
      const fusion = fusionar(antes, c);
      fusion.modificado_por = editor.nombre;
      if (i === undefined) { porId[c.id] = filas.length; filas.push(fusion); }
      else filas[i] = fusion;
      cambiado = true;
      const accion = !antes ? 'alta' : (fusion.borrado && !antes.borrado) ? 'borrado' : 'cambio';
      const ua = antes ? antes.ubicaciones.join(', ') : '', ud = fusion.ubicaciones.join(', ');
      const igual = antes && accion === 'cambio' && ua === ud && antes.nombre === fusion.nombre && antes.codigo === fusion.codigo &&
        antes.categoria === fusion.categoria && antes.formato === fusion.formato && antes.notas === fusion.notas;
      if (!igual) historial.push([fecha, editor.nombre, fusion.codigo, fusion.nombre, accion, ua, ud]);
    });
    if (cambiado) escribir(sh, filas);
    if (historial.length) anotarHistorial(historial);
    return { ok: true, hora: new Date().toISOString(), productos: filas };
  } finally {
    lock.releaseLock();
  }
}

/** Combina un cambio de un móvil con lo que hay en la hoja.
 *  Datos del producto: gana el cambio más reciente.
 *  Ubicaciones: se aplican las altas y bajas que hizo ese móvil, sin perder las de otros móviles. */
function fusionar(ex, c) {
  const limpiar = arr => (arr || []).map(x => String(x).trim()).filter(Boolean);
  const nuevo = {
    id: String(c.id), codigo: str(c.codigo), nombre: str(c.nombre), categoria: str(c.categoria),
    formato: str(c.formato), notas: str(c.notas), ubicaciones: limpiar(c.ubicaciones),
    actualizado: str(c.actualizado), borrado: !!c.borrado
  };
  if (!ex) return nuevo;
  const ganaNuevo = nuevo.actualizado >= ex.actualizado;
  let ubic;
  if (c.forzar || !Array.isArray(c.base)) {
    ubic = ganaNuevo ? nuevo.ubicaciones : ex.ubicaciones;
  } else {
    const base = limpiar(c.base);
    const altas = nuevo.ubicaciones.filter(u => base.indexOf(u) < 0);
    const bajas = base.filter(u => nuevo.ubicaciones.indexOf(u) < 0);
    ubic = ex.ubicaciones.filter(u => bajas.indexOf(u) < 0);
    altas.forEach(u => { if (ubic.indexOf(u) < 0) ubic.push(u); });
  }
  const g = ganaNuevo ? nuevo : ex;
  return {
    id: ex.id, codigo: g.codigo, nombre: g.nombre, categoria: g.categoria, formato: g.formato, notas: g.notas,
    modificado_por: ex.modificado_por,
    ubicaciones: g.borrado ? [] : ubic,
    actualizado: ganaNuevo ? nuevo.actualizado : ex.actualizado,
    borrado: g.borrado
  };
}

/** Busca un código en la pestaña «Editores». Devuelve {nombre} si es válido y está activo. */
function buscarEditor(codigo) {
  const sh = hojaEditores();
  codigo = str(codigo).toUpperCase();
  if (!codigo) return null;
  const valores = sh.getDataRange().getValues();
  const cab = (valores[0] || []).map(h => String(h).trim().toLowerCase());
  const iN = cab.indexOf('nombre'), iC = cab.indexOf('codigo'), iA = cab.indexOf('activo');
  for (let r = 1; r < valores.length; r++) {
    const v = valores[r];
    if (str(v[iC]).toUpperCase() !== codigo) continue;
    const activo = iA < 0 ? '' : str(v[iA]).toUpperCase();
    if (['NO', 'FALSE', 'FALSO', '0'].indexOf(activo) >= 0) return null;
    return { nombre: str(v[iN]) || 'Editor' };
  }
  return null;
}

function hojaEditores() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(HOJA_EDITORES);
  if (!sh) {
    sh = ss.insertSheet(HOJA_EDITORES);
    sh.getRange(1, 1, sh.getMaxRows(), 3).setNumberFormat('@');
    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    sh.getRange(1, 1, 2, 3).setValues([['nombre', 'codigo', 'activo'], ['Administrador', codigo, 'SI']]);
    sh.getRange(1, 1, 1, 3).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function hojaHistorial() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(HOJA_HISTORIAL);
  if (!sh) {
    sh = ss.insertSheet(HOJA_HISTORIAL);
    sh.getRange(1, 1, 1, 7).setValues([['fecha', 'editor', 'codigo', 'producto', 'accion', 'ubicaciones_antes', 'ubicaciones_despues']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function anotarHistorial(filas) {
  const sh = hojaHistorial();
  const r = sh.getRange(sh.getLastRow() + 1, 1, filas.length, 7);
  r.setNumberFormat('@');
  r.setValues(filas);
}

function str(v) {
  if (v instanceof Date) return v.toISOString();
  return v == null ? '' : String(v).trim();
}

function obtenerHoja() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(HOJA);
  if (!sh) {
    sh = ss.insertSheet(HOJA);
    sh.getRange(1, 1, sh.getMaxRows(), COLUMNAS.length).setNumberFormat('@');   // todo como texto
    sh.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Lee la hoja usando la fila de cabecera (las columnas pueden estar en otro orden). */
function leer(sh) {
  const valores = sh.getDataRange().getValues();
  const cab = (valores[0] || []).map(h => String(h).trim().toLowerCase());
  const idx = {};
  COLUMNAS.forEach(c => { idx[c] = cab.indexOf(c); });
  const faltan = COLUMNAS.filter(c => idx[c] < 0);
  if (faltan.length) {
    // Añade columnas que falten al final de la cabecera.
    faltan.forEach(c => { cab.push(c); idx[c] = cab.length - 1; });
    sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
  }
  const filas = [], porId = {};
  let cambiado = false;
  valores.slice(1).forEach(v => {
    const get = c => idx[c] < v.length ? str(v[idx[c]]) : '';
    const nombre = get('nombre');
    let id = get('id');
    if (!id && !nombre) return;                 // fila vacía
    if (!id) { id = Utilities.getUuid(); cambiado = true; }   // fila añadida a mano en la hoja
    if (porId[id] !== undefined) return;        // id repetido: se ignora
    const b = get('borrado').toUpperCase();
    porId[id] = filas.length;
    filas.push({
      id, nombre, codigo: get('codigo'), categoria: get('categoria'), formato: get('formato'), notas: get('notas'),
      ubicaciones: get('ubicaciones').split(/[,;|\n]+/).map(x => x.trim()).filter(Boolean),
      actualizado: get('actualizado') || (cambiado ? new Date().toISOString() : ''),
      modificado_por: get('modificado_por'),
      borrado: b === 'SI' || b === 'SÍ' || b === 'TRUE' || b === 'VERDADERO' || b === 'X'
    });
  });
  return { filas, porId, cambiado, cab };
}

function escribir(sh, filas) {
  const cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim().toLowerCase());
  const datos = filas.map(f => cab.map(c => {
    if (c === 'ubicaciones') return f.ubicaciones.join(', ');
    if (c === 'borrado') return f.borrado ? 'SI' : '';
    return f[c] === undefined ? '' : f[c];
  }));
  const ultima = sh.getLastRow();
  if (ultima > 1) sh.getRange(2, 1, ultima - 1, cab.length).clearContent();
  if (datos.length) {
    const r = sh.getRange(2, 1, datos.length, cab.length);
    r.setNumberFormat('@');
    r.setValues(datos);
  }
}
