# Plan: portales y flujos de una distribuidora de alto nivel

> 2026-09-28. Pedido del dueño: rediseñar el front para una **distribuidora de alto nivel**; revisar el flujo completo del
> **cliente** (pedido, favoritos, órdenes, facturas, deuda, formas de pago, declarar pagos; móvil primero y escritorio), del
> **vendedor** (venta, clientes y deudas, reporte de cobros), de **delivery** (documentos de entrega de Odoo, mapa, foto y firma,
> entrega incompleta con motivo, rechazo, reprogramación) y del módulo de **reportes** frente al Excel que usaban.
> Reglas nuevas: **todo pedido de cliente o vendedor queda pendiente de aprobar en el admin; al aprobarlo se crea en Odoo** como
> cotización en borrador; el **envío va como línea de servicio**. Prohibido borrar en Odoo.
>
> Investigación hecha con 4 agentes en paralelo (Playwright en 390×844 y 1440×900, lectura del código y consultas de solo
> lectura). Los informes detallados (con archivo:línea, capturas y mediciones) están en `docs/privado/planes/`, **fuera de git**
> porque el repositorio es público y contienen nombres de clientes, vendedores y montos.

## 1. Ya resuelto en esta sesión (28-sep)

| Área | Qué | Migración / archivo |
|---|---|---|
| Pedidos → Odoo | Aprobación en el admin: pedidos de cliente y vendedor nacen **por aprobar**; aprobar crea la cotización en Odoo (pg_net → `sync-odoo?enviar=`); rechazar con motivo libera stock y avisa; reintento automático y manual | 19g, 19h, `enviar.js`, `Ordenes.tsx` |
| Pedidos → Odoo | Envío de GUDS como **línea de servicio** (código configurable en Políticas de venta); sin producto en Odoo va como nota | 19g, `PoliticasVenta.tsx` |
| Seguridad vendedor | El rol Vendedor veía **todas** las órdenes y clientes de la empresa y podía editarlos por REST → solo su cartera | 19j |
| Seguridad aprobación | Nadie que no sea administración puede fijar/cambiar la aprobación ni los datos de envío a Odoo (triggers); el envío exige aprobador | 19j |
| Seguridad delivery | El rol Delivery leía **todas** las órdenes y podía modificar cualquier entrega → solo sus entregas, cierre por función con validaciones | 19i |
| Almacenamiento | En el bucket público `imagenes` **cualquier usuario con sesión podía borrar o reemplazar** fotos de productos y banners → solo administración (cada usuario su avatar) | 19i |
| Evidencias | Firma y foto de entrega en bucket **privado** `evidencias-entrega`; la foto se comprime; **sin evidencia no se cierra** la entrega | 19i, `DeliveryEntregas.tsx` |
| Seguridad cliente | Un cliente podía insertar por REST pedidos y **pagos ya "verificados"** → solo por las funciones del servidor | 19k |
| Precios | Un empaque sin precio propio ("Caja ×12") se cobraba al precio de **1 unidad** y a Odoo llegaba precio/12 → ahora `precio_base × unidades` (como Odoo, precio por unidad) | 19k |
| Cuentas bancarias | **Cualquier usuario con sesión (clientes, vendedores, repartidores) leía la tabla de bancos completa, con los saldos de Odoo y del extracto** → solo administración; clientes y vendedores ven la vista `cuentas_pago`. Número, banco, titular y RIF ahora vienen de Odoo; pago móvil y Zelle se cargan en Bancos; se desactivaron 2 cuentas de maqueta | 19l, importador, `Bancos.tsx` |
| Acceso | Dominio `portal.guds-supply.com`, correos de acceso en español, página para restablecer la contraseña (antes el enlace no pedía clave nueva) | Configuración de Auth, `RestablecerClave.tsx` |
| Funciones del servidor | **Sin sesión se podía aprobar un registro de cliente (y recibir la contraseña) y crear cuentas de acceso**; funciones internas (aplicar pagos a facturas, notificaciones) abiertas a cualquiera → cerradas | 19q |
| Reportes | Facturas anuladas por completo con su NC ya no cuentan como venta (R8a) | 19o, `Reportes.tsx` |

