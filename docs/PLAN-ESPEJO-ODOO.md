# Plan: GUDS como espejo de Odoo (multiempresa)

> Acordado el 2026-09-26/27. Se actualiza a medida que avanzan las fases.

## Objetivo
GUDS es un **espejo de Odoo** (Odoo 18 Enterprise de Corpo Eureka) para operar encima lo que Odoo no tiene:
ecommerce por empresa, pedidos de vendedores desde el celular, delivery y reportería.
**Fuera de alcance:** asientos contables, plan de cuentas y las apps de Odoo sin datos (web, CRM, fabricación, flota, empleados, firmas).

## Reglas
- **Odoo manda** en todo lo que existe en Odoo. GUDS lo refleja; los campos que vienen de Odoo llevan la
  **marca Odoo** (componente `OdooBadge`) y no se editan en GUDS (se editan en Odoo).
- **Una sola base** con `empresa_id` en cada tabla de negocio; `empresa_id` nulo = registro compartido
  (igual que `company_id` nulo en Odoo). Empresas: GUDS SUPPLY, C.A. (Odoo 1) y QUIRUTEC, C.A. (Odoo 3).
- **Selector de empresa en el header**: GUDS / Quirutec / Ambas. "Ambas" = solo consulta (la base rechaza altas y cambios).
- **Acceso por usuario**: cada usuario tiene sus empresas asignadas (Configuración → Usuarios).
- **Tienda por empresa**; un cliente presente en ambas cambia con el mismo selector.
- **Vendedores con internet** (sin modo offline).
- **Marca por empresa**: logo y datos fiscales; mismo diseño.

## Decisiones tomadas (2026-09-27)
1. **Precio base**: se recupera de las cotizaciones y órdenes de Odoo y se guarda como precio base en GUDS.
   **Nunca se cambia un precio en Odoo.**
2. **Conciliación bancaria**: la herramienta de GUDS se mantiene y debe funcionar (a futuro podría llevarse a Odoo).
3. **Clientes nuevos desde GUDS** se crean en Odoo, **sin duplicados por RIF ni por nombre**.
4. **Vendedores sin correo real**: se dejan los campos para llenarlos después.
5. **Escritura en Odoo** con la key de Freddy Cardoso. Todo lo que GUDS cree en Odoo debe quedar marcado
   (campo de origen o texto "(GUDS)"), igual que en GUDS lo que viene de Odoo lleva la marca Odoo.
6. **Otras retenciones**: se adaptan las que se usan (ver Fases 4 y 5).

## Fases
| # | Fase | Estado |
|---|---|---|
| 0 | Preparación: respaldo, foto de esquema, scripts viejos retirados, credenciales a `.env.local` | ✅ 2026-09-27 |
| 1 | Multiempresa: tablas, permisos, selector, numeración por empresa, marca Odoo | ✅ 2026-09-27 (falta publicar el frontend) |
| 2 | Importador nuevo (API) y reimportación limpia separada por empresa | ✅ 2026-09-27 |
| 3 | Maestros: productos (precio desde órdenes), listas de precios, clientes, proveedores, vendedores, bancos, impuestos | ✅ 2026-09-27 |
| 4 | Ventas y CxC: órdenes, facturas, NC, ND, pagos con aplicación a facturas, antigüedad, retenciones recibidas | ✅ 2026-09-27 |
| 5 | Compras y CxP: órdenes de compra, facturas de proveedor, pagos a proveedores, retenciones emitidas | ✅ 2026-09-27 |
| 6 | Inventario: stock por almacén, lotes y vencimientos, transferencias, consignación | ✅ 2026-09-27 |
| 7 | Bancos y tesorería: cuentas, cajas, extractos, conciliación GUDS | ✅ 2026-09-27 |
| 8 | Capa GUDS: tienda por empresa, portal cliente/vendedor, crédito, stock comprometido, contactos, delivery, reportes | ✅ 2026-09-27 |
| 9a | Sincronización periódica Odoo → GUDS (15 min + nocturna), solo lectura de Odoo | ✅ 2026-09-27 |
| 9b | Envío a Odoo de pedidos, clientes, contactos y límites de crédito creados en GUDS (marcados "(GUDS)") | 🟡 primera prueba hecha: 1 pedido → S00927 (27-sep); falta automatizar |

### Fase 0 — hecho
- Respaldo completo en `C:\Users\gabri\GUDS-backups\2026-09-27` (fuera del repo y de OneDrive) con
  `node scripts/respaldo-supabase.mjs`.
- Foto de esquema en `supabase/schema/esquema-2026-09-27.sql` (referencia, **no** es migración: las migraciones
  de 2026 se aplicaron a mano y `supabase_migrations` quedó en dic-2025).
- Scripts `sync-odoo-*` movidos a `scripts/legacy-odoo/` y bloqueados.
- Credenciales de Postgres de Odoo en `.env.local` (`ODOO_PG_*`); `scripts/odoo-verificar.mjs` ya no tiene secretos.

### Fase 8 — hecho
- Migraciones `20260927_fase18l_credito_contactos.sql`, `…18m_stock_comprometido.sql`, `…18n_portal_clientes.sql`,
  `…18o_contactos_vendedor.sql` y `…18p_registro_empresa.sql`.
