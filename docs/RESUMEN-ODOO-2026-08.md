# GUDS B2B Hub — Resumen de lo construido desde la conexión con Odoo

**Ventana cubierta:** 14 ago 2026 (fecha en que se resolvió el acceso a Odoo) → 18 ago 2026 (último commit, `7cd15b3`).
**Fases incluidas:** importaciones de Odoo + Fases 10 a 16.
**Proyecto Supabase (prod):** `oyyxkbwtyxdpzsgarmim` · **Producción:** `guds.store` (Netlify, repo `Boosty-Hub/guds-b2b-hub`).

> **Regla permanente de Odoo:** acceso de **solo lectura**, nunca escribir. Los `scripts/sync-odoo-*.mjs` leen credenciales de variables de entorno (`.env.local` + `ODOO_PG_*`), ambos fuera de git.
> Instancia: Odoo 18 de Corpo Eureka. Funcionan tanto la API HTTPS como PostgreSQL directo (5432).

---

## 1. Resumen ejecutivo

| Área | Qué había antes | Qué hay ahora |
|---|---|---|
| Datos | Maqueta con datos de ejemplo | 3.238 facturas, 1.165 órdenes, 432 clientes, 422 productos, 1.418 pagos y 493 retenciones reales de Odoo |
| Deuda | Calculada desde `ordenes` + `cuentas_cobrar` (números inconsistentes) | Calculada **solo** desde `facturas.saldo_usd` → **$1.084.362,94**, cuadrado contra Odoo con 5 centavos de diferencia |
| Adjudicación de cobros | FIFO automático por fecha | **Manual**: el admin elige factura(s) y monto por factura, más anticipos aplicables después |
| Pagos pendientes | 3 flujos sueltos (checkout, cliente, vendedor) | **Una sola cola** admin de verificación |
| Módulos | — | Facturas, Notas de Crédito, Consignación, Retenciones, Conciliación bancaria, Vendedores, Torre de Control |
| Seguridad | `almacenes`/`inventario_almacen` sin RLS; usuarios sin `rol_id` | RLS cerrado por rol; constraint que impide usuarios staff sin rol |
| Despliegue | 404 en toda ruta que no fuera `/` | `netlify.toml` versionado con fallback SPA |

**Volumen de código:** 22 archivos nuevos en `src/`, 2 scripts de sync nuevos (7 en total), 15 migraciones SQL nuevas, 1 edge function nueva.

---

## 2. Migración de datos desde Odoo

Siete scripts en `scripts/`, todos **idempotentes** (re-ejecutables sin duplicar, vía columnas `odoo_id` con índice único) y de **solo lectura** en Odoo.

| Script | Fuente en Odoo | Resultado en Supabase |
|---|---|---|
| `sync-odoo-catalogo.mjs` | `product_template` / `product_category` | 13 categorías + 422 productos |
| `sync-odoo-clientes.mjs` | `res_partner` (`customer_rank > 0`) | 432 clientes + campos nuevos (RIF, contribuyente especial, razón social, `vendedor_odoo`, `retiene_iva/islr`) |
| `sync-odoo-ordenes.mjs` | `sale_order` + `sale_order_line` | 1.165 órdenes + 6.352 líneas |
| `sync-odoo-almacenes.mjs` | `stock_warehouse` / `stock_quant` | almacenes propios + de consignación con `inventario_almacen` (consignación → cliente por match de nombre) |
| `sync-odoo-pagos.mjs` | `account_payment` | 1.418 recibos + bancos (1.387 transferencia + 31 tarjeta, según `pago_por_pv`) |
| `sync-odoo-facturas.mjs` | `account_move` (`out_invoice`/`out_refund`, `state='posted'`) + `account_move_line` (`display_type='product'`) | **3.238 facturas** (2.538 USD + 700 VES) + **8.757 líneas**; 1.444 con orden de origen resuelta |
| `sync-odoo-retenciones.mjs` | `account_wh_iva` (761) + `account_wh_islr` (182) | **493 retenciones de IVA** resueltas + 493 líneas |

### Vínculos resueltos en la migración

- `sale_id → ordenes.odoo_id` (coinciden 1:1)
- `partner_id` / `commercial_partner_id → clientes.odoo_id`
- `product_id → product_product.product_tmpl_id → productos.odoo_id`
- Monto USD de retenciones: calculado con el mismo factor `total_usd/total` de facturas (en Odoo vienen en la moneda del documento, no en USD)

### Hallazgos de datos importantes