Verificado: 88 pruebas de base (`scripts/probar-multiempresa.mjs`), e2e de aprobación, del portal del vendedor y humo de los
portales del cliente y de delivery. **En Odoo sigue existiendo una sola cotización de GUDS (S00927).**

### Avance al 28-sep (noche)

Hecho: F0 (portal cliente), V0 (vendedor), D0, **D1 + D4 + D7** (cola con los documentos de entrega y las reposiciones a
consignación de Odoo, asignación a repartidor, app con los 4 cierres, escritura del estado a Odoo en modo simulación hasta el
piloto), R8a (reversos), edición de pedidos pendientes con recálculo de cupón y pago, empresas del cliente en el portal,
cuentas de pago desde Odoo, edición de dirección y teléfonos del cliente escrita en Odoo (activa), facturas sin borrado con
historial, correo por Resend, dominio propio y limpieza de Lovable, y la **etapa 2** (IVA de cada producto desde Odoo, cotización
en el servidor, listas de precios sincronizadas), **F1** (portal del cliente responsive), **F4/V1** (línea de tiempo y
detalle del pedido), los **avisos desde Odoo**, **D2–D3** (ubicaciones, mapa y rutas), **R1** (histórico de Profit en
reportes) y **R3–R6** (costo promedio de Odoo visible solo para administración, motor de reporte tipo cubo con subtotales y
filtros cruzados, pestaña **Análisis** con las vistas del Excel y exportación del análisis y del detalle de líneas con las
columnas de "Base datos"; migraciones 20j) y **F2** (catálogo paginado y ficha de producto), **F5–F6** (estado de cuenta, facturas, cuenta) y **V2–V5** (venta rápida,
ficha y cartera, cobro con comprobante y propuesta, "Hoy" y metas), **D6/D8** (seguimiento del repartidor, incidencias,
devoluciones por almacén, indicadores y cuadre con Odoo), **R2/R7/R8b** (clasificación comercial, comparativos, metas y
calidad y cuadre) y **F7** (accesibilidad WCAG 2.2 AA; rendimiento móvil 82–87). Descartado por decisión: instalar como aplicación
(PWA de V6) y el modo sin señal (D5); todo queda en línea. Fotos y descripciones de producto bidireccionales con Odoo (decisión 15,
migración 20r) también están hechas, y el rendimiento móvil de los portales quedó en 90–95 (29-sep).
Siguiente: piloto de entregas en Odoo.

## 2. Principios comunes (los tres portales)

1. **Confianza primero**: cada cifra coincide con el admin y con Odoo; nada inventado (hoy hay datos bancarios y de contacto
   de maqueta en el portal del cliente). Si no hay dato, estado vacío honesto.
2. **Un solo contrato de estados del pedido** para admin, vendedor y cliente (tabla §3), alimentado por `aprobacion`,
   `estado`, `estado_odoo`, despachos, factura y pago.
3. **Mobile first, escritorio de verdad**: pila en móvil; en escritorio barra lateral + contenido ancho + panel de resumen
   (hoy el portal del cliente es un teléfono de 448 px centrado en 1440 px).
4. **Sobriedad premium**: neutros cálidos, un acento de marca por empresa (GUDS / Quirutec), cifras tabulares, fotos reales o
   placeholder de marca (nunca emojis), microcopias honestas ("te avisaremos…", no "entrega mañana 9–1" fijo).
5. **El servidor calcula el dinero**: precios, impuestos, envío y totales salen de funciones del servidor; el navegador solo
   muestra (hoy el total que ve el vendedor no es el que guarda el servidor).
6. **Rendimiento**: código separado por portal (hoy un único JS de 2,5 MB), catálogo paginado desde el servidor, refresco
   silencioso sin perder la posición.
7. **Todo verificado con Playwright** en móvil y escritorio y con SQL (regla del proyecto).