- **Crédito** (decisión del 27-sep): por ahora **abierto** (`configuracion.credito_modo = 'abierto'`); en Configuración →
  Empresas se puede pasar a "exigir el límite". Las tres vías de pedido (tienda, vendedor, admin) usan `validar_credito`
  (antes rechazaban todo pedido a crédito con límite 0). El **límite se puede editar en GUDS** (ficha del cliente o formulario):
  queda "pendiente de enviar a Odoo" (`limite_credito_pendiente`) y la sincronización no lo pisa hasta que se envíe (Fase 9).
- **Stock comprometido, como en Odoo**: disponible = existencia en almacenes propios − entregas y traslados a consignación
  pendientes en Odoo − pedidos de GUDS que aún no están en Odoo (`productos.stock_disponible`). Al entregarse en Odoo baja la
  existencia y se libera lo comprometido. Los pedidos validan el disponible en el servidor (solo productos con control de stock
  en Odoo; servicios sin tope) y la tienda/vendedor/admin muestran el disponible y no dejan pasarse. `orden_items` guarda ahora
  el empaque y sus unidades (antes solo la cantidad de empaques). El trigger viejo que descontaba `stock_actual` (espejo de
  Odoo) quedó solo para productos propios de GUDS.
- **Contactos del cliente y acceso al portal**: en Odoo no hay contactos hijos (solo direcciones de entrega), así que nacen en
  GUDS (`cliente_contactos`). Cada contacto con correo puede tener su usuario: el admin (o el vendedor, solo de sus clientes)
  pulsa "Dar acceso", GUDS genera una **contraseña temporal** que se comparte por un canal privado y el contacto **debe crear
  la suya en el primer ingreso**. "Restablecer clave" genera otra temporal; "Desactivar" bloquea el acceso. Los registros
  aprobados también entran con clave temporal y cambio obligatorio.
- **Cliente presente en ambas empresas** (14 RIF): un mismo usuario ve la ficha de la empresa activa (`mi_cliente_id()`);
  las políticas del portal usan `clientes_del_usuario()`.
- **Registro público por empresa**: el solicitante elige con qué empresa quiere comprar; el cliente se crea en esa empresa.
- Portal: disponible en catálogo y carrito, crédito abierto visible al pagar, direcciones de entrega de Odoo en "Direcciones".
  Delivery: estado del despacho en Odoo por orden y filtro "listas para despachar".
- **Flancos corregidos**:
  - "Usuarios del cliente" creaba accesos con `signUp` desde el navegador: con la confirmación por correo activa y sin SMTP,
    esos usuarios no podían entrar. Se rehízo con funciones del servidor.
  - Configuración → Empresas tenía ajustes de crédito e inventario que no guardaban nada: se reemplazaron por la política real.
  - `updateUser` no estaba memoizado (recargas en cadena al resolver la empresa del cliente).
  - Un vendedor podía dar acceso al portal a cualquier cliente: ahora solo a los suyos.
- Verificado: 56 pruebas de base (crédito abierto/límite, stock, compromiso de un pedido, cliente en ambas empresas, accesos,
  registro por empresa), 15 verificaciones de punta a punta (admin da acceso → contacto cambia su clave → compra a crédito →
  cambia de empresa → vuelve a entrar → restablecer clave) y recorridos sin errores: 70 pantallas de administración y 52 del portal del cliente (13 × 2 empresas × móvil y escritorio); cuadre 68/68 e importación idempotente. Datos de prueba borrados (pedidos, notificaciones,
  usuarios, contactos y numeración).

### Fase 9b — en curso (envío a Odoo; prohibido borrar en Odoo)
- Motor `supabase/functions/_shared/odoo-sync/enviar.js` + `scripts/enviar-pedido-odoo.mjs <pedido> [--apply]`. El cliente de
  Odoo (`odoo.js`) tiene una única vía de escritura, `crear()`, limitada a `create` en `sale.order`; no existe forma de borrar ni
  modificar registros de Odoo desde GUDS.
- El pedido se crea como **cotización en borrador** en la empresa del pedido, con almacén general P-01, precio de GUDS por unidad,
  referencia `<número> (GUDS)`, origen `GUDS` y nota "(GUDS)". Solo clientes con lista de precios en USD (en Bs habría que convertir).
- Idempotente (busca la referencia antes de crear) y vincula pedido y líneas con su `odoo_id` para que la sincronización no duplique.
- **Primera prueba (27-sep):** GUDS-ORD-00001 → **S00927** (Quirutec como cliente de GUDS, 1 × CARAMELOS CHAO $0,38, "No procesar").
  Detalle y hallazgos en la bitácora (almacén de consignación en S00927, envío de $50 sin equivalente en Odoo).

### Fase 9a — hecho (sincronización periódica, solo lectura de Odoo)
- Función edge **`sync-odoo`** (`supabase/functions/sync-odoo/`) con el mismo motor del importador; escribe por conexión
  directa a Postgres: una corrida completa tarda **~55–65 s** (antes 165 s por la API de gestión), dentro del límite de
  150 s del plan gratuito de Supabase. Responde 202 y trabaja en segundo plano; no se solapa con otra corrida.
