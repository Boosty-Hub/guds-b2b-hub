# PENDIENTE — retomar el plan de revisión del 30-sep

Estado al **1-oct-2026**. Plan completo: `docs/PLAN-REVISION-30SEP.md`. Este archivo no lleva nombres: los datos de personas
y cuentas están en `docs/privado/retomar-1oct/PRIVADO.md` (fuera de git).

## Qué pasó

El 30-sep en la noche se lanzaron 4 agentes en paralelo: **A** (fases 0 y 1), **B** (2 y 3), **C** (4) y **D** (6). A las
22:42 (02:42 UTC) se cortaron los cuatro a la vez: primero falló la conexión a Supabase (desde ~22:31) y después la sesión
dio "API Error 403". Luego se reinició la computadora. Todos estaban en la verificación final; **ninguno escribió su informe
final**.

- **Código:** todo está en disco, **sin commit** (≈40 archivos modificados y ≈24 nuevos). `tsc -p tsconfig.app.json` pasa
  limpio con todo junto (verificado el 1-oct).
- **Regla vigente:** NO hacer `git push` hasta que el usuario diga "publica" (cada push gasta créditos de Netlify). Los
  commits locales sí se pueden hacer.
- **Base (producción):** las 8 migraciones del 1-oct **ya están aplicadas** (no hay ninguna escrita sin aplicar):
  `fase21a_categorias_empresa`, `fase21a_empleados_clientes`, `fase21a_vendedores_empresa`, `fase21b_estado_cuenta_cruce`,
  `fase21b_metricas_cobranza`, `fase21b_correo_envio_masivo`, `fase21c_planificacion_pagos`, `fase21d_calidad_tareas`.
- **Escrituras reales en Odoo (las dos autorizadas, ambas `hecha`):** correo de un cliente de Quirutec (fase 2; se escribió
  el mismo correo que ya tenía, más nota "(GUDS)") y estado de un cliente de Puerto Ordaz que tenía un estado de Ecuador →
  "Bolivar." de Venezuela (fase 6; la sync cerró la tarea sola). No hacer más escrituras de prueba.

## 1. Arreglos urgentes (antes de seguir) — ✅ HECHOS el 1-oct 00:50 (VE)

> La base de producción estuvo caída de ~22:31 a ~00:45 (db/rest UNHEALTHY; se recuperó sola, sin reiniciar).
> `sync-odoo` redesplegado desde el árbol de trabajo + corrida `ok` (condicion_pago llena en 539/685); los 3 usuarios e2e
> borrados (no tenían referencias); `_tmp_21c.mjs` borrado; caso de la suite ajustado (campo prohibido ahora `rif`);
> `tsc` y `build` limpios.

1. **Volver a desplegar `sync-odoo` desde el árbol de trabajo actual.** El último despliegue (agente A, 01:53 UTC) se hizo
   desde `HEAD` + solo su `importar.js` y **pisó** los de B (01:51) y C (01:41). En producción hoy faltan:
   - `compras.js` (21c): lectura de `invoice_payment_term_id` → `facturas_proveedor.condicion_pago` y la llamada a
     `conciliar_planes_pago` (cierre automático de los planes de pago);
   - `odoo.js` y `escribir-cliente.js` (21b): escribir el correo del cliente en Odoo (sin el filtro por `customer_rank`, que
     no sirve).
   Comando: `npx supabase functions deploy sync-odoo --project-ref $SUPABASE_PROJECT_REF --use-api --no-verify-jwt` (con
   `SUPABASE_ACCESS_TOKEN` de `.env.local`), luego `select disparar_sync_odoo()` y confirmar la corrida `ok`.
2. **Borrar los usuarios de prueba que quedaron en producción** (de `auth.users`, `usuarios` y `usuario_empresas`):
   `e2e.f23.admin@guds.test`, `e2e.f23.cliente@guds.test`, `e2e.calidad.f6@guds.test`. Antes, poner en `null` las
   referencias que tengan (p. ej. `odoo_escrituras.solicitado_por`).
3. **Borrar `scripts/_tmp_21c.mjs`** (copia temporal de la suite, del agente C).

## 2. Verificación conjunta que faltó

> ✅ 1-oct: suite **558/558**; tsc + build limpios; Playwright A/B/C/D pasan a 1440 y 390 en las 3 vistas (arneses
> arreglados; salidas y capturas en `docs/privado/retomar-1oct/arneses/*/cap`). Bugs de app arreglados: PDF filtraba
> comentarios internos, `/admin` 404, barra superior recortada con la torre abierta. Limpieza confirmada (sin e2e, planes,
> comentarios ni envíos de prueba). Bitácora escrita. **Falta solo: commit local y el "publica" del usuario.**

1. Suite completa: `node scripts/probar-multiempresa.mjs` (es lenta; guardar la salida en un archivo). Incluye los bloques
   nuevos 21a (16 casos), 21b (18), 21c (~23) y 21d (22). Ninguno se vio pasar dentro de la suite completa.
   - **Caso esperado en rojo:** "Clientes→Odoo: campos fuera de teléfonos/dirección se rechazan" (≈nº 150) espera que se
     rechace `email`, pero la 21b ahora lo permite en `actualizar_contacto_cliente`. Ajustar la prueba (el campo
     prohibido de ejemplo ya no puede ser `email`).