## 3. Contrato de estados del pedido

| Estado visible | Regla (en orden) | Cliente | Vendedor | Admin |
|---|---|---|---|---|
| Rechazado | `aprobacion='rechazada'` | con motivo y "volver a pedir" | con motivo, "duplicar y corregir" | con motivo |
| Cancelado | `estado='cancelado'` | ✓ | ✓ | ✓ |
| Pendiente de aprobación | `aprobacion='pendiente'` | "lo estamos revisando" | ✓ | cola "Por aprobar" con aprobar/rechazar |
| Aprobado · en cotización | aprobada y (`odoo_id` nulo o `estado_odoo='draft'`) | "aprobado, registrándose" (sin error técnico) | ✓ (+ error si falla) | "Enviando a Odoo / Error + Reintentar" |
| Confirmado | `estado_odoo='sale'` sin despacho hecho | ✓ | ✓ | ✓ |
| En preparación / listo | despacho en espera / listo | ✓ | ✓ | ✓ |
| Despachado / en camino | despacho hecho o `estado='enviado'` | ✓ + fecha | ✓ | ✓ |
| Entregado (completo / parcial) | `estado='completado'` + resultado de delivery | ✓ + evidencia (si se decide) | ✓ | ✓ + evidencia |
| Pago (eje aparte) | pendiente / parcial / pagado | pill | pill | pill |

Número: "S00927 · antes GUDS-ORD-00001" (el buscador ya acepta ambos). Notificaciones de cambios que vienen de Odoo: hoy la
sincronización escribe sin triggers y **nadie se entera** de "confirmado/entregado/facturado" → la sincronización debe emitir
esas notificaciones (V1/F4).

## 4. Portal del cliente (F0–F7)

**Hallazgos clave**: no se puede **declarar un pago** (el botón queda fuera de la hoja, en móvil y escritorio); "Métodos de
pago" y "Ayuda" muestran **datos bancarios y contactos falsos**; "Por pagar" suma pedidos ya pagados (no hay facturas ni estado
de cuenta); declarar en Bs precarga el monto en USD; favoritos → "agregar al carrito" no guarda; no hay ficha de producto,
"ordenar" no hace nada, la búsqueda no encuentra por SKU ni sin acentos y el catálogo vuelve arriba cada 60 s; el checkout no
pide dirección y dice "¡Pedido confirmado!"; los pedidos cancelados/rechazados no aparecen en ninguna pestaña; el checkout
ofrece diarios contables de Odoo como cuentas de pago.

- **F0 · Bloqueantes (1–2 d)**: declarar pago usable (hoja con scroll, monto en la moneda del banco); retirar datos de maqueta
  (métodos de pago, ayuda, "entrega mañana", "envío gratis"); "Por pagar" desde facturas; favoritos al carrito real;
  pestaña "Cancelados y rechazados" con motivo; checkout con "Pendiente de aprobación" en lugar de "confirmado"; solo cuentas
  marcadas "recibe cobros".
- **F1 · Shell responsive y sistema visual (3–4 d)**: `PortalShell` (barra inferior en móvil, lateral en escritorio), tokens de
  estado, `EstadoPill`, `Monto`, carga por ruta.
- **F2 · Catálogo, ficha, favoritos, carrito (4–5 d)**: catálogo paginado en servidor con búsqueda por nombre/SKU/marca sin
  acentos, ficha de producto, empaques visibles con precio por empaque y por unidad, un único carrito.
- **F3 · Checkout (3–4 d)**: dirección de entrega, notas, OC, totales calculados en el servidor, pantalla de confirmación
  "Pendiente de aprobación".
- **F4 · Mis pedidos (2–3 d)**: línea de tiempo (§3), número GUDS y de Odoo, factura y despacho, "volver a pedir".
- **F5 · Finanzas (4–5 d)**: estado de cuenta con antigüedad (misma lógica que el admin), facturas y su detalle, "Cómo pagar"
  con **todas las cuentas bancarias** y sus datos completos traídos de Odoo (número, banco, titular, RIF; botón copiar), y
  asistente de declaración por factura: el cliente indica **a qué cuenta pagó**, método, monto, referencia y comprobante.