- Programación (`pg_cron`, migración 19b): **cada 15 min de 07:00 a 19:45 (Caracas), lunes a sábado** + **nocturna
  diaria a las 02:00**. El job llama `disparar_sync_odoo()` (pg_net) con el secreto guardado en **Vault**.
- **Guardia de lectura**: si alguna entidad leída de Odoo cae a menos de la mitad de lo que hay en GUDS (p. ej. por un
  cambio de permisos de la API key), la corrida aborta antes de escribir (evita borrados masivos).
- Registro en `sync_corridas` (corridas, simulaciones y trazas de progreso; limpieza automática a 2/60 días).
- Interfaz: indicador **"Odoo · hace X min"** en el header (verde/ámbar/rojo) con **"Sincronizar ahora"** para quien
  puede editar Configuración (`solicitar_sync_odoo()`; el secreto nunca llega al navegador).
- Secretos de la función: `ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_API_KEY` (la de Freddy Cardoso), `SYNC_ODOO_SECRET`.
  **La API key de Odoo del grupo "Internal User" vence a los 90 días**: al vencer, el indicador se pone rojo y hay que
  generar otra y actualizar el secreto `ODOO_API_KEY` (y `.env.local`).
- Verificado: diagnóstico del adaptador SQL, simulación y corrida aplicada en la nube, disparo por pg_net y por un job
  de cron de prueba, cuadre 68/68, 74 pruebas de base y e2e del indicador ("Sincronizar ahora" termina en ~66 s).

### Reportes (capa GUDS, flanco 30) — hecho
- Página `/admin/reportes` (permiso del módulo **Reportes**), menú Principal. Funciones en la base (migración
  `20260927_fase18u_reportes.sql`, `security definer` con filtro de empresa activa/ambas): `reporte_ventas`,
  `reporte_cobranza`, `reporte_inventario`.
- **Venta** = facturas y NC contabilizadas en Odoo, sin saldos iniciales ni notas de débito, neta de IVA, en USD
  (subtotal × total_usd / total). Coincide con la suma directa de documentos (agosto: GUDS $213.715,83; Quirutec
  $180.832,37; ambas $394.548,20).
- Ventas: venta neta vs período anterior, facturado, NC, clientes, ticket; gráfico de 12 meses; por vendedor (Odoo),
  categoría, cliente, producto y empresa (modo "Ambas"). Cobranza: cobros verificados sin IGTF por banco/caja,
  vendedor del cliente, cliente, método y empresa; gráfico de 12 meses. Inventario y rotación: disponible, vendido en
  30/60/90/180 días, última venta, **cobertura en días** (riesgo de quiebre < 15 días) e inmovilizado.
- Todas las tablas se ordenan y exportan a CSV; períodos predefinidos o personalizados.

### Fase 7 — hecho
- Migraciones `20260927_fase18j_tesoreria.sql` y `…18k_saldo_extracto.sql`. Importador: `supabase/functions/_shared/odoo-sync/tesoreria.js`.
- **Movimientos bancarios completos** (antes solo cobros): 1.675 cobros, 831 pagos a proveedores, 74 reintegros de proveedores,
  70 reintegros a clientes y 2 depósitos por identificar, cada uno con su origen (`movimientos_bancarios.origen`).
  Con esto la **conciliación propia de GUDS** (decisión 2) casa también las salidas; probado en base (entrada + salida
  conciliadas automáticamente).
- **Saldo de cada banco según Odoo**: contable en la moneda del banco (en Bs se suman los apuntes de la cuenta, porque Odoo no
  agrega montos en moneda extranjera) y en USD, más el saldo del último extracto. Disponible hoy: GUDS $109.202,99 +
  Bs 29.862.219,19; Quirutec $41.279,18 + Bs 81.762.785,94 (en pantalla con su equivalente a tasa BCV).
- **Extractos bancarios de Odoo** (espejo): 38 extractos y 1.335 líneas (661 conciliadas en Odoo, 674 por conciliar).
- **IGTF**: los 31 pagos de IGTF quedan ligados a su cobro de origen ("IGTF del cobro …" en Cobros). Pagos por lote de Odoo:
  se guarda el lote en cada pago (46 pagos a proveedores; los 14 lotes de Odoo están en borrador).
- Pantallas: **Bancos** (disponible en USD y Bs, líneas por conciliar, depósitos por identificar con su detalle) y **detalle
  de banco** (`/admin/bancos/:id`: saldos, movimientos por origen con enlace al documento, extracto de Odoo conciliado/por
  conciliar y extractos con saldo inicial y final). Torre de control: depósitos por identificar.
- Cuadre ampliado a **68 controles** (extractos, líneas, conciliadas, neto de extractos y coherencia de movimientos/IGTF).
- Verificado: 46 pruebas de base, cuadre 68/68, importación idempotente, 16 verificaciones de UI de la fase y recorrido de
  66 pantallas sin errores.

### Fase 6 — hecho
- Migraciones `20260927_fase18f_inventario.sql` (lotes, existencias por lote, transferencias con movimientos y lotes,
  `inventario_almacen.reservado`, `almacenes.vinculo_cliente`), `…18h_vinculo_consignacion.sql` e `…18i_ajustes_inventario.sql`.
  Espejo de solo lectura (RLS por empresa, lectura con el módulo `inventario`, sin políticas de escritura).
