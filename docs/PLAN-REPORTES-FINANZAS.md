# Plan — los 4 reportes manuales de finanzas dentro de GUDS

Análisis del 8-oct-2026 de los Excel que hoy arma a mano el equipo de finanzas y cobranzas, comparados contra la base de
producción y contra Odoo, siempre en solo lectura. Este documento no lleva nombres de clientes ni personas. Los Excel
originales están en `Downloads` del usuario y no se versionan.

| # | Excel | Qué es en realidad | Dónde va en GUDS | Cobertura actual | Tamaño |
|---|---|---|---|---|---|
| 1 | FORMATO EDC | Estado de cuenta de un cliente al corte | Finanzas → Cuentas → detalle del cliente (ya existe) | ~90 % | S |
| 2 | FORMATO - Análisis de Vencimiento | Antigüedad de la CxC por empresa: año, vendedor, tipo de cliente, tramos, incobrables | Reportes → Cobranza → **Antigüedad** | ~40 % | M |
| 3 | FORMATO DE LO COBRADO | Libro de cobros 2026 por cuenta bancaria, moneda, cliente y mes | Reportes → Cobranza → **Lo cobrado** | ~50 % | M |
| 4 | FORMATO - DMQ GS - Promedio Ventas | **No es de inventario:** venta mensual por cliente frente a su deuda (días de recuperación) | Reportes → Cobranza → **Ventas vs deuda** | ~50 % | M |
| — | Hoja "P Matriz" del Excel 2 | Notas de entrega **no fiscales** (N/E) | Finanzas → **Notas de entrega** (módulo nuevo) | 0 % | M+M+M |

Los cuatro reportes son de la Gerencia de Finanzas / Departamento de Cobranzas y cubren las dos empresas (DMQ = Quirutec,
GS = GUDS).

## Decisiones (8-oct)

| | Decisión | Estado |
|---|---|---|
| D1 | Cobros en Bs a USD con la **tasa BCV del día del cobro** | ✅ decidido |
| D2 | Antigüedad con **selector emisión / vencimiento; arranca en vencimiento** | ✅ decidido |
| D3 | La **fuente de verdad de los cobros es Odoo**. Lo que no esté en Odoo (cobros de Profit ene–abr 2026) se carga desde el Excel, marcado como origen Profit | ✅ decidido |
| D4 | Notas de entrega no fiscales: **módulo propio**, que permita crear nuevas. Se diseña ahora y se confirma con finanzas | 🟡 diseño abajo, preguntas abiertas |
| D5 | Clasificación de clientes: **opción A**. La de finanzas es la oficial y se guarda en Odoo (Industria, Canal y Segmento de contacto); GUDS la edita y la escribe por la cola, en modo prueba → activo | ✅ decidido 8-oct (fase 22d) |
| D6 | **Días de recuperación con la fórmula del equipo**, con la **explicación visible** de cómo se calcula | ✅ decidido |
| D7 | **Un solo estado de cuenta**, con el formato de finanzas. El detalle de la cuenta, el enlace público, el PDF, el Excel, el portal, la ficha del vendedor y el correo muestran el mismo. Facturas, NC, Pagos y Retenciones quedan como listas de consulta | ✅ decidido 8-oct (fase 22c) |
| D8 | **Papelera general.** Todo lo anulado o archivado va a la papelera, con su foto completa y opción de restaurar. Los administradores pueden anular cobros registrados en GUDS (los de Odoo se anulan en Odoo) | ✅ decidido 8-oct (fase 22a) |
| D9 | **Consignación.** Al aprobar una declaración se crea un pedido que va a Odoo como cotización y sigue allí hasta la factura. No más factura interna ni descuento de stock en GUDS | ✅ decidido 8-oct (fase 22b) |
| D10 | Los reportes con **deuda por cliente** exigen los permisos `reportes` **y** `cuentas`. Ampliado a *Calidad y cuadre* y a "Top clientes que pagaron" | ✅ decidido 8-oct (fases 22a y 22e) |
| D11 | **Tasa de las NC = la de la factura que afectan** (como finanzas): la que revierten; si no, aquella en la que más se aplicaron; si no, la que dice Profit (`numero_origen`, solo del mismo cliente). En USD, la BCV del día de esa factura | ✅ decidido 8-oct (fase 22e) |
| D12 | Las **335 tasas tomadas de Profit** (días sin tasa en Odoo) se conservan, pero **se ve de dónde sale cada tasa**: marca F (factura de la NC) y P (Profit) con leyenda en pantalla y PDF, y columna "Origen de la tasa" en el Excel | ✅ decidido 8-oct (fase 22e) |
| D13 | **Consignación sin precio:** no se declara ni se aprueba con productos en precio 0; alerta en el portal del vendedor/cliente y en el admin | ✅ decidido 8-oct (fase 22e) |
| D14 | Clasificación en Odoo **activa**: primera escritura real verificada el 8-oct (un cliente); "DISTRIBUIDOR" quedó "Distribuidor". El resto lo envía finanzas desde Configuración → Clasificación | ✅ 8-oct (22e) |

---

## Dónde van, descarga en Excel y filtro por fechas

**Ubicación.** El estado de cuenta se queda en el detalle de la cuenta. Los otros tres son **sub-vistas de Reportes →
Cobranza** (Resumen · Lo cobrado · Antigüedad · Ventas vs deuda), con el mismo control segmentado de *Calidad y cuadre*.

