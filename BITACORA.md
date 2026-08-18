# Bitácora — GUDS B2B Hub

Registro de trabajo por sesión. La entrada más reciente va arriba. Cada entrada
resume qué se ejecutó, qué cambió en base de datos (producción) y qué queda pendiente.

- **Proyecto Supabase (prod):** `oyyxkbwtyxdpzsgarmim`
- **Dev server local:** este repo corre en `http://localhost:8081` (el `:8080` lo ocupa otra app que apunta a otro proyecto Supabase).
- **Regla Odoo:** solo lectura, nunca escribir. Los `scripts/sync-odoo-*.mjs` leen credenciales desde variables de entorno (`.env.local` + `ODOO_PG_*`, ambos fuera de git).
- **Admin de prueba (QA):** `qa.admin@guds.test` / `GudsQA-2026!circuito` (cliente/vendedor QA: `qa.cliente@guds.test` / `qa.vendedor@guds.test`, misma password).

---

## 2026-08-18 · Fase 16: rol obligatorio al crear usuario + adaptación a Netlify

### Rol obligatorio
El bug de Fase 14 ("Sin rol") se parchó a mano en su momento, pero el hueco de fondo seguía
abierto: `crear_usuario_admin` podía dejar `rol_id` en null si algo fallaba, y el formulario de
edición en `/admin/configuracion/usuarios` no validaba que quedara un rol seleccionado al
guardar. Ahora:
- Constraint nueva en BD: `usuarios_rol_id_requerido_check` — `role = 'cliente' or rol_id is not
  null`. Los clientes siguen sin rol granular (no usan el sistema de permisos admin, por diseño
  desde el registro/onboarding), pero ningún usuario admin/vendedor/delivery puede quedar sin uno,
  en ningún camino de inserción futuro, no solo desde el frontend.
- `crear_usuario_admin` ahora corta con un mensaje claro ("Debes seleccionar un rol para este
  usuario") si la resolución automática de rol_id falla, en vez de dejar pasar el insert y que
  reviente con un error crudo de Postgres.
- `ConfigUsuarios.tsx`: `handleCreateUser` ya pasa `p_rol_id` directo en la misma llamada a la
  RPC — se eliminó el `update` de enlace posterior que, si fallaba, dejaba el usuario creado pero
  sin rol (la causa real del bug de Fase 14). `handleEditUser` ahora valida que haya un rol
  seleccionado antes de guardar.
- Verificado en prod antes de aplicar: 0 filas violan la constraint (staff ya tenía rol_id,
  clientes no tienen filas en `usuarios` con role='cliente' fuera de las que ya excluye la regla).

### Adaptación a Netlify
El sitio quedó publicado en `guds.store` (Netlify, repo `Boosty-Hub/guds-b2b-hub`) sin el
fallback de SPA — cualquier ruta que no fuera `/` devolvía el 404 nativo de Netlify en vez de la
app React (confirmado en vivo: `guds.store/admin/dashboard` → 404), rompiendo refrescar la
página o abrir un link directo a `/admin/*`, `/portal/*`, `/vendedor/*`. Se agregó `netlify.toml`
con el build (`bun run build` → `dist`, ya versionado en el repo en vez de depender solo de la
config del dashboard de Netlify) y la regla `/* → /index.html 200`.

---

## 2026-08-18 · Fase 15: Torre de Control + Dashboard ampliado

Sin cambios de esquema — todo lecturas ya existentes. Solo frontend.

### Torre de Control (reemplaza el popover de notificaciones en el admin)
- La campana del `Header` admin (y una nueva campana en el header móvil, que antes **no tenía
  ninguna forma de abrir notificaciones**) ya no abre un popover chico: abre/cierra un panel
  lateral derecho que **empuja el contenido** en escritorio (mismo patrón `transition-[margin]`
  que ya usa el sidebar izquierdo: `lg:mr-96`/`lg:mr-16`/`lg:mr-0`) y es overlay de pantalla
  completa en mobile/tablet.
- `ControlTowerContext` (nuevo, `open`/`collapsed` con persistencia en
  `localStorage["guds-torre-collapsed"]`) + componente `ControlTower.tsx` con dos secciones:
  **"Por hacer"** (conteos en vivo de las 5 colas de aprobación de las Fases 11-14 + stock bajo +
  clientes sin vendedor) y **"Notificaciones"** (lista completa, hasta 50, con marcar
  leída/todas — el `NotificationsContext` compartido con el portal no se tocó, sigue en 10).
- Hook nuevo `use-pending-actions.ts`: única fuente de "pendientes", reusada por la torre y por
  el dashboard.
- **Bug real encontrado y corregido en el camino**: el `Sheet` de Radix usa un portal que
  renderiza fuera del contenedor `lg:hidden`, así que la versión mobile quedaba montada *a la
  vez* que el panel de escritorio y tapaba los clics incluso en pantallas grandes. Se resolvió
  decidiendo en JS (`matchMedia("(min-width: 1024px)")`) cuál de las dos variantes montar, nunca
  las dos juntas.
- El `NotificationsDropdown` original (portal de cliente/vendedor) queda intacto — la torre es
  solo para el layout admin.

### Dashboard (`/admin/dashboard`)
- 3 `StatCard` nuevos (mismo componente ya existente, no un look ad-hoc): **Deuda por Cobrar**
  (`Σ facturas.saldo_usd`, igual que `Cuentas.tsx`), **Cartera de Vendedores** (clientes con
  `vendedor_asignado_id`), **Anticipos sin Aplicar** (`v_anticipos`, igual que
  `CuentasPorCobrar.tsx`).
- Widget nuevo **"Acciones pendientes"** con la misma lista que la Torre de Control.

### Verificación
Playwright (admin real, desktop 1440px y mobile 390px): dashboard con los 3 KPIs nuevos + deuda
coincide exacto con el valor conocido ($1.084.362,94); torre abre/colapsa (margen 384px↔64px
verificado por CSS computado), navega al hacer clic en un pendiente (`/admin/registros`); en
mobile abre como overlay completo sin el aside de escritorio de fondo. 0 errores de consola en
ambos tamaños. `tsc`/`build` limpios.

---

## 2026-08-18 · Fase 14 (parte B): Módulo Vendedores + fix de rol + deuda real

Cierra el bug visto en producción: **17 de 19 vendedores** tenían `rol_id is null` ("Sin rol" en
`/admin/configuracion/usuarios`) porque `crear_usuario_admin` nunca lo asignaba, solo el enum
`role`. Además **65 de 432 clientes activos** no tenían vendedor asignado, y no había ninguna UI
para asignar/reasignar (se hacía por SQL directo).

### Fix de raíz (prod, backup previo `backup_20260818.usuarios_pre14`/`clientes_pre14`)
- Dato: los 17 usuarios corregidos con `rol_id` = rol "Vendedor".
- RPC `crear_usuario_admin`: nuevo parámetro `p_rol_id` (opcional); si no viene, resuelve solo el
  `rol_id` según el enum (`admin→Administrador`, `vendedor→Vendedor`, `delivery→Delivery`;
  `cliente` queda sin rol granular, es lo esperado). *Nota técnica*: `create or replace` con un
  parámetro nuevo no reemplaza la función vieja — Postgres la trata como otro overload por firma
  de tipos — hubo que `drop function` la de 7 args explícitamente para no dejar dos versiones
  ambiguas (`PGRST203`).

### Módulo nuevo `/admin/vendedores` (+ `/admin/vendedores/:id`)
- Lista de vendedores con # clientes asignados y **saldo de cartera real** (suma de
  `facturas.saldo_usd`, no la vieja cuenta de `ordenes`/`cuentas_cobrar`), activar/desactivar,
  crear vendedor (llama `crear_usuario_admin`, rol ya queda bien solo).