- Importador: `supabase/functions/_shared/odoo-sync/inventario.js`. Resultado: 948 lotes/series (938 con vencimiento; las fechas
  de relleno 1900-01-01 de Odoo se toman como "sin vencimiento"), 2.109 existencias por ubicación y lote, 2.827 transferencias,
  12.198 movimientos, 11.800 líneas con lote y 3.505 ajustes de inventario. Reservado: GUDS 2.038 u, Quirutec 3.368 u.
  Cuadre ampliado a **56 controles** (lotes, existencias, unidades, reservado, transferencias, movimientos, trazabilidad y ajustes).
- Pantallas:
  - **Inventario**: columnas Reservado y Disponible (stock propio − reservado en Odoo), pestaña **Lotes y vencimientos**
    (vencidos con existencia, vencen en 30/90 días, sin fecha) y aviso de que el stock de Odoo se mueve en Odoo.
  - **Transferencias** (nuevo, Inventario → Transferencias): entregas, recepciones y traslados con indicadores (listas para
    despachar, en espera, recepciones y traslados pendientes); detalle con productos, lotes y vencimiento, cliente, orden,
    almacenes, devoluciones y entregas parciales.
  - **Detalle de lote** (`/admin/lotes/:id`): dónde está, **clientes que lo recibieron** (para retiros o reclamos) y trazabilidad
    completa (transferencias + ajustes de inventario).
  - **Detalle de almacén**: productos desplegables en sus lotes con vencimiento, reservado, lotes por vencer/vencidos y acceso a
    sus movimientos; en consignaciones, cómo se identificó el cliente y acción para asignarlo/cambiarlo a mano.
  - **Órdenes**: la orden muestra sus despachos de Odoo; enlace directo `?orden=<id>`.
  - **Torre de control**: lotes vencidos con existencia, lotes que vencen en 30 días y entregas listas para despachar.
- **Consignación (flanco 8)**: el cruce por nombre casi nunca funcionaba (la expresión solo reconocía la variante mal escrita
  "CONSGINADO") y se conservaban vínculos de la carga vieja, 5 de ellos apuntando a la ficha del cliente en la OTRA empresa.
  Ahora: por nombre → si no, por el cliente que recibe ≥ 60 % de las entregas del almacén (p. ej. "CMDLT" → Centro Médico
  Docente La Trinidad) → si no, se conserva el anterior solo si es de la misma empresa; el vínculo manual de GUDS se respeta
  siempre ("Volver a automático" lo devuelve a la sincronización). Resultado: 61 de 107 consignaciones con cliente
  (55 por nombre, 6 por entregas); 0 vínculos entre empresas.
- **Flancos corregidos**:
  - **Seguridad (migración `…18g_rls_cierre.sql`)**: `producto_empaques` tenía una política que permitía a CUALQUIERA, incluso
    sin sesión, crear/editar/borrar empaques y sus precios; `almacenes`, `inventario_almacen`, `movimientos_bancarios`,
    `cuentas_cobrar`, `pago_cuentas` y `pago_ordenes` permitían escribir a cualquier usuario autenticado (también clientes del
    portal y vendedores). Se quitaron esas políticas y se dejaron permisos por módulo; los procesos internos son funciones
    `security definer` y siguen funcionando. Además, el cliente de un almacén debe ser de su misma empresa.
  - "Ajuste de Inventario" permitía cambiar el stock de productos de Odoo (la sincronización lo pisaba): ahora solo productos
    propios de GUDS, con aviso.
  - Los 10 errores de TypeScript que venían de antes quedaron en 0.
- Verificado: 41 pruebas de base (8 nuevas de inventario y seguridad), cuadre 56/56, importación idempotente (0 filas cambiadas
  en la segunda corrida), 31 verificaciones de UI de la fase (incluye móvil 390 px) y recorrido de 64 pantallas sin errores.

### Fase 5 — hecho
- Migración `20260927_fase18e_compras_cxp.sql`: `ordenes_compra` (+ ítems), `facturas_proveedor` (+ ítems; facturas, NC y ND
  con documento de origen y motivo de anulación), `pagos_proveedor` (pagos y reintegros de proveedores),
  `factura_proveedor_aplicaciones` (cómo se saldó cada documento) y `retenciones_emitidas` (+ ítems; IVA e ISLR con concepto,
  porcentaje y sustraendo). Espejo de **solo lectura**: RLS restrictiva por empresa, lectura con el módulo `compras` y sin
  políticas de escritura (solo escribe el importador).
- Importador: `supabase/functions/_shared/odoo-sync/compras.js` (lectura por empresa, proveedores referenciados sin marca de
  proveedor en Odoo: +18 GUDS, +25 Quirutec; bancos de pagos a proveedores y reintegros; limpieza de filas que ya no existen).
- Resultado: GUDS 11 OC / 259 facturas de proveedor / 389 pagos / 213 retenciones emitidas, **CxP $416.353,46**;
  Quirutec 21 / 411 / 614 / 407, **CxP $390.769,64** (igual que Odoo). El 100 % de las facturas de proveedor publicadas
  (637) tiene explicado su monto pagado (559 retenciones, 312 pagos, 75 NC, 12 asientos).
