# Plan de mejoras — revisión de módulos del 30-sep-2026

Origen: reunión de revisión con el equipo (finanzas, operaciones, comercial) del 30-sep y recorrido completo de la app
(28 pantallas de admin × 2 empresas, detalle de cuentas, clientes, vendedores y reportes). Este documento no lleva nombres de
clientes ni montos por cliente; el detalle está en la bitácora privada.

Principios (los de siempre):
- GUDS es espejo de Odoo. Lo que nace en Odoo se corrige en Odoo; GUDS solo escribe lo ya acordado (pedidos en borrador,
  entregas, dirección/teléfono, foto/descripción) y lo nuevo que este plan propone escribir se marca **[escribe en Odoo]**.
  Nunca se borra en Odoo.
- Lo que sea propio del negocio y no haga falta en Odoo (comentarios, planes de pago, métricas) vive solo en GUDS.
- Cada fase cierra con: suite multiempresa, `tsc`, build, Playwright en escritorio y 390 px, y cuadre contra Odoo cuando toca
  cifras.
- Los Excel y reportes que mande el equipo **afinan** las fases 2, 3 y 4 (columnas, orden, nombres), pero no las bloquean: se
  construyen ya con lo explicado en la reunión.

---

## Orden y dependencias

| Fase | Tema | Depende de | Bloquea a |
|---|---|---|---|
| 0 | Accesos, publicación y arreglos rápidos | pago de Netlify | que el equipo pruebe |
| 1 | Separar datos por empresa (categorías, vendedores, empleados) | — | 5, portal |
| 2 | Estado de cuenta a profundidad | — (Excel lo afina) | 3 |
| 3 | Métricas internas de cobranza | 2 | — |
| 4 | Planificación de pagos (Cuentas por Pagar) | — (Excel lo afina) | — |
| 5 | Listas de precios | 1; listas reales del equipo para la carga | portal en producción |
| 6 | Calidad de datos y cuadre Profit ↔ Odoo | — | — |
| 7 | Reportes: ajustes y metas | opinión de dirección sobre qué análisis quedan | — |
| 8 | Transportista externo (operador logístico) | datos del operador | entregas a consignación |
| 9 | Facturación digital | documentación del proveedor | — |
| 10 | Cobros y conciliación operativa | uso real del equipo de finanzas | — |
| 11 | Planificación de compras (segundo nivel) | 3, 7 | — |

Ritmo propuesto: 0 → 1 → 2 → 3 → 4 en serie (cada una deja algo que el equipo puede revisar), 5 y 6 en paralelo cuando
lleguen las listas, 7–11 según lleguen insumos.

---

## Fase 0 — Accesos, publicación y arreglos rápidos

**Objetivo:** que el equipo entre a la versión actual y no tropiece con detalles.

0.1 **Acceso del equipo de finanzas.** Un usuario administrador no entra desde el 25-ago. Revisar qué URL usa (la vieja
    tienda vs `portal.guds-supply.com`), restablecer clave con el flujo `/restablecer-clave` y confirmar el ingreso.
    Revisar si su rol debe ser *Contador* en vez de *Administrador*.
0.2 **Publicación.** Al pagarse Netlify: publicar `main`, verificar el deploy "ready" y repasar en producción las pantallas
    nuevas (contactos, filtros, estado de cuenta).
0.3 **Usuarios de prueba visibles.** Quitar de la lista de vendedores los usuarios de QA (o marcarlos `es_prueba` y
    ocultarlos en listas, reportes y asignaciones). Revisar el usuario vendedor que usa el correo personal de operaciones.
0.4 **Correos reales de vendedores.** Hoy son `@guds.test`. Pantalla en Vendedores para cargar el correo real y enviar la
    invitación (mismo flujo que contactos → acceso al portal). Pedir la lista al equipo.
0.5 **Detalles visuales del recorrido:**
    - Ficha de cliente: etiqueta "Empresa" duplicada (tipo de cliente y "es empresa" muestran lo mismo).
    - Detalle de vendedor: el título muestra solo el nombre; usar nombre completo.
    - Barra superior: con títulos largos "Odoo hace 1 h" y la tasa BCV saltan a dos líneas; truncar el título antes.
    - Estado de cuenta: el selector "Filas por página" de *Documentos con saldo* aparece vacío.