- Detalle: clientes asignados con **Select para reasignar** cada uno a otro vendedor o "Sin
  asignar" (update directo, sin RPC — es solo metadata, no dinero).
- Pestaña "Sin asignar": los clientes activos sin vendedor, con asignación individual o masiva.
- De paso se corrigió `VendedorClientes.tsx`/`VendedorDashboard.tsx` (portal del vendedor): el
  saldo de cartera se calculaba desde `ordenes.monto_pagado`/`cuentas_cobrar`, la misma fuente
  que la Fase 11 marcó deprecada — ahora usan `facturas.saldo_usd`, igual que el resto del
  sistema desde esa fase.

### Verificación
Playwright (admin real): 0 "Sin rol" en la tabla, detalle de ANDERSON ALBORNOZ muestra
**$48.023,00** de cartera — coincide exacto con `sum(facturas.saldo_usd)` consultado directo en
prod. Reasignación de cliente probada con la misma sesión real (PostgREST, revertida). `tsc`/
`build` limpios.

---

## 2026-08-18 · Fase 14 (parte A): Conciliación bancaria con sugerencias de IA

Módulo nuevo: cargar el extracto real del banco (CSV/Excel) y cruzarlo contra
`movimientos_bancarios` (lo que el sistema ya registró al aprobar cobros/pagos). Investigado
antes cómo lo hace Odoo (`account.reconcile.model`): reglas simples de texto/monto/tercero, sin
IA, y en la práctica casi no se usa para cobros de clientes en esta instancia — el cobro de
GUDS ya vive aparte (Fase 11). Se construyó algo mejor: matching determinístico + IA solo para
lo ambiguo, y la IA nunca decide sola.

### Esquema y RPCs (`20260821_fase14a/b_*.sql`, aplicadas a prod)
- **`extractos_bancarios`** (lote cargado) + **`extracto_lineas`** (cada fila del extracto:
  fecha, monto con signo, referencia, descripción, `estado` pendiente/conciliado/descartado,
  `movimiento_bancario_id`, `metodo_match` automatico/ia/manual, `sugerencia_ia` jsonb). Índice
  único en `movimiento_bancario_id` — un movimiento no se puede conciliar dos veces.
- **`crear_extracto_bancario`**: inserta header + líneas desde el JSON ya parseado en el
  navegador. **`conciliar_extracto_automatico`**: para cada línea pendiente, busca en
  `movimientos_bancarios` del mismo banco+signo con tolerancia estricta (±0.01 de monto, ±3 días
  de fecha); solo concilia si hay **un único** candidato — ambigüedad nunca se resuelve sola.
  **`confirmar_match_extracto`** (manual) / **`aplicar_sugerencia_ia`** /
  **`descartar_linea_extracto`**.

### IA (edge function `conciliar-ia-sugerir`, desplegada)
Para las líneas que el matcher estricto no resolvió: junta candidatos con ventana ampliada
(±15 días, monto 0.5×–1.5×) y le pide a Claude (`claude-haiku-4-5`, API de Anthropic) el mejor
candidato + motivo + confianza. **Solo escribe `sugerencia_ia`, nunca cambia `estado`** — el
admin aprueba o no desde la UI. Mismo patrón que `actualizar-tasa-bcv` (`verify_jwt=false` +
chequeo de admin a mano adentro de la función, porque el gateway no valida JWT con las llaves
`sb_publishable_` nuevas). `ANTHROPIC_API_KEY` subida como secret del proyecto (venía en
`.env.local`, no se commiteó).
**Pendiente del lado del usuario:** la cuenta de Anthropic de esa API key no tiene saldo —
probado hasta la llamada real (auth, matching, armado de candidatos, todo OK), Anthropic
devolvió "credit balance too low". Hay que cargar crédito para que la sugerencia funcione en
producción; el resto del módulo (carga, match automático, match manual, descartar) no depende
de eso y ya funciona.

### Frontend (`/admin/conciliacion`, nuevo)
- Carga en 2 pasos: elegir banco + archivo, luego **mapear columnas** (fecha/monto/referencia/
  descripción vía dropdowns con preview) — cada banco exporta con columnas distintas.
- **Gotcha real encontrado y corregido**: la librería `xlsx` interpreta fechas tipo
  "11/08/2026" en formato inglés (mes/día) aunque se le pida `raw:true`, rompiendo fechas
  día/mes (quedaba 2026-11-08 en vez de 2026-08-11). Se resolvió parseando el **CSV como texto
  plano a mano** (sin pasar por la detección de fechas de la librería); `xlsx` se reserva solo
  para `.xlsx`/`.xls` reales, con manejo aparte del serial de fecha de Excel.