- Pantallas (Compras): **Cuentas por Pagar** (neto, antigüedad por proveedor con saldo a favor, pestañas de facturas de
  proveedor, pagos, órdenes de compra y retenciones emitidas), **estado de cuenta del proveedor** (`/admin/proveedores/:id`,
  enlazado desde la ficha) y **detalle de factura de proveedor** (líneas, "Cómo se saldó", "Aplicada a" en NC y
  retenciones emitidas sobre el documento).
- `scripts/supabase-admin.mjs` reintenta con espera creciente ante 429/5xx de la Management API (la importación completa
  llegaba al límite de tasa).
- **Flancos corregidos**:
  - La paginación de todas las tablas desbordaba el ancho en el celular (390 px) cuando la tabla no recortaba el contenido.
  - "A favor" se mostraba como "$-2,176.10" en Cuentas por Cobrar y por Pagar → monto positivo en verde.
  - El documento del plan tenía la cabecera duplicada dentro de la Fase 4 (patrón especial de `String.replace` en una edición anterior) → reparado.
- Verificado: 33 pruebas de base (5 nuevas de compras: separación por empresa, sin edición ni altas desde GUDS, vendedor y
  anónimo sin acceso), cuadre **37/37**, importación idempotente (segunda corrida: 0 filas cambiadas), 22 verificaciones de
  UI de la fase (incluye "Ambas" = $807.123,10 y móvil sin desborde) y recorrido de 60 pantallas en ambas empresas sin errores.

### Fase 4 — hecho
- Migración `20260927_fase18d_ventas_cxc.sql`: `facturas.motivo_anulacion/motivo_nota`, tablas `factura_aplicaciones` y
  `reintegros` (espejo, solo lectura para usuarios), tipo de retención `municipal`.
- **Cómo se saldó cada documento**: desde las conciliaciones de Odoo (`account.partial.reconcile`) se reconstruyen 3.976
  aplicaciones (cobros, notas de crédito, retenciones, reintegros y asientos). Validado: el 100 % de facturas, NC y ND
  publicadas tiene explicado su monto pagado. Visible en el detalle de factura ("Cómo se saldó", y "Aplicada a" en las NC).
- **Notas de débito** marcadas (ND) con su factura de origen; **facturas anuladas** con motivo de Odoo.
- **Cuentas por cobrar**: antigüedad por cliente (por vencer, 1–30, 31–60, 61–90, +90), saldo a favor y neto.
- **Retención municipal recibida** (47, módulo "Responsabilidad Social" de Odoo) e **IGTF** marcado en los cobros (Quirutec).
- **Reintegros a clientes** (70) en la cuenta del cliente. Pedidos creados en GUDS marcados "pendiente de enviar a Odoo".
- **Flancos corregidos**:
  - Cuentas por cobrar sumaba solo facturas con saldo e ignoraba los saldos a favor: mostraba $385.795 (GUDS) cuando el neto
    real es $365.978 (igual que Odoo y el dashboard).
  - En la cuenta del cliente todos los cobros de Odoo aparecían "Sin aplicar (anticipo)"; ahora muestran sus facturas.
  - En facturas en bolívares, subtotal, impuesto e ítems se mostraban con `$` siendo montos en Bs.
  - La API (PostgREST) no veía tablas/columnas de migraciones hechas en modo réplica (el refresco automático de esquema no
    corre en ese modo) → `scripts/aplicar-migracion.mjs` ahora refresca el esquema siempre.
  - Claves duplicadas de React en las aplicaciones de un cobro (un cobro puede aplicarse en dos partes a la misma factura).
- Verificado: 11 verificaciones de UI de la fase y recorrido de 56 pantallas sin errores; importación idempotente; cuadre 27/27.

### Fase 3 — hecho
- Migraciones `20260927_fase18b_maestros_espejo.sql` y `20260927_fase18c_clientes_sin_duplicados.sql`.
- **Proveedores** (nuevo): tabla `proveedores` espejo de Odoo (190: 55 GUDS, 130 Quirutec, 5 compartidos; 18 también
  clientes) + pantalla **Compras → Proveedores** (módulo de permisos `compras`).
- **Direcciones de entrega** de clientes (`cliente_direcciones`, 167) visibles en el detalle del cliente.
- **Protección de datos espejo en la base** (`trg_proteger_espejo_odoo`): en registros con `odoo_id`, los campos que manda
  Odoo no se editan ni se borran desde GUDS (mensaje: "El dato … viene de Odoo y se edita en Odoo"). Cubre productos,
  clientes, proveedores, direcciones, bancos, categorías, almacenes, órdenes, facturas, cobros y retenciones. Los campos de
  GUDS siguen editables (imágenes, descripción, empaques, ofertas, lista de precios del cliente, datos de cuenta del banco,
  método de un cobro, ícono/color de categoría, cliente de un almacén de consignación…).
- **Productos**: `precio_origen` (odoo/guds). Si el producto nunca se vendió en Odoo, GUDS puede fijarle precio y el
  importador lo respeta hasta que haya una venta en Odoo (flanco 1). "Activo" en productos de Odoo = **visible en la tienda**
  (`oculto_tienda`, decisión de GUDS); `disponible` = vendible en Odoo, físico y con precio.