- **F6 · Cuenta (3–4 d)**: retenciones, consignación, empresa y ejecutivo de cuenta, contactos, direcciones, notificaciones reales.
- **F7 · Calidad (2–3 d)**: accesibilidad WCAG 2.2 AA, Lighthouse móvil ≥ 90, PWA.

## 5. Portal del vendedor (V0–V6)

**Hallazgos clave**: veía toda la empresa (**resuelto**); podía autoaprobar por API (**resuelto**); el total que ve al pedir no
es el que guarda el servidor (IVA 16 % fijo + envío; en Odoo el IVA efectivo es ~6,7 % por productos exentos); "registrar cobro"
usa un modelo viejo (aplica a órdenes "no pagadas" que ya lo están, sin facturas, sin comprobante ni fecha, con diarios
contables como destino); cartera sin antigüedad ni ficha de cliente; el pedido no abre detalle ni se notifica; en móvil el título
mide 5 px, total y estado quedan fuera de pantalla y el selector de 105 productos no busca; tres vendedores entran por defecto a
la empresa donde no tienen clientes.

- **V0 · Seguridad y cifras (resto)**: cifras con fuente única (`resumen_vendedor()`), empresa por defecto según su cartera,
  cuentas "de cobro", referencia obligatoria salvo efectivo.
- **V1 · Estado visible y notificado (2–3 d)**: `/vendedor/pedidos/:id` con línea de tiempo, tarjetas en móvil, notificaciones
  desde la sincronización, "duplicar y corregir".
- **V2 · Venta rápida (4–5 d)**: pedido en pantalla completa con búsqueda real, "lo que compra este cliente", total cotizado en
  el servidor, **impuesto por producto** desde Odoo, borrador que sobrevive a recargar, idempotencia.
- **V3 · Ficha del cliente y cartera (3–4 d)**: `/vendedor/clientes/:id`, `/vendedor/cartera` con antigüedad y prioridades,
  compartir estado de cuenta.
- **V4 · Cobro con evidencia (3–4 d)**: varias líneas (Bs/USD), tasa BCV por fecha, comprobante con cámara, asignación a facturas
  propuesta que el admin confirma.
- **V5 · "Hoy", metas y notificaciones (2–3 d)**. **V6 · Pulido móvil (2–3 d)**: header legible, menú completo, PWA.

## 6. Delivery (D0–D8)

**Hallazgos clave**: la cola del admin son **órdenes**, no los documentos de entrega de Odoo (incluye órdenes sin entrega
pendiente y cortes de consignación que no requieren transporte; deja fuera las reposiciones a consignación; excluye por número,
que se repite entre empresas); muestra la dirección **fiscal** y no la de entrega (13 de 18 entregas van a una sucursal); **0
clientes con coordenadas** y el importador borraría cualquier coordenada guardada en `clientes`; el mapa existente tiene datos de
prueba; no hay rutas, estados parcial/rechazado/reprogramado, motivos ni modo sin señal; en una ruta mixta habría que cambiar de
empresa en cada parada. El almacén valida en Odoo al despachar (la factura sale el mismo día), así que una entrega incompleta o
rechazada implica devolución y nota de crédito. Seguridad y evidencia: **resuelto** (§1).

- **D0 · Resto**: excluir por `orden_id` y no por número; "hoy" en hora de Caracas; quitar el mapa de prueba y mover el token a
  variable de entorno; vista de evidencias con URL firmadas en el admin.
- **D1 · Cola de despacho con los documentos de Odoo**: el importador trae dirección de entrega, referencia, fecha compromiso y
  cantidades preparadas (solo lectura); pestaña "Cola de despacho" por empresa.
- **D2 · Ubicaciones**: tabla propia `ubicaciones_entrega` (el sync no la toca), geocodificación como sugerencia en una función
  edge, pin confirmado por una persona o por el GPS de la entrega.
