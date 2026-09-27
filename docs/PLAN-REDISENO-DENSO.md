# Plan: GUDS denso, tipo sistema de gestión (SAP/Fiori) + buscador global

> 2026-09-27. Objetivo pedido: priorizar datos, tablas y pantallas compactas, todas las funciones a la vista y un
> buscador global en el header (ventana emergente) para encontrar cualquier registro de la base.

## 1. Diagnóstico (medido con Playwright a 1440×900, empresa GUDS)

| Pantalla | Filas visibles sin scroll | Alto de fila | La tabla empieza en |
|---|---|---|---|
| Órdenes | 12 | 55 px | 153 px |
| Clientes | 7 | 69 px | 263 px |
| Productos | 8 | 73 px | 263 px |
| Inventario | 9 | 55 px | 335 px |
| Transferencias | 7 | 73 px | 331 px |
| Proveedores | 8 | 69 px | 255 px |
| Cuentas por cobrar | 5 | 93 px | 417 px |
| Cuentas por pagar | 6 | 53 px | 385 px |
| Facturas | 10 | 55 px | 255 px |
| Bancos | 4 | 85 px | 528 px |
| Delivery | 7 | 73 px | 287 px |
| Config. usuarios | 5 | 73 px | 429 px |
| Ficha de cliente | — | — | página de 4.660 px de alto |

Causas: celdas con `p-4` y encabezado `h-12` (fila mínima 53 px), avatares y dos líneas por celda, tarjetas de estadística
de 86–140 px por encima de cada lista, barra de búsqueda y botones en una fila aparte, títulos y tarjetas con mucho aire,
fichas de detalle en tarjetas grandes de 2 columnas, sidebar con ítems de 44 px. El campo "Buscar…" del header no busca.

**Meta:** ≥ 20 filas visibles a 1440×900 en todas las listas, fila ≤ 32 px, la tabla empieza ≤ 170 px, fichas de
detalle en una pantalla (≤ 1,5 alturas de pantalla), todo lo accionable visible sin abrir menús.

## 2. Principios de diseño
1. **Densidad compacta por defecto** (texto base de datos 13 px, etiquetas 11 px, números tabulares). Opción de
   densidad "cómoda" por usuario (se guarda en el navegador) para quien la prefiera.
2. **Una sola franja de indicadores** (KPI strip) por lista: 4–8 cifras en 44 px de alto en lugar de tarjetas grandes.
3. **Barra de herramientas por lista** en una fila: búsqueda, filtros rápidos (chips), agrupar, columnas, exportar
   CSV, acciones (nuevo, etc.) y contador de registros.
4. **Tablas de datos**: fila de 30 px, una línea por celda (lo secundario en tooltip o columna propia), cebra suave,
   encabezado fijo, ordenar al pulsar el encabezado, números alineados a la derecha con dígitos tabulares, estado como
   distintivo pequeño, acciones como iconos de 28 px, selección de columnas visibles, 50 filas por página por defecto.
5. **Fichas de detalle** como en SAP: cabecera de 1–2 líneas (número, estado, datos clave, acciones), rejilla de
   campos etiqueta/valor en 4–6 columnas y pestañas para las secciones (líneas, pagos, documentos, historial).
6. **Marco compacto**: header de 48 px, sidebar con ítems de 32 px y secciones plegables, contenido con márgenes de
   16 px, pestañas y botones de 32 px.
7. **Todo a la vista**: acciones frecuentes en la barra, no escondidas en menús; enlaces entre documentos siempre
   visibles (cliente → órdenes → facturas → pagos).

## 3. Buscador global (header, Ctrl/⌘ + K)
- Ventana emergente (cmdk) que se abre al pulsar el campo del header o Ctrl/⌘+K.
- Busca a la vez en: clientes (nombre, RIF, código), contactos, proveedores, productos (nombre, SKU), órdenes de venta
  (número, cliente), facturas y NC/ND (número, nº de control, referencia), cobros y reintegros, facturas y pagos de
  proveedor, órdenes de compra, retenciones (comprobante), lotes y series, transferencias, almacenes, bancos, vendedores.