- La sub-vista va en `?cobranza=`. No se usa `?vista=`, que ya la ocupa Calidad, y `cambiarTab` debe limpiarla.
- No se agregan ítems al menú lateral: `NavLink` compara solo la ruta, así que dos ítems quedarían marcados a la vez. En
  su lugar se agregan **accesos en Ctrl+K** con un arreglo `accesosBuscador` en `navegacion.ts`.
- Las notas de entrega sí llevan ítem propio: Finanzas → Notas de entrega, después de Facturas.

| | Estado de cuenta | Lo cobrado | Antigüedad | Ventas vs deuda |
|---|---|---|---|---|
| **Ruta** | `/admin/cuentas/:id` (botón **Excel** junto al PDF). Opcional: Excel de los clientes seleccionados en Cuentas | `/admin/reportes?tab=cobranza&cobranza=cobrado` | `…&cobranza=antiguedad` | `…&cobranza=ventas-deuda` |
| **Fechas** | **Fecha de corte** (por defecto hoy, hora de Caracas) + rango de movimientos con "Personalizado" | **Rango de fecha de cobro** (presets + desde/hasta en la URL); columnas por mes | **Fecha de corte** + selector de días desde emisión o vencimiento (D2) + rango o año de emisión opcional | **Mes de corte** (último mes cerrado) + **rango de meses** de la matriz (12 m por defecto, hasta dic-2020) |
| **Otros filtros** | Estatus del documento | Empresa, diario/banco, moneda, cliente, vendedor del cliente, vigentes o anulados aparte | Empresa, vendedor, tipo y categoría de cliente, cliente, tipo de partida, activa/incobrable, tramo, incluir N/E | Empresa, vendedor, tipo y categoría, cliente, activo/inactivo/recuperación, incluir N/E |
| **Hojas del Excel** | Estado de cuenta (encabezado con empresa, RIF, cliente y "actualizado al…", columnas del equipo, totales) + Movimientos | Detalle · Diario×mes (moneda original) · Diario×mes (USD) · Moneda×mes · Cliente×mes · Excluidos (anulados) · Parámetros | Resumen · Por año · Año×vendedor · Tramos · Top 10 · Por tipo de cliente · Cliente×año · 61–90 y +91 · Incobrables · N/E · Detalle · Parámetros. Con «Ambas», una hoja o bloque por empresa | Resumen · una hoja por empresa (cliente×mes, totales por año, promedios, deuda, días de recuperación) · Parámetros (con la fórmula) |
| **Quién lo ve** | Módulo `cuentas` | `reportes` | `reportes` **y** `cuentas` (detalle de deuda por cliente) | `reportes` **y** `cuentas` |

**Piezas comunes para descargar en Excel y filtrar por fechas** (hoy todo sale en CSV, sin encabezado de empresa ni
período, y no se puede elegir una fecha de corte pasada):

- **`src/lib/excel.ts` + `BotonExcel`**: `descargarExcel({ archivo, hojas: [{ nombre, encabezado, columnas: [{ titulo,
  valor, tipo: usd | bs | fecha | entero | pct | texto, ancho }], filas, totales }] })`. Debe incluir:
  - carga diferida;
  - formato numérico y fechas reales;
  - anchos de columna y autofiltro;
  - título combinado y fila de totales;
  - nombre de archivo con empresa y corte.

  `xlsx` (SheetJS 0.18.5) ya está instalado, pero **no permite estilos** y tiene vulnerabilidades conocidas al *leer*
  archivos (afecta a Conciliación y al importador de precios). Propuesta: `exceljs` con carga diferida para los reportes
  con formato, y revisar más adelante las lecturas con `xlsx`.
- **`src/lib/fechas.ts`**: `hoyCaracas`, `iso` y los presets en un solo lugar. Hoy `hoyCaracas` está copiado en 6
  archivos, y "este mes" llega hasta hoy en Reportes pero hasta fin de mes en FiltrosLista.
- **`SelectorPeriodo`** (desde/hasta **en la URL**; hoy el "Personalizado" de Reportes se pierde al recargar) y
  **`SelectorCorte`**.
- **Descargas completas**: el detalle llega en JSON compacto o por tramos, como `reporte_ventas_cubo_json` y
  `exportarLineas`. Hoy hay topes silenciosos de 5.000 y 10.000 filas y un límite de 8 s por consulta.
- **Fecha única de los cobros (arreglo previo):**
  - `pagos.fecha_pago` está vacío en los 1.796 cobros y la fecha está en `created_at` a las 00:00 UTC.
  - `reporte_cobranza` usa el día UTC; el estado de cuenta y el DSO lo pasan a hora de Caracas, así que el mismo cobro
    cae **un día antes** (o en otro mes si es día 1).
  - Solución: llenar `fecha_pago` en la sincronización y usarlo en todas partes.

---

## 1. FORMATO EDC — Estado de cuenta

**Qué trae.** Encabezado con empresa, RIF, cliente y "Estado de cuenta actualizado al…". Una fila por documento con saldo:
Año · Mes · Tipo y Nº · Nº de control · Emisión · Vencimiento · Días transcurridos · Tasa de emisión · Base US$ ·
Impuesto US$ · Total US$ · Deuda US$ · Estatus. Al final, una fila de totales.

- *Año* y *Mes* son los del **vencimiento**.
- *Días* = hoy − vencimiento, la misma regla de GUDS.
- *Tasa de emisión* = BCV de la fecha de emisión, también en documentos en USD.
- *Estatus*: Pendiente por cobrar / NC a favor / Pendiente comprobante de retención.

**Cruce con un cliente de muestra de GUDS (corte 30-sep):**