- **D3 · Rutas y asignación**: planificador con mapa y lista ordenable, hoja de ruta, notificación al repartidor.
- **D4 · App del repartidor con mapa y los 4 cierres**: entregado completo (foto + firma + receptor), **incompleto** (cantidad por
  producto + motivo), **rechazado** (foto + motivo), **reprogramado** (fecha + motivo); navegar con Google Maps/Waze; detalle con
  evidencias en el admin.
- **D5 · Sin señal**: PWA con bandeja de salida (IndexedDB), cierres sin duplicar al volver la señal.
- **D6 · Seguimiento e incidencias**: mapa en vivo, re-cola de reprogramadas, devoluciones confirmadas por almacén, KPIs.
- **D7 · Entregado en GUDS → entregado en Odoo** (decisión 28-sep): al cerrar la entrega en GUDS se valida el documento de
  entrega en Odoo con las cantidades entregadas (incompleta: solo lo entregado), se adjuntan foto y firma y se deja una nota
  "(GUDS)"; al reprogramar se cambia la fecha prevista. Si alguien lo valida directo en Odoo, la sincronización cierra la entrega
  en GUDS con la insignia **"Actualizado desde Odoo"**. Requiere usuario de API dedicado con permisos de Inventario, simulación
  y un piloto con un documento acordado. Nunca borrar; un rechazo deja el documento abierto para que administración decida.
- **D8 · Conciliación**: el sync compara lo validado en Odoo con el resultado de GUDS y marca discrepancias.

## 7. Reportes frente al Excel (R0–R8)

**Hallazgo principal**: el Excel **no sale de Odoo sino de Profit Plus** (el ERP anterior) y termina justo cuando empezó Odoo
(5–6 may-2026); GUDS tiene ventas de Odoo desde el 12/26-may-2026. **No hay ningún mes en ambas fuentes.** Donde tocan el mismo
documento (facturas pendientes al corte) cuadran (666 documentos, diferencia < 2 USD). La caché de las tablas dinámicas del Excel
guarda el historial completo dic-2020 → may-2026 (137 mil líneas) y se puede extraer. Faltan: costo y margen (el importador no
lee el costo de Odoo), vistas jerárquicas (Categoría > Línea > Sub-línea > Artículo; Vendedor > Cliente; Cliente > Categoría >
Artículo), matriz Año × Mes, filtros cruzados, dimensiones (línea, sub-línea, marca, tipo de cliente, canal, segmento) y exportar
el detalle. "Facturado" y "NC" están inflados por facturas erróneas revertidas con NC por el mismo monto.

- **R0 · Definiciones** (venta neta, costo, exclusiones, corte Profit→Odoo). **R8a · Neteo de reversos** (mejora rápida).
- **R1 · Histórico de Profit** (decisión 28-sep: **todo**, dic-2020 → may-2026) en una tabla aparte de solo lectura, con insignia
  **"Profit"** en cada reporte. Suma a todos los reportes de ventas; no entra en cuentas por cobrar, stock, pedidos ni en la
  sincronización con Odoo, que sigue siendo el sistema en operación.
- **R2 · Clasificación comercial** (dimensiones que faltan, en Odoo o en GUDS). **R3 · Costo y margen** (leer el costo de Odoo;
  proteger quién lo ve).
- **R4 · Motor tipo cubo** (agrupar por varios niveles con subtotales). **R5 · Pestaña "Análisis"** que reproduce las vistas del
  Excel. **R6 · Exportación** (mismas columnas del Excel). **R7 · Comparativos y metas**. **R8b · Calidad y conciliación**.

## 8. Orden de ejecución recomendado