1. **La dirección del ISLR es la contraria a la esperada.** Las 182 retenciones ISLR en Odoo son 100% de facturas de compra (`move_type='in_invoice'`): es GUDS reteniéndole a **sus proveedores**, no clientes reteniéndole a GUDS. No hay histórico del lado que interesa. El flujo hacia adelante se construyó igual (5 clientes están marcados como agentes de retención ISLR en Odoo), simplemente sin backlog.
2. **`estado_pago='anulado'` no implica saldo 0.** Hay 181 facturas "reversed" en Odoo con saldo real. El índice de deuda filtra por `estado='posted'`, no por estado de pago.
3. **Las notas de crédito deben restar.** El primer número de deuda ($887.091 de la Fase 10) las sumaba como deuda positiva. Con `amount_total_signed`/`amount_residual_signed` (ya en USD y con signo) quedó en $1.084.362,94.
4. **El import de clientes no dejó vendedor asignable.** Solo guardó el nombre como texto en `clientes.vendedor_odoo` (15 nombres distintos) → 0 de 432 clientes tenían `vendedor_asignado_id`, y el portal del vendedor y las RLS filtran por ese campo.

---

## 3. Cambio arquitectónico central: la deuda vive en las facturas

Las órdenes son el pedido comercial; la deuda real es el documento fiscal. Las Fases 10-11 movieron toda la contabilidad a `facturas`:

- **`facturas.saldo_odoo_usd`** — snapshot inmutable de Odoo (`amount_residual_signed`). **Solo el script de sync la escribe.**
- **`facturas.monto_aplicado_usd`** — **solo el trigger** `trg_pf_recalc` la escribe, desde `pago_facturas`.
- **`facturas.monto_retenido_usd`** — mantenida por `trg_recalc_factura_retenido` desde `retencion_items`.
- **`facturas.saldo_usd`** — columna **generada**: `round(saldo_odoo_usd − monto_aplicado_usd − monto_retenido_usd, 2)`. Al ser generada, **un re-sync de Odoo no puede pisar lo cobrado en GUDS**.
- **`facturas.estado_cobro`** — columna generada: `anulado` / `pagado` (|saldo| ≤ 0,01) / `parcial` / `pendiente`.

> Detalle técnico: no se puede alterar la expresión de una columna generada in-place. Al agregar las retenciones a la fórmula hubo que hacer `drop` + `add` de `saldo_usd` y `estado_cobro`.

### Deprecado en la Fase 11

| Objeto | Acción | Motivo |
|---|---|---|
| `registrar_cobro(...)` | `drop` | Reemplazado por `registrar_cobro_facturas` (asignación manual) |
| `ajustar_deuda_odoo(...)` | `drop` | Re-adjudicaba FIFO y habría desmentido las asignaciones manuales |
| `pago_ordenes` / `pago_cuentas` | solo lectura | Histórico |
| `ordenes.monto_pagado` / `estado_pago` / `pagado` | comentadas como deprecadas | La verdad está en `facturas` |

### Doble conteo evitado

Tanto `v_anticipos` como el trigger de retenciones **excluyen las filas con `odoo_id` no nulo**: el histórico de Odoo ya viene neteado en `saldo_odoo_usd`, así que volver a descontarlo duplicaría el crédito.

---

## 4. Módulos nuevos — detalle

### 4.1 Facturas y Notas de Crédito

**Rutas:** `/admin/facturas`, `/admin/facturas/:facturaId`, `/admin/notas-credito` · **Permiso:** módulo `cuentas`
**Archivos:** `src/pages/Facturas.tsx`, `FacturaDetalle.tsx`, `NotasCredito.tsx`
**Tablas:** `facturas`, `factura_items`

Funcionalidades:

- Listado paginado de facturas con número, cliente, fechas de emisión y vencimiento, moneda (USD/VES) + tasa, totales, saldo y estado de cobro.
- Detalle de factura: líneas (producto, cantidad, precio, descuento, subtotal/total), **nro. de control fiscal** venezolano, referencia, vendedor, orden de origen, **pagos aplicados** con el monto imputado a esa factura y **retenciones aplicadas**.
- `/admin/notas-credito` reusa `FacturaDetalle.tsx` filtrando `tipo='nota_credito'`.
- **Facturación interna desde una orden:** botón "Facturar" en el detalle de orden → RPC `facturar_orden(p_orden_id)`, numeración propia `F-000001…`, con bloqueo de doble facturación. Si la orden ya tiene factura, muestra el número y linkea al detalle.
- RLS igual que `pagos`/`ordenes`: admin por permiso de módulo `cuentas`, cliente ve solo las suyas, vendedor solo las de sus clientes asignados.

### 4.2 Estado de Cuentas y detalle por cliente

**Rutas:** `/admin/cuentas`, `/admin/cuentas/:clienteId` · **Archivos:** `Cuentas.tsx`, `CuentaDetalle.tsx` (nuevo)

- Deuda por cliente calculada desde `Σ facturas.saldo_usd`.
- Las filas de cliente ahora **navegan** a su detalle (antes eran estáticas).
- `CuentaDetalle.tsx`: facturas, notas de crédito, pagos del cliente con lo aplicado a cada factura, y sección de retenciones. Mismo patrón visual que `ClienteDetalle.tsx`.
- `recalcular_credito(p_cliente_id)` reescrita para leer `facturas.saldo_usd`; recalculada para los 432 clientes.

