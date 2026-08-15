# Bitácora — GUDS B2B Hub

Registro de trabajo por sesión. La entrada más reciente va arriba. Cada entrada
resume qué se ejecutó, qué cambió en base de datos (producción) y qué queda pendiente.

- **Proyecto Supabase (prod):** `oyyxkbwtyxdpzsgarmim`
- **Dev server local:** este repo corre en `http://localhost:8081` (el `:8080` lo ocupa otra app que apunta a otro proyecto Supabase).
- **Regla Odoo:** solo lectura, nunca escribir. Los `scripts/sync-odoo-*.mjs` leen credenciales desde variables de entorno (`.env.local` + `ODOO_PG_*`, ambos fuera de git).
- **Admin de prueba (QA):** `qa.admin@guds.test` / `GudsQA-2026!circuito`.

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
- Conexión Odoo por PG directo falla por VPN; falta usuario RO / API key para vía HTTPS estable (ver memoria `guds-odoo-conexion`).
- Deshabilitar el JWT legacy en Supabase (ya migrado a `sb_publishable_`/`sb_secret_`); confirmar que no quede nada usando la anon legacy.
- Evaluar pasar los cambios de esquema aplicados por Management API a archivos de migración formales.
- (Opcional) Code-splitting: el bundle JS supera 500 kB.