| Etapa | Contenido | Por qué primero |
|---|---|---|
| 0 · Bloqueantes | F0, resto de V0 y D0, R8a, **datos bancarios desde Odoo**, **correo (SMTP) y URL del sitio** | Operaciones básicas rotas, datos falsos, cifras inconsistentes; sin correo los clientes no recuperan su clave |
| 1 · Estados y shell | Contrato de estados (§3) + F1, F4, V1 + notificaciones desde el sync + **sistema visual común** (admin, portales y login) | La aprobación ya está en producción: los tres portales deben mostrarla igual |
| 2 · Vender bien | F2, F3, V2 + **impuesto por producto y listas de precios desde Odoo** (común) | El total debe cuadrar con Odoo antes de más pedidos |
| 3 · Finanzas | F5, V3, V4 | Deuda, facturas y cobros con evidencia |
| 4 · Delivery | D1 → D4, D7 | Cola real de Odoo, ubicaciones, rutas, cierres con evidencia y entregado en Odoo |
| 5 · Analítica | R0, R1, R3, R4, R5 | Recuperar lo que daba el Excel (histórico + margen + vistas) |
| 6 · Madurez | F6, F7, V5, V6, D5, D6, D8, R2, R6–R8b | Sin señal, PWA, conciliación, clasificación y metas |

## 9. Decisiones del negocio

### 9.1 Tomadas (28-sep)

| # | Decisión | Qué implica (verificado en Odoo, solo lectura) |
|---|---|---|
| 1 | **Impuestos**: el IVA de cada producto viene de Odoo | Etapa 2: importar los impuestos de cada producto por empresa y calcular el impuesto por línea en el servidor; se elimina el 16 % fijo |
| 2 | **Listas de precios**: las de Odoo | Odoo tiene 4 listas (USD y Bs por empresa) **sin reglas**, y los 449 clientes de cada empresa usan la lista USD: hoy el precio de Odoo es el precio de lista del producto, el mismo que usa GUDS. El sync importará listas y reglas para aplicarlas en cuanto se carguen en Odoo |
| 3 | **Envío en pedidos del vendedor**: no, salvo que se estipule | Sin envío automático en pedidos del vendedor; el vendedor (o el admin al aprobar) puede agregar un cargo de envío, que viaja a Odoo como la misma línea de servicio |
| 4 | **Cuentas bancarias**: todas, con sus datos, para que el cliente pague y luego declare a cuál pagó | Los 18 diarios bancarios de Odoo tienen número de cuenta, banco y titular, pero el importador no los lee (en GUDS 0 de 18 tienen número). El sync los traerá y el portal los mostrará. Los diarios contables (saldos iniciales, cierre de anticipos) no se publican; lo que no está en Odoo (Zelle, pago móvil) se completa en Bancos |
| 5 | **Entrega**: se valida en GUDS al entregar y GUDS marca el documento como entregado en Odoo; si se valida en Odoo, el sync lo refleja como "Actualizado desde Odoo" | D7. Todos los almacenes son de 1 paso y 437 de 458 productos vendibles facturan **lo entregado**: al validar en la entrega, la factura sale después de entregar y una entrega incompleta factura solo lo entregado (sin nota de crédito). Ver 9.2 |
| 6 | **Histórico de Profit**: todo, con insignia "Profit", solo lectura | R1. Aporta a todos los reportes; no toca la operación con Odoo |

### 9.2 Tomadas (28-sep, segunda ronda)