- **Clientes sin duplicados por RIF ni nombre** (decisión 3): trigger con RIF y nombre normalizados
  ("FARMATODO, C.A." = "Farmatodo CA"; "J-12345678-9" = "J123456789") dentro de la misma empresa o contra compartidos.
- Pantallas: marca Odoo y campos bloqueados en Productos, Clientes (+ detalle), Bancos, Categorías, Vendedor (clientes con
  vendedor de Odoo no se reasignan en GUDS) y Órdenes (las de Odoo no cambian de estado ni se "facturan" en GUDS).
  Delivery: al entregar una orden de Odoo se registra la entrega sin tocar el estado que manda Odoo.
- **Flancos corregidos**: guardar un producto de Odoo fallaba por exigir empaque (ahora opcional en productos de Odoo);
  campos del formulario de clientes recibían `null` desde Odoo; código de cliente nuevo ahora por empresa (`GUDS-CLI-00001`).
- Verificado: 28 pruebas de base (`scripts/probar-multiempresa.mjs`), 18 verificaciones de UI de la fase y recorrido de
  56 pantallas (28 × 2 empresas) sin errores de consola ni de red. Importador idempotente con las entidades nuevas.

### Fase 2 — hecho
- Motor en `supabase/functions/_shared/odoo-sync/` (JS sin dependencias: corre en Node y en Deno; lo reutiliza la Fase 9).
  CLI: `node scripts/importar-odoo.mjs [--apply]`. Cuadre: `node scripts/cuadre-odoo.mjs` (27 controles, todo cuadra).
- Lee Odoo por API, empresa por empresa (el contexto de empresa hace que plazos y límites de crédito salgan por empresa).
  Upserts idempotentes por `odoo_id` (conserva los uuid de GUDS); una segunda corrida seguida cambia **0 filas**.
  Escrituras con `session_replication_role = replica` (sin triggers); derivados recalculados al final: stock por empresa en
  almacenes propios, crédito usado, movimientos bancarios de cobros. Registro en `sync_corridas` y marcas en `sync_estado`.
- Precio base = último precio USD en cotizaciones y órdenes no canceladas de Odoo (decisión 1).
- Migración `20260927_fase18a_importador_base.sql`: columnas de sync, `unique(odoo_model, odoo_id)` en retenciones y tablas
  `sync_corridas` / `sync_estado`.
- Resultado: 454 clientes, 614 productos, 1.602 órdenes, 3.932 facturas/NC, 1.707 cobros, 820 retenciones IVA recibidas,
  25 bancos (23 de Odoo), 129 almacenes, 1.723 filas de inventario.
- **Flancos corregidos en esta fase**:
  - 638 cobros apuntaban a un banco de la otra empresa (la carga vieja unificaba bancos por nombre) → un banco por diario y empresa.
  - 48 "cobros" eran pagos entrantes de PROVEEDORES → eliminados de cobros (van a CxP en la Fase 5).
  - Retenciones de IVA de proveedores mezcladas con las de clientes → solo las recibidas de clientes; los ids de IVA/ISLR ya no chocan.
  - Facturas anuladas en Odoo que seguían "publicadas"; números de orden con sufijo `-odoo_id`; stock que nunca bajaba a 0.
  - Portal del vendedor vacío: 390 clientes y sus órdenes quedaron ligados a su vendedor (usuario Odoo → usuario GUDS por nombre).
  - 5 clientes con documentos pero sin marca de cliente en Odoo ahora se importan.
  - Advertencia de HTML inválido en el detalle del cliente.
- Verificado con Playwright: 54 pantallas admin (27 × 2 empresas) sin errores; compra completa del cliente (catálogo → carrito →
  checkout → `GUDS-ORD-00001`) y pedido del vendedor (`GUDS-ORD-00002`), aislados por empresa. Datos de prueba borrados.

### Fase 1 — hecho
- Migraciones aplicadas: `20260927_fase17a_multiempresa_base.sql`, `…17a2_fix_trigger_stock_orden.sql`,
  `…17b_multiempresa_reglas.sql`, `…17c_usuarios_cliente_empresa.sql`.
- Datos existentes asignados a su empresa leyendo Odoo (`node scripts/multiempresa-backfill.mjs --apply`):
  GUDS 590 órdenes / 1.940 facturas / 231 clientes; Quirutec 575 / 1.298 / 196; 5 clientes y 1 producto compartidos.
  Usuarios: admins y delivery en ambas; vendedores según sus empresas en Odoo.
- Pruebas de base: `node scripts/probar-multiempresa.mjs` (14 casos: lectura por empresa, "Ambas" solo consulta,
  guardia contra funciones definer, no mezclar empresas, numeración GUDS-/QRT-, herencia en hijas).
- Frontend: `EmpresaContext` + header `x-empresa-id` (fetch propio en `src/lib/supabase.ts`); selector en los
  portales admin, vendedor, cliente, delivery y configuración; franja "modo consulta"; Configuración → Usuarios
  asigna empresas; Configuración → Empresas edita logo/color/contacto (razón social, RIF y dirección con marca Odoo);
  componente `OdooBadge` aplicado donde ya se mostraba el origen Odoo.