- 100 de 109 documentos tienen **el mismo saldo al centavo**.
- Hay diferencia de corte: 3 facturas del 29-sep y 1 NC del 7-oct.
- En 9 documentos (facturas en Bs de mayo y NC de julio), finanzas pone el residuo en la NC y Odoo lo deja en la factura;
  el neto difiere ≈ USD 66.
- **El Nº de control del Excel está desalineado en las 109 filas.** GUDS lo trae bien de Odoo.

**Qué ya existe:**

- `estado_cuenta_cliente` → `estado_cuenta_documentos` (`20261001_fase21b_estado_cuenta_cruce.sql`).
- La tabla `TablaDocumentos.tsx`, el PDF, el enlace público, el portal y el correo, con envío masivo y su registro.

**Qué hacer (R1):**

1. Columna **Nº de control**. El dato ya está en `facturas.nro_control`.
2. **Tasa de emisión** en todos los documentos. Los de USD dependen de T2.
3. **Estatus** con las tres etiquetas del equipo, derivado de "qué falta".
4. Año/Mes del vencimiento.
5. **Excel con el formato del equipo** (botón en el detalle). Opcional: Excel masivo desde la selección de Cuentas.
6. **Fecha de corte** (T4). Hoy los documentos abiertos usan siempre la fecha de hoy (`v_hoy`, `:218, :343`).

**Verificación:** el cliente de muestra da 100/109 con el Nº de control correcto; más 5 clientes por empresa contra Odoo.

## 2. FORMATO - Análisis de Vencimiento — Antigüedad

**Qué trae.** Libro de 17 hojas con corte al 30-abr-2026 (era Profit) sobre dos bases:

- **"Matriz"**: 1.631 documentos y 43 columnas.
- **"P Matriz"**: 29 N/E no fiscales.

Secciones por empresa:

- CxC por año de emisión y % vencido;
- año × vendedor;
- tramos 0–30 / 31–60 / 61–90 / +91, contados **desde la emisión**;
- top 10 clientes;
- por tipo de cliente;
- tipo de partida: Cartera abierta / Adelanto / RET IVA / 25 % IVA + IGTF;
- cliente × año;
- 61–90 y +91;
- **incobrables**: 26 clientes, USD 59.381, "casos con abogados". La marca va por cliente: solo 5 de 284 clientes la
  tienen mezclada.

**Qué ya existe:**

- `/admin/cuentas-por-cobrar`: tramos calculados en el navegador desde el vencimiento, con CSV.
- `/admin/cuentas`: DSO, mora y NC sin aplicar.
- `facturas.es_saldo_inicial`.
- Hay **tres cálculos distintos de tramos**: CxC en el navegador, `cartera_vendedor` y `estado_cuenta_datos`.

**Qué hacer (R3):**

1. `reporte_antiguedad(corte, base_dias, agrupar)` **en el servidor**, una sola fuente para todos. Usa la lógica de saldo
   al corte de `metricas_cobranza_calculo` (`apl_ant`).
2. Sub-vista *Antigüedad*:
   - selector emisión/vencimiento (arranca en vencimiento);
   - agrupar por empresa, año, vendedor, tipo o categoría, cliente o tipo de partida;
   - % del total y % vencido;
   - top 10;
   - Excel con una hoja por sección.
3. **Tipo de partida**: facturas, NC, ND, anticipos, retención de IVA por recibir, IVA + IGTF y **N/E no fiscal** (con
   interruptor).
4. **T6, anticipos de Odoo sin aplicar.** Hoy `v_anticipos` los excluye (`odoo_id is null`).
5. **T5, gestión de cobranza**: activa / incobrable (cobranza externa) por cliente, con nota, fecha, responsable y
   excepción por documento.
6. Mostrar "último estado de cuenta enviado" en lugar de la columna "Observación".

**✅ Hecho (22g, 8-oct).** Reportes → Cobranza → **Antigüedad** (`?cobranza=antiguedad`, también en Ctrl+K; exige reportes y
cuentas):

- **Una sola fuente** `partidas_cobranza(corte, empresas, ne)`: facturas, ND, NC a favor, anticipos de Odoo y de GUDS y notas
  de entrega abiertas al corte, con el mismo saldo y el mismo "qué falta" del estado de cuenta (probado documento por documento).
  `reporte_antiguedad(corte, ne)` la entrega en JSON y la página agrupa; ≈ 200 ms.
- Corte (hoy o cierre de mes), días desde el vencimiento (por defecto) o la emisión, activa/incobrable, interruptor de N/E;
  matriz por año, vendedor (del documento o del cliente), tipo, categoría, cliente, tipo de partida, clasificación o empresa, en
  tramos o años, con % del total y % vencido; top 10; detalle; Excel con las secciones del libro de finanzas. Todo en la URL.
- **T6:** la sincronización trae el saldo sin aplicar de cada cobro de Odoo y sus conciliaciones (`pagos.saldo_odoo_usd`,
  `pagos.odoo_conciliaciones`), así se sabe el saldo a cualquier corte. Hoy: GUDS USD 55.929 (92 cobros) y Quirutec USD 195.758 (164),
  que antes no se veían. `v_anticipos` los incluye: el estado de cuenta los resta y CxC → Anticipos los lista ("se aplica en Odoo").
- **T5:** gestión de cobranza en el detalle de la cuenta (activa/incobrable, responsable, nota, desde cuándo, excepciones por
  documento, historial). Carga del Excel: 139 documentos incobrables (USD 59.381) → 21 clientes + 19 documentos sueltos.