0.6 **Guía de verificación cruzada** para el equipo (1 página en el propio sistema o PDF): qué comparar contra Odoo
    (venta del mes por cliente, pagos a un proveedor, cartera de un vendedor, stock de un almacén) y cómo reportar
    diferencias con el botón *Ticket*.

**Verificación:** login real del usuario afectado; deploy publicado; Playwright de vendedores sin usuarios de prueba.

---

## Fase 1 — Separar los datos por empresa

**Problema:** en GUDS se ven categorías y vendedores de Quirutec (y al revés). La tabla `categorias` no tiene empresa: Odoo no
asigna compañía a `product.category`, así que se importan juntas.

1.1 **Categorías por empresa.**
    - Calcular la empresa de cada categoría a partir de sus productos (`productos.empresa_id`): GUDS, Quirutec o
      *compartida* (las dos). Guardarlo en `categorias.empresas` (arreglo) al sincronizar, no a mano.
    - La pantalla Categorías y el selector de categoría en Productos muestran solo las de la empresa activa (más las
      compartidas, marcadas). En «Ambas» se ven todas con su empresa.
    - El portal del cliente arma el menú de categorías con las que tienen **productos vendibles y visibles de la empresa que
      está comprando**; una categoría vacía para esa empresa no aparece aunque esté activa.
    - Categorías que no son de venta (gastos de importación, servicios internos, "Todos / Entregas"): ocultas del portal
      por defecto. Regla: si ninguno de sus productos es `vendible`, la categoría no se ofrece; además, interruptor manual.
    - Nombres largos de Odoo ("MATERIAL MÉDICO QUIRÚRGICO / GUANTES"): mostrar el último tramo como nombre y el padre como
      grupo, para que en el portal se vean como subcategorías de verdad.
1.2 **Vendedores por empresa.**
    - Un vendedor pertenece a las empresas donde Odoo le asigna clientes o donde tiene acceso (`usuario_empresas`). La lista,
      los KPI (vendedores, cartera, sin asignar), los filtros y las metas se calculan con la empresa activa.
    - Un vendedor de la otra empresa no aparece con "0 clientes" en esta; si tiene clientes en ambas, aparece en las dos con
      la cartera de cada una.
    - Revisar que el "Reasignar a" y el alta de clientes solo ofrezcan vendedores de la empresa.
1.3 **Empleados que llegaron como clientes.** Hay contactos de empleados sin empresa, asignados a un usuario de soporte; tres
    tienen facturas (compras de personal).
    - Identificarlos por la etiqueta *Empleado* de Odoo o por pertenecer a la empresa matriz; marcarlos `tipo_cliente =
      empleado`.
    - No cuentan como cartera de vendedor ni en "clientes sin vendedor"; sí siguen en Cuentas y Facturas si tienen deuda.
    - Filtro "Tipo: empleado" en Clientes para revisarlos.
    - **Decisión a confirmar:** si las compras de personal deben verse en reportes de venta (propuesta: sí, como canal
      *Personal*, excluible con un filtro).
1.4 Repetir en el portal del cliente el cambio de empresa (cliente habilitado en las dos) y comprobar que catálogo,
    categorías, carrito y precios no se mezclan.

**Verificación:** conteos UI vs SQL por empresa (arnés de filtros), Playwright del portal con cliente de una empresa y de las
dos, suite multiempresa (casos nuevos: categoría de Quirutec invisible en GUDS, vendedor de otra empresa fuera de la lista).

---

## Fase 2 — Estado de cuenta a profundidad

**Pedido:** que el cliente y el equipo vean, por factura, cuánto era, cuánto se ha abonado y qué falta, sin cruzar a mano
facturas contra pagos. Los datos ya existen: `facturas` (subtotal = base imponible, impuesto = IVA, total, saldo) y
`factura_aplicaciones` (pagos, notas de crédito, retenciones, reintegros, otros), sincronizados desde Odoo.

2.1 **Vista por defecto.** Abrir en *Documentos con saldo* (lo que el cliente debe) y, en movimientos, el período desde la
    factura abierta más antigua (hoy abre en "90 días" y dice "Sin movimientos" a un cliente que debe).