- Función en la base `buscar_global(q, limite)` con `security invoker`: respeta los permisos del usuario y la empresa
  activa (RLS). Índices trigram (`pg_trgm`) en los campos de búsqueda para responder en < 300 ms.
- Resultados agrupados por tipo, con icono, título, subtítulo (cliente, monto, fecha, estado) y enlace directo;
  navegación con teclado; búsquedas recientes; accesos directos a módulos ("ir a…") cuando el texto coincide con un módulo.

## 4. Fases de ejecución

### Fase A — Base visual (impacta todas las pantallas)
- [x] `table.tsx`: modo compacto por defecto (celda `px-2 py-1`, encabezado `h-8`, texto 13 px, `tabular-nums`,
      cebra, alto máx. del contenedor según la pantalla).
- [x] Densidad global: tokens de tamaño en `index.css` + clase `densidad-comoda` opcional en `<html>`.
- [x] `KpiStrip` (franja de indicadores) y `BarraLista` (barra de herramientas de lista).
- [x] `FichaCampos` (rejilla etiqueta/valor) y `CabeceraDocumento` (cabecera compacta de fichas).
- [x] `Badge` tamaño xs, `Tabs` compactas, `DataTablePagination` en una línea con 50 filas por defecto.
- [x] Header 48 px, sidebar compacto (ítems 32 px), márgenes del contenido 16 px.
- [x] Selector de densidad (compacta / cómoda) en el menú del usuario.

### Fase B — Buscador global
- [x] Migración: `pg_trgm` + índices trigram + función `buscar_global`.
- [x] Componente `BuscadorGlobal` (cmdk) en el header de administración (escritorio y móvil).
- [x] Atajo Ctrl/⌘+K, resultados agrupados, recientes, "ir a módulo".

### Fase C — Módulos (listas)
Cada lista: KPI strip + barra de herramientas + tabla compacta de una línea + 50 filas por página.
- [x] Ventas: Órdenes, Clientes, Vendedores, Registros (aprobar/rechazar como iconos visibles).
- [x] Catálogo: Productos, Categorías (de tarjetas a tabla), Precios (de tarjetas a tabla), Cupones, Banners
      (vista previa del portal movida debajo de la lista).
- [x] Inventario: Inventario (stock / por almacén / lotes / movimientos), Almacenes, Transferencias, Consignación.
- [x] Compras: Proveedores, Cuentas por pagar.
- [x] Finanzas: Cuentas, Cuentas por cobrar, Facturas, Notas de crédito, Cobros (Pagos), Retenciones, Bancos
      (depósitos por identificar debajo de la lista), Conciliación.
- [x] Logística: Delivery.
- [x] Configuración: Usuarios (tabla de roles) y resto de pantallas compactadas.
- [x] Pestañas dentro de la barra de herramientas (`BarraLista pestanas=…`): una sola fila con pestañas, búsqueda,
      filtros y acciones en Cuentas por cobrar/pagar, Cuentas, Transferencias, Retenciones, Vendedores, Delivery,
      Inventario y ficha de Banco. Una sola instancia de la barra por página (no se pierde el foco al cambiar de pestaña).
- [x] Celdas con botones o interruptores con menos relleno vertical (`has-[button]`), botones `sm` de 32 px.

### Fase D — Módulos (fichas de detalle)
Cabecera compacta + rejilla de campos + pestañas.
- [x] Cliente (de 4.660 px a ~965 px: cabecera + franja de KPIs + ficha + pestañas), Contactos y portal, Vendedor,
      Cuenta del cliente, Factura, Factura de proveedor, Proveedor, Almacén, Transferencia, Lote, Banco (cabecera en una
      línea + franja de KPIs + barra con pestañas; la tabla pasa de 470 px a ~255–295 px), detalle de Orden (hoja lateral).

### Fase E — Dashboard y torre de control
- [x] Dashboard: dos franjas de KPIs (ventas/cobranza y operación: por pagar, bancos USD/Bs, entregas listas, sin
      disponible, lotes vencidos), órdenes recientes, mejores clientes y acciones pendientes en una sola pantalla.
- [ ] Torre de control: lista compacta de colas con conteos.

### Fase F — Funciones de tabla
- [x] Ordenar por columna y exportar CSV de lo filtrado en Clientes, Productos, Transferencias, Facturas, Notas de
      crédito y Proveedores (`useOrdenTabla`, `EncabezadoOrdenable`, `exportarCSV`).