### 4.3 Cuentas por Cobrar — cobros manuales, verificación y anticipos

**Ruta:** `/admin/cuentas-por-cobrar` · **Archivos:** `CuentasPorCobrar.tsx`, `src/components/cuentas/SelectorFacturas.tsx` (nuevo)
**Tablas:** `pago_facturas` (puente pago↔factura), vista `v_anticipos`

- **`SelectorFacturas`** — componente compartido para elegir manualmente a qué facturas va un pago y cuánto a cada una. Reusado en tres lugares: "Registrar Cobro", "Verificar pago" y la pestaña "Anticipos".
- **Pestaña "Por verificar (N)"** con badge de conteo: pagos en estado `pendiente` con cliente, orden, método, referencia, monto y fecha. Diálogo de verificación con **"Ver comprobante"** (signed URL), asignación de banco opcional (registra el movimiento bancario), notas, y **Aprobar y adjudicar** / **Rechazar**.
- **Pestaña "Anticipos"** — pagos verificados con sobrante sin aplicar (`v_anticipos`), aplicables a facturas después vía `aplicar_anticipo(p_pago_id, p_asignaciones)`.
- Se eliminó el preview FIFO (`docsClienteFifo`/`previewAdjudicacion`) que ya no describe el comportamiento del backend.
- **RPCs:** `registrar_cobro_facturas(p_cliente_id, p_banco_id, p_monto_moneda, p_moneda, p_tasa, p_metodo, p_referencia, p_comprobante_url, p_notas, p_asignaciones)`, `verificar_pago(..., p_asignaciones jsonb)` (se conserva el wrapper de 5 args por compatibilidad), `aplicar_pago_a_facturas` (helper interno que valida cliente, saldo y monto).
- Todas las validaciones son transaccionales: monto > saldo de factura, o asignaciones > monto del pago, fallan **sin dejar nada escrito**.

### 4.4 Consignación — declaración de ventas (Fase 12)

**Rutas:** `/admin/consignacion`, `/portal/consignacion`, `/vendedor/consignacion`
**Archivos:** `Consignacion.tsx`, `portal/PortalConsignacion.tsx`, `vendedor/VendedorConsignacion.tsx`, `src/components/consignacion/DeclararVentaForm.tsx` (compartido por los 3)
**Tablas:** `declaraciones_consignacion`, `declaracion_consignacion_items`

Flujo completo:

1. **Cliente** (`/portal/consignacion`, con entrada desde "Mi Cuenta → Mis Compras") ve el stock de su almacén de consignación y declara cantidades vendidas por producto. **Vendedor** hace lo mismo con un selector de sus clientes con consignación. **Admin** también puede declarar.
2. **`declarar_venta_consignacion(p_almacen_id, p_items, p_notas)`** valida que el almacén sea de consignación, que quien llama tenga acceso (cliente dueño / vendedor asignado / admin) y que haya stock disponible por producto; calcula el precio con **`precio_efectivo()`** (la misma función del checkout, respeta la lista de precios del cliente) + IVA desde `configuracion`; notifica al admin con `notif_admins`. Queda en `pendiente`.
3. **`revisar_declaracion_consignacion(p_declaracion_id, p_aprobar, p_notas)`** (solo admin): al aprobar **re-valida el stock** (pudo cambiar), descuenta `inventario_almacen`, genera una **factura interna** (mismo patrón que `facturar_orden`, numeración `F-…`, `referencia` = número de la declaración) y notifica a cliente y vendedor. Al rechazar no toca nada.
4. Historial en el portal del cliente con link a la factura si fue aprobada.

**Admin:** tabs Pendientes / Aprobadas / Rechazadas + diálogo de detalle con items y botones "Aprobar y facturar" / "Rechazar".
**RLS:** las declaraciones solo permiten `SELECT` propio a cliente/vendedor; **no hay INSERT directo**, todo pasa por RPC.

### 4.5 Retenciones IVA/ISLR (Fase 13)

**Rutas:** `/admin/retenciones`, `/portal/retenciones`, `/vendedor/retenciones`
**Archivos:** `Retenciones.tsx`, `portal/PortalRetenciones.tsx`, `vendedor/VendedorRetenciones.tsx`, `src/components/retenciones/DeclararRetencionForm.tsx` (compartido)
**Tablas:** `retenciones`, `retencion_items`, `conceptos_retencion_islr`

