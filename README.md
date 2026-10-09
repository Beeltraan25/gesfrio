# GesFrío · Ubicaciones del almacén de congelados

Aplicación para el móvil que sirve para consultar el catálogo de productos y saber **en qué ubicación del almacén está cada uno**.
Funciona **sin conexión** cuando ya está instalada: los datos se guardan en el propio móvil. No hay que iniciar sesión.
Opcionalmente, todos los móviles pueden **compartir los mismos datos** a través de una hoja de Google Sheets de la empresa (ver apartado 4).

- **Ubicación** = Cámara + Pasillo + Posición (1-20) + Letra (A, B, C). Por ejemplo: `K-P3-12-B` o `S-SOFIALTO-4-A`.
- Pasillos de cada cámara:

  | Cámara | Pasillos |
  |---|---|
  | FRÍO | P1, P2 |
  | K | P1, P2, P3, P4 |
  | N | P1 … P8, TRÁNSITO |
  | L | P1, P2, P3 |
  | S | SA, SB, P2, P7, P8, SCE, SOFI, SOFIALTO, TRANS |

  Los pasillos con número llevan una **P** delante (`K-P3-12-B`) para no confundir el pasillo con la posición. En total hay 27 pasillos y 1.620 huecos.
- Un producto puede estar en varias ubicaciones, y una ubicación puede tener varios productos.
- Al abrirla por primera vez sin estar conectada a una hoja, trae **15 productos de ejemplo**.

## Funciones

| Sección | Qué hace |
|---|---|
| **Buscador** (arriba, siempre visible) | Busca mientras escribes, por nombre o por código, sin importar mayúsculas ni tildes (`lasana` encuentra «Lasaña»). Si escribes una ubicación completa (`k 3 12 b`, `n transito 5 a`) te dice qué hay en ese hueco. |
| **Catálogo** | Lista de productos con sus ubicaciones en grande (amarillo). Filtros por cámara, por pasillo y por categoría. |
| **Ficha** | Al tocar un producto: todos sus datos y ubicaciones. Desde aquí se **añade**, **mueve** o **quita** una ubicación, se editan los datos o se elimina el producto. Al tocar una ubicación se abre la cámara con ese hueco resaltado. |
| **Cámaras** | Eliges cámara y pasillo, y ves la cuadrícula de 20 posiciones × 3 letras: azul = ocupado, gris = vacío. Junto a cada pasillo sale cuántos huecos ocupados tiene. Al tocar un hueco ves qué contiene y puedes poner, mover o quitar productos. |
| **Nuevo** | Alta de un producto (nombre, código, categoría, formato y notas). Después se le asignan las ubicaciones. |
| **Copia** | Conexión con la hoja de Google, exportar e importar (JSON o CSV de Excel), plantilla CSV, cargar ejemplo, borrar todo e información de la app. |

Todo lo que se borra pide confirmación antes. El botón «Atrás» de Android cierra la ventana abierta.

---

## 1. Publicar la app (solo una vez, la hace quien gestiona la app)

Una PWA tiene que abrirse **una vez** desde una dirección `https://` para que el móvil la pueda instalar y guardar. Después ya no necesita internet.
Son archivos estáticos (`index.html`, `app.js`, `config.js`, `styles.css`, `sw.js`, `manifest.webmanifest` y la carpeta `icons/`), así que sirve cualquier alojamiento web gratuito. Elige una opción:

### Opción A: GitHub Pages (recomendada si ya usas este repositorio)
1. En GitHub, entra en el repositorio → **Settings** → **Pages**.
2. En «Build and deployment», elige **Source: Deploy from a branch**.
3. Selecciona la rama (por ejemplo `main`) y la carpeta **/ (root)**. Pulsa **Save**.
4. Al cabo de 1-2 minutos aparece la dirección, del tipo `https://TU-USUARIO.github.io/gesfrio/`.