2. `npx tsc --noEmit -p tsconfig.app.json` y `npm run build` (luego borrar `dist`).
3. Playwright a 1440 y 390 px en GUDS, Quirutec y «Ambas», con `npm run dev` levantado. Arneses de los agentes en
   `docs/privado/retomar-1oct/arneses/` (copia; los originales están en el scratchpad de la sesión `2cf53198…` y usan
   rutas absolutas a `%TEMP%`; si ya no existen, corregir los `require`):
   - **A** `agente-f01/t-admin.cjs` y `t-portal.cjs`: la última corrida acabó en timeout de `waitForURL('/admin')`.
     Revisar la barra superior tras el último cambio de `Header.tsx` (oculta el nombre del usuario bajo 1400 px).
   - **B** `agente-f23/e2e.cjs`: arreglar el selector duplicado del botón "Cerrar"; faltan las capturas de enlace público,
     portal, PDF renderizado a imagen y el flujo "cliente sin correo"; los ajustes de columnas de `Cuentas.tsx`
     (límite `2xl`, "Docs." en `md`) no se verificaron.
   - **C** `agente-f4/e2e.cjs` (dio 28/28 antes de los últimos retoques de la tabla móvil y `CoberturaMonedas`): repetir.
   - **D** `agente-f6/t-calidad.cjs` (pasó a las 01:53; después hubo ajustes visuales de chips KPI en móvil y filas): repetir.
4. Confirmar que no queden usuarios `e2e.%`, planes de pago de prueba ni comentarios/envíos de prueba.
5. Escribir la entrada del 1-oct en `BITACORA.md` y el informe al usuario. Después, avisar que está listo para publicar y
   esperar el "publica".

## 3. Lo que quedó sin hacer dentro de cada fase

- ✅ 1-oct: el catálogo del vendedor ya filtra en la base (`categorias_vendedor`/`catalogo_vendedor` de la 21a: activos, vendibles, empresa del cliente, categoría activa); no hacía falta tocar la pantalla. Nota original: **Fase 0+1 (A):** el catálogo del **portal del vendedor** no se tocó (`VendedorPedidoNuevo.tsx` sin cambios): falta que
  solo muestre categorías con productos vendibles de la empresa. El resto (usuarios de prueba ocultos `es_prueba`, invitar
  vendedores con correo real, título del vendedor, etiqueta "Empresa", barra superior, guía de verificación
  `ConfigVerificacionOdoo`, categorías/vendedores por empresa, empleados → canal *Personal*) está hecho.
- ✅ 1-oct: métricas de cobranza en `VendedorDetalle.tsx` (DSO, mora ponderada, DSO alto, NC por aplicar + columna DSO; cuadra con SQL a 1440/390). Nota original: **Fase 2+3 (B):** las métricas de cobranza no están en `VendedorDetalle.tsx`. El resto (tabla por factura con "qué
  falta", comentarios, clientes sin correo, envío masivo con registro, DSO, mora ponderada, NC sin aplicar, torre de
  control, selector de "Filas por página") está hecho. Cuadre: 23/23 clientes y 5 contra Odoo con diferencia ≤ 0,02 USD.
- **Fase 4 (C):** completa en código y probada antes del corte; solo falta la verificación final.
- **Fase 6 (D):** completa; no consta prueba en navegador de "Exportar" ni de "Ocultar sección".
- **Fase 5 (listas de precios):** ✅ 1-oct parte sin Odoo (21e): listas de GUDS con precio por producto editable fila
  por fila, ajuste masivo, copiar, importar/exportar Excel, clientes, historial; sync no pisa la lista; RLS cerrado.
  **Falta (decisión del usuario 1-oct):** crear las listas en Odoo (5.4 `product.pricelist` + ítems y 5.5 asignar a
  clientes `property_product_pricelist`) **se hace cuando el equipo mande la primera lista real**: cargarla en GUDS,
  revisarla con ellos y entonces escribirla en Odoo por la cola `odoo_escrituras` (modo prueba → activo, como las fotos).
  Mientras tanto, el precio ya llega a Odoo por línea en cada pedido.

## 4. Decisiones abiertas para el usuario

1. **Términos de pago de proveedores:** el vencimiento casi total de CxP es **real**, no un error del import (0 diferencias
   con Odoo en 233 documentos): "contado" en Odoo vence a 3 días y ningún proveedor tiene término por defecto. ¿Se corrige
   en Odoo o se ajusta en GUDS?
2. **Estados con punto en Odoo** ("Bolivar.", "Sucre." son el nombre real del estado en Odoo): ¿renombrarlos en Odoo o
   dejar solo la normalización visual de GUDS? Quedan 6 clientes con estado de otro país por corregir desde la bandeja.
3. **Quién aprueba los planes de pago:** hoy el rol Contador planifica pero no aprueba.
4. **"Retenciones pendientes"** en la planificación sale de la retención emitida; en ISLR la relación varía mucho: revisar.
5. **Umbral de DSO alto** (hoy 60 días) y reglas de "qué falta": afinar con los Excel del equipo.
6. Cuentas de usuarios con problemas de acceso o duplicadas: ver `docs/privado/retomar-1oct/PRIVADO.md`.

## 5. Después

Seguir el plan: fase 5 (listas de precios), luego 7–11 según lleguen los insumos del equipo (Excel de estado de cuenta,
métricas y flujo de caja; listas de precios; datos del operador logístico; documentación de facturación digital).