- [x] Extendido a Órdenes (fecha real del pedido), Inventario (stock), Cuentas por cobrar y por pagar (antigüedad por
      cliente/proveedor; el botón exportar aparece en la pestaña de antigüedad).
- [x] Pagos: búsqueda (número, cliente, referencia, orden), orden por columna y exportación.
- [x] Columnas visibles (`useColumnas`, `src/components/datos/columnas.tsx`): botón en la barra de 11 listas (Órdenes,
      Clientes, Productos, Facturas, NC, Proveedores, Transferencias, Inventario, antigüedad CxC/CxP, Pagos); oculta por
      CSS sin tocar las celdas y se recuerda en el navegador.
- [ ] Filtros rápidos por estado/fecha como chips en la barra.

### Portales (vendedor, cliente, delivery)
Se mantienen orientados a móvil (táctiles).
- [x] Portal del vendedor compacto: marco (sidebar 224 px, header 48 px), dashboard, Mis clientes, Pedidos, Pagos e
      Inventario con franja de KPIs, barra y filas de una línea; el inventario muestra el **disponible** para vender.
- [x] Buscador del vendedor: `buscar_global(q, limite, 'vendedor')` (migración 18s) devuelve enlaces `/vendedor/...?q=`
      y omite proveedores, compras, bancos, transferencias y almacenes; sus páginas aceptan `?q=`.

## 5. Resultado medido (1440×900, empresa GUDS, 27-sep)

| Pantalla | Filas visibles | Alto de fila | La tabla empieza en |
|---|---|---|---|
| Órdenes | 12 → **23** | 55 → **33 px** | 153 → **105 px** |
| Clientes | 7 → **21** | 69 → **33 px** | 263 → **168 px** |
| Productos | 8 → **21** | 73 → **33 px** | 263 → **168 px** |
| Inventario | 9 → **21** | 55 → **33 px** | 335 → **181 px** |
| Transferencias | 7 → **21** | 73 → **33 px** | 331 → **168 px** |
| Proveedores | 8 → **21** | 69 → **33 px** | 255 → **168 px** |
| Cuentas por cobrar | 5 → **19** | 93 → **33 px** | 417 → **240 px** (franja de antigüedad) |
| Cuentas por pagar | 6 → **21** | 53 → **30 px** | 385 → **226 px** (franja de antigüedad) |
| Facturas | 10 → **21** | 55 → **33 px** | 255 → **168 px** |
| Bancos | 4 → **15** (todas) | 85 → **33 px** | 528 → **181 px** |
| Delivery | 7 → **21** | 73 → **33 px** | 287 → **168 px** |
| Config. usuarios | 5 → **19** | 73 → **33 px** | 429 → **232 px** |

**Buscador global:** responde en 80–95 ms en la base (antes 2,2 s). El cuello de botella eran las políticas RLS que
llamaban `puede()`/`auth.uid()` por fila; la migración 18r las envuelve en `(select …)` (se evalúan una vez por
consulta). Esto acelera también todas las listas (p. ej. facturas: 585 ms → 11 ms de evaluación de permisos).
`probar-multiempresa.mjs` vigila que ninguna política nueva vuelva a llamar esas funciones por fila.

**Flancos corregidos durante el rediseño:**
- Inventario mostraba servicios e inactivos (283 filas, "Agotados 197"); ahora, como el inventario de Odoo, solo
  almacenables activos por defecto (105, agotados reales 26) con la franja "Servicios e inactivos" para verlos; los
  servicios salen como "Servicio", no "Agotado". Mismo criterio en los KPIs de Productos, dashboard y torre de control.
- Buscador: al buscar otra vez, Enter no abría nada (cmdk conservaba la selección anterior) → selección controlada.

## 6. Verificación de cada fase
- Medición automática (Playwright, 1440×900): filas visibles, alto de fila, posición de la tabla, alto de fichas.
- Recorrido completo sin errores de consola/red en ambas empresas; móvil 390 px sin desborde.
- Buscador: cada tipo de registro encontrable por su número/nombre; respuesta < 300 ms; respeta empresa y permisos.