> En cuentas gratuitas, GitHub Pages solo funciona con repositorios **públicos**. Los datos de los productos **no** se publican, porque viven en cada móvil. Solo se publica el código de la app y los 15 productos de ejemplo.

### Opción B: Netlify Drop (sin cuenta de GitHub, arrastrando una carpeta)
1. Descarga el código (botón **Code → Download ZIP** en GitHub) y descomprímelo.
2. Entra en <https://app.netlify.com/drop> y arrastra la carpeta descomprimida.
3. Te da una dirección `https://algo.netlify.app` que ya puedes usar.

### Opción C: Probar en un ordenador
```bash
cd gesfrio
python3 -m http.server 8000
# abre http://localhost:8000 en el navegador del ordenador
```
(`localhost` sirve para probar en el ordenador. Para instalarla en un móvil hace falta `https`, así que usa la opción A o la B.)

## 2. Instalar en el móvil (en cada móvil)

Hazlo **con conexión a internet** (wifi o datos), fuera de las cámaras.

### Android (Chrome)
1. Abre **Chrome** y entra en la dirección de la app.
2. Pulsa el menú **⋮** (arriba a la derecha) y luego **«Instalar aplicación»** o **«Añadir a pantalla de inicio»** → **Instalar**.
   También puedes ir a la sección **Copia** de la app y pulsar **«📲 Instalar en este móvil»** si aparece.
3. Aparece el icono **GesFrío** (copo de nieve amarillo) en la pantalla de inicio.

### iPhone / iPad (Safari)
1. Abre la dirección en **Safari**. Tiene que ser Safari. En otros navegadores de iPhone la opción puede no aparecer o la app puede no funcionar sin conexión.
2. Pulsa el botón **Compartir** (cuadrado con una flecha hacia arriba).
3. Baja y elige **«Añadir a pantalla de inicio»** → **Añadir**.
4. Abre la app **desde el icono nuevo** a partir de ahora.

### Comprobar que funciona sin conexión
1. Abre la app desde el icono una vez con internet y espera unos segundos.
2. Activa el **modo avión**.
3. Cierra la app del todo y vuelve a abrirla: debe cargar al instante con todos los productos.
   En **Copia → Aplicación** verás «Funciona sin conexión: **sí**».

## 3. Uso diario

- **Buscar:** escribe en la barra de arriba. La ubicación sale en grande en amarillo.
- **Guardar dónde se deja un palé:** toca el producto → **＋ Añadir ubicación** → elige Cámara, Pasillo, Posición y Letra → **Guardar ubicación**. Debajo de la ubicación elegida se ve si el hueco está vacío o qué contiene. Los botones con un punto azul tienen algo dentro.
- **Mover un palé:** en la ficha, **Mover** junto a la ubicación, y eliges la nueva.
- **Ver una cámara:** pestaña **Cámaras**, elige la cámara y el pasillo, y desliza la cuadrícula a los lados. Toca un hueco para ver o cambiar su contenido.

## 4. Compartir los datos entre todos los móviles (hoja de Google)

Si se conecta la app a una hoja de Google Sheets, lo que cambie una persona aparece en los móviles de todos.

**Cómo funciona:**
- Cada móvil sigue trabajando con sus datos guardados, así que **dentro de las cámaras, sin cobertura, todo funciona igual**.
- Los cambios hechos sin cobertura se quedan en el móvil y se envían **solos** al recuperar la conexión. También se envían al abrir la app y cada 2 minutos mientras está abierta.
- Bajo el buscador se ve el estado: **✓ Al día**, **● 3 cambios sin enviar (sin cobertura)** o **⚠ error**. Si lo tocas, sincroniza en ese momento.
- Si dos personas cambian a la vez, sin cobertura, ubicaciones distintas del mismo producto (una lo pone en K-P3-12-B y otra en S-SA-1-A), se guardan las dos. Si cambian el mismo dato (por ejemplo el nombre), se queda el cambio más reciente.
- La hoja se puede abrir en el ordenador para consultar o retocar el catálogo. También se pueden **añadir productos escribiendo filas nuevas en la hoja**: basta con el nombre y, si quieres, el código y las ubicaciones separadas por comas. Deja vacía la columna `id`, se rellena sola.