- "Observación" → último estado de cuenta enviado por correo, en el top 10 y en el detalle del Excel.
- **Cuadre con el Excel al 30-abr:** 1.034 de 1.069 facturas y ND con el saldo idéntico; deuda de documentos GUDS −0,6 % y
  Quirutec −0,1 % (NC que Odoo ya aplicó a su factura); incobrables idénticos. El Excel incluye documentos del 1 al 6 de mayo y
  cuenta desde la emisión.

## 3. FORMATO DE LO COBRADO — Libro de cobros

**Qué trae.**

- Hoja "Cobranza 2026": 2.354 cobros del 5-ene al 25-sep.
- Columnas: empresa, fecha, número, RIF, cliente, cobrador, forma de pago, referencia, cuenta/diario, moneda, monto
  original, tipo de cambio y total USD.
- Tablas dinámicas: moneda×mes, cuenta×moneda×mes, cuenta×mes USD y cliente×mes USD.
- **Ene–abr sale de Profit** (1.255 filas) y **may–sep de Odoo** (1.099).

**Cruce may–sep con `pagos`:**

- 1.092 de 1.099 encontrados; monto original igual en el 98 %, fecha en el 99,9 %.
- El Excel cuenta **18 cobros anulados en Odoo** (USD 106.463). En 11 de ellos el cobro que lo reemplazó también está
  → doble conteo.
- Hay ≈ 95 cobros vigentes de Odoo (≈ USD 103.000) en el rango que el Excel no trae.
- El Excel usa **una tasa por semana** (la BCV del último día hábil) → may–sep en Bs da 7,7 % menos que GUDS.

**Ene–abr en el sistema (D3).**

- Odoo no tiene esos cobros. Antes de mayo solo hay 173 **anticipos de saldo inicial migrados**, en los diarios "Saldo
  Iniciales Anticipo" y "… ME" (`PSIANT` / `PSIAME`), más 3 cobros de banco de abril que ya están en Odoo.
- Al menos 26 de esos anticipos son el mismo dinero que un recibo de Profit del Excel.

**Qué ya existe:**

- `reporte_cobranza`: una dimensión a la vez, solo USD.
- `/admin/pagos`: CSV sin Bs ni tasa, y no está en el menú.
- CxC → Recibos: sin exportar.

**Qué hacer (R2):**

1. Sub-vista *Lo cobrado*:
   - **detalle** con las columnas del Excel (el vendedor sale del cliente, porque Odoo no tiene cobrador; IGTF aparte);
   - **matrices** diario×mes en moneda original y en USD, moneda×mes y cliente×mes;
   - nuevas `reporte_cobros_detalle` (JSON) y `reporte_cobranza_matriz`.
2. **USD = monto original ÷ tasa BCV del día del cobro (D1)**, sin depender de `amount_usd` de Odoo. En 282 de 1.019
   cobros en Bs, Odoo usa otra tasa. Necesita T2 para fechas anteriores al 19-jul.
3. Solo cobros vigentes; los anulados y en borrador se ven aparte para explicar diferencias.
4. **Carga de cobros de Profit (D3):**
   - tabla `cobros_historicos` con `origen='profit'`, lote y archivo, como `importar-historico-profit.mjs`;
   - se cargan las **1.253 filas con número de Profit** del Excel (ene–abr). Las 2 con número de Odoo ya están en Odoo;
   - emparejar cliente por RIF.
   - **Regla para no contar dos veces:** antes de la fecha de arranque de Odoo de cada empresa valen los cobros de
     Profit y **no** se cuentan los anticipos de saldo inicial migrados. Desde el arranque, todo sale de Odoo.
   - Totales de control: GUDS 555 filas / USD 487.195,84; Quirutec 700 / USD 717.029,91. El USD se recalcula con D1
     cuando haya tasas (T2).
5. Llenar `fecha_pago` (ver la sección de piezas comunes).

**✅ Hecho (22f, 8-oct).** Reportes → Cobranza → **Lo cobrado** (`?cobranza=cobrado`, también en Ctrl+K):

- **Fuente única** `cobros_unificados`: Odoo desde su arranque (`empresas.odoo_arranque` = 1-may-2026 en las dos) y, antes,
  los **1.253 recibos de Profit** cargados del Excel (`cobros_historicos`, `scripts/importar-cobros-profit.mjs`; GUDS 553,
  Quirutec 700; las 2 filas sin número de Profit ya están en Odoo). Los 173 anticipos de saldo inicial de 2026 anteriores al
  arranque (`bancos.saldo_inicial`) no cuentan; desde el arranque sí (82).
- USD = monto ÷ BCV del día (D1), con la marca P cuando la tasa sale de Profit. La caja o cuenta de Profit se lleva al
  diario de Odoo equivalente; quedan con su nombre la tarjeta de débito (Quirutec) y la cuenta por cobrar entre empresas (GUDS).
- Matriz diario / moneda / cliente / vendedor × mes, en USD o en moneda original; detalle; "No cuentan" (anulados,
  borradores, por verificar, IGTF, saldos iniciales) y Excel con las hojas del libro de finanzas + Parámetros.
- El **Resumen** de cobranza usa la misma fuente: ahora incluye ene–abr (Profit) y pasa a la BCV del día.
- Cuadre may–sep con el Excel: de 1.099 cobros, 1.092 están en GUDS; 1.046 cuentan en los dos (USD 1.381.323 en GUDS
  frente a 1.386.483 en el Excel: −0,4 % por la tasa del día frente a la semanal); el Excel suma además 18 anulados en
  Odoo (USD 106.463), 26 IGTF y 2 borradores; 7 no están en GUDS; GUDS trae 90 cobros vigentes que el Excel no tiene.