2.2 **Tabla de facturas con cruce** (admin, enlace público, PDF, portal del cliente y cartera del vendedor):

    | Nº | Emisión | Vence | Días | Base imponible | IVA | Total | Pagos | NC | Retenciones | Otros | Saldo | Qué falta | Comentario |

    - Monedas: USD como principal; Bs con la tasa del documento cuando la factura sea en Bs.
    - Cada abono se puede desplegar: fecha, tipo, referencia, banco y monto (de `factura_aplicaciones` + `pagos`).
    - Filtro: abiertas / todas / pagadas en el período.
2.3 **"Qué falta" automático.** Con la base, el IVA y lo abonado, GUDS sugiere la explicación del saldo:
    - saldo ≈ IVA → "Pendiente el IVA";
    - saldo ≈ IGTF de los pagos en divisas → "Pendiente el IGTF";
    - saldo ≈ retención de IVA o ISLR esperada y sin comprobante → "Retención por recibir";
    - saldo < 1 USD → "Diferencia menor" (redondeo o cambiario);
    - si no encaja: vacío.
    Tolerancia configurable (centavos). Es una sugerencia: se distingue visualmente del comentario escrito por una persona.
2.4 **Comentarios por factura** (solo en GUDS): tabla `factura_comentarios` (factura, texto, visible para el cliente sí/no,
    autor, fecha). Se editan desde Cuentas y Facturas; los visibles salen en el enlace público, el PDF y el correo; los
    internos solo en admin. Historial, no se sobrescriben.
2.5 **Resumen arriba** (ya aprobado): por cobrar, vencido, por vencer, a favor, saldo neto, notas de débito. Agregar la
    antigüedad del vencido en la misma franja del PDF y del correo.
2.6 **Clientes sin correo.** 137 de 277 clientes con deuda no tienen correo propio ni de contactos.
    - Indicador y filtro "sin correo" en Cuentas.
    - Desde el diálogo de envío: agregar correo al cliente o crear un contacto con correo en el momento.
    - **[escribe en Odoo]** el correo del cliente, por la misma cola de escrituras que dirección/teléfono (decisión a
      confirmar).
2.7 **Envío masivo (opcional, al final de la fase):** seleccionar varios clientes en Cuentas (por ejemplo, todos los vencidos
    de un vendedor) y enviar el estado de cuenta a cada uno, con registro de envíos y rebotes.

**Cuando llegue el reporte de estado de cuenta del equipo:** ajustar columnas, nombres, orden y formato del PDF a ese
modelo; no cambia la estructura de datos.

**Verificación:** cuadre por cliente — suma de saldos por factura = saldo del cliente en Odoo; base + IVA = total; la suma de
abonos por factura = total − saldo. Muestra de 20 clientes (con IVA pendiente, con IGTF, con retenciones, con NC). Playwright
del enlace público y del PDF (render a imagen).

---

## Fase 3 — Métricas internas de cobranza

Solo para el equipo (no salen en el estado de cuenta del cliente).

3.1 **Días de venta adeudados por cliente (DSO).** Deuda vigente ÷ venta promedio diaria (90 días, configurable a 30/180).
    Lectura: "este cliente debe N días de compras" o "tarda N días en pagar".
3.2 **Días de mora ponderados** (por monto) y **tendencia** (mejora o empeora contra el mes anterior).
3.3 Dónde se ven: columna y orden en Cuentas; tarjeta en el detalle de la cuenta; Reportes → Cobranza por vendedor y por
    cliente; cartera del vendedor.
3.4 **Notas de crédito sin aplicar.** Hay vendedores con cartera negativa porque tienen solo NC sin cruzar. Mostrar aparte
    "a favor por aplicar" y un listado de NC sin aplicar con antigüedad (para que finanzas las cruce en Odoo); la cartera
    del vendedor muestra deuda y a favor por separado.
3.5 Alertas en la torre de control: cliente que pasa de cierto DSO o que supera su límite.

**Cuando lleguen las métricas en Excel:** igualar fórmulas y nombres; validar cliente por cliente contra el Excel.

---

## Fase 4 — Planificación de pagos (Cuentas por Pagar)

**Pedido:** saber qué hay que pagar a una fecha (día de caja: miércoles) sin armar Excel, y ejecutar los pagos desde ese plan.