### 4.1 Crear la hoja (una sola vez, en un ordenador)
1. Entra en <https://sheets.google.com> con la cuenta de Google de la empresa y crea una **hoja de cálculo en blanco**. Llámala por ejemplo «GesFrío».
2. Menú **Extensiones → Apps Script**. Se abre un editor.
3. Borra el contenido que trae y pega **todo** el archivo [`hoja-google/Codigo.gs`](hoja-google/Codigo.gs) de este repositorio.
4. En la línea `const CLAVE = 'cambia-esta-clave';` pon una clave propia, por ejemplo `const CLAVE = 'congelados-2026-xyz';`. Pulsa el icono de **guardar** 💾.
5. Pulsa **Implementar → Nueva implementación**. En el engranaje ⚙ elige **Aplicación web** y rellena:
   - **Ejecutar como:** Yo (tu cuenta)
   - **Quién tiene acceso:** Cualquier usuario
6. Pulsa **Implementar** y luego **Autorizar acceso**. Elige tu cuenta. Si sale «Google no ha verificado esta aplicación», pulsa **Configuración avanzada → Ir a GesFrío (no seguro)** y después **Permitir**. Es tu propio script.
7. Copia la **URL de la aplicación web**. Empieza por `https://script.google.com/macros/s/…` y termina en `/exec`.

La hoja «Productos» se crea sola la primera vez que un móvil se conecta.

> Si más adelante cambias el script, hay que pulsar **Implementar → Gestionar implementaciones → ✎ Editar → Versión: Nueva versión → Implementar** para que la URL use el código nuevo. La URL no cambia.

### 4.2 Conectar los móviles

**Opción A, recomendada: todos los móviles a la vez.** Antes de publicar la app, abre `config.js` y pon la URL y la clave:
```js
window.GESFRIO_CONFIG = {
  syncUrl: 'https://script.google.com/macros/s/XXXXXXXX/exec',
  syncClave: 'congelados-2026-xyz'
};
```
Publica la app (apartado 1). Todos los móviles que la instalen, o que reciban esta versión, quedan conectados sin tocar nada.

**Opción B: móvil a móvil.** En la app: **Copia → Compartir datos entre móviles**. Pega la URL y la clave y pulsa **🔗 Conectar**.
- Si en ese móvil ya habías añadido o cambiado productos, la app pregunta si quieres **juntarlos con los de la hoja** (recomendado) o descartarlos. Si un producto con el mismo código ya está en la hoja, se le añaden las ubicaciones de este móvil.
- Los productos de ejemplo que no se han tocado no se suben a la hoja.

**Seguridad:** la URL y la clave son lo único que protege la hoja. Cualquiera que tenga las dos puede leer y cambiar el catálogo. No las publiques fuera de la empresa. Si se filtran, cambia la `CLAVE` en el script, crea una versión nueva de la implementación y pon la clave nueva en `config.js` o en cada móvil.

## 5. Actualizar la app en todos los móviles

Cuando se publica una versión nueva de la app (por ejemplo, cuando se añaden pasillos o cambia `config.js`):
1. Sube el número de `VERSION` en `sw.js` (por ejemplo `gesfrio-v2.0.0` → `gesfrio-v2.0.1`).
2. Publica los archivos otra vez en el mismo sitio (GitHub Pages se actualiza solo al subir los cambios a la rama; en Netlify se vuelve a arrastrar la carpeta).
3. Cada móvil descarga la versión nueva sola la próxima vez que abra la app con internet. Arriba aparece la franja azul **«Hay una versión nueva de la app · Toca para actualizar»**. Los datos no se pierden.

## 6. Copias de seguridad y paso de datos sin hoja de Google