- **Incidente resuelto**: el trigger `actualizar_stock_orden` reponía stock en cualquier update de una orden
  cancelada; al asignar empresa repuso stock falso (92 productos, 461 movimientos). Se revirtió desde el respaldo y
  el trigger ahora solo actúa en cambios de estado y nunca en órdenes de Odoo. **Antes de actualizaciones masivas,
  revisar los triggers BEFORE/AFTER UPDATE de la tabla o usar `session_replication_role = replica`.**
- **Pendiente de publicar**: mientras el frontend nuevo no esté desplegado, la versión publicada no envía la
  empresa y funciona como "Ambas" (consulta, sin altas).
- Queda para fases posteriores: login único para los 13 clientes presentes en ambas empresas (Fase 8), elegir
  empresa en el registro público y tienda pública por empresa (Fase 8), `unique(odoo_model, odoo_id)` en
  retenciones (Fase 2/4).

### Fase 1 — diseño
- `empresas`, `usuario_empresas`, `empresa_secuencias`.
- El frontend envía la empresa activa en el header `x-empresa-id` (uuid o `todas`) en cada petición.
- Funciones: `empresas_permitidas()`, `empresa_solicitada()`, `empresas_visibles()`, `empresa_activa()`,
  `empresa_activa_requerida()`.
- **Política RLS restrictiva** por tabla de negocio: `empresa_id is null or empresa_id = any(empresas_visibles())`.
  Las políticas por rol existentes no se tocan.
- **Guardia** (trigger) en cada tabla por empresa: si escribe un usuario autenticado, el registro debe ser de la
  empresa activa (cubre también las funciones `security definer`). Service role e importador no pasan por la guardia.
- Tablas hijas heredan `empresa_id` del padre por trigger.
- Unicidad por empresa (número de orden/pago, SKU, código de cliente, cupones, metas) y numeración por empresa
  con prefijo (`GUDS-ORD-00001`, `QRT-ORD-00001`).

## Hallazgos que condicionan fases posteriores
- **Números repetidos entre empresas en Odoo**: 698 órdenes, 79 facturas, 899 pagos.
- **Compartidos en Odoo** (`company_id` nulo): 6 clientes (incl. Quirutec como cliente de GUDS) y 2 productos.
- 13 clientes con el mismo RIF en ambas empresas; 64 productos con el mismo código en ambas.
- Datos en GUDS al 2026-09-27: **ninguna transacción creada en GUDS** (todo viene de Odoo) → reimport limpio seguro.
  16 de 19 vendedores tienen correo de relleno `@guds.test`.
- **Retenciones en uso** (datos desde 06-05-2026):
  - IVA en **ambas direcciones** (clientes nos retienen / retenemos a proveedores); el comprobante del cliente está
    en `customer_doc_number` y Odoo lo parte en una cabecera por factura.
  - ISLR **solo a proveedores** (ningún cliente retiene ISLR en Odoo); requiere conceptos, tarifas por año,
    sustraendo y unidad tributaria.
  - Municipal de clientes (1,25 %) registrado con el módulo "Responsabilidad Social".
  - IGTF 3 % solo en Quirutec, como pago aparte ligado al pago original.
  - 1x1000, 1x500 y municipal/IAE: sin datos.
  - Bug a corregir: `retenciones.odoo_id` choca entre IVA e ISLR → `unique(odoo_model, odoo_id)`.