- **Contexto fiscal:** GUDS es el sujeto **retenido** — sus clientes le retienen IVA/ISLR al pagarle una factura. En Odoo el comprobante de retención se reconcilia contra la factura como si fuera un pago.
- **`conceptos_retencion_islr`**: 8 conceptos reales del SENIAT (Honorarios, Comisiones, Fletes, Publicidad, Arrendamiento, etc.) con la tasa vigente 2026 para persona jurídica domiciliada, tomados de `account_withholding_concept` / `account_withholding_rate_table_line`.
- **Asignación multi-factura**: `retencion_items` es un puente (mismo patrón que `pago_facturas`) y el formulario reusa **`SelectorFacturas`** de la Fase 11 para repartir el monto retenido entre varias facturas.
- **`declarar_retencion(p_cliente_id, p_tipo, p_items, p_concepto_islr_id, p_comprobante_url, p_numero, p_fecha, p_notas)`**: si la declara un cliente o vendedor queda `pendiente`; si la declara el admin se **auto-aprueba**. El cliente puede subir el comprobante.
- **`revisar_retencion(p_retencion_id, p_aprobar, p_notas)`** (admin): re-valida el saldo al aprobar.
- **`clientes.retiene_iva` / `retiene_islr`** (nuevas): migradas de `res_partner.apply_third_party_retention_iva/islr` — 5 clientes reales matchearon, incluye FARMATODO.
- Secciones "Retenciones aplicadas" agregadas a `FacturaDetalle.tsx` y `CuentaDetalle.tsx`.
- **Fix posterior (18 ago, commit `7cd15b3`):** el módulo mostraba 0 en las tres pestañas porque filtraba `.is("odoo_id", null)`. Se quitó el filtro y se agregó una columna **"Origen"** con badge Odoo/Sistema. Las 493 migradas aparecen en "Aprobadas", sin botones de acción.

### 4.6 Conciliación bancaria con sugerencias de IA (Fase 14A)

**Ruta:** `/admin/conciliacion` · **Permiso:** módulo `bancos` · **Archivo:** `Conciliacion.tsx`
**Tablas:** `extractos_bancarios`, `extracto_lineas` · **Edge function:** `conciliar-ia-sugerir`

Se investigó primero cómo lo hace Odoo (`account.reconcile.model`: reglas simples de texto/monto/tercero, sin IA, casi no usadas para cobros de clientes en esta instancia) y se construyó algo distinto: **matching determinístico + IA solo para lo ambiguo, y la IA nunca decide sola.**

- **Carga en 2 pasos:** elegir banco + archivo (CSV/Excel), luego **mapear columnas** (fecha / monto / referencia / descripción) con dropdowns y preview — cada banco exporta con columnas distintas.
- **`crear_extracto_bancario`**: inserta el header del lote + las líneas desde el JSON ya parseado en el navegador.
- **`conciliar_extracto_automatico(p_extracto_id)`**: para cada línea pendiente busca en `movimientos_bancarios` del mismo banco y signo con tolerancia estricta (**±0,01 de monto, ±3 días de fecha**) y solo concilia si hay **un único candidato**. La ambigüedad nunca se resuelve sola.
- **IA (`conciliar-ia-sugerir`)**: para lo que el matcher estricto no resolvió, junta candidatos con ventana ampliada (**±15 días, monto 0,5×–1,5×**) y le pide a Claude (`claude-haiku-4-5`) el mejor candidato + motivo + confianza. **Solo escribe `sugerencia_ia` (jsonb), nunca cambia `estado`** — el admin aprueba desde la UI con `aplicar_sugerencia_ia`.
- **RPCs de resolución:** `confirmar_match_extracto(p_linea_id, p_movimiento_id)` (manual), `aplicar_sugerencia_ia(p_linea_id)`, `descartar_linea_extracto(p_linea_id, p_notas)`.
- **Índice único en `movimiento_bancario_id`**: un movimiento no se puede conciliar dos veces.
- Detalle de extracto con tabs Por conciliar (badge de sugerencia IA + botones Aplicar / Buscar manual / Descartar) / Conciliadas / Descartadas. La búsqueda manual abre un diálogo con los movimientos sin conciliar del mismo banco.
- **Gotcha resuelto:** la librería `xlsx` interpreta "11/08/2026" en formato inglés (mes/día) incluso con `raw:true`, corriendo las fechas día/mes (quedaba 2026-11-08 en vez de 2026-08-11). Los **CSV se parsean como texto plano a mano**; `xlsx` se reserva solo para `.xlsx`/`.xls` reales, con manejo aparte del serial de fecha de Excel.
- **Patrón de auth de la edge function:** `verify_jwt=false` + chequeo de admin a mano dentro de la función, igual que `actualizar-tasa-bcv`, porque el gateway no valida JWT con las llaves `sb_publishable_` nuevas.

### 4.7 Módulo Vendedores (Fase 14B)

**Rutas:** `/admin/vendedores`, `/admin/vendedores/:vendedorId` · **Permiso:** módulo `usuarios`
**Archivos:** `Vendedores.tsx`, `VendedorDetalle.tsx`