Sin la hoja de Google, los datos solo existen en el móvil donde se introducen. **Exporta una copia de vez en cuando**, aunque uses la hoja. La app muestra la fecha de la última copia en **Copia → Aplicación**.

- **Exportar copia (JSON):** guarda todo. En el móvil puedes elegir **Compartir** (WhatsApp, correo, Drive, Bluetooth…) o **Guardar en el móvil**.
- **Pasar a otro móvil:** envía ese archivo al otro móvil, abre GesFrío → **Copia → Importar archivo** y elige:
  - **Combinar:** añade productos nuevos y actualiza los que tengan el mismo código. No borra productos.
  - **Reemplazar todo:** deja el catálogo exactamente igual que el del archivo.
- **Exportar para Excel (CSV):** abre bien en Excel en español (separado por `;` y con tildes).

### Cargar el catálogo inicial desde Excel
1. **Copia → Descargar plantilla CSV** y ábrela en Excel. Si lo prefieres, crea una hoja con estas columnas en la primera fila:

   | codigo | nombre | categoria | formato | ubicaciones | notas |
   |---|---|---|---|---|---|
   | PES-001 | Merluza en rodajas | Pescado | Caja | FRÍO-P1-1-A, K-P2-4-B | |

2. Pon varias ubicaciones en la misma celda separadas por comas (`K-P3-12-B, S-SOFIALTO-3-A`). También vale **una fila por ubicación** repitiendo el mismo código: la app las junta en un solo producto.
3. Formas alternativas que también entiende la app:
   - Nombres de columna: `referencia`/`ref`, `producto`/`descripción`, `familia`, `observaciones`.
   - Columnas separadas **cámara**, **pasillo**, **posición** y **letra** en lugar de `ubicaciones`.
   - Ubicaciones escritas como `k 3 12 b`, `K-P3-12B` o `n transito 5 a`.
   - Ubicaciones antiguas sin pasillo (`K-12-B`): se colocan en el primer pasillo de la cámara y la app lo avisa.
4. En Excel: **Archivo → Guardar como → «CSV UTF-8 (delimitado por comas)»**.
5. Pasa el archivo al móvil e impórtalo en **Copia → Importar archivo**. Antes de aplicar nada, la app te dice cuántos productos ha leído y avisa de las ubicaciones que no son válidas.

## 7. Para desarrolladores

- Sin dependencias ni compilación: HTML, CSS y JavaScript normales.
- `app.js`: toda la lógica (IndexedDB, buscador, vistas, sincronización, importar y exportar).
- `config.js`: conexión con la hoja de Google para todos los móviles (opcional).
- `hoja-google/Codigo.gs`: script de Google Apps Script que guarda los datos compartidos en la hoja. Combina las ubicaciones con un *merge* de tres vías (lo que añadió y quitó cada móvil respecto a la última versión que vio) y el resto de campos por el cambio más reciente. Los productos borrados se marcan con `borrado = SI` para que el borrado llegue a todos los móviles.
- `sw.js`: service worker que guarda la app en caché («primero caché») para que arranque al instante sin cobertura.
- Datos: base IndexedDB `gesfrio`, almacén `productos` (`{id, nombre, codigo, categoria, formato, notas, ubicaciones[], actualizado}`, más los campos internos de sincronización `pend`, `base`, `forzar` y `borrado`). La app pide al navegador almacenamiento persistente para que no borre los datos.
- **Al publicar una versión nueva**, cambia `VERSION` en `sw.js`. Los móviles la descargan la próxima vez que abran la app con internet y la usan a partir de la siguiente apertura. Los datos no se tocan.
- Las cámaras y sus pasillos, las posiciones, las letras, las categorías y los formatos se configuran al principio de `app.js` (`ALMACEN`, `POSICIONES`, `LETRAS`, `CATEGORIAS`, `FORMATOS`). Si se renombra un pasillo que ya tiene productos, hay que cambiar también esas ubicaciones en la hoja.