- **`fecha_pago`** llena en los 1.800 cobros de Odoo (la sincronización la escribe) y en los de GUDS (disparador);
  Cuentas, CxC → Recibos, Pagos, el portal y el vendedor la muestran (antes los cobros de Odoo salían un día antes).

## 4. FORMATO - DMQ GS - Promedio Ventas — Ventas vs deuda

**Qué trae.** Una hoja por empresa: Quirutec 1.264 clientes, GUDS 570. Por cliente:

- **venta mensual con IVA** de 2020 a abr-2026;
- promedio de 12 meses y "cuatrimestral";
- deuda (CxC + N/E);
- **días de recuperación = deuda ÷ promedio mensual × 30**;
- compra de 90 días;
- marcas Recuperación y Activo/Inactivo;
- % de impuesto por cobrar.

Las ventas **cuadran al centavo** con `ventas_historicas.total_usd`.

**Fórmulas rotas en el Excel:**

- Divisores manuales por fila.
- "Activo" mira 2024.
- Un porcentaje está invertido.
- Hay clientes sin categoría.

**Qué ya existe:**

- Reportes → Análisis: cliente × mes, Odoo + Profit, sin IVA.
- `metricas_cobranza_calculo`: deuda **bruta** ÷ venta de los **últimos 90 días**, solo Odoo.

**Qué hacer (R4):**

1. `reporte_ventas_vs_deuda(corte, meses)` y su sub-vista:
   - cliente × mes **con IVA** (Profit + Odoo);
   - promedio de 12 meses (para clientes nuevos, se divide entre los meses desde la primera compra, automático);
   - promedio de 5 meses, compra de 90 días, deuda y días de recuperación;
   - recuperación y activo (compró en los últimos N meses, configurable);
   - % de impuesto por cobrar;
   - Excel.
2. **Días de recuperación oficiales (D6):**
   **deuda neta al corte ÷ venta promedio mensual de los últimos 12 meses (con IVA, Profit + Odoo) × 30**, donde
   *deuda neta = facturas y ND con saldo − NC a favor − anticipos sin aplicar (+ N/E activas si el interruptor está
   encendido)*.
   - Para clientes con menos de 12 meses, el promedio se toma sobre los meses desde su primera compra.
   - **Explicación visible en todos los lugares donde aparece el número:** tooltip en la columna de Cuentas, línea bajo
     la tarjeta del detalle de la cuenta, encabezado de la sub-vista, hoja "Parámetros" del Excel, VendedorDetalle y la
     cartera del vendedor.
   - Ejemplo de texto: *"Días de recuperación: deuda neta USD X ÷ venta promedio mensual USD Y (12 meses, con IVA) × 30
     = Z días"*.
   - El DSO actual (90 días, deuda bruta) queda como **"tendencia 90 días"**, también rotulado.
   - Hay que **recalibrar el umbral de "DSO alto"** (hoy 60) de la torre de control con la nueva fórmula.
3. Siempre rotular "venta con IVA" o "venta neta". La venta oficial de los reportes de ventas sigue siendo sin IVA.

**✅ Hecho (22h, 8-oct).** Reportes → Cobranza → **Ventas vs deuda** (`?cobranza=ventas-deuda`, también en Ctrl+K; exige
reportes y cuentas):

- **Venta con IVA** (`ventas_con_iva`): Profit = todos sus documentos, como el Excel (facturas, devoluciones, notas
  financieras, ND cambiarias y reversos); Odoo = facturas, NC y ND publicadas sin saldos iniciales.
- **Días de recuperación (D6)** (`recuperacion_calculo`): deuda neta de la Antigüedad (`partidas_cobranza`, con N/E si se
  incluyen) ÷ venta promedio mensual de 12 meses (cliente nuevo: los meses desde su primera compra) × 30. Con deuda y sin
  compras en 12 meses = "en recuperación" (sin días).
- La sub-vista: cliente × mes (12, 24, 36 meses o desde dic-2020), venta de 12 meses, promedios de 12 y 5 meses, compra de 90
  días, deuda neta, días, deuda ÷ compra 90 d, % de impuesto por cobrar, activo / inactivo (compró en los últimos N meses,
  configurable) y en recuperación; por cliente, vendedor, tipo, categoría o empresa; Excel con Resumen, una hoja por
  empresa, Por vendedor y Parámetros (con la fórmula). Corte: cierre del último mes (por defecto) o hoy.
- **La explicación está a la vista donde aparece el número**: encabezado de la sub-vista y total, título de cada celda, columna
  "Días rec." de Cuentas, tarjeta del detalle de la cuenta, ficha del vendedor, cartera del vendedor en su portal,
  Reportes → Cobranza (por vendedor y cliente) y Parámetros del Excel. El DSO de la ventana queda como **"Tendencia 90 d (DSO)"**.
- **Torre de control recalibrada**: "más de 90 días de recuperación" (`configuracion.cobranza_recuperacion_alerta_dias`, 90) y
  "con deuda y sin compras en 12 meses", sin contar los incobrables (hoy 61 y 95; con la regla vieja del DSO salían 231).
  Cuentas cuenta lo mismo que la torre.
- **Cuadre con el Excel al 30-abr:** venta de 12 meses de GUDS igual al centavo (USD 1.669.545,30, mes por mes); Quirutec −1,4 %
  porque el Excel de Quirutec **suma como venta las notas de entrega de Profit** (no fiscales; p. ej. las dos de sep-2025 de
  USD 22.416), que GUDS no tiene ni cuenta como venta (D4). Deuda neta: GUDS −0,9 %, Quirutec −2,8 % (anticipos de saldo
  inicial fechados en mayo y documentos del 1 al 6 de mayo). El "promedio anual" del Excel tiene divisores manuales en algunas
  filas y agrupa clientes a mano (hoja LISTADO): por cliente no siempre cuadra.