- **Listado** de vendedores con nº de clientes asignados y **saldo de cartera real** (`Σ facturas.saldo_usd`, no la vieja cuenta de `ordenes`/`cuentas_cobrar`), activar/desactivar y crear vendedor.
- **Detalle:** clientes asignados con un `Select` por fila para **reasignar** a otro vendedor o "Sin asignar" (update directo, sin RPC — es metadata, no dinero).
- **Pestaña "Sin asignar":** clientes activos sin vendedor, con asignación individual o **masiva**.
- **Corrección de fondo:** 17 de 19 vendedores tenían `rol_id is null` ("Sin rol") porque `crear_usuario_admin` solo asignaba el enum `role`. Se corrigieron los datos (backup previo en `backup_20260818.usuarios_pre14` / `clientes_pre14`) y la RPC ganó un parámetro `p_rol_id` opcional que, si no viene, resuelve el rol según el enum (`admin→Administrador`, `vendedor→Vendedor`, `delivery→Delivery`; `cliente` queda sin rol granular, por diseño).
  > Detalle técnico: `create or replace` con un parámetro nuevo **no** reemplaza la función vieja — Postgres la trata como otro overload por firma — hubo que `drop function` la de 7 args explícitamente para no dejar dos versiones ambiguas (error `PGRST203`).
- **Portal del vendedor corregido:** `VendedorClientes.tsx` y `VendedorDashboard.tsx` calculaban el saldo de cartera desde `ordenes.monto_pagado`/`cuentas_cobrar` (fuente que la Fase 11 marcó deprecada) → ahora usan `facturas.saldo_usd`, como el resto del sistema.

### 4.8 Torre de Control y Dashboard (Fase 15)

**Archivos:** `src/components/layout/ControlTower.tsx`, `src/contexts/ControlTowerContext.tsx`, `src/hooks/use-pending-actions.ts` (todos nuevos). Sin cambios de esquema.

- La campana del header admin ya no abre un popover chico: abre/cierra un **panel lateral derecho que empuja el contenido** en escritorio (mismo patrón `transition-[margin]` del sidebar izquierdo: `lg:mr-96` / `lg:mr-16` / `lg:mr-0`) y es overlay de pantalla completa en mobile/tablet. Se agregó además una campana al **header móvil**, que antes no tenía ninguna forma de abrir notificaciones.
- Dos secciones: **"Por hacer"** (conteos en vivo) y **"Notificaciones"** (lista completa, hasta 50, con marcar leída / todas). El `NotificationsContext` compartido con el portal no se tocó, sigue en 10.
- Estado `open`/`collapsed` persistido en `localStorage["guds-torre-collapsed"]` vía `ControlTowerContext`.
- **`use-pending-actions.ts`** es la única fuente de "pendientes", reusada por la torre y por el dashboard. Sus 7 colas:

| Cola | Consulta | Link |
|---|---|---|
| Pagos por verificar | `pagos.estado='pendiente'` | `/admin/cuentas-por-cobrar` |
| Registros de clientes pendientes | `registros_clientes.estado='pendiente'` | `/admin/registros` |
| Consignación por revisar | `declaraciones_consignacion.estado='pendiente'` | `/admin/consignacion` |
| Retenciones por revisar | `retenciones.estado='pendiente'` | `/admin/retenciones` |
| Líneas de extracto sin conciliar | `extracto_lineas.estado='pendiente'` | `/admin/conciliacion` |
| Productos con stock bajo | `productos.activo` y `stock_actual < 10` | `/admin/inventario` |
| Clientes sin vendedor asignado | `clientes.activo` y `vendedor_asignado_id is null` | `/admin/vendedores` |

- **Dashboard (`/admin/dashboard`):** 3 `StatCard` nuevos (reusando el componente existente, no un look ad-hoc) — **Deuda por Cobrar** (`Σ facturas.saldo_usd`), **Cartera de Vendedores** (clientes con `vendedor_asignado_id`), **Anticipos sin Aplicar** (`v_anticipos`) — más un widget **"Acciones pendientes"** con la misma lista de la torre.
- **Bug real encontrado y corregido:** el `Sheet` de Radix usa un portal que renderiza **fuera** del contenedor `lg:hidden`, así que la variante mobile quedaba montada a la vez que el panel de escritorio y tapaba los clics incluso en pantallas grandes. Se resolvió decidiendo en JS (`matchMedia("(min-width: 1024px)")`) cuál de las dos variantes montar, nunca las dos juntas.

### 4.9 Almacenes e Inventario

**Rutas:** `/admin/almacenes`, `/admin/almacenes/:almacenId`, `/admin/inventario` · **Archivos:** `Almacenes.tsx`, `AlmacenDetalle.tsx` (nuevos)

- Módulo de almacenes propios y de consignación con `inventario_almacen`; los de consignación se ligan al cliente por match de nombre.
- **`Inventario.tsx`**: filtro por categoría + "Agrupar por categoría" en Stock Actual (fila colapsable, mismo patrón que ya usaba "Por Almacén"), y filtro **Todos / Propios / Consignación** en la vista Por Almacén.
- **Hallazgo de seguridad cerrado:** `almacenes` e `inventario_almacen` **no tenían ninguna política RLS** — cualquier usuario autenticado veía y editaba el inventario de cualquier cliente. Se cerró en `20260819_fase12a_rls_almacenes.sql`: admin vía módulo `inventario`, cliente solo su propio almacén, vendedor solo los de sus clientes asignados (`mis_clientes_vendedor()`).

