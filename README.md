# GesFrío · Ubicaciones del almacén de congelados

Aplicación para el móvil que sirve para consultar el catálogo de productos y saber **en qué ubicación del almacén está cada uno**.
Funciona **100 % sin conexión** cuando ya está instalada. Todos los datos se guardan en el propio móvil. No hay servidor ni hay que iniciar sesión.

- **Ubicación** = Cámara (FRÍO, K, N, L, S) + Posición (1-20) + Letra (A, B, C). Por ejemplo: `K-12-B` o `FRÍO-3-A` (300 ubicaciones en total).
- Un producto puede estar en varias ubicaciones, y una ubicación puede tener varios productos.
- Al abrirla por primera vez trae **15 productos de ejemplo**.

## Funciones

| Sección | Qué hace |
|---|---|
| **Buscador** (arriba, siempre visible) | Busca mientras escribes, por nombre o por código, sin importar mayúsculas ni tildes (`lasana` encuentra «Lasaña»). Si escribes una ubicación (`k12b`, `frio 3 a`) te dice qué hay en ese hueco. |
| **Catálogo** | Lista de productos con sus ubicaciones en grande (amarillo). Filtros por cámara y por categoría. |
| **Ficha** | Al tocar un producto: todos sus datos y ubicaciones. Desde aquí se **añade**, **mueve** o **quita** una ubicación, se editan los datos o se elimina el producto. Al tocar una ubicación se abre la cámara con ese hueco resaltado. |
| **Cámaras** | Eliges cámara y ves la cuadrícula de 20 posiciones × 3 letras: azul = ocupado, gris = vacío. Al tocar un hueco ves qué contiene y puedes poner, mover o quitar productos. |
| **Nuevo** | Alta de un producto (nombre, código, categoría, formato y notas). Después se le asignan las ubicaciones. |
| **Copia** | Exportar e importar (JSON o CSV de Excel), plantilla CSV, cargar ejemplo, borrar todo e información de la app. |

Todo lo que se borra pide confirmación antes. El botón «Atrás» de Android cierra la ventana abierta.

---

## 1. Publicar la app (solo una vez, la hace quien gestiona la app)

Una PWA tiene que abrirse **una vez** desde una dirección `https://` para que el móvil la pueda instalar y guardar. Después ya no necesita internet.
Son archivos estáticos (`index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest` y la carpeta `icons/`), así que sirve cualquier alojamiento web gratuito. Elige una opción:

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
- **Guardar dónde se deja un palé:** toca el producto → **＋ Añadir ubicación** → elige Cámara, Posición y Letra → **Guardar ubicación**. Debajo de la ubicación elegida se ve si el hueco está vacío o qué contiene. Los números con un punto azul tienen algo en esa posición.
- **Mover un palé:** en la ficha, **Mover** junto a la ubicación, y eliges la nueva.
- **Ver una cámara:** pestaña **Cámaras**, elige la cámara y desliza la cuadrícula a los lados. Toca un hueco para ver o cambiar su contenido.

## 4. Copias de seguridad y paso de datos entre móviles

Los datos solo existen en el móvil donde se introducen. **Exporta una copia de vez en cuando**. La app muestra la fecha de la última copia en **Copia → Aplicación**.

- **Exportar copia (JSON):** guarda todo. En el móvil puedes elegir **Compartir** (WhatsApp, correo, Drive, Bluetooth…) o **Guardar en el móvil**.
- **Pasar a otro móvil:** envía ese archivo al otro móvil, abre GesFrío → **Copia → Importar archivo** y elige:
  - **Combinar:** añade productos nuevos y actualiza los que tengan el mismo código. No borra productos.
  - **Reemplazar todo:** deja el catálogo exactamente igual que el del archivo.
- **Exportar para Excel (CSV):** abre bien en Excel en español (separado por `;` y con tildes).

### Cargar el catálogo inicial desde Excel
1. **Copia → Descargar plantilla CSV** y ábrela en Excel. Si lo prefieres, crea una hoja con estas columnas en la primera fila:

   | codigo | nombre | categoria | formato | ubicaciones | notas |
   |---|---|---|---|---|---|
   | PES-001 | Merluza en rodajas | Pescado | Caja | FRÍO-1-A, K-4-B | |

2. Pon varias ubicaciones en la misma celda separadas por comas (`K-12-B, FRÍO-3-A`). También vale **una fila por ubicación** repitiendo el mismo código: la app las junta en un solo producto.
3. Formas alternativas que también entiende la app:
   - Nombres de columna: `referencia`/`ref`, `producto`/`descripción`, `familia`, `observaciones`.
   - Columnas separadas **cámara**, **posición** y **letra** en lugar de `ubicaciones`.
   - Ubicaciones escritas como `frio 3 a`, `K12B` o `k-12-b`.
4. En Excel: **Archivo → Guardar como → «CSV UTF-8 (delimitado por comas)»**.
5. Pasa el archivo al móvil e impórtalo en **Copia → Importar archivo**. Antes de aplicar nada, la app te dice cuántos productos ha leído y avisa de las ubicaciones que no son válidas.

## 5. Para desarrolladores

- Sin dependencias ni compilación: HTML, CSS y JavaScript normales.
- `app.js`: toda la lógica (IndexedDB, buscador, vistas, importar y exportar).
- `sw.js`: service worker que guarda la app en caché («primero caché») para que arranque al instante sin cobertura.
- Datos: base IndexedDB `gesfrio`, almacén `productos` (`{id, nombre, codigo, categoria, formato, notas, ubicaciones[], actualizado}`). La app pide al navegador almacenamiento persistente para que no borre los datos.
- **Al publicar una versión nueva**, cambia `VERSION` en `sw.js`. Los móviles la descargan la próxima vez que abran la app con internet y la usan a partir de la siguiente apertura. Los datos no se tocan.
- Las categorías, los formatos y el número de cámaras y posiciones se configuran al principio de `app.js` (`CAMARAS`, `POSICIONES`, `LETRAS`, `CATEGORIAS`, `FORMATOS`).
