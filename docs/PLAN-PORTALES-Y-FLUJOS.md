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

Verificado: 88 pruebas de base (`scripts/probar-multiempresa.mjs`), e2e de aprobación, del portal del vendedor y humo de los
portales del cliente y de delivery. **En Odoo sigue existiendo una sola cotización de GUDS (S00927).**

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
  (cuentas oficiales con copiar), asistente de declaración por factura con varios métodos y comprobante.
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
- **D7 · Conciliación con Odoo (solo lectura)**: el sync compara lo validado en Odoo con el resultado de GUDS.
- **D8 · Escritura en Odoo (opcional, con aprobación explícita)**: notas/adjuntos en el documento o validación desde GUDS; nunca
  borrar.

## 7. Reportes frente al Excel (R0–R8)

**Hallazgo principal**: el Excel **no sale de Odoo sino de Profit Plus** (el ERP anterior) y termina justo cuando empezó Odoo
(5–6 may-2026); GUDS tiene ventas de Odoo desde el 12/26-may-2026. **No hay ningún mes en ambas fuentes.** Donde tocan el mismo
documento (facturas pendientes al corte) cuadran (666 documentos, diferencia < 2 USD). La caché de las tablas dinámicas del Excel
guarda el historial completo dic-2020 → may-2026 (137 mil líneas) y se puede extraer. Faltan: costo y margen (el importador no
lee el costo de Odoo), vistas jerárquicas (Categoría > Línea > Sub-línea > Artículo; Vendedor > Cliente; Cliente > Categoría >
Artículo), matriz Año × Mes, filtros cruzados, dimensiones (línea, sub-línea, marca, tipo de cliente, canal, segmento) y exportar
el detalle. "Facturado" y "NC" están inflados por facturas erróneas revertidas con NC por el mismo monto.

- **R0 · Definiciones** (venta neta, costo, exclusiones, corte Profit→Odoo). **R8a · Neteo de reversos** (mejora rápida).
- **R1 · Histórico de Profit** en `ventas_historicas` (desde la caché del Excel o una extracción de Profit).
- **R2 · Clasificación comercial** (dimensiones que faltan, en Odoo o en GUDS). **R3 · Costo y margen** (leer el costo de Odoo;
  proteger quién lo ve).
- **R4 · Motor tipo cubo** (agrupar por varios niveles con subtotales). **R5 · Pestaña "Análisis"** que reproduce las vistas del
  Excel. **R6 · Exportación** (mismas columnas del Excel). **R7 · Comparativos y metas**. **R8b · Calidad y conciliación**.

## 8. Orden de ejecución recomendado

| Etapa | Contenido | Por qué primero |
|---|---|---|
| 0 · Bloqueantes | F0, resto de V0 y D0, R8a | Operaciones básicas rotas, datos falsos, cifras inconsistentes |
| 1 · Estados y shell | Contrato de estados (§3) + F1, F4, V1 + notificaciones desde el sync | La aprobación ya está en producción: los tres portales deben mostrarla igual |
| 2 · Vender bien | F2, F3, V2 + **impuesto por producto desde Odoo** (común) | El total debe cuadrar con Odoo antes de más pedidos |
| 3 · Finanzas | F5, V3, V4 | Deuda, facturas y cobros con evidencia |
| 4 · Delivery | D1 → D4 | Cola real de Odoo, ubicaciones, rutas, cierres con evidencia |
| 5 · Analítica | R0, R1, R3, R4, R5 | Recuperar lo que daba el Excel (histórico + margen + vistas) |
| 6 · Madurez | F6, F7, V5, V6, D5–D8, R2, R6–R8b | Sin señal, PWA, escritura opcional en Odoo, clasificación y metas |

## 9. Decisiones que necesita el negocio (consolidadas)

**Precios, impuestos y envío**
1. Impuestos: ¿se sincroniza el IVA de cada producto desde Odoo? (recomendado; hoy GUDS aplica 16 % a todo).
2. Listas de precios: ¿se migran las de Odoo (por cliente, en Bs y USD) o GUDS vende a precio base y Odoo corrige al confirmar?
3. Envío: la decisión es línea de servicio; **contabilidad debe crear en Odoo el servicio "Envío"** (cuenta de ingresos + IVA) y
   configurar su código. ¿Aplican los $50 (< $500) a pedidos de vendedores B2B, o depende de zona/cliente?
4. Precio por empaque: se corrigió a `precio_base × unidades` (Odoo vende por unidad); confirmar que es la regla.

**Pedidos y crédito**
5. ¿El cliente paga antes o después de la aprobación? (propuesta: después, contra la cotización/factura).
6. Crédito: ¿sigue abierto (la aprobación manual es el control) o cupo por cliente? ¿Bloqueo o aviso con deuda vencida > N días?
7. SLA de aprobación; ¿el cliente/vendedor puede cancelar o editar mientras está pendiente?

**Cobros y datos**
8. Cuentas bancarias oficiales que se publican al cliente y cuáles reciben cobros (marcar `recibe_cobros`).
9. ¿El vendedor puede recibir efectivo? ¿Propone la aplicación a facturas? ¿Tasa BCV de la fecha del pago?
10. Fotos y descripciones del catálogo (hoy 2 de 105 productos con foto): ¿quién las carga o se traen de Odoo?
11. Multiempresa para el cliente: ¿dos tiendas con su marca o un portal con la empresa como filtro? Canal de soporte real.

**Delivery**
12. ¿Cuándo se valida en Odoo: al salir el camión o al confirmar la entrega? Qué entra en la cola; ¿rutas mixtas GUDS+Quirutec?
13. Mapas: Mapbox (mapas) + Google (sugerir coordenadas) + enlaces a Google Maps/Waze ≈ US$0/mes con el volumen actual
    (verificar tarifas). Evidencia obligatoria por resultado; ¿cédula del receptor? Retención de evidencias y paso a plan Pro.
14. Nivel de escritura en Odoo para entregas y con qué usuario API (propuesta: usuario dedicado, no la key personal que vence a
    los 90 días). Tratamiento de incompletas y rechazos (reintento o anulación + NC). Limpiar en Odoo las entregas "listas"
    viejas y las direcciones de sucursal.

**Reportes**
15. ¿Se importa el histórico de Profit y desde qué año? Definición de venta neta (ND, NC financieras, reversos).
16. Costo para el margen y quién lo ve; clasificación comercial (dónde se mantiene); mapeo de vendedores Profit → Odoo; metas.

## 10. Anexos (locales, fuera de git)

- `docs/privado/planes/plan-portal-cliente.md` — inventario, bugs con archivo:línea, rediseño y fases F0–F7.
- `docs/privado/planes/plan-portal-vendedor.md` — inventario, mediciones, rediseño y fases V0–V6.
- `docs/privado/planes/plan-delivery.md` — datos reales, modelo de datos propuesto, fases D0–D8.
- `docs/privado/planes/plan-reportes.md` — análisis del Excel, matriz de brechas, cruce de cifras, fases R0–R8.