### 4.10 Bancos multi-método y movimientos

**Rutas:** `/admin/bancos`, `/admin/pagos`

- `bancos.metodos text[]` (nueva) + backfill: métodos recibidos ∪ transferencia; el banco "Efectivo" quedó en `['efectivo']`.
- Nuevo valor `'tarjeta'` en el enum `pago_metodo` + método de pago "Tarjeta" en `metodos_pago`.
- Los 1.418 recibos importados se re-mapearon: `tarjeta` si el pago de Odoo tenía `pago_por_pv`, si no `transferencia` → **1.387 transferencia + 31 tarjeta**.

---

## 5. Flujo de pagos unificado (checkout → cola admin)

Antes había dos modelos de contabilidad conviviendo (el boolean `pagado` vs. `monto_pagado`) y tres orígenes de pago que no se juntaban en ninguna parte. Ahora:

```
Checkout (cliente)   ─┐
Portal cliente        ├─→  pagos.estado = 'pendiente'  ─→  /admin/cuentas-por-cobrar
Portal vendedor      ─┘                                    "Por verificar (N)"
                                                                   │
                                                    verificar_pago(aprobar=true, asignaciones)
                                                                   │
                                          ┌────────────────────────┼────────────────────────┐
                                    pago_facturas          movimiento bancario        notificación
                                    (→ saldo_usd)          (si se asigna banco)       a cliente/vendedor
```

Cambios concretos:

- **`crear_orden_desde_carrito`** ahora acepta `p_banco_id` / `p_moneda` / `p_tasa` y, si el checkout llevó comprobante, **inserta un pago `pendiente` ligado a la orden**. Antes el comprobante quedaba huérfano en `ordenes.comprobante_url` y la orden no se marcaba pagada hasta que el cliente lo re-reportaba.
- **Checkout con banco destino:** cuando el método lleva comprobante (transferencia / pago móvil), el cliente elige **moneda (USD/Bs)**, lo cual **filtra las cuentas** disponibles, y selecciona el **banco destino** al que pagó (ve nombre, nº de cuenta y titular) más el monto a transferir (en Bs = total × tasa BCV). El pago entra a la cola con el banco ya asignado y el admin lo ve prellenado.
- **`verificar_pago`** reescrito: al aprobar ya no solo setea el boolean; adjudica el monto a la deuda real según las asignaciones manuales y crea el movimiento bancario. Al rechazar marca `rechazado`. Solo admin (`is_admin()`).
- **`trg_pago_insert`**: la notificación al admin apunta a `/admin/cuentas-por-cobrar`.
- **`PortalPagos`**: se quitó la lista muerta `metodosPago` (contenía `deposito`, que no es válido); ahora lee `bancos.metodos[]`, muestra los métodos por banco (ej. Banco Mercantil → "Tarjeta, Transferencia") y agrega selector de método.

---

## 6. Inventario completo de cambios de esquema

### Tablas nuevas

| Tabla | Fase | Para qué |
|---|---|---|
| `facturas` | 10 | Documento fiscal (`account_move`), fuente canónica de deuda |
| `factura_items` | 10 | Líneas de factura |
| `pago_facturas` | 11 | Puente pago↔factura con `monto_aplicado`, único por `(pago_id, factura_id)` |
| `declaraciones_consignacion` | 12 | Declaración de venta en consignación (número, almacén, cliente, rol del declarante, estado, totales, factura generada) |
| `declaracion_consignacion_items` | 12 | Productos y cantidades declaradas |
| `conceptos_retencion_islr` | 13 | 8 conceptos SENIAT con porcentaje |
| `retenciones` | 13 | Comprobante de retención (tipo iva/islr, base imponible, total, comprobante, estado) |
| `retencion_items` | 13 | Puente retención↔factura |
| `extractos_bancarios` | 14A | Lote de extracto cargado (banco, archivo, moneda, rango de fechas) |
| `extracto_lineas` | 14A | Línea del extracto con estado, match, método (`automatico`/`ia`/`manual`), confianza y `sugerencia_ia` |

### Columnas nuevas destacadas

- `facturas`: `total_usd`, `saldo_odoo_usd`, `monto_aplicado_usd`, `monto_retenido_usd`, `odoo_sync_at`, `creada_en_guds`, + generadas `saldo_usd` y `estado_cobro`
- `clientes`: `retiene_iva`, `retiene_islr`
- `bancos`: `metodos text[]`

### Vistas

- **`v_anticipos`** (`security_invoker = on`): pagos `verificado` con `odoo_id is null` y su `disponible = monto − Σ aplicado`

### RPCs nuevas o reescritas