- Detalle de extracto: tabs Por conciliar (con badge de sugerencia IA y botones Aplicar/Buscar
  manual/Descartar) / Conciliadas / Descartadas. Búsqueda manual: diálogo con movimientos sin
  conciliar del mismo banco.

### Verificación
Backend probado por RPC directo (login real): match exacto → conciliado automático; sin match →
pendiente; doble conciliación del mismo movimiento → falla. **Circuito completo por UI**
(Playwright, admin real, CSV real de 2 líneas): cargar → mapear columnas → 1 conciliada auto +
1 pendiente → descartar la pendiente → 0 pendientes, 1 descartada. 0 errores de consola en
todo el flujo. `tsc`/`build` limpios. Datos de prueba limpiados.

---

## 2026-08-18 · Usuarios que no se pueden eliminar: popup descriptivo + desactivar

Cierra la auditoría de más abajo. El botón "Eliminar" en `ConfigUsuarios.tsx` hace un `DELETE`
físico crudo sobre `usuarios`, sin soft-delete. Hay **10 tablas con FK `NO ACTION`** hacia
`usuarios(id)` que lo bloquean apenas el usuario tiene actividad: hoy afecta a **15 vendedores**
(`clientes.vendedor_asignado_id`) y **1 admin** (`registros_clientes.revisado_por`); las demás
(`ordenes`, `pagos`, `entregas`, `movimientos_inventario`, `metas_vendedor`, `pago_facturas`,
`declaraciones_consignacion`) están en 0 pero bloquearán en cuanto haya actividad.