---

## D5 — Clasificación de clientes: qué hay en Odoo frente al Excel

**Odoo prácticamente no tiene clasificación de clientes.** Se revisaron 296 campos de `res.partner`, siempre en solo
lectura.

- *Industria* (`industry_id`): su catálogo tiene los 7 tipos viejos de Profit más 21 sectores estándar en inglés, pero
  solo **3 clientes** tienen valor, los 3 de Quirutec.
- *Canal de contacto* y *Segmento de contacto*: catálogos vacíos.
- Los campos de texto `channel`, `segmentation` y `client_category`: vacíos.
- `tipo_cliente` (oro, bronce, silver): vacío.
- Las *Etiquetas* son administrativas (Cliente, Proveedor, Empleado…).

Por eso `clientes.tipo_cliente`, `canal` y `segmento` están vacíos en GUDS: la sincronización lee bien esos campos
(`importar.js:719-740`), pero **Odoo está vacío**. Además, un disparador impide editar esas columnas desde GUDS.

| | Profit (`ventas_historicas`) | Excel de finanzas |
|---|---|---|
| GUDS | 6 tipos gruesos (DISTRIBUIDOR, CADENAS, PARTICULAR, TRADICIONAL, AUTOMERCADO, INSTITUCIONAL); canal casi siempre "DIRECTO"; segmento RETAIL / MAYORISTAS / … | 16 tipos → 4 canales (Moderno, Tradicional indirecto, Tradicional directo, Otro) → 3 categorías de cobranza (Cadena Moderno, Independiente/Distribuidor, Resto) |
| Quirutec | 7 tipos (DISTRIBUIDOR, PARTICULAR, CLÍNICA, CORPORATIVO…); segmento SALUD / RETAIL / DENTAL | 12 tipos (Clínica A/B/C, Distribuidor, Droguería, Retail…) → 3 categorías de cobranza; además, una letra de tamaño A/B/C escrita a mano |

**Comparación entre el Excel y Profit:**

- Coinciden en el **61 % en GUDS** y el **86 % en Quirutec**.
- En Profit, DISTRIBUIDOR es un cajón de sastre: en GUDS se reparte entre 15 tipos del Excel.
- Equivalencias fiables: CADENAS → Cadena Moderno (90 %), PARTICULAR → Particular (98 %), y en Quirutec DISTRIBUIDOR o
  CLÍNICA → Clínica/Distribuidor (90 %).

**Situación de los clientes activos hoy en GUDS:**

| | GUDS | Quirutec |
|---|---|---|
| Ya tienen tipo en el Excel | 147 (90 % de las ventas, 82 % de la deuda) | 118 (83 % de las ventas, 87 % de la deuda) |
| Propuesta automática fiable desde Profit | 25 (categoría) | 71 (categoría) |
| Quedan por asignar a mano | ≈ 85 | ≈ 88 |

- Los cientos de "Por definir" del Excel son clientes históricos sin actividad: no hace falta clasificarlos.
- Al Excel le faltan en el catálogo "Cines" y "E-commerce".

**Opciones para decidir:**

- **A (recomendada).** La taxonomía de finanzas pasa a ser la oficial y **se guarda en Odoo, reutilizando sus campos
  vacíos**: Industria = tipo, Canal de contacto = canal, Segmento de contacto = categoría de cobranza. GUDS ya los lee
  y los reportes ya agrupan por ellos.
  - Finanzas edita en una pantalla de GUDS que **escribe en Odoo por la cola `odoo_escrituras`**, en modo prueba →
    activo, como fotos y direcciones.
  - Hay que crear los valores de los catálogos en Odoo (y ordenar los 21 sectores en inglés).
- **B.** Una tabla propia en GUDS, editable por finanzas. Es más rápida, pero se separa de Odoo y necesita columnas
  nuevas, porque las actuales están bloqueadas por el disparador.
- **Antes de cargar, finanzas debe:** agregar o reasignar "Cines" y "E-commerce"; decidir si la letra A/B/C de Quirutec
  es una dimensión aparte ("tamaño"); y repasar las ≈ 170 asignaciones manuales con la sugerencia de Profit al lado.

---

## D4 — Módulo de notas de entrega no fiscales (diseño)

### Lo que se encontró

- **Odoo no tiene ningún concepto de N/E** (ni diario, ni serie, ni campo, ni modelo, ni cuenta), y las 29 del Excel
  **viven solo en el Excel** (USD 44.004,91: 25.182,15 activas y 18.822,76 incobrables, 22 clientes).
- Pero **Quirutec sigue despachando con N/E en 2026**: 6 pedidos de jun–sep dicen "despachado con nota de entrega 31xx"
  y luego se facturan en Odoo. La N/E es también un paso previo a la factura, no solo deuda vieja.
- La mercancía sale siempre por pedido + albarán en Odoo. En GUDS hay **49 pedidos entregados y sin ninguna factura**
  (4 de consignación).
- **No conviene reutilizar `cuentas_cobrar`:**
  - son 185 filas "Saldo pendiente según Odoo" del 14-ago que nunca se actualizaron (USD 131.576 en GUDS y 280.528 en
    Quirutec);
  - ninguna RPC las lee;
  - no admiten abonos;
  - la numeración es global.
  - Se muestran como "Cuentas manuales" en CxC.

### Diseño propuesto

- **Menú y permisos:**
  - Finanzas → **Notas de entrega** (`/admin/notas-entrega`, `/nueva`, `/:id`), con módulo propio `notas_entrega`.
  - Administrador: todo. Contador: ver, crear y editar. Vendedor: solo las de su cartera, en su portal. Cliente: nada.