## Pendientes y flancos detectados (se atienden al final de su fase o al cierre)
| # | Flanco | Dónde se resuelve |
|---|---|---|
| 1 | ~~Productos vendibles sin historial de venta no tienen precio ⇒ no salen en el catálogo~~ | ✅ Fase 3: GUDS puede fijarles precio (queda pendiente que GUDS cargue esos precios) |
| 2 | ~~Límite de crédito 0 en Odoo bloqueaba comprar a crédito~~ | ✅ Fase 8: crédito abierto por ahora; límite editable en GUDS y pendiente de enviar a Odoo (Fase 9) |
| 3 | ~~2 cobros en Bs sin cliente en Odoo (Bs 6,67 M y Bs 698 mil) no entraban a GUDS~~ | ✅ Fase 7: visibles como "Depósitos por identificar" (Bancos y torre de control); identificarlos es tarea de contabilidad en Odoo |
| 4 | **Calidad de datos en Odoo**: órdenes con montos anómalos (S00771 por $3.467.663; S00683 y S00690 por $2.394.514) — parecen montos en Bs cargados como USD | Avisar a contabilidad de GUDS |
| 5 | ~~Pagos salientes a clientes (reintegros) no se importaban~~ | ✅ Fase 4 |
| 6 | ~~Retención municipal de clientes e IGTF no se importaban~~ | ✅ Fase 4; IGTF ligado a su cobro de origen en la Fase 7 |
| 7 | ~~Vendedor del cliente y precio base se podían editar en GUDS y la sincronización los pisaba~~ | ✅ Fase 3: protegidos en la base y marcados en pantalla |
| 8 | ~~Cliente de cada almacén de consignación se identifica por nombre~~ | ✅ Fase 6: nombre → entregas → manual; 46 consignaciones sin cliente para confirmar a mano desde el detalle del almacén |
| 9 | 16 vendedores con correo de relleno `@guds.test` | Cuando GUDS pase los correos (decisión 4) |
| 10 | El widget de soporte "Ticket" responde 403 (`widget-listar-tickets`) | Revisar con Boosty (no es de esta plataforma) |
| 11 | Frontend multiempresa sin publicar: la versión desplegada funciona en modo "Ambas" (solo consulta) | Al publicar |
| 12 | ¿Se permite crear productos en GUDS? Existirían solo en GUDS (no en Odoo). Hoy la pantalla lo permite | Decisión de GUDS |
| 13 | Las listas de precios de Odoo están vacías (0 reglas); las listas de GUDS siguen siendo propias de GUDS (precios negociados) | Revisar si GUDS carga listas en Odoo |
| 14 | Impuestos y términos de pago de Odoo no se espejan como tablas (se usan el IVA de configuración y la condición de pago del cliente) | Fase 4 (líneas de factura) |
| 15 | El motivo de nota de crédito (`motivos` en Odoo) está vacío en todas las NC | Informativo (se importa si lo cargan) |
| 16 | 6 pagos a proveedores en Odoo sin proveedor (se importan sin proveedor; salen en CxP → Pagos con "—") | Informativo / contabilidad |
| 17 | Facturas sin cliente reconocible en Odoo (GUDS 9, Quirutec 2) no entran a GUDS; los cobros sin cliente ya se ven como depósitos por identificar (los otros 2 son borradores/cancelados en 0) | Contabilidad (asignarles cliente en Odoo) |
| 18 | GUDS tiene $200.829,86 vencidos a más de 90 días con proveedores (SURGICONSULT CORP $74.932 +90 días) | Informativo para finanzas; alerta en la torre de control (Fase 8) |
| 19 | ~~Políticas RLS "todo permitido" (empaques escribibles por anónimos; almacenes, existencias y movimientos bancarios por cualquier autenticado)~~ | ✅ Fase 6 (migración 18g) |
| 20 | 246 lotes vencidos con existencia en Odoo (muchos en consignación) | Informativo para operaciones; visible en Inventario → Lotes y en la torre de control |
| 21 | Unidades de medida de Odoo llegan en inglés ("Units") | Cosmético; revisar al leer Odoo con idioma es_VE (cambia también nombres traducibles) |
| 22 | ~~La importación completa tardaba ~3,5 min (límite de las edge functions)~~ | ✅ Fase 9a: con conexión directa tarda ~60 s; incremental por `write_date` queda como mejora si crece el volumen |
| 23 | Los ajustes de inventario sin lote no existen hoy (los 3.505 tienen lote); si aparecen, quedan igual en `ajustes_inventario` | Informativo |
| 24 | **Configuración en Odoo (GUDS)**: el diario "Banco Banesco USA" usa la misma cuenta contable que "Banco Banesco (VED)"; su saldo contable no se puede separar (GUDS muestra el del extracto con aviso). Los diarios de "Saldos iniciales anticipo" también comparten cuenta | Avisar a contabilidad de GUDS |
| 25 | 674 líneas de extracto bancario por conciliar en Odoo | Informativo para contabilidad; visible por banco en GUDS |
| 26 | **Correo de autenticación**: Supabase no tiene SMTP propio (el correo por defecto solo llega al equipo y 2/hora) y la `site_url` es `localhost:3000` (debe ser `https://gudsupply.netlify.app`). "Olvidé mi contraseña" no llega a clientes; por eso las claves de contactos son temporales generadas por GUDS | Configurar un SMTP (Resend/SendGrid) y la URL del sitio — requiere cuenta de GUDS |
| 27 | Pedidos de GUDS completados antes de la Fase 9b quedan comprometiendo stock hasta pasar a Odoo | Fase 9b (envío de pedidos a Odoo) |
| 28 | Límites de crédito editados en GUDS quedan pendientes de enviar a Odoo | Fase 9 |
| 29 | Contactos creados en GUDS no existen en Odoo | Fase 9 (crearlos como contacto hijo, marcados "(GUDS)") |
| 30 | ~~Reportes (ventas por empresa, vendedor, producto; cobranza; inventario)~~ | ✅ `/admin/reportes` (migración 18u), ver "Reportes" en la Fase 8 |
| 31 | **Documentos que no son venta**: 986 facturas + 353 NC del "Diario Saldo Inicial CXC" y 113 del "ND CxC Saldos Iniciales" (saldos de apertura migrados a Odoo, fechados 2021–2026) y 493 notas del diario "Nota debito cliente" en Bs con cuenta *Diferencia en cambio* y 0 en USD (ajustes cambiarios). GUDS ahora guarda el diario (`facturas.diario_odoo`, `es_saldo_inicial`) y marca como ND lo emitido en diarios de ND | ✅ migración 18t + importador; los reportes de ventas los excluyen |
| 32 | Los montos negativos se muestran como `$-1,234.69` (formato de `formatPrice`) | Cosmético |
| 33 | **Envío**: GUDS cobra $50 en pedidos menores de $500; Odoo no tiene línea de envío, el total enviado no lo incluye | Decisión de GUDS (producto "Envío" en Odoo o sin envío en B2B) |
| 34 | S00927 (prueba) quedó con almacén G-CONSIGNADO REPRESENTACIONES FAW; los envíos nuevos usan P-01 | Si se confirma, cambiar almacén en Odoo (GUDS no edita en Odoo) |