**Cambio**: al fallar el borrado, en vez del toast con el texto crudo de Postgres, se abre un
**popup** (`Dialog`) con un mensaje descriptivo (`describirErrorEliminar` en
`ConfigUsuarios.tsx`, mapea el nombre de la tabla que bloqueó el FK — ej. `clientes` → "tiene
clientes asignados como vendedor" — a partir de `error.code==='23503'` y `error.details`) y un
botón **"Desactivar en su lugar"** que llama a `handleToggleUserStatus` (ya existente,
`activo=false`) sin tocar el historial. Verificado con Playwright (admin real) intentando
borrar un vendedor con clientes asignados: popup correcto, 0 efectos secundarios al cerrar sin
desactivar. `tsc`/`build` limpios.

---

## 2026-08-18 · Fase 13: Módulo de Retenciones (IVA/ISLR)

GUDS es el sujeto retenido: sus clientes le retienen IVA/ISLR al pagarle una factura. En Odoo
(localización venezolana completa) el comprobante de retención se reconcilia contra la factura
como si fuera un pago — verificado con casos reales.

### Hallazgo importante: dirección real de ISLR en Odoo
Las 182 retenciones ISLR en Odoo son **100% de facturas de compra** (`move_type='in_invoice'`) —
es decir, GUDS reteniéndole ISLR a **sus proveedores** (cuentas por pagar), no clientes
reteniéndole a GUDS. No hay histórico de ISLR del lado que nos interesa (clientes→GUDS); el
IVA sí es mixto y las **493 retenciones de IVA sobre facturas de venta** son las reales
migradas. El flujo hacia adelante para ISLR se construyó igual (5 clientes están marcados como
agentes de retención ISLR en Odoo, por si empiezan a hacerlo), simplemente sin backlog.

### Esquema (`20260820_fase13a/b_*.sql`, aplicadas a prod; backup en `backup_20260818.facturas_pre13`)
- **`conceptos_retencion_islr`**: 8 conceptos reales del SENIAT (Honorarios, Comisiones,
  Fletes, Publicidad, Arrendamiento, etc.) con la tasa vigente 2026 para persona jurídica
  domiciliada, tomados de `account_withholding_concept`/`account_withholding_rate_table_line`.
- **`retenciones`** + **`retencion_items`** (puente multi-factura, igual patrón que
  `pago_facturas`): `odoo_id` NOT NULL = migrada de Odoo (ya neteada en `saldo_odoo_usd`).
- **`facturas.monto_retenido_usd`** (nueva) + **recreadas `saldo_usd`/`estado_cobro`** (columnas
  generadas: no se puede alterar su expresión in-place, hubo que `drop`+`add`) para restar
  también lo retenido: `saldo_usd = saldo_odoo_usd - monto_aplicado_usd - monto_retenido_usd`.
  Trigger `trg_recalc_factura_retenido` **excluye retenciones con `odoo_id` no nulo** — el mismo
  patrón ya usado en `v_anticipos` — para no descontar dos veces el histórico.
- `clientes.retiene_iva/retiene_islr` (nuevas): migradas de `res_partner.apply_third_party_
  retention_iva/islr` — 5 clientes reales matchearon (incluye FARMATODO).
- **RPCs**: `declarar_retencion(...)` (cliente/vendedor: queda `pendiente`; admin: se auto-aprueba
  directo) y `revisar_retencion(...)` (admin aprueba/rechaza, re-valida saldo al aprobar).

### Migración histórica (`scripts/sync-odoo-retenciones.mjs`)
761 `account_wh_iva` + 182 `account_wh_islr` confirmadas → **493 retenciones de IVA** resueltas
(cliente + factura matcheados) + 493 líneas. El monto USD se calculó con el mismo factor
`total_usd/total` ya usado para facturas (las retenciones en Odoo vienen en la moneda del
documento, no en USD). **Deuda total sin cambios tras migrar: $1.084.362,94.**

### Frontend
- Nuevo módulo `/admin/retenciones` (tabs Pendientes/Aprobadas/Rechazadas + "Registrar
  retención" directo), `/portal/retenciones` (cliente, con subida de comprobante) y
  `/vendedor/retenciones` (selector de cliente). Componente compartido
  `DeclararRetencionForm.tsx`, reusa `SelectorFacturas` (Fase 11) para la asignación
  multi-factura del monto retenido.
- Sección "Retenciones aplicadas"/"Retenciones" agregada a `FacturaDetalle.tsx` y
  `CuentaDetalle.tsx`.

### Verificación
- Backend probado por RPC directo (login real): declarar como admin (auto-aprobado, baja saldo
  de 2 facturas), declarar como cliente (queda pendiente, sin tocar saldo), aprobar como admin
  (baja saldo), validaciones de saldo insuficiente.
- **Circuito completo por UI** (Playwright, con la misma reasignación temporal autorizada y
  revertida de Fase 12): declarar desde portal cliente → aprobar desde admin, 0 errores de
  consola.
- `tsc --noEmit` limpio · `npm run build` OK. Datos de prueba limpiados, deuda total y
  reasignaciones restauradas a su estado original.

---

## 2026-08-18 · Fase 12: Declaración de ventas en consignación + filtros de Inventario

Cierra el pedido de "declarar lo vendido en consignación" (portal cliente/vendedor/admin) y
mejoras de filtro/agrupación en Inventario.

### Hallazgo de seguridad corregido
`almacenes` e `inventario_almacen` **no tenían ninguna política RLS** (cualquier autenticado
veía/editaba el inventario de cualquier cliente). Se cerró en el mismo pase
(`20260819_fase12a_rls_almacenes.sql`): admin vía módulo `inventario`, cliente solo su propio
almacén, vendedor solo los de sus clientes asignados (`mis_clientes_vendedor()`).

### Esquema y RPCs (`20260819_fase12b/c_*.sql`, aplicadas a prod)
- **`declaraciones_consignacion`** + **`declaracion_consignacion_items`** (RLS: solo SELECT
  propio para cliente/vendedor; sin INSERT directo — todo pasa por RPC).
- **`declarar_venta_consignacion(p_almacen_id, p_items, p_notas)`**: valida que el almacén sea
  de consignación y que quien llama tenga acceso (cliente dueño / vendedor asignado / admin),
  valida stock disponible por producto, calcula precio con `precio_efectivo()` (misma función
  del checkout) + IVA de `configuracion`, notifica al admin (`notif_admins`). Queda `pendiente`.
- **`revisar_declaracion_consignacion(p_declaracion_id, p_aprobar, p_notas)`** (solo admin):
  al aprobar, re-valida stock (por si cambió), descuenta `inventario_almacen`, genera una
  **factura interna** (mismo patrón que `facturar_orden`, numeración `F-…`, `referencia` =
  número de la declaración) y notifica a cliente/vendedor. Al rechazar, no toca nada.

### Frontend
- **Portal cliente** (`/portal/consignacion`, nuevo): ve su almacén de consignación, declara
  cantidades vendidas por producto, historial de declaraciones con link a la factura si fue
  aprobada. Entrada en "Mi Cuenta" → Mis Compras.
- **Portal vendedor** (`/vendedor/consignacion`, nuevo): selector de cliente (solo los propios
  con consignación) + mismo formulario.
- **Admin** (`/admin/consignacion`, nuevo): tabs Pendientes/Aprobadas/Rechazadas, diálogo de
  detalle con items y botones Aprobar y facturar / Rechazar.
- Componente compartido `src/components/consignacion/DeclararVentaForm.tsx` (tabla de stock +
  cantidad a declarar) reusado en los 3 portales.
- **Inventario.tsx**: filtro por categoría + "Agrupar por categoría" en Stock Actual (mismo
  patrón de fila colapsable que ya usaba "Por Almacén"); filtro "Todos/Propios/Consignación"
  en Por Almacén.

### Verificación
- Backend probado por RPC directo (login real): declarar 2 productos → pendiente, stock sin
  tocar; aprobar → stock descontado exacto, factura `F-…` generada con `referencia`; rechazar
  → sin cambios; validación de stock insuficiente (al declarar y al aprobar) falla sin dejar
  nada escrito.
- **Circuito completo por UI** (Playwright, con reasignación temporal y autorizada de
  FARMATODO a `qa.cliente`/`qa.vendedor` para poder loguearse como ellos, revertida al
  terminar): declarar desde el portal cliente → aprobar desde el admin → factura visible en
  `CuentaDetalle` del cliente. **0 errores de consola** en las 5 páginas nuevas + Inventario.
- `tsc --noEmit` limpio · `npm run build` OK. Deuda total verificada sin cambios
  ($1.084.362,94) tras limpiar todos los datos de prueba y restaurar stock/asignaciones.

---

## 2026-08-18 · Fase 11: Cuentas/CxC sobre facturas + asignación manual de pagos

Cierra el pendiente de la Fase 10: la deuda real ahora se calcula **solo desde `facturas`**
(no desde `ordenes`), y la adjudicación de un cobro a las facturas es **manual** (el admin
elige a qué factura(s) va cada pago y cuánto de cada una), reemplazando el FIFO automático.

### Esquema (`20260818_fase11a..d_*.sql`, aplicadas a prod; backup previo en schema `backup_20260818`)
- **`facturas`**: nuevas columnas `total_usd`/`saldo_odoo_usd` (snapshot inmutable de Odoo,
  `amount_total_signed`/`amount_residual_signed` — ya en USD y con signo, negativo en notas de
  crédito), `monto_aplicado_usd` (mantenido por trigger desde `pago_facturas`), y las columnas
  **generadas** `saldo_usd` (= `saldo_odoo_usd - monto_aplicado_usd`, canónica para deuda) y
  `estado_cobro`. Al ser generadas, el re-sync de Odoo **no puede pisar** lo cobrado en GUDS.
  Índice de deuda: `where estado='posted'` (¡ojo!: `estado_pago='anulado'` no implica saldo 0 —
  181 facturas "reversed" en Odoo con saldo real; no filtrar por eso).
- **`pago_facturas`** (nueva, puente pago↔factura manual) + trigger `trg_pf_recalc` que
  recalcula `monto_aplicado_usd` desde ahí. Vista **`v_anticipos`** (security_invoker) = pagos
  verificados con sobrante sin aplicar (anticipos), excluye los 1.418 pagos históricos de Odoo.
- **RPCs nuevos**: `registrar_cobro_facturas` (reemplaza `registrar_cobro`, ahora con
  `p_asignaciones jsonb`), `verificar_pago` (6º parámetro `p_asignaciones`; wrapper de 5 args
  se conserva para compatibilidad), `aplicar_anticipo`, `facturar_orden` (factura interna desde
  una orden, numeración `F-000001…`, bloquea doble facturación), `aplicar_pago_a_facturas`
  (helper interno, valida cliente/saldo/monto). `recalcular_credito` reescrita para leer
  `facturas.saldo_usd`.
- **Deprecado**: `registrar_cobro` (drop), `ajustar_deuda_odoo` (drop, re-adjudicaba FIFO y
  hubiera desmentido las asignaciones manuales), `pago_ordenes`/`pago_cuentas` (solo lectura,
  histórico), `ordenes.monto_pagado/estado_pago/pagado` (comentados como deprecados).
- `scripts/sync-odoo-facturas.mjs`: ahora mapea `amount_total_signed`/`amount_residual_signed`
  a `total_usd`/`saldo_odoo_usd` y ya no sobrescribe `monto_pagado`/`saldo_pendiente` en re-sync.

### Deuda real verificada contra Odoo
`sum(saldo_usd)` = **$1.084.362,94** vs. Odoo en vivo `sum(amount_residual_signed)` =
$1.084.362,89 (diferencia de 5 centavos por redondeo por fila en 3.238 documentos — aceptable).
Reemplaza el número de la Fase 10 ($887.091, que sumaba mal las notas de crédito como deuda
positiva en vez de restarlas).

### Frontend
- **`Cuentas.tsx`**: deuda por cliente desde `facturas.saldo_usd`; filas de cliente ahora
  **navegan a `/admin/cuentas/:clienteId`** (nuevo, `CuentaDetalle.tsx`: facturas, notas de
  crédito y pagos del cliente con lo aplicado a cada factura — patrón de `ClienteDetalle.tsx`).
- **`CuentasPorCobrar.tsx`**: se eliminó el preview FIFO (`docsClienteFifo`/
  `previewAdjudicacion`); nuevo componente **`SelectorFacturas`**
  (`src/components/cuentas/SelectorFacturas.tsx`) para elegir manualmente facturas + monto por
  factura, reusado en "Registrar Cobro", "Verificar pago" y la nueva pestaña **Anticipos**
  (aplicar sobrante de un pago a facturas después).
- **Nuevo módulo Facturas** (`/admin/facturas`, `/admin/facturas/:id`) y **Notas de Crédito**
  (`/admin/notas-credito`, reusa `FacturaDetalle.tsx`) en el sidebar (sección Finanzas).
- **Órdenes**: botón **"Facturar"** en el detalle → `facturar_orden`; si ya tiene factura,
  muestra el número y linkea al detalle.
- Tipos de Supabase regenerados (`src/integrations/supabase/types.ts`).

### Verificación
- Backend probado por RPC directo (login real `qa.admin`, JWT real): cobro repartido en 2
  facturas ($12,92 + $10 de $25) → sobrante $2,08 de anticipo → `aplicar_anticipo` a una 3ª
  factura; validaciones de exceso (monto > saldo de factura, asignación > monto del pago)
  fallan sin dejar nada escrito (transaccional); `facturar_orden` genera `F-000001` y bloquea
  doble facturación.
- `tsc --noEmit` limpio · `npm run build` OK · Playwright (admin `qa.admin`): navegación por
  Cuentas → detalle de cuenta → Cuentas por Cobrar → Facturas → detalle de factura → Notas de
  Crédito → Órdenes, **0 errores de consola**; flujo completo de "Registrar Cobro" con
  selección manual de factura y envío real (revertido después). Datos y pagos de prueba
  limpiados; `credito_utilizado` recalculado para los 432 clientes.

### Pendiente
- No se migró la reconciliación factura↔pago histórica de Odoo (`account_partial_reconcile`):
  los 1.418 pagos importados no están linkeados a una factura específica (decisión tomada:
  `amount_residual_signed` ya es el saldo de partida correcto).
- Pasar los cambios de esquema aplicados por Management API a convención de migraciones ya
  quedó cubierto en esta fase (sí se creó el `.sql`); sigue pendiente para fases anteriores.
- (Opcional) Code-splitting: el bundle JS supera 500 kB.

---

## 2026-08-17 · Módulo de FACTURAS (migradas desde Odoo)

Las órdenes son el pedido comercial; la deuda real de Cuentas/Cuentas por Cobrar vive en las **facturas** (documento fiscal de Odoo, `account_move`), no en las órdenes. Se creó el módulo y se migraron los datos.

### Esquema nuevo (`supabase/migrations/20260817_fase10_facturas.sql`, aplicada a prod)
- **`facturas`**: número, tipo (factura/nota_credito), cliente, orden origen (opcional, vía `sale_id`), fechas, moneda (USD/VES) + tasa de cambio, subtotal/impuesto/total, monto pagado, **saldo pendiente real** (`amount_residual` de Odoo), estado de pago, referencia, **nro. de control fiscal**, vendedor, `odoo_id` (idempotencia).
- **`factura_items`**: líneas (producto, cantidad, precio, descuento, subtotal/total), `odoo_id`.
- RLS igual que `pagos`/`ordenes`: admin por permiso de módulo `cuentas`, cliente ve las suyas, vendedor ve las de sus clientes asignados.

### Migración de datos (`scripts/sync-odoo-facturas.mjs`, solo lectura en Odoo, idempotente)
- Fuente: `account_move` (`move_type in ('out_invoice','out_refund')`, `state='posted'`) + `account_move_line` (`display_type='product'`).
- Vínculos resueltos: `sale_id → ordenes.odoo_id` (coinciden 1:1), `partner_id`/`commercial_partner_id → clientes.odoo_id`, `product_id → product_product.product_tmpl_id → productos.odoo_id`.
- **Resultado:** 3.238 facturas (2.538 USD + 700 VES) + 8.757 líneas. 1.444 facturas con orden de origen encontrada. **Deuda real por facturas (USD): $887.091,04** — este es el número que debería reemplazar la deuda basada en órdenes en Cuentas/Cuentas por Cobrar.

### Pendiente
- Los módulos **Cuentas** y **Cuentas por Cobrar** (`Cuentas.tsx`, `CuentasPorCobrar.tsx`) y el RPC `registrar_cobro` siguen calculando la deuda desde `ordenes` + `cuentas_cobrar`, no desde `facturas`. Falta migrar esa lógica (y la UI) para que adjudique cobros contra facturas.
- No se migró la relación factura↔pago de Odoo (partial reconcile) — los pagos ya importados (`pagos.odoo_id`) no están linkeados a una factura específica todavía.
- Facturas en VES no tienen la deuda consolidada a USD en el resumen de arriba (falta aplicar `tasa_cambio` para un total combinado).

---

## 2026-08-17 · Verificación de acceso (Supabase + Odoo)

- **Supabase:** nuevo `SUPABASE_ACCESS_TOKEN` (Management API) en `.env.local`, entregado por el hub — probado con `GET /v1/projects/{ref}` → 200 OK.
- **Odoo:** re-verificada la conexión de solo lectura (`node scripts/odoo-verificar.mjs`) — **sigue funcionando** tanto la API HTTPS como PostgreSQL directo (5432), sin problema de VPN/firewall (aquello se resolvió el 14 ago, ver memoria `guds-odoo-conexion`). Datos actuales: 590 plantillas/variantes de producto (eran 580), 432 clientes (`customer_rank>0`, sin cambio), 2.142 registros en `res_partner` (eran 2.138).
- JWT legacy de Supabase: ya deshabilitado por el cliente (pendiente cerrado).

---

## 2026-08-14 · Checkout: banco destino + filtro por moneda

- En el checkout (`PortalCarrito`), cuando el método lleva comprobante (transferencia/pago móvil), el cliente ahora elige **moneda (USD / Bs)** que **filtra las cuentas** (solo USD o solo Bs) y **selecciona el banco destino** al que pagó (muestra nombre, nº de cuenta y titular). Se muestra el monto a transferir (en Bs = total×tasa BCV).
- Backend (`20260814b_checkout_banco_destino.sql`): `crear_orden_desde_carrito` acepta `p_banco_id/p_moneda/p_tasa` y los guarda en el pago pendiente (monto USD; monto_moneda/tasa si es Bs). El pago entra a la cola con el **banco ya asignado** → el admin lo ve prellenado al verificar.
- Verificado E2E: checkout USD → pago pendiente con banco "Banco Banesco PANAMA" → admin aprueba → orden pagada. Solo cuentas USD visibles al elegir USD. 0 errores.

---

## 2026-08-14 · Unificación del flujo de pagos pendientes (3 portales → cola admin)

Cierra los puntos 1 y 4 pendientes de la auditoría de compra: hoy todos los pagos pendientes (checkout, portal cliente, vendedor) fluyen a UNA cola de verificación admin, y al aprobar se aplican a la deuda real.

### Backend (migración `supabase/migrations/20260814_unificar_pagos_pendientes.sql`, aplicada a prod)
- **`verificar_pago(p_pago_id, p_aprobar, p_notas, p_banco_id?, p_tasa?)`** reescrito: al **aprobar** ya no solo setea el boolean `pagado` (vía `liquidar_orden`); ahora **adjudica el monto a la deuda real** (`monto_pagado`/`estado_pago`) igual que `registrar_cobro` — primero la orden ligada, luego FIFO por fecha (órdenes + `cuentas_cobrar`), y crea el **movimiento bancario** si se asigna banco. Al **rechazar**, marca `rechazado`. Solo admin (`is_admin()`).
- **`crear_orden_desde_carrito`**: si el checkout llevó comprobante, inserta un **pago `pendiente`** ligado a la orden → entra a la cola (antes el comprobante quedaba solo en la orden, huérfano).
- **`trg_pago_insert`**: la notificación al admin ahora apunta a `/admin/cuentas-por-cobrar`.

### UI admin (`CuentasPorCobrar.tsx`)
- Nueva pestaña **"Por verificar (N)"** con badge de conteo: lista los pagos `pendiente` (cliente, orden, método, referencia, monto, fecha).
- Diálogo **Verificar pago**: muestra detalle + **Ver comprobante** (signed URL), permite asignar **banco** (opcional, registra el movimiento), notas, y **Aprobar y adjudicar** / **Rechazar**. La pestaña "Recibos" ahora filtra solo `verificado`.

### Verificación end-to-end (Playwright)
- Backend: verificar 60/100 → parcial, +40 → pagado (monto_pagado correcto).
- Full: cliente hace checkout con **Transferencia + comprobante** → orden + **pago pendiente** (PAG-…) → admin lo ve en "Por verificar" → **Aprobar** → orden `monto_pagado=total, estado_pago=pagado, pagado=true`, pago `verificado`. 0 errores de consola en cliente y admin. Datos de prueba limpiados.

### Resultado
- **Un solo circuito**: checkout / portal cliente / vendedor crean pagos `pendiente` → admin verifica en un solo lugar → se refleja en la deuda real (Cuentas / Cuentas por Cobrar / portales). Cierra el desfase entre los dos modelos de contabilidad (`pagado` boolean vs `monto_pagado`).

---

## 2026-08-14 · Auditoría del flujo de compra (portal del cliente)

Recorrido Catálogo → Carrito → Checkout → Pago, verificado end-to-end.

### Estado: FUNCIONA
- Checkout end-to-end verificado (cliente QA ligado a un cliente de prueba desechable, revertido después): agregar al carrito → `crear_orden_desde_carrito` **RPC 200** → orden creada (`ORD-…`) → `/portal/pedidos`. El RPC recalcula todo en servidor (precios por `precio_efectivo` con lista del cliente, IVA/envío de `configuracion`, valida cupón, chequea crédito) e inserta orden `pendiente` + items + vacía el carrito atómicamente. Sin columnas obsoletas.

### Bugs corregidos
- **Precio del diálogo de empaque** (`PortalCatalogo.tsx`): mostraba `precio_base × unidades`, distinto de lo que cobra el checkout (`precio_efectivo`). Ahora pide el precio real por empaque al abrir el diálogo → **precio mostrado = precio cobrado**.
- **Key duplicada "Todos"** (warning de React): existe una categoría llamada "Todos" que chocaba con el pill fijo "Todos". Se dedupe todo el arreglo de categorías.
- **`getCartQuantity`** sumaba solo la primera fila del producto; ahora suma todas las presentaciones (empaques) de ese producto.
- **PortalPagos**: se quitó la lista muerta `metodosPago` (tenía `deposito`, que no es válido). Ahora lee `bancos.metodos[]` (multi-método), muestra los métodos por banco (ej. Banco Mercantil → "Tarjeta, Transferencia") y agrega un **selector de Método** (incl. tarjeta). Sigue con `registrar_pago` (pago del cliente queda **pendiente** de verificación).

### Hallazgos para decidir (no tocados — requieren decisión de negocio)
1. **Comprobante del checkout "huérfano"**: `crear_orden_desde_carrito` guarda el comprobante en `ordenes.comprobante_url` pero NO crea una fila en `pagos`, y la verificación (`liquidar_orden`) suma `pagos`. Así, el pago hecho en el checkout no marca la orden como pagada hasta que el cliente lo re-reporta en PortalPagos o el admin lo registra. Conviene unificar (crear un `pago` pendiente en el checkout).
2. **Sin datos del banco destino en el checkout**: para transferencia/pago móvil se exige referencia + comprobante, pero no se le muestra al cliente a qué cuenta transferir. Falta mostrar la cuenta.
3. **`tarjeta` no está en el checkout del cliente** (sí en admin/vendedor): es intencional por ahora (no hay pasarela de tarjeta en el autoservicio); confirmar si se quiere.
4. **Cola admin para verificar pagos pendientes**: el pago del vendedor/cliente queda `pendiente`; falta la pantalla admin para verificarlos y aplicar la adjudicación.

### Verificación
- `tsc` limpio · `npm run build` OK · Playwright (cliente QA): compra 200, catálogo 0 errores (key duplicada eliminada), selector de Método presente. Datos de prueba limpiados.

---

## 2026-08-14 · Ajustes al registro de cliente + verificación del bug de envío

Cambios pedidos por el cliente (3 screenshots) sobre el proceso de registro público (`/registro`).

### Cambios aplicados
- **Título**: "Registro de Cliente **Mayorista**" → "Registro de Cliente" (`src/pages/Registro.tsx`).
- **Tipos de negocio**: nueva lista de 14 (Kiosco, Abasto, Supermercado, Bodega, Licorería, Restaurante, Hotel, Panadería, Cafetería, Distribuidor(a), Bodegón, Mini farmacia, Cantina, Otro).
- **Prefijos de teléfono**: solo móviles `0412/0414/0416/0422/0424/0426`; se quitaron los locales `0212/0241/0243/0251/0261/0281` (`src/components/forms/PhoneInput.tsx`).

### Bug "revisa tu conexión e intenta de nuevo" (email de Wonderly, 12 ago) → NO reproducible hoy
- Diagnóstico: el insert anónimo en `registros_clientes` **funciona** (201) tal como lo hace supabase-js (`.insert()` sin `.select()`, `Prefer: return=minimal`). El rol se resuelve como `anon` y existe la policy `registros_anon_insert` (check `true`) + grant + policy de storage `registro_anon_upload_documento`. La subida del RIF también funciona (200).
- La causa del fallo del 12 ago fue el **estado pre-migración** (anon key legacy / RLS a medio endurecer). Con las llaves `sb_publishable_` + las RLS ya publicadas, el flujo quedó operativo. Ver [[guds-supabase-keys-nuevas]] y [[guds-rls-expuesto]].
- **Verificado end-to-end (Playwright, anónimo):** los 3 pasos + "Enviar Solicitud" → INSERT 201 → pantalla "¡Solicitud Enviada!", 0 errores de consola. Datos de prueba limpiados.

### Pendiente / mencionado en el email
- Wonderly también pidió "revisar el proceso de **compra** para ajustar los flujos" — no auditado aún en esta sesión (candidato para la próxima).

---

## 2026-08-14 · Auditoría del portal del vendedor

Revisión módulo por módulo del portal `/vendedor` tras las importaciones de Odoo y los cambios de estructura.

### Hallazgo principal → RESUELTO
- **Ningún cliente tenía `vendedor_asignado_id`** (0 de 432). El import de Odoo solo guardó el vendedor como **texto** en `clientes.vendedor_odoo` (15 nombres). Como el portal y las RLS filtran por `vendedor_asignado_id`, cada vendedor veía su portal vacío.
- **Solución (elegida por el usuario):** se crearon **15 usuarios vendedor** (uno por nombre de Odoo), email placeholder `<slug>@guds.test` (ej. `anderson.albornoz@guds.test`), password temporal común **`GudsVend-2026!`** (a cambiar), y se asignaron **367 clientes** por match de `vendedor_odoo`. Los otros 65 no traían vendedor en Odoo. **SOPORTE CORPOEUREKA** (4 clientes) probablemente no es un vendedor real → revisar/desactivar. Verificado: anderson.albornoz → 87 clientes, saldo cartera real $52.787,53, 0 errores.
- **Pendiente menor:** reemplazar los emails placeholder por los reales de cada vendedor y que cambien su contraseña.

### Correcciones aplicadas (código)
- **VendedorDashboard**: ahora filtra clientes por `vendedor_asignado_id`; "Saldo cartera" usa deuda **real** (saldos de órdenes + `cuentas_cobrar`) en vez de `credito_utilizado`.
- **VendedorClientes**: "Saldo pendiente" = deuda real por cliente (órdenes + cuentas), estado Con deuda/Excedido/Al día.
- **VendedorPagos**: bancos **multi-método** + selector de **Método** (incluye tarjeta), etiqueta de método legible. Sigue usando `registrar_pago` (deja el cobro **pendiente** hasta que admin verifica — flujo correcto del vendedor). Lista de pagos correctamente acotada por RLS a sus clientes.
- **VendedorPedidos**: opción de pago **Tarjeta** agregada.
- **VendedorInventario**: filtra `productos.activo = true` (no muestra desactivados). (Sigue con stock global `productos.stock_actual`, no per-almacén — aceptable para vista de vendedor.)

### Verificación
- `tsc` limpio · `npm run build` OK · Playwright como `qa.vendedor@guds.test` con 10 clientes de prueba (asignación **revertida** después): 6 módulos cargan con **0 errores de consola**. Deuda del vendedor coincide con la del admin (FARMATODO $212.958,85, etc.).

### Notas
- `registrar_pago` deja el pago del vendedor en `estado='pendiente'`; falta confirmar/definir la UI **admin** para verificar esos pagos pendientes y que apliquen la adjudicación (hoy el admin usa `registrar_cobro` directo).

---

## 2026-08-14

### Resumen
Sesión centrada en: (1) métodos de pago múltiples por banco + tarjeta, (2) reescritura del módulo **Cuentas** para mostrar la deuda real, (3) **sidebar** colapsable con secciones, (4) **agrupaciones** en Órdenes/Productos/Inventario, y (5) preview de cobro multi-orden. Antes en el día: importación de pagos de Odoo y ajuste de deuda al residual de Odoo.

### 1. Métodos de pago múltiples por banco + tarjeta
- Odoo **no** guarda método granular (todo es "Pago manual"); el único distintivo real es `pago_por_pv` = punto de venta → **tarjeta** (31 recibos). El resto = transferencia.
- Se agregó `tarjeta` al enum `pago_metodo` y a la tabla config `metodos_pago` (5 métodos: transferencia, pago_movil, efectivo, credito, tarjeta).
- `bancos` ahora tiene columna **`metodos text[]`** (un banco recibe varios métodos). `Bancos.tsx`: form con checkboxes (Transferencia/Pago Móvil/Tarjeta/Efectivo), la tabla muestra badges.
- Los 1418 recibos importados se re-mapearon: `tarjeta` si el pago Odoo tenía `pago_por_pv`, si no `transferencia` → **1387 transferencia + 31 tarjeta**.
- Diálogos de cobro (`CuentasPorCobrar.tsx`, `Cuentas.tsx`): al elegir banco se llena un Select **Método** con los métodos de ese banco.

### 2. Módulo Cuentas → "Estado de Cuentas" con data real
- Antes mostraba `credito_utilizado` (solo crédito, incorrecto). Ahora la deuda real = Σ(saldo órdenes: total − monto_pagado) + Σ(saldo cuentas_cobrar).
- KPIs reales: **Total por Cobrar $1,219,258.32** (= residual exacto de Odoo), Cobrado del mes, Clientes con Deuda (283), Recibos (1418).
- Pestaña **Movimientos** = libro de cuenta real (cobros +, órdenes/cuentas como cargos −).
- Botón "Registrar Cobro" usa el RPC unificado `registrar_cobro` (adjudicación FIFO con parciales).

### 3. Sidebar colapsable + secciones desplegables
- `Sidebar.tsx` + `MainLayout.tsx`: botón para colapsar (`w-64`↔`w-16`, solo íconos + tooltips). Estado en `localStorage['guds-sb-collapsed']`; el contenido reajusta su margen.
- Módulos reorganizados en secciones plegables: **Principal · Ventas · Catálogo · Inventario · Finanzas · Logística**. Estado abierto/cerrado en `localStorage['guds-sb-sections']`. Se filtran por permisos y las secciones vacías se ocultan.

### 4. Agrupaciones en tablas
Patrón reutilizable: botón toggle "Agrupar por X" → filas-cabecera de grupo colapsables (chevron + nombre + conteo + total) dentro de la misma tabla; grupos colapsados por defecto; sin paginación en modo agrupado.
- **Órdenes** (`Ordenes.tsx`): agrupar por **cliente** (nº órdenes + total).
- **Productos** (`Productos.tsx`): agrupar por **categoría** (13 categorías).
- **Inventario** (`Inventario.tsx`): pestaña nueva **"Por Almacén"** desde `inventario_almacen` (1708 filas; badge propio/consignación + nº SKU + total unidades). La pestaña "Stock Actual" sigue con el stock global.

### 5. Cobro que abarca varias órdenes
- No hay selector de órdenes: se registra **un** cobro a nivel de cliente y `registrar_cobro` adjudica **FIFO por fecha** (órdenes + cuentas UNION, `coalesce(fecha_pedido,created_at)` asc), dejando una parcial y el sobrante como saldo a favor.
- Se agregó un **preview en vivo** en el diálogo "Registrar Cobro" (`CuentasPorCobrar.tsx`): al elegir cliente + monto muestra qué documentos se cubren (Cubierta/Parcial) y el sobrante, replicando el orden FIFO del backend.

### Cambios en base de datos (aplicados a producción vía Management API)
> No están en `supabase/migrations` (se aplicaron directo). Documentados acá para reproducibilidad.
- `alter type public.pago_metodo add value if not exists 'tarjeta';`
- `insert into metodos_pago (nombre, tipo, ...) values ('Tarjeta','tarjeta',...)` (si no existía).
- `alter table public.bancos add column if not exists metodos text[];` + backfill (métodos recibidos ∪ transferencia; banco "Efectivo" → ['efectivo']).
- `update pagos set metodo='tarjeta'` para los recibos cuyo `account_payment` Odoo tenía `pago_por_pv` (31 filas).
- (Antes en el día) Importación de pagos de Odoo: 1418 recibos + bancos, y `ajustar_deuda_odoo(...)` para que el saldo == residual de Odoo. Total por cobrar = **$1,219,258.32**.

### Estado actual
- `tsc --noEmit` limpio · `npm run build` OK · 0 errores de consola en Playwright.
- Verificado en `:8081`: sidebar (expandido/colapsado), agrupaciones (Órdenes/Productos/Inventario), Estado de Cuentas con data real, bancos multi-método, preview de cobro.

### Pendientes / Próxima sesión
- Evaluar pasar los cambios de esquema aplicados por Management API a archivos de migración formales.
- (Opcional) Code-splitting: el bundle JS supera 500 kB.