4.1 **Pestaña "Planificación"** en Cuentas por Pagar.
    - Fecha de corte (por defecto, el próximo día de caja; configurable en Configuración → días de pago).
    - Grupos: vencido, vence hasta la fecha de corte, próximos 7 / 14 / 30 días; por proveedor con sus facturas.
    - Columnas: proveedor, factura, emisión, vence, días, saldo USD, moneda, retenciones pendientes, condición.
4.2 **Plan de pago.** Seleccionar facturas (o montos parciales) → guardar como plan de la semana (`planes_pago`,
    `planes_pago_items`): estados *borrador → aprobado → pagado*. Total del plan contra el saldo disponible en bancos
    (módulo Bancos) por moneda.
4.3 **Cierre automático.** Cuando el pago se registre en Odoo y entre por la sincronización, el ítem del plan se marca pagado
    (cruce por `factura_proveedor_aplicaciones`). Diferencias (pagado distinto a lo planificado) se señalan.
4.4 **Salida:** PDF/Excel del plan para aprobación y envío a tesorería; historial de planes.
4.5 **Revisar vencimientos.** Hoy 232 de 234 facturas de proveedor con saldo figuran vencidas y "por vencer" es 0: confirmar
    con finanzas si es real o si Odoo no trae la fecha de vencimiento/condición de pago del proveedor (corregir el import si
    es lo segundo).

**Cuando llegue el Excel de flujo de caja semanal:** igualar grupos y columnas; agregar lo que falte (por ejemplo, prioridad
por proveedor).

---

## Fase 5 — Listas de precios

**Problema:** en Odoo los productos están a 1 USD y el precio se escribe a mano al cotizar; las listas no tienen reglas
(0 reglas, 0 precios por producto). GUDS recuperó precios de cotizaciones pasadas como provisional.

5.1 **Listas por empresa y moneda** con precio por producto (`precios_lista`) y reglas (descuento por categoría, cantidad
    mínima, vigencia) — la tabla `reglas_precio` ya existe.
5.2 **Importador** de Excel/CSV (y PDF tabular cuando se pueda extraer): subir archivo → mapear columnas (SKU o nombre,
    precio, moneda, empaque) → emparejar con productos (SKU exacto, luego nombre) → vista previa con cambios
    (nuevo/sube/baja/sin cambio/no encontrado) → confirmar. Guarda historial de cada carga.
5.3 **Edición** en pantalla (precio por producto, masivo por %), con historial de cambios.
5.4 **[escribe en Odoo]** cada lista como `product.pricelist` y sus precios como `product.pricelist.item` (crear/actualizar,
    nunca borrar; un precio retirado se archiva o se le pone fin de vigencia). Por la cola `odoo_escrituras`, con el mismo
    modo de prueba → activo que se usó en fotos.
5.5 **Asignación a clientes** (masiva por segmento/vendedor) **[escribe en Odoo]** `property_product_pricelist`.
5.6 **Portal y vendedor** usan el precio de la lista del cliente; el pedido que va a Odoo lleva la lista para que la
    cotización salga con precio (fin del 1 USD).

**Depende de:** las listas reales del equipo para la primera carga; el importador se construye antes.
**Verificación:** carga de una lista de prueba en Quirutec (empresa con menos movimiento), cotización borrador en Odoo con
precio correcto (una sola, como en 9b), portal mostrando el precio de la lista.

---

## Fase 6 — Calidad de datos y cuadre

Ya existe Reportes → *Calidad y cuadre* (solo lectura). Convertirlo en una **bandeja de trabajo**:

6.1 **Tareas por tipo** con responsable y estado (pendiente / corregido en Odoo / explicado): estado de otro país (6 clientes
    con un estado de Ecuador), estados con punto duplicado ("Sucre." vs "Sucre"), sin ciudad (62), sin estado (6), sin
    condición de pago (136), sin RIF (11), facturas anuladas con saldo (51), cobros sin aplicar (91), productos sin costo o
    sin categoría.
6.2 **Corrección asistida [escribe en Odoo]** para lo simple y seguro: estado/ciudad del cliente (ya existe la escritura de
    dirección) con un clic desde la tarea. Lo contable (anuladas con saldo, cobros sin aplicar) solo se señala con enlace a
    Odoo.
6.3 **Normalización de presentación** mientras se corrige: mostrar "Sucre" y "Bolívar" sin punto ni "(VE)" en listas y
    filtros (el filtro ya agrupa mayúsculas; agregar puntuación y sufijo de país).