- **Pantalla:**
  - Indicadores: saldo activo, incobrable, vencidas, por convertir y emitidas en el mes.
  - Pestañas: Abiertas / Incobrables / Convertidas / Anuladas / Todas.
  - Filtros por empresa, cliente, vendedor, estado, clasificación y fecha. Descarga en Excel.
- **Tablas:**
  - `notas_entrega`: serie y número por empresa (`NE` correlativo de GUDS / `TAL` talonario físico / `HIST`
    históricas), cliente, vendedor, pedido de Odoo, emisión, vencimiento, moneda, tasa, total sin IVA, saldo generado,
    estado y clasificación.
  - `nota_entrega_items`: líneas con producto o texto libre.
  - `nota_entrega_movimientos`: abono, descuento, devolución, facturada y ajuste.
  - Se reutilizan los triggers y el RLS multiempresa, `siguiente_numero` y `puede()`.
- **Estado y clasificación son ejes distintos.**
  - Estado: borrador → emitida → abonada → pagada / **facturada** / devuelta / anulada.
  - Clasificación: activa / incobrable. Marcar incobrable no baja el saldo, igual que en el Excel.
- **Emitir:**
  - formulario con cliente de la empresa activa (no en «Ambas»), líneas, vencimiento y observación;
  - **PDF "NOTA DE ENTREGA — DOCUMENTO NO FISCAL"**, sin IVA ni número de control, con firma de recibido. Ver la
    pregunta 2: puede que no se deba imprimir.
- **Abonos.** Nunca con `registrar_cobro_facturas`, que es para facturas de Odoo.
  - Si el dinero entra a un banco de Odoo, se registra en Odoo (queda como anticipo) y la N/E se **vincula a ese cobro**
    (`pago_id`), para no contarlo dos veces como "a favor".
  - Si no pasa por Odoo, el abono queda solo en GUDS, con comprobante.
- **Conversión a factura:**
  - la factura se emite en Odoo y GUDS **sugiere el enlace**: busca el número de N/E en la nota del pedido y sigue
    `facturas.orden_id`. Hoy ya hay 6 casos enlazables.
  - Una persona confirma; se registra un movimiento "facturada" y desde ahí la deuda vive en la factura fiscal.
  - Puede ser parcial.
- **Inventario:**
  - la mercancía sale **por pedido + albarán en Odoo** (lo que Quirutec ya hace) y la N/E solo se enlaza;
  - nunca se descuenta stock solo en GUDS, porque la sincronización lo pisa;
  - alerta de "entregado sin facturar".
- **No escribir N/E en Odoo.** Cualquier asiento de venta entra al libro fiscal o a la CxC del cliente. Solo se permite
  dejar el número de N/E en la nota del pedido.
- **Carga inicial de las 29:**
  - serie `HIST`, en Quirutec;
  - las 3 con abonos restados en fórmula se cargan como total + abonos sin fecha, para que el saldo cuadre;
  - los 15 clientes que no tienen ficha en GUDS **se cargan con nombre, sin crear clientes**, porque crear un cliente lo
    crea en Odoo.
- **En los reportes, siempre separadas de lo fiscal:**
  - el estado de cuenta del cliente (PDF, enlace, portal, correo) **no cambia**;
  - en el detalle de la cuenta (admin) se agrega una pestaña "No fiscal" y "Deuda interna = fiscal + N/E";
  - Antigüedad, Ventas vs deuda y los días de recuperación las incluyen con interruptor (encendido por defecto en la
    deuda; nunca cuentan como venta);
  - columna N/E en Cuentas y en la cartera del vendedor;
  - alertas en la torre de control.

### Preguntas para finanzas (con propuesta)

1. ¿Se siguen emitiendo N/E y en qué empresas? → un módulo para las dos, activable por empresa; empezar por Quirutec.
2. ¿La N/E acompaña mercancía en tránsito? **Validar con el asesor fiscal**: si funciona como guía de despacho podría
   exigir imprenta autorizada y número de control. Mientras tanto, GUDS solo registra el número del talonario y no
   imprime.
3. ¿La mercancía sale por pedido y albarán en Odoo? → sí.
4. ¿Cómo se cobran (banco de Odoo, efectivo, cuenta externa)? → los dos caminos descritos en Abonos.
5. ¿Toda N/E termina en factura, y en qué plazo? → sí, con alerta a los 30 días.
6. ¿Precio con o sin IVA, y se factura por el total? → sin IVA en la N/E; factura por el total, aplicando los abonos en
   Odoo.
7. Numeración: ¿desde qué número sigue? ¿Qué son la serie 31xx de 2026 y "P00-00056"? → serie `NE` por empresa + `HIST`.
8. ¿Incobrable por documento o por cliente? → por documento, heredando la marca del cliente.
9. ¿Se envía al cliente un estado de cuenta de N/E? → PDF aparte, solo cuando se pida; nunca en el portal.

### Fases

| Fase | Contenido |
|---|---|
| NE1 | Tablas, carga de las 29, lista y detalle de solo lectura, bloque "no fiscal" en la antigüedad y en la deuda interna (lo que necesita R3) — ✅ 22g: Finanzas → Notas de entrega; 29 HIST (USD 44.004,91), 5 clientes con ficha; pestaña "No fiscal" en la cuenta |
| NE2 | Emitir, PDF, abonos y anular |
| NE3 | Conversión con sugerencias, enlace con pedidos de Odoo, alertas y cartera del vendedor |

---

## Transversales

