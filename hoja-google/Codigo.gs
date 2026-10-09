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
 * La hoja «Productos» se puede consultar y editar a mano. Para añadir productos desde la hoja,
 * escribe una fila nueva con al menos el nombre (deja vacía la columna id: se rellena sola).
 * Ubicaciones separadas por comas, con el formato de la app: K-P3-12-B, S-SOFIALTO-4-A…
 */

const CLAVE = 'cambia-esta-clave';
const HOJA = 'Productos';
const COLUMNAS = ['codigo', 'nombre', 'categoria', 'formato', 'ubicaciones', 'notas', 'actualizado', 'borrado', 'id'];

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
    const sh = obtenerHoja();
    const { filas, porId, cambiado: idsNuevos } = leer(sh);
    let cambiado = idsNuevos;
    if (d.accion === 'sincronizar' && Array.isArray(d.cambios)) {
      d.cambios.forEach(c => {
        if (!c || !c.id) return;
        const i = porId[c.id];
        const fusion = fusionar(i === undefined ? null : filas[i], c);
        if (i === undefined) { porId[c.id] = filas.length; filas.push(fusion); }
        else filas[i] = fusion;
        cambiado = true;
      });
    }
    if (cambiado) escribir(sh, filas);
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
    ubicaciones: g.borrado ? [] : ubic,
    actualizado: ganaNuevo ? nuevo.actualizado : ex.actualizado,
    borrado: g.borrado
  };
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