| RPC | Fase | Rol |
|---|---|---|
| `facturar_orden(p_orden_id)` | 11 | Factura interna desde una orden, `F-000001…`, bloquea doble facturación |
| `registrar_cobro_facturas(...10 params)` | 11 | Cobro con asignación manual a facturas |
| `verificar_pago(..., p_asignaciones)` | 11 | Aprueba/rechaza pago pendiente y adjudica (wrapper de 5 args conservado) |
| `aplicar_anticipo(p_pago_id, p_asignaciones)` | 11 | Aplica el sobrante de un pago a facturas |
| `aplicar_pago_a_facturas(p_pago_id, p_asignaciones)` | 11 | Helper interno, valida cliente/saldo/monto |
| `recalcular_credito(p_cliente_id)` | 11 | Reescrita sobre `facturas.saldo_usd` |
| `declarar_venta_consignacion(p_almacen_id, p_items, p_notas)` | 12 | Declara venta, valida acceso y stock |
| `revisar_declaracion_consignacion(p_declaracion_id, p_aprobar, p_notas)` | 12 | Aprueba: descuenta stock + genera factura |
| `declarar_retencion(...8 params)` | 13 | Declara retención multi-factura |
| `revisar_retencion(p_retencion_id, p_aprobar, p_notas)` | 13 | Aprueba/rechaza, re-valida saldo |
| `crear_extracto_bancario(...)` | 14A | Inserta lote + líneas |
| `conciliar_extracto_automatico(p_extracto_id)` | 14A | Match estricto, solo candidato único |
| `confirmar_match_extracto(p_linea_id, p_movimiento_id)` | 14A | Match manual |
| `aplicar_sugerencia_ia(p_linea_id)` | 14A | Acepta la sugerencia de la IA |
| `descartar_linea_extracto(p_linea_id, p_notas)` | 14A | Descarta una línea |
| `crear_usuario_admin(..., p_rol_id)` | 14B/16 | Rol resuelto solo; corta con mensaje claro si falla |
| `crear_orden_desde_carrito(..., p_banco_id, p_moneda, p_tasa)` | — | Checkout con banco destino + pago pendiente |

### Triggers

`trg_recalc_factura_aplicado`, `trg_recalc_factura_aplicado_por_pago`, `trg_recalc_factura_retenido`, `trg_recalc_factura_retenido_por_retencion`, `trg_pago_insert` (notificación redirigida)

### Migraciones (en orden)

```
20260814_unificar_pagos_pendientes.sql       20260819_fase12c_rpcs.sql
20260814b_checkout_banco_destino.sql         20260820_fase13a_retenciones_schema.sql
20260817_fase10_facturas.sql                 20260820_fase13b_rpcs.sql
20260818_fase11a_facturas_usd.sql            20260821_fase14a_conciliacion.sql
20260818_fase11b_pago_facturas.sql           20260821_fase14b_rpcs.sql
20260818_fase11c_rpcs.sql                    20260821_fase14c_vendedores_rpc.sql
20260818_fase11d_deprecar.sql                20260822_fase16_rol_obligatorio.sql
20260819_fase12a_rls_almacenes.sql
20260819_fase12b_declaraciones_consignacion.sql
```

Backups previos en el schema `backup_20260818` (`facturas_pre13`, `usuarios_pre14`, `clientes_pre14`).

---

## 7. Seguridad y correcciones de fondo

| Problema | Estado | Detalle |
|---|---|---|
| `almacenes` / `inventario_almacen` sin RLS | **Cerrado** | Cualquier autenticado veía y editaba inventario de cualquier cliente |
| 0 de 432 clientes con `vendedor_asignado_id` | **Resuelto** | 15 usuarios vendedor creados (email placeholder `<slug>@guds.test`) + 367 clientes asignados por match de `vendedor_odoo`. Los otros 65 no traían vendedor en Odoo |
| 17 de 19 vendedores con `rol_id` null | **Resuelto + blindado** | Constraint `usuarios_rol_id_requerido_check`: `role='cliente' or rol_id is not null`. Verificado antes de aplicar: 0 filas la violaban |
| Formulario de usuarios permitía guardar sin rol | **Resuelto** | `handleCreateUser` pasa `p_rol_id` en la misma llamada a la RPC (se eliminó el `update` posterior que, si fallaba, dejaba el usuario sin rol — la causa real del bug); `handleEditUser` valida el rol antes de guardar |
| Eliminar usuario reventaba con error crudo de Postgres | **Resuelto** | Hay **10 tablas con FK `NO ACTION`** hacia `usuarios(id)`; hoy bloquean a 15 vendedores y 1 admin. Ahora un `Dialog` explica la causa en lenguaje llano (`describirErrorEliminar` mapea la tabla del FK desde `error.code='23503'` + `error.details`) y ofrece **"Desactivar en su lugar"** |
| `guds.store` devolvía 404 fuera de `/` | **Resuelto** | Faltaba el fallback SPA. `netlify.toml` versionado: build `bun run build` → `dist` + regla `/* → /index.html 200` |
| Registro público "revisa tu conexión" | **No reproducible** | El insert anónimo en `registros_clientes` funciona (201) y la subida del RIF también (200). La causa del fallo del 12 ago fue el estado pre-migración (anon key legacy / RLS a medio endurecer) |
| Precio del diálogo de empaque ≠ precio cobrado | **Resuelto** | Mostraba `precio_base × unidades`; ahora pide `precio_efectivo` al abrir el diálogo |
| `SOPORTE CORPOEUREKA` como "vendedor" | **Por revisar** | 4 clientes asignados; probablemente no es un vendedor real |