- **T1** Clasificación de clientes, según la opción que se elija en D5.
- **T2** Histórico de tasas BCV de 2021 a jul-2026 desde `res.currency.rate` de Odoo, en solo lectura. `tasa_bcv` solo
  tiene datos desde el 19-jul-2026.
- **T3** Exportador Excel compartido (ver la sección de piezas comunes).
- **T4** Corte a fecha: saldo de cada documento = total − aplicaciones con fecha ≤ corte.
- **T5** Gestión de cobranza: incobrable / cobranza externa.
- **T6** Anticipos de Odoo sin aplicar, visibles.

## Orden propuesto

| Fase | Contenido | Depende de |
|---|---|---|
| R0 | `fecha_pago` y fecha única de cobros; `lib/fechas` + `SelectorPeriodo` / `SelectorCorte`; `lib/excel` + `BotonExcel`; T2; armazón de sub-vistas en Reportes → Cobranza y accesos en Ctrl+K; limpieza de los hallazgos de abajo | — |
| R1 | Estado de cuenta con el formato del equipo, Excel y corte | R0 |
| R2 | Lo cobrado + carga de cobros de Profit ene–abr | R0 |
| R3 | T5, T6, Antigüedad y NE1 (+ T1 si ya se decidió D5) — ✅ 22g | R0, NE1 |
| R4 | Ventas vs deuda y días de recuperación nuevos, con su explicación — ✅ 22h | R3 |
| NE2–NE3 | Emitir, abonos y conversión de N/E | respuestas de finanzas |

Cada fase se cierra con el cuadre contra el Excel del equipo (es la "respuesta correcta"), conteos de UI contra SQL y
Playwright a 1440 y 390 px en GUDS, Quirutec y «Ambas».

## Hallazgos para revisar

> 8-oct (noche, 22h): **Ventas vs deuda** hecha (ver §4). Para decidir con finanzas: el Excel de Quirutec cuenta como venta las
> notas de entrega de Profit; el plan (D4) dice que nunca son venta y GUDS solo tiene las 29 abiertas, así que los clientes que
> compran con N/E salen con más días de recuperación en GUDS. Si finanzas quiere contarlas, hay que cargar el histórico de
> N/E de Profit. Umbral de la torre: 90 días (la mediana hoy es 70); se cambia en `cobranza_recuperacion_alerta_dias`.

> 8-oct (noche, 22g): **Antigüedad** hecha (ver §2). Dos hallazgos para finanzas: (1) Odoo tiene **USD 251.687 en cobros sin
> aplicar** (GUDS 55.929, Quirutec 195.758; 256 cobros, varios de "Saldo Iniciales Anticipo") que GUDS no mostraba; ahora restan
> en el estado de cuenta y se ven en la antigüedad, pero hay que aplicarlos en Odoo. (2) Los anticipos de saldo inicial de
> GUDS Supply se migraron a Odoo con fecha 4–5 de mayo, no con la de Profit: a un corte anterior no aparecen y su antigüedad
> sale corta. Corregir la fecha es en Odoo.

> 8-oct (noche, 22f): **Lo cobrado** hecho (ver §3). Aviso de operación: la sincronización escribe con los disparadores
> apagados (`session_replication_role = replica`), así que una columna obligatoria nueva en una tabla espejo se despliega
> **primero en la sincronización** y después en la base. Por hacerlo al revés, una corrida (15:30 VE) falló y la siguiente,
> ya con la función nueva, salió bien.

> 8-oct (tarde, 22e): consignación **activa** (aprobar crea la cotización en borrador en Odoo, verificado de punta a punta
> con un cliente de prueba sin Odoo: el envío para antes de escribir). Pendiente de datos: **46 almacenes de consignación
> sin cliente** (22 de GUDS y 24 de Quirutec) que Odoo no permite identificar: se asignan a mano en Almacenes (lista con
> sugerencias en `docs/privado/22e/`). Tasa de las NC: con la regla nueva el cliente de muestra pasa de 66 a 70 de 100
> filas con la tasa idéntica a la del Excel; lo que queda son NC viejas sin rastro de su factura y días con tasa de Profit
> (redondeada a 2 decimales).

> 8-oct, decisiones del usuario: 1 → anular los 2 cobros y que los administradores puedan anular, todo a la papelera (22a);
> 2 → archivar y quitar la pestaña (22a); 3 → la consignación crea un pedido en Odoo (22b); 4 → exigir `reportes` y
> `cuentas` (22a).

1. **2 cobros de prueba del 6-oct en producción**, registrados desde GUDS y sin Odoo: `PAG-20261006-0015` (USD 2,29) y
   `PAG-20261006-5776` ("ABONO EQUIV 100$ (PRUEBA)", USD 100). Están aplicados a 7 facturas de GUDS, así que el saldo de
   esas facturas en GUDS está USD 102,29 por debajo de Odoo.
2. **`cuentas_cobrar` vieja** (185 filas del 14-ago) se muestra como "Cuentas manuales"; además, crear una cuenta manual
   falla en «Ambas». Propuesta: archivarla y quitar la pestaña.
3. **La aprobación de consignación todavía crea facturas internas** que no están en Odoo y que entrarían en el estado de
   cuenta y en las ventas. Hoy no hay ninguna. Hay que decidir si se apaga.
4. **Permisos**: quien tiene `reportes` sin `cuentas` ve la deuda por cliente en los reportes. R3 y R4 exigirán los dos.
5. `/admin/pagos` no está en el menú ni en Ctrl+K. Cuentas, el detalle de la cuenta, CxC → Recibos y Bancos no exportan
   nada.