6.4 **Cuadre Profit ↔ Odoo** (documentos con diferencias y diferenciales cambiarios): revisión uno a uno con comentario y
    marca "explicado"; resumen de cuánto queda por explicar; exportable.
6.5 Al cerrar el cuadre, la sección se puede ocultar (como se dijo en la reunión).

---

## Fase 7 — Reportes: ajustes y metas

7.1 **Carga visible:** esqueletos y barra de progreso al cambiar período/fuente (Odoo, Profit, ambos), no solo el giro.
7.2 **Qué análisis quedan:** interruptor por análisis (configuración de la empresa) para que dirección deje solo lo que
    usa; los ocultos no se calculan.
7.3 **Metas de vendedores:** carga mensual por vendedor y empresa (tabla `metas_vendedor`), avance en reportes y en el
    portal del vendedor.
7.4 Rendimiento: medir los análisis más pesados y moverlos a vistas materializadas o RPC si pasan de 2 s.

---

## Fase 8 — Transportista externo (operador logístico)

**Pedido:** las reposiciones a consignación (y otras entregas) las hace un operador externo.

8.1 Modelo *transportista*: interno (repartidor con usuario) o externo (empresa). Asignar entregas y reposiciones a un
    transportista desde Delivery.
8.2 Para el externo, sin usuario: **enlace por hoja de ruta** (como el enlace público del estado de cuenta) donde marca
    entregado con foto y firma, o reporta incidencia; lo que marca alimenta la misma escritura de entregas a Odoo.
8.3 Si el operador ofrece API o archivo, integrar después (notificación de despacho y estado).
8.4 **Depende de:** datos del operador (contacto, qué recibe, cómo confirma).

---

## Fase 9 — Facturación digital

9.1 Revisar la documentación del proveedor y el grupo de integración.
9.2 Definir dónde se integra: la factura nace en Odoo, así que lo natural es Odoo → proveedor; GUDS solo refleja el número
    de control y el estado. Si el proveedor no se integra con Odoo, GUDS envía la factura sincronizada y escribe de vuelta
    el número de control **[escribe en Odoo]**.
9.3 Ambiente de pruebas en paralelo a la aprobación del SENIAT (≈30 días).

---

## Fase 10 — Cobros y conciliación operativa

10.1 Sesión con finanzas cuando hayan usado la plataforma: qué ejecutar en GUDS y qué sigue en Odoo (decisión vigente:
     los cobros se registran en Odoo).
10.2 Conciliación bancaria (ya hay importación CSV/Excel + IA): definir el flujo final, quién aprueba, cómo se marca en
     Odoo.
10.3 Depósitos por identificar: bandeja para asignarlos a cliente con sugerencia por monto/referencia.

---

## Fase 11 — Planificación de compras (segundo nivel)

Con días de inventario por SKU (venta promedio) y el modelo de pronóstico del equipo: sugerido de compra por producto y
proveedor, cobertura objetivo, órdenes de compra borrador **[escribe en Odoo]**. Se diseña cuando llegue el modelo.

---

## Decisiones a confirmar

1. Compras de personal (empleados como clientes): ¿se ven en reportes de venta como canal *Personal*? (propuesta: sí).
2. Comentarios por factura: ¿los visibles al cliente requieren aprobación de finanzas? (propuesta: no; quedan con autor).
3. ¿GUDS escribe en Odoo el correo del cliente y las correcciones de estado/ciudad? (propuesta: sí, por la cola).
4. Listas de precios: ¿GUDS pasa a ser donde se mantienen y Odoo solo las recibe? (propuesta: sí, como se dijo en la
   reunión).
5. Día de caja de proveedores: miércoles por empresa o común (propuesta: configurable por empresa).
6. Rol del usuario de finanzas: *Administrador* o *Contador*.

## Insumos pendientes del equipo

- Reporte de estado de cuenta (afina fase 2), métricas de cobranza (fase 3), flujo de caja semanal y formato de cuentas por
  pagar / facturas de proveedor (fase 4).
- Listas de precios vigentes (fase 5).
- Correos reales de vendedores y confirmación de cuáles están activos (fase 0/1).
- Datos del operador logístico (fase 8) y documentación de facturación digital (fase 9).
- Qué análisis de reportes se quedan (fase 7).