---

## 8. Infraestructura y despliegue

- **`netlify.toml`** versionado en el repo (build y fallback SPA ya no dependen solo del dashboard de Netlify).
- **Edge functions:** `actualizar-tasa-bcv` (existente) y **`conciliar-ia-sugerir`** (nueva, desplegada). Ambas con `verify_jwt=false` + chequeo de admin interno.
- **Secrets:** `ANTHROPIC_API_KEY` subida como secret del proyecto Supabase (venía en `.env.local`, no se commiteó). `SUPABASE_ACCESS_TOKEN` (Management API) en `.env.local`, probado con `GET /v1/projects/{ref}` → 200.
- **Llaves Supabase:** migradas a `sb_publishable_` / `sb_secret_`; el JWT legacy ya fue deshabilitado por el cliente.
- **Convención de tablas:** header sticky + scroll flotante (`table.tsx`) + `usePagination` / `DataTablePagination` en cada tabla.

---

## 9. Verificación aplicada en cada fase

Método usado consistentemente:

1. **RPC directo con login real** (JWT real de `qa.admin`) para probar el backend, incluidas las rutas de error: montos que exceden el saldo, stock insuficiente, doble facturación, doble conciliación. Todas fallan **sin dejar nada escrito**.
2. **Circuito completo por UI con Playwright** en sesiones reales de admin, cliente y vendedor, contando **errores de consola** (objetivo: 0).
3. **`tsc --noEmit` limpio + `npm run build` OK** en cada cierre de fase.
4. **Datos de prueba limpiados** y estado restaurado (stock, asignaciones, deuda total) al terminar.

Cifras cuadradas contra la fuente:

- Deuda total: **$1.084.362,94** en Supabase vs. **$1.084.362,89** en Odoo en vivo (5 centavos por redondeo por fila en 3.238 documentos).
- Deuda total **sin cambios** tras migrar retenciones y tras cada circuito de prueba de consignación/retenciones.
- Cartera de ANDERSON ALBORNOZ: **$48.023,00** en la UI = `sum(facturas.saldo_usd)` consultado directo en prod.
- Torre de Control: margen 384px ↔ 64px verificado por CSS computado; en mobile abre como overlay sin el aside de escritorio de fondo.

---

## 10. Pendientes abiertos

**Bloqueantes para producción**

1. **La cuenta de Anthropic de la API key no tiene saldo** — la sugerencia de IA en conciliación está probada hasta la llamada real (auth, matching, armado de candidatos, todo OK) y Anthropic devolvió "credit balance too low". Hay que cargar crédito. El resto del módulo (carga, match automático, match manual, descartar) **no depende de eso y ya funciona**.

**Operativos**

2. Reemplazar los emails placeholder `@guds.test` de los 15 vendedores por los reales y forzar cambio de la contraseña temporal.
3. Revisar o desactivar **SOPORTE CORPOEUREKA** como vendedor (4 clientes asignados).

**Técnicos**

4. No se migró la reconciliación factura↔pago histórica de Odoo (`account_partial_reconcile`): los 1.418 pagos importados no están linkeados a una factura específica. **Decisión tomada:** `amount_residual_signed` ya es el saldo de partida correcto.
5. Facturas en VES: falta consolidar su deuda a USD aplicando `tasa_cambio` para un total combinado en el resumen.
6. Pasar a archivos de migración formales los cambios de esquema que se aplicaron por Management API en fases **anteriores** a la 11 (desde la 11 sí se crean los `.sql`).
7. (Opcional) Code-splitting: el bundle JS supera 500 kB.

**Decisiones de negocio sin cerrar**

8. `tarjeta` no está habilitada en el checkout del cliente (sí en admin y vendedor): es intencional por ahora, porque no hay pasarela para autoservicio. Confirmar si se quiere.

---

## Anexo — referencias rápidas

- **Bitácora completa por sesión:** `BITACORA.md` (entrada más reciente arriba; incluye credenciales de los usuarios QA)
- **Scripts de sincronización:** `scripts/sync-odoo-{catalogo,clientes,ordenes,almacenes,pagos,facturas,retenciones}.mjs` + `scripts/odoo-verificar.mjs`
- **Dev server local:** `http://localhost:8081` (el `:8080` lo ocupa otra app que apunta a otro proyecto Supabase)
- **Usuarios QA:** `qa.admin@guds.test`, `qa.cliente@guds.test`, `qa.vendedor@guds.test` (contraseña en `BITACORA.md`)