| # | Decisión | Qué implica |
|---|---|---|
| 7 | **Dominio**: la plataforma pasa a `portal.guds-supply.com` | ✅ URL del sitio y redirecciones de acceso configuradas; correos de acceso en español; página `/restablecer-clave` (probada de punta a punta). El dominio de correo está verificado en el proveedor, pero **Supabase aún no tiene el SMTP** (falta la clave SMTP del proveedor) |
| 8 | **Pago móvil y Zelle**: pago móvil es la forma de pago de los bancos venezolanos (teléfono, cédula/RIF, código del banco); Zelle es un correo registrado en el banco de EE. UU. | ✅ 19l: campos en Bancos (admin → Bancos → editar), se ofrecen al cliente solo si la cuenta tiene sus datos |
| 9 | **Momento de facturar**: el almacén deja de validar al despachar; la factura sale tras la entrega | D7 |
| 10 | **Usuario de API dedicado** en Odoo (Ventas + Inventario) | Lo crea el administrador de Odoo; piloto con 1 documento antes de activar D7 |
| 11 | **Incompleta** → pendiente o no según el motivo; **rechazo** → administración decide en Odoo (GUDS no anula) | D4/D7 |
| 12 | **Precio por empaque** = precio por unidad × unidades (19k) | Confirmado |
| 13 | **Pago después de aprobado**; **crédito abierto** con aviso por deuda vencida > 30 días; aprobación el mismo día hábil | F3/F5, V2 |
| 14 | **Pedidos pendientes se pueden editar** (cliente y vendedor) mientras no estén aprobados | F4/V1: editar líneas y cantidades recalculando totales y stock comprometido en el servidor; el admin ve que fue editado |
| 15 | **Fotos y descripciones bidireccionales**: se editan en GUDS y se escriben en Odoo (y lo que cambie en Odoo llega a GUDS) | ✅ 20r: escritura en Odoo acotada a `product.template` (`image_1920` y `description_sale`) por la cola `odoo_escrituras` (tipo `producto`, modo `odoo_escritura_productos` = activo); el sync detecta cambios por el checksum del adjunto de la imagen y el md5 de la descripción y solo descarga las fotos que cambiaron; gana el cambio más reciente (fecha del cambio en GUDS contra el `write_date` de Odoo). Quitar la foto en GUDS no se envía (en Odoo borraría el adjunto). El historial "(GUDS)" queda en la cola de GUDS (en el chatter de Odoo haría falta `message_post`, fuera del alcance permitido). Se usa la API key actual, no un usuario dedicado |
| 16 | **Multiempresa del cliente**: el selector GUDS / Quirutec solo aparece si el cliente tiene habilitadas ambas empresas; se habilita desde la ficha del cliente en el admin | F1/F6 |
| 17 | **Mapas** con el token de Mapbox de la cuenta de GUDS (en variables de entorno, no en el código) | D0/D2; restringir el token por URL (`portal.guds-supply.com`) en Mapbox |
| 18 | Vendedor con efectivo, soporte por WhatsApp y ejecutivo de cuenta, cola de delivery (ventas + reposiciones a consignación, rutas mixtas), evidencia por resultado (24 meses), el cliente y el vendedor ven la evidencia, reportes (venta neta sin ND cambiarias, reversos neteados, NC financieras aparte, costo promedio solo para administración, clasificación en Odoo, mapeo de vendedores propuesto por GUDS, históricos solo con nombre y RIF, metas por vendedor y mes en USD) | Según la propuesta por defecto |

### 9.3 Pendiente

- **Limpieza de datos en Odoo antes de activar delivery** (explicada al dueño el 28-sep): documentos de entrega abiertos y
  viejos (24 "listos" y 45 "en espera" de más de 30 días, 6 borradores vacíos), direcciones de sucursal, 39 direcciones con
  basura `_x000D_` y 132 clientes sin teléfono válido. Decidido (28-sep): GUDS escribe direcciones y teléfonos en Odoo (activo),
  así que esas se corrigen desde la ficha del cliente; los documentos de entrega viejos se limpian en Odoo antes del piloto.
- **Cuenta "Banco Banesco USA" de GUDS en Odoo**: tiene el mismo número que Banesco en bolívares (configuración de Odoo); se
  dejó sin publicar hasta corregirla en Odoo.

## 10. Anexos (locales, fuera de git)

- `docs/privado/planes/plan-portal-cliente.md` — inventario, bugs con archivo:línea, rediseño y fases F0–F7.
- `docs/privado/planes/plan-portal-vendedor.md` — inventario, mediciones, rediseño y fases V0–V6.
- `docs/privado/planes/plan-delivery.md` — datos reales, modelo de datos propuesto, fases D0–D8.
- `docs/privado/planes/plan-reportes.md` — análisis del Excel, matriz de brechas, cruce de cifras, fases R0–R8.
