## 1) TOP 8-10 más dañinos (tipo A primero)

1. **src/pages/Precios.tsx:336** (A) — upsert de precios muestra "Precios guardados" aunque falle. Fix: `const { error } = await supabase.from('precios_lista').upsert(...); if (error) throw error;` (ídem delete línea 329).
2. **src/pages/Precios.tsx:251** (A) — update de asignación cliente→lista da "Clientes actualizados" sin comprobar. Fix: desestructurar `{ error }` de ambos update (244 y 251) y `throw error`.
3. **src/pages/Precios.tsx:216** (A) — update que limpia `lista_precios_id` no comprobado; clientes quedan apuntando a lista borrada. Fix: `const { error } = ...update({lista_precios_id:null})...; if (error) throw error;` antes del delete.
4. **src/pages/configuracion/ConfigUsuarios.tsx:356** (A) — delete+insert de permisos al editar rol; puede dejar el rol SIN permisos con toast de éxito. Fix: comprobar error de delete e insert (ideal RPC atómica); si falla, no mostrar "Rol Actualizado" y recargar.
5. **src/pages/configuracion/ConfigUsuarios.tsx:288** (A, seguridad) — toggle activo de usuario da éxito sin persistir; usuario "desactivado" sigue con acceso. Fix: `const { error } = ...update({activo:!...}).eq('id',...); if (error){toast;return;}`.
6. **src/pages/configuracion/ConfigUsuarios.tsx:330** (A) — rol creado sin permisos con toast "Rol Creado". Fix: comprobar `permError` del insert de permisos antes de dar éxito.
7. **src/pages/Productos.tsx:323** (A) — delete/insert de empaques al editar producto no comprobado; producto inutilizable pero "Producto Actualizado". Fix: comprobar error de delete e insert antes del toast.
8. **src/pages/Productos.tsx:269** (A) — insert de empaques al crear producto no comprobado. Fix: `const { error: empErr } = ...insert(...); if (empErr){toast destructivo}`.
9. **src/pages/configuracion/ConfigSeguridad.tsx:71** (A) — políticas de seguridad con falso éxito. Fix: comprobar error, revertir el `setConfig` optimista y toast destructivo si falla.
10. **src/contexts/StoreConfigContext.tsx:198/203** (A) — updateBanner/deleteBanner no comprueban error; Banners.tsx muestra éxito siempre. Fix: `const { error } = ...; if (error) return false;` y condicionar el toast al booleano.

Casos B que rozan lo crítico (vale la pena tratarlos como urgentes):
- **src/contexts/CurrencyContext.tsx:24** — tasa=0 → toda la tienda muestra "Bs. 0,00" y división por cero. Silencioso y global.
- **src/contexts/PermissionsContext.tsx:27** — rpc `mis_permisos` falla → admin sin permisos, bloqueado sin aviso.
- **src/pages/Precios.tsx:138 y 285** — prellenado vacío por error puede sobrescribir/borrar asignaciones y precios reales al guardar.

## 2) Conteo por archivo

| Archivo | A | B | Total |
|---|---|---|---|
| src/pages/configuracion/ConfigUsuarios.tsx | 4 | 2 | 6 |
| src/pages/Precios.tsx | 3 | 3 | 6 |
| src/contexts/StoreConfigContext.tsx | 5 | 2 | 7 |
| src/pages/Productos.tsx | 2 | 1 | 3 |
| src/pages/portal/PortalDashboard.tsx | 0 | 3 | 3 |
| src/pages/portal/PortalCuentaMobile.tsx | 0 | 3 | 3 |
| src/pages/configuracion/ConfigMoneda.tsx | 1 | 1 | 2 |
| src/pages/configuracion/ConfigSeguridad.tsx | 1 | 1 | 2 |
| src/pages/configuracion/ConfigNotificaciones.tsx | 1 | 1 | 2 |
| src/pages/configuracion/ConfigMetodosPago.tsx | 1 | 1 | 2 |
| src/pages/configuracion/ConfigEmpaques.tsx | 1 | 1 | 2 |
| src/contexts/AuthContext.tsx | 1 | 1 | 2 |
| src/components/portal/NotificationsDropdown.tsx | 2 | 0 | 2 |
| src/pages/configuracion/ConfigIconos.tsx | 0 | 1 | 1 |
| src/pages/Inventario.tsx | 0 | 1 | 1 |
| src/pages/Clientes.tsx | 0 | 1 | 1 |
| src/pages/ClienteUsuarios.tsx | 0 | 1 | 1 |
| src/pages/portal/cuenta/PortalDirecciones.tsx | 0 | 1 | 1 |
| src/pages/portal/PortalFavoritos.tsx | 0 | 1 | 1 |
| src/pages/portal/cuenta/PortalPerfil.tsx | 0 | 1 | 1 |
| src/contexts/CurrencyContext.tsx | 0 | 1 | 1 |
| src/contexts/PermissionsContext.tsx | 0 | 1 | 1 |
| src/components/dashboard/RecentOrders.tsx | 0 | 1 | 1 |
| src/components/dashboard/TopClients.tsx | 0 | 1 | 1 |
| **Total** | **22** | **31** | **53** |

## 3) Qué arreglar YA vs qué puede esperar

**Arreglar ya (esta iteración):**
- Todos los tipo A de **Precios.tsx** (336, 251, 216) y de **Productos.tsx** (323, 269): tocan el núcleo transaccional (precios, asignaciones, empaques) con falso-éxito y datos inconsistentes.
- Los tipo A de **ConfigUsuarios.tsx** (356, 330, 288, 230): corrupción de permisos y falso bloqueo de usuarios = riesgo de seguridad.
- **ConfigSeguridad.tsx:71** (política de seguridad falso-éxito).
- **StoreConfigContext.tsx** A (165/198/203/208/228) + **AuthContext.tsx:330**: patrón fire-and-forget que hay que convertir a `Promise<boolean>` y condicionar los toasts en las páginas. Un solo cambio de patrón cierra 6 casos.
- Tres B "críticos disfrazados": **CurrencyContext.tsx:24** (precios en 0 / división por cero global), **PermissionsContext.tsx:27** (admin bloqueado), y **Precios.tsx:138/285** (prellenado vacío que puede borrar datos reales al guardar).

**Pueden esperar (segunda tanda):**
- El resto de tipo A de configuración (ConfigNotificaciones:51, ConfigMoneda:106, ConfigMetodosPago:211, ConfigEmpaques:143): mismos toggles/upsert, menor alcance; varios se auto-corrigen con un `fetch` posterior.
- **NotificationsDropdown.tsx** (58/72): falso-éxito optimista de baja severidad, se revierte al recargar.
- La mayoría de B de listados admin (Inventario, Clientes, ClienteUsuarios, Productos:136, Precios:97, ConfigIconos, ConfigEmpaques:59, ConfigMetodosPago:177) y todo el bloque **portal** (Dashboard, CuentaMobile, Favoritos, Direcciones, Perfil): son "vacío indistinguible de error", molestos pero sin pérdida de datos. Se resuelven en bloque con un patrón común de estado de error + reintento diferenciado del empty state.

**Recomendación de método:** para los contexts, refactorizar las mutaciones a devolver `boolean`/error y que la página decida el toast (cierra ~8 casos A de golpe); para los B, introducir un helper/estado `error` reutilizable que distinga "sin datos" de "falló la carga".

---DETALLE---
[
 {
  "archivo": "src/pages/configuracion/ConfigNotificaciones.tsx",
  "linea": 51,
  "tipo": "A",
  "operacion": "upsert en bucle sobre tabla 'configuracion' (handleSave: guarda las 8 preferencias de notificacion)",
  "que_ve_el_usuario": "Siempre sale el toast 'Configuracion guardada / Las preferencias de notificacion han sido actualizadas', aunque todos los upsert fallen (RLS, red, etc.). El usuario cree que guardo sus preferencias y al recargar vuelven a los valores anteriores.",
  "arreglo": "Capturar el error de cada upsert: let ok = true; for (...) { const { error } = await supabase.from('configuracion').upsert(...); if (error) { ok = false; break; } }. Si !ok mostrar toast destructivo con error.message y NO mostrar el toast de exito. Idealmente enviar todos los valores en un solo upsert (array) para atomicidad.",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigSeguridad.tsx",
  "linea": 71,
  "tipo": "A",
  "operacion": "upsert sobre 'configuracion' (saveSecurityConfig: politicas 'Expiracion de sesion' y 'Bloqueo por intentos fallidos')",
  "que_ve_el_usuario": "Al mover el switch siempre sale 'Guardado / Configuracion actualizada' aunque el upsert falle. El admin cree que activo/desactivo una politica de seguridad que en realidad no cambio en la BD (falso exito en configuracion sensible).",
  "arreglo": "const { error } = await supabase.from('configuracion').upsert(...); if (error) { revertir el setConfig optimista que se hizo en onCheckedChange y mostrar toast destructivo; return; } Mostrar 'Guardado' solo cuando error sea null.",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigMoneda.tsx",
  "linea": 106,
  "tipo": "A",
  "operacion": "update sobre 'configuracion' clave='moneda_principal' (handleSaveMonedaPrincipal)",
  "que_ve_el_usuario": "El boton se marca como activo y sale toast 'Guardado: Moneda principal: X' aunque el update falle. La moneda en la que se almacenan los precios del sistema no cambio realmente pese al exito mostrado.",
  "arreglo": "const { error } = await supabase.from('configuracion').update(...).eq('clave','moneda_principal'); if (error) { revertir setMonedaPrincipal al valor previo y mostrar toast destructivo; return; } Mostrar 'Guardado' solo si error es null.",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigMetodosPago.tsx",
  "linea": 211,
  "tipo": "A",
  "operacion": "update activo sobre 'metodos_pago' (handleToggleActivo)",
  "que_ve_el_usuario": "El switch cambia (update optimista en el estado) y sale toast 'Metodo Habilitado/Deshabilitado' aunque el update a BD falle. Un metodo de pago puede quedar visible/oculto para clientes de forma distinta a lo que muestra la UI.",
  "arreglo": "const { error } = await supabase.from('metodos_pago').update({activo:newActivo}).eq('id',id); if (error) { revertir setMetodos al estado anterior y mostrar toast destructivo; return; } antes de mostrar el toast de exito.",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigEmpaques.tsx",
  "linea": 143,
  "tipo": "A",
  "operacion": "update activo sobre 'tipos_empaque' (handleToggleActivo)",
  "que_ve_el_usuario": "Sale toast 'Empaque Activado/Desactivado' aunque el update falle. El fetchEmpaques posterior acabara revirtiendo el switch, pero el usuario ya vio un falso mensaje de exito.",
  "arreglo": "const { error } = await supabase.from('tipos_empaque').update({activo:!empaque.activo}).eq('id',empaque.id); if (error) { toast destructivo; return; } Solo entonces mostrar el toast de exito y llamar a fetchEmpaques().",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigUsuarios.tsx",
  "linea": 288,
  "tipo": "A",
  "operacion": "update activo sobre 'usuarios' (handleToggleUserStatus)",
  "que_ve_el_usuario": "Sale toast 'Usuario Activado/Desactivado' aunque el update falle. Se puede creer que se desactivo (bloqueo el acceso de) un usuario cuando en realidad sigue activo: riesgo de seguridad por falso exito.",
  "arreglo": "const { error } = await supabase.from('usuarios').update({activo:!usuario.activo}).eq('id',usuario.id); if (error) { toast destructivo; return; } antes del toast de exito y del fetchData().",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigUsuarios.tsx",
  "linea": 356,
  "tipo": "A",
  "operacion": "delete + insert sobre 'permisos' al editar rol (handleEditRol)",
  "que_ve_el_usuario": "Se muestra 'Rol Actualizado' aunque el delete y/o el insert de permisos fallen. Peor caso: el delete borra todos los permisos y el insert falla -> el rol queda SIN ningun permiso, pero el admin cree que se guardaron los checkboxes que marco (corrupcion silenciosa de permisos).",
  "arreglo": "Capturar { error } tanto del delete como del insert (idealmente una RPC transaccional que reemplace permisos de forma atomica). Si cualquiera falla, NO mostrar 'Rol Actualizado': mostrar toast destructivo y recargar (fetchPermisosForRol) para reflejar el estado real.",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigUsuarios.tsx",
  "linea": 330,
  "tipo": "A",
  "operacion": "insert masivo sobre 'permisos' al crear rol (handleCreateRol)",
  "que_ve_el_usuario": "Se muestra 'Rol Creado' aunque el insert de permisos falle. El rol queda creado pero sin ningun permiso, y el admin cree que quedo configurado con los permisos que marco en la tabla.",
  "arreglo": "const { error: permError } = await supabase.from('permisos').insert(permisosInsert); if (permError) { mostrar toast destructivo avisando que el rol se creo pero no se guardaron sus permisos; } y no dar por exitoso hasta comprobarlo.",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigUsuarios.tsx",
  "linea": 230,
  "tipo": "A",
  "operacion": "update rol_id sobre 'usuarios' tras crear usuario via RPC (handleCreateUser)",
  "que_ve_el_usuario": "El RPC 'crear_usuario_admin' si valida su error, pero el update posterior que enlaza el rol granular seleccionado NO se comprueba. Sale 'Usuario Creado exitosamente' aunque el rol no se haya asignado; el usuario aparece sin el rol elegido.",
  "arreglo": "const { error: rolError } = await supabase.from('usuarios').update({rol_id:userForm.rol_id}).eq('id',row.usuario_id); if (rolError) avisar que el usuario se creo pero no se pudo asignar el rol. Mejor aun: pasar el rol_id al propio RPC para que sea atomico.",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigUsuarios.tsx",
  "linea": 132,
  "tipo": "B",
  "operacion": "select de usuarios/roles/modulos en paralelo (fetchData, Promise.all)",
  "que_ve_el_usuario": "Si falla la carga, usuariosRes.error solo se manda a console.error y rolesRes/modulosRes ignoran el error por completo. La tabla de usuarios, la lista de roles y el filtro de roles quedan vacios, sin distinguir 'no hay datos' de 'fallo la carga'.",
  "arreglo": "Añadir estado de error y, cuando usuariosRes.error / rolesRes.error / modulosRes.error existan, mostrar en la UI un mensaje de error con reintento en lugar de solo console.log; asi el usuario distingue lista vacia real de fallo de red/permisos.",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigUsuarios.tsx",
  "linea": 167,
  "tipo": "B",
  "operacion": "select sobre 'permisos' (fetchPermisosForRol, al abrir el dialogo de editar rol)",
  "que_ve_el_usuario": "Si el select falla, no se inicializa rolPermisos y el dialogo de editar rol muestra TODOS los permisos desmarcados como si el rol no tuviera ninguno. Si el admin pulsa guardar, sobreescribe los permisos reales con un estado vacio.",
  "arreglo": "const { data, error } = ...; if (error) { no abrir el dialogo (o mostrar error y deshabilitar el boton Guardar) para no pisar los permisos existentes con un estado vacio erroneo }.",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigMetodosPago.tsx",
  "linea": 177,
  "tipo": "B",
  "operacion": "select sobre 'metodos_pago' (fetchMetodos)",
  "que_ve_el_usuario": "Si el select falla, data es null, la lista de metodos y los stats quedan en 0 y se ve la pantalla vacia como si no hubiera metodos de pago configurados.",
  "arreglo": "const { data, error } = await supabase.from('metodos_pago').select('*').order('orden'); if (error) { setear estado de error y mostrar aviso/reintento en vez de interpretar el vacio como 'sin metodos' }.",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigEmpaques.tsx",
  "linea": 59,
  "tipo": "B",
  "operacion": "select sobre 'tipos_empaque' (fetchEmpaques)",
  "que_ve_el_usuario": "Si falla, data es null y se muestra el empty state 'No hay tipos de empaque', indistinguible de un fallo de carga real.",
  "arreglo": "const { data, error } = ...; if (error) mostrar un estado de error con reintento diferenciado del empty state; solo mostrar 'No hay tipos de empaque' cuando la carga fue exitosa y data esta vacio.",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigIconos.tsx",
  "linea": 74,
  "tipo": "B",
  "operacion": "select sobre 'iconos' (fetchIconos)",
  "que_ve_el_usuario": "Si falla, data es null, la cuadricula y los stats quedan vacios con 'No hay iconos para productos/categorias', sin distinguir de un error de carga.",
  "arreglo": "const { data, error } = ...; if (error) mostrar estado de error/reintento en la UI en lugar del empty state; reservar el 'No hay iconos' para el caso de carga exitosa sin resultados.",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigMoneda.tsx",
  "linea": 49,
  "tipo": "B",
  "operacion": "select sobre 'configuracion' (fetchConfig: tasa_cambio, moneda_principal, moneda_secundaria)",
  "que_ve_el_usuario": "Si el select falla, data es null y la pantalla muestra la tasa por defecto hardcodeada (36.50) y USD/BS como si fueran los valores reales guardados. El usuario podria operar y hacer conversiones con una tasa de cambio equivocada sin saber que la config no cargo.",
  "arreglo": "const { data, error } = ...; if (error) mostrar aviso claro de que no se pudo cargar la configuracion (y no presentar los valores por defecto como si fueran los guardados); considerar bloquear la actualizacion de tasa hasta recargar.",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigNotificaciones.tsx",
  "linea": 29,
  "tipo": "B",
  "operacion": "select sobre 'configuracion' like 'notif_%' (fetchConfig)",
  "que_ve_el_usuario": "Si falla, data es null y los switches muestran los valores por defecto del useState como si fueran la configuracion guardada; el usuario no distingue su configuracion real de un fallo de carga.",
  "arreglo": "const { data, error } = ...; if (error) señalar el fallo de carga en la UI en vez de dejar pasar los defaults como estado real de las notificaciones.",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/configuracion/ConfigSeguridad.tsx",
  "linea": 31,
  "tipo": "B",
  "operacion": "select sobre 'configuracion' (fetchConfig: politicas de seguridad)",
  "que_ve_el_usuario": "Si falla, los switches de seguridad muestran los defaults del useState (ambos activados) como si fueran los guardados; no se distingue de un fallo de carga, dando falsa sensacion de politicas activas.",
  "arreglo": "const { data, error } = ...; if (error) mostrar el fallo de carga en la UI en lugar de presentar los defaults como estado real de las politicas de seguridad.",
  "grupo": "configuracion"
 },
 {
  "archivo": "src/pages/Precios.tsx",
  "linea": 336,
  "tipo": "A",
  "operacion": "handleSavePrecios: dentro del bucle for, delete (linea 329) y upsert (linea 336) sobre 'precios_lista' para guardar los precios manuales por producto.",
  "que_ve_el_usuario": "Ninguna de las dos escrituras captura su { error } (Supabase no lanza, devuelve el error en la respuesta). Aunque falle el upsert/delete, se muestra el toast 'Precios guardados: se actualizaron N precio(s)' y se cierra el sheet. El precio NO queda guardado, pero el admin cree que si; el cliente sigue comprando al precio anterior. Es el nucleo de precios: falso-exito grave.",
  "arreglo": "Capturar el error de cada operacion dentro del for y lanzarlo para que el catch existente (linea 353) lo muestre: `const { error } = await supabase.from('precios_lista').upsert(...); if (error) throw error;` (idem para el delete de la linea 329). Idealmente acumular los fallos por producto y reportarlos.",
  "grupo": "admin-crud"
 },
 {
  "archivo": "src/pages/Precios.tsx",
  "linea": 251,
  "tipo": "A",
  "operacion": "handleSaveClientes: update de 'clientes' para limpiar lista_precios_id (linea 244) y update para asignar la lista a los clientes seleccionados (linea 251).",
  "que_ve_el_usuario": "Ninguno de los dos update comprueba { error }. Aunque fallen, se muestra 'Clientes actualizados: N cliente(s) asignado(s)' y se cierra el sheet. La asignacion de clientes a la lista de precios no se aplica pero parece exitosa, por lo que esos clientes seguiran facturando con la lista/descuento equivocado.",
  "arreglo": "Desestructurar y comprobar el error de ambos update y lanzarlo para el catch: `const { error } = await supabase.from('clientes').update({...}).in('id', selectedClienteIds); if (error) throw error;` (igual para el update de limpieza en linea 244).",
  "grupo": "admin-crud"
 },
 {
  "archivo": "src/pages/Productos.tsx",
  "linea": 323,
  "tipo": "A",
  "operacion": "handleEdit: tras actualizar el producto (update ya comprobado en 293), se hace delete de 'producto_empaques' (linea 317) e insert de los nuevos empaques (linea 323) sin comprobar error.",
  "que_ve_el_usuario": "Se muestra 'Producto Actualizado' aunque el delete o el insert de empaques falle. El producto puede quedar sin empaques o con empaques a medias (inutilizable para pedidos), pero el admin cree que se guardo todo correctamente.",
  "arreglo": "Comprobar el error de ambas llamadas antes del toast de exito: `const { error: delErr } = await supabase.from('producto_empaques').delete()...; if (delErr) { toast(error); return; }` y lo mismo para el insert de la linea 323.",
  "grupo": "admin-crud"
 },
 {
  "archivo": "src/pages/Productos.tsx",
  "linea": 269,
  "tipo": "A",
  "operacion": "handleCreate: insert en 'producto_empaques' con las relaciones de empaque, tras crear el producto (insert principal si comprobado en 258).",
  "que_ve_el_usuario": "El insert de empaques no captura error. Se muestra 'Producto Creado ... exitosamente' y se cierra el formulario aunque las relaciones de empaque no se hayan guardado. El producto queda creado pero sin empaques validos (no se puede pedir), pareciendo correcto.",
  "arreglo": "Capturar el error: `const { error: empErr } = await supabase.from('producto_empaques').insert(empaquesInsert); if (empErr) { toast({ title:'Error', description: empErr.message, variant:'destructive' }); }` antes del toast de exito, o reportar el fallo como ya se hace en handleImport (lineas 873-882).",
  "grupo": "admin-crud"
 },
 {
  "archivo": "src/pages/Precios.tsx",
  "linea": 216,
  "tipo": "A",
  "operacion": "handleDelete: update de 'clientes' poniendo lista_precios_id = null antes de borrar la lista (el delete de listas_precios en 221 si comprueba error).",
  "que_ve_el_usuario": "El update de desvinculacion no comprueba error. Si falla pero el delete de la lista se ejecuta (sin FK que lo impida), se muestra 'Lista eliminada' y los clientes quedan apuntando a una lista de precios inexistente. Fallo silencioso con toast de exito.",
  "arreglo": "Capturar el error del update y lanzarlo antes del delete: `const { error } = await supabase.from('clientes').update({ lista_precios_id: null }).eq('lista_precios_id', selectedLista.id); if (error) throw error;`",
  "grupo": "admin-crud"
 },
 {
  "archivo": "src/pages/Productos.tsx",
  "linea": 136,
  "tipo": "B",
  "operacion": "fetchData: select principal de 'productos' (con joins a categorias, tipos_empaque y producto_empaques) dentro de Promise.all; el error se ignora (solo se usa `if (productosRes.data)` en linea 141). Tambien ignoran error los select de categorias (137) y tipos_empaque (138).",
  "que_ve_el_usuario": "Si el select falla, productosRes.data es null, la tabla queda vacia y loading pasa a false. El usuario ve la tabla de productos vacia sin distinguir si no hay productos o si hubo un error de carga (RLS/red).",
  "arreglo": "Desestructurar el error de cada respuesta y manejarlo: `const { data, error } = ...; if (error) { toast/estado de error; }`. Mostrar un estado 'Error al cargar' diferenciado del estado 'sin datos'.",
  "grupo": "admin-crud"
 },
 {
  "archivo": "src/pages/Precios.tsx",
  "linea": 97,
  "tipo": "B",
  "operacion": "fetchData: select de 'listas_precios' (con count de clientes) dentro de Promise.all; error ignorado (solo `if (listasRes.data)`). Igual para productos (98) y clientes (99).",
  "que_ve_el_usuario": "Si el select falla, el grid de listas queda vacio y se muestra el empty state 'No hay listas de precios' con boton 'Crear Primera Lista', aunque en realidad haya sido un fallo de carga.",
  "arreglo": "Comprobar el error de la respuesta y mostrar un estado de error distinto del empty state; no asumir 'sin datos' cuando data es null por error.",
  "grupo": "admin-crud"
 },
 {
  "archivo": "src/pages/Inventario.tsx",
  "linea": 75,
  "tipo": "B",
  "operacion": "fetchData: select de 'productos' dentro de Promise.all; error ignorado (solo `if (productosRes.data)` en linea 79). Igual para movimientos_inventario (76).",
  "que_ve_el_usuario": "Si el select falla, la tabla de stock queda vacia sin indicar error; el usuario no distingue entre 'no hay productos' y 'fallo la carga'. Las tarjetas de stats muestran 0.",
  "arreglo": "Desestructurar el error de cada respuesta y mostrar un mensaje/estado de error de carga en lugar de una tabla vacia silenciosa.",
  "grupo": "admin-crud"
 },
 {
  "archivo": "src/pages/Clientes.tsx",
  "linea": 99,
  "tipo": "B",
  "operacion": "fetchData: select de 'clientes' (con join a listas_precios) dentro de Promise.all; error ignorado (solo `if (clientesRes.data)` en linea 103). Igual para listas_precios (100).",
  "que_ve_el_usuario": "Si el select falla, se muestra el empty state 'No hay clientes registrados / Los clientes apareceran aqui cuando se aprueben registros', ocultando por completo que hubo un error de carga.",
  "arreglo": "Comprobar el error del select y mostrar un estado de error diferenciado del empty state real.",
  "grupo": "admin-crud"
 },
 {
  "archivo": "src/pages/ClienteUsuarios.tsx",
  "linea": 103,
  "tipo": "B",
  "operacion": "fetchData: select de 'usuarios' filtrado por cliente_id/role; error ignorado (solo `if (usuariosData)` en linea 110). Tambien el select de 'clientes' (linea 92) ignora su error.",
  "que_ve_el_usuario": "Si el select de usuarios falla, se muestra el empty state 'No hay usuarios registrados para este cliente', haciendo pasar un fallo de carga por 'sin usuarios'. Si falla el select de cliente (92), el titulo muestra 'Cliente' generico.",
  "arreglo": "Comprobar el error de ambos select y mostrar un estado de error en vez del empty state; distinguir carga fallida de lista vacia.",
  "grupo": "admin-crud"
 },
 {
  "archivo": "src/pages/Precios.tsx",
  "linea": 138,
  "tipo": "B",
  "operacion": "openClientesSheet: select de 'clientes' (id) filtrado por lista_precios_id para prellenar los checkboxes de clientes ya asignados; error ignorado (solo `data?.map(...)` en linea 143).",
  "que_ve_el_usuario": "Si el select falla, selectedClienteIds queda vacio y el sheet muestra 0 clientes seleccionados aunque haya clientes asignados. Peor aun: si el admin pulsa 'Guardar Asignacion', handleSaveClientes limpia todas las asignaciones existentes (perdida de datos) con toast de exito.",
  "arreglo": "Comprobar `{ data, error }`; si hay error, avisar con toast y no abrir el sheet (o bloquear el guardado) para no sobrescribir asignaciones reales con un estado vacio erroneo.",
  "grupo": "admin-crud"
 },
 {
  "archivo": "src/pages/Precios.tsx",
  "linea": 285,
  "tipo": "B",
  "operacion": "openPreciosSheet: select de 'precios_lista' filtrado por lista_precios_id para prellenar los precios manuales por producto; error ignorado (solo `preciosData?.forEach(...)`).",
  "que_ve_el_usuario": "Si el select falla, preciosMap queda vacio y todos los productos aparecen como 'sin precio manual', ocultando los precios personalizados ya configurados. El admin cree que no hay precios manuales cuando si los hay.",
  "arreglo": "Comprobar `{ data, error }`; si hay error, avisar y no mostrar el sheet con datos incompletos para evitar edicciones sobre un estado falso.",
  "grupo": "admin-crud"
 },
 {
  "archivo": "C:\\Users\\gabri\\OneDrive\\Escritorio\\APPS Github\\GUDS\\src\\pages\\portal\\cuenta\\PortalDirecciones.tsx",
  "linea": 46,
  "tipo": "B",
  "operacion": "SELECT clientes (.from('clientes').select('*').eq('id', cliente_id).single()) en fetchCliente",
  "que_ve_el_usuario": "Si falla, se ignora el error: cliente queda null y loading pasa a false. La direccion de entrega es el contenido principal de esta pantalla, y la tarjeta con la direccion registrada simplemente no se renderiza. El usuario solo ve el mensaje informativo generico y el placeholder 'Proximamente podras agregar direcciones', como si no tuviera direccion, sin poder distinguir 'sin direccion' de 'fallo la carga'.",
  "arreglo": "Desestructurar tambien error: const { data, error } = await supabase.from('clientes')... Si error, hacer console.error, mostrar toast destructivo ('No se pudo cargar tu direccion') y setear un estado de error (setError(true)) para renderizar un bloque 'Error al cargar. Reintentar' distinto del contenido normal. No dejar que el fallo se confunda con el estado sin-datos.",
  "grupo": "portal-cuenta"
 },
 {
  "archivo": "C:\\Users\\gabri\\OneDrive\\Escritorio\\APPS Github\\GUDS\\src\\pages\\portal\\PortalFavoritos.tsx",
  "linea": 56,
  "tipo": "B",
  "operacion": "SELECT favoritos con join producto:productos(*) (.from('favoritos').select(...).eq('usuario_id').order()) en fetchFavoritos",
  "que_ve_el_usuario": "Si falla, se ignora el error: favoritos queda [] y loading pasa a false. La lista de favoritos es el contenido principal de la pantalla, asi que se muestra el estado vacio 'Sin favoritos / Guarda tus productos favoritos...' con el boton 'Explorar catalogo', identico a cuando realmente no hay favoritos. El usuario puede creer que perdio sus favoritos guardados.",
  "arreglo": "const { data, error } = await supabase.from('favoritos')... Si error: console.error, toast destructivo y setError(true); renderizar un estado de error con boton 'Reintentar' (que vuelva a llamar fetchFavoritos) claramente diferenciado del estado 'Sin favoritos'.",
  "grupo": "portal-cuenta"
 },
 {
  "archivo": "C:\\Users\\gabri\\OneDrive\\Escritorio\\APPS Github\\GUDS\\src\\pages\\portal\\PortalDashboard.tsx",
  "linea": 77,
  "tipo": "B",
  "operacion": "SELECT ordenes (.from('ordenes').select('*').eq('cliente_id').order().limit(5)) en fetchData",
  "que_ve_el_usuario": "Si falla, se ignora el error: ordenes queda []. Desaparece el banner de 'Pedido en camino' y en 'Actividad Reciente' se muestra 'No hay pedidos recientes' con enlace a hacer un pedido, indistinguible de un cliente que realmente no tiene pedidos. Un cliente con pedidos activos cree que no tiene ninguno.",
  "arreglo": "const { data: ordenesData, error: ordenesError } = await supabase.from('ordenes')... Si ordenesError: console.error y setear una bandera de error para mostrar en la seccion 'Actividad Reciente' un mensaje 'No se pudieron cargar tus pedidos. Reintentar' en vez del estado vacio.",
  "grupo": "portal-cuenta"
 },
 {
  "archivo": "C:\\Users\\gabri\\OneDrive\\Escritorio\\APPS Github\\GUDS\\src\\pages\\portal\\PortalDashboard.tsx",
  "linea": 66,
  "tipo": "B",
  "operacion": "SELECT productos destacados (.from('productos').select('*, categoria:categorias(*)').eq('activo').eq('destacado').limit(4)) en fetchData",
  "que_ve_el_usuario": "Si falla, se ignora el error: productos queda [] y, tras loading, se muestra 'No hay productos destacados'. Es indistinguible de que no existan destacados; el usuario ve una tienda que parece vacia aunque el fallo sea de red/permisos.",
  "arreglo": "const { data: productosData, error: productosError } = await supabase.from('productos')... Si productosError: console.error y setear bandera de error para mostrar 'No se pudieron cargar los productos. Reintentar' en lugar del texto de vacio.",
  "grupo": "portal-cuenta"
 },
 {
  "archivo": "C:\\Users\\gabri\\OneDrive\\Escritorio\\APPS Github\\GUDS\\src\\pages\\portal\\PortalDashboard.tsx",
  "linea": 57,
  "tipo": "B",
  "operacion": "SELECT clientes (.from('clientes').select('*').eq('id', cliente_id).single()) en fetchData",
  "que_ve_el_usuario": "Si falla, se ignora el error: cliente queda null. La tarjeta 'Mi Linea de Credito' (que depende de cliente.limite_credito) no se renderiza en absoluto, asi que el usuario deja de ver su credito disponible/utilizado sin ningun aviso, como si no tuviera linea de credito.",
  "arreglo": "const { data: clienteData, error: clienteError } = await supabase.from('clientes')... Si clienteError: console.error y setear bandera de error; mostrar en el area de credito un aviso 'No se pudo cargar tu linea de credito. Reintentar' en vez de ocultarla silenciosamente.",
  "grupo": "portal-cuenta"
 },
 {
  "archivo": "C:\\Users\\gabri\\OneDrive\\Escritorio\\APPS Github\\GUDS\\src\\pages\\portal\\PortalCuentaMobile.tsx",
  "linea": 81,
  "tipo": "B",
  "operacion": "SELECT clientes (.from('clientes').select('*').eq('id', cliente_id).single()) en fetchData",
  "que_ve_el_usuario": "Si falla, se ignora el error: cliente queda null. Desaparecen el badge de tipo_negocio en la cabecera de perfil y toda la tarjeta 'Linea de Credito' (credito disponible/utilizado), sin aviso. El usuario cree que no tiene credito o que sus datos de negocio no existen.",
  "arreglo": "const { data: clienteData, error: clienteError } = await supabase.from('clientes')... Si clienteError: console.error, toast destructivo y setear bandera de error para mostrar un aviso de fallo de carga en lugar de ocultar el credito.",
  "grupo": "portal-cuenta"
 },
 {
  "archivo": "C:\\Users\\gabri\\OneDrive\\Escritorio\\APPS Github\\GUDS\\src\\pages\\portal\\PortalCuentaMobile.tsx",
  "linea": 90,
  "tipo": "B",
  "operacion": "SELECT count de ordenes (.from('ordenes').select('*',{count:'exact',head:true}).eq('cliente_id')) en fetchData",
  "que_ve_el_usuario": "Si falla, se ignora el error y por 'pedidosCount || 0' el contador de 'Pedidos' de las estadisticas del perfil muestra 0. Es un cero falso: el usuario con pedidos ve 0 sin distinguir 'sin pedidos' de 'fallo el conteo'.",
  "arreglo": "const { count: pedidosCount, error: pedidosError } = await supabase.from('ordenes')... Si pedidosError: console.error y mostrar un placeholder ('-' o skeleton) en la estadistica en vez de 0, o setear bandera de error. No mostrar 0 cuando la consulta fallo.",
  "grupo": "portal-cuenta"
 },
 {
  "archivo": "C:\\Users\\gabri\\OneDrive\\Escritorio\\APPS Github\\GUDS\\src\\pages\\portal\\PortalCuentaMobile.tsx",
  "linea": 95,
  "tipo": "B",
  "operacion": "SELECT count de favoritos (.from('favoritos').select('*',{count:'exact',head:true}).eq('usuario_id')) en fetchData",
  "que_ve_el_usuario": "Si falla, se ignora el error y por 'favoritosCount || 0' el contador de 'Favoritos' muestra 0. Cero falso indistinguible de no tener favoritos cuando en realidad fallo el conteo.",
  "arreglo": "const { count: favoritosCount, error: favoritosError } = await supabase.from('favoritos')... Si favoritosError: console.error y mostrar placeholder en la estadistica (no 0) o setear bandera de error.",
  "grupo": "portal-cuenta"
 },
 {
  "archivo": "C:\\Users\\gabri\\OneDrive\\Escritorio\\APPS Github\\GUDS\\src\\pages\\portal\\cuenta\\PortalPerfil.tsx",
  "linea": 194,
  "tipo": "B",
  "operacion": "SELECT clientes (.from('clientes').select('*').eq('id', cliente_id).single()) en fetchCliente",
  "que_ve_el_usuario": "Si falla, se ignora el error: cliente queda null y el panel de solo-lectura 'Datos del Negocio' (nombre_negocio, RIF, tipo, ciudad) no se renderiza. El usuario ve su formulario personal pero cree que no tiene datos de negocio asociados, sin aviso del fallo.",
  "arreglo": "const { data, error } = await supabase.from('clientes')... Si error: console.error y toast destructivo; opcionalmente setear estado de error para mostrar 'No se pudieron cargar los datos del negocio' en lugar de omitir el panel. En cualquier caso loading debe pasar a false igual.",
  "grupo": "portal-cuenta"
 },
 {
  "archivo": "src/contexts/StoreConfigContext.tsx",
  "linea": 165,
  "tipo": "A",
  "operacion": "insert en tabla 'banners' (addBanner). Se desestructura { data, error } pero solo se comprueba `if (data)`; el error se ignora y la funcion es void (fire-and-forget).",
  "que_ve_el_usuario": "En src/pages/Banners.tsx (handleCreate, linea 116) se muestra el toast 'Banner Creado - El banner ha sido creado exitosamente' de forma incondicional aunque el insert haya fallado. El admin cree que creo el banner; al recargar no aparece.",
  "arreglo": "Comprobar el error y propagarlo: `if (error) { console.error(error); return false; } await fetchData(); return true;` cambiando la firma a Promise<boolean>. En Banners.tsx hacer `if (await addBanner(...)) toast(exito); else toast({variant:'destructive', title:'No se pudo crear el banner'})`.",
  "grupo": "contexts-componentes"
 },
 {
  "archivo": "src/contexts/StoreConfigContext.tsx",
  "linea": 198,
  "tipo": "A",
  "operacion": "update en tabla 'banners' (updateBanner). `await supabase.from('banners').update(...).eq('id', id)` sin desestructurar ni comprobar error, y luego fetchData().",
  "que_ve_el_usuario": "Banners.tsx handleEdit (linea 136) y handleToggleActivo (linea 173) muestran 'Banner Actualizado ... exitosamente' / 'Banner Activado/Desactivado' siempre. Si el update falla (ej. RLS), el cambio no persiste pero el admin cree que si.",
  "arreglo": "Devolver el error: `const { error } = await supabase...; if (error) { console.error(error); return false; } await fetchData(); return true;`. En la pagina, solo mostrar el toast de exito cuando la promesa resuelva true; en caso contrario toast destructivo.",
  "grupo": "contexts-componentes"
 },
 {
  "archivo": "src/contexts/StoreConfigContext.tsx",
  "linea": 203,
  "tipo": "A",
  "operacion": "delete en tabla 'banners' (deleteBanner). `await supabase.from('banners').delete().eq('id', id)` sin comprobar error, luego fetchData().",
  "que_ve_el_usuario": "Banners.tsx handleDelete (linea 149) muestra 'Banner Eliminado' incondicionalmente. Si el delete falla el banner sigue existiendo pero el admin cree que lo borro.",
  "arreglo": "`const { error } = await supabase.from('banners').delete().eq('id', id); if (error) { console.error(error); return false; } await fetchData(); return true;` y condicionar el toast de exito al resultado en la pagina.",
  "grupo": "contexts-componentes"
 },
 {
  "archivo": "src/contexts/StoreConfigContext.tsx",
  "linea": 208,
  "tipo": "A",
  "operacion": "insert en tabla 'categorias' (addCategoria). `await supabase.from('categorias').insert(...)` sin desestructurar ni comprobar error, luego fetchData().",
  "que_ve_el_usuario": "src/pages/Categorias.tsx (handleCreate) muestra el toast de exito de creacion aunque el insert falle; la categoria no se guarda pero el admin cree que si.",
  "arreglo": "`const { error } = await supabase.from('categorias').insert(...); if (error) { console.error(error); return false; } await fetchData(); return true;` y condicionar el toast de exito en la pagina.",
  "grupo": "contexts-componentes"
 },
 {
  "archivo": "src/contexts/StoreConfigContext.tsx",
  "linea": 228,
  "tipo": "A",
  "operacion": "update en tabla 'categorias' (updateCategoria). `await supabase.from('categorias').update(dbUpdates).eq('id', id)` sin comprobar error, luego fetchData().",
  "que_ve_el_usuario": "Categorias.tsx (handleEdit linea 126 y toggle de activo linea 165) muestra el toast de exito siempre. Si el update falla (incluido el toggle activo/inactivo), el cambio no persiste pero el admin lo ve como guardado.",
  "arreglo": "Desestructurar y comprobar error, devolver boolean: `const { error } = await supabase...; if (error) { console.error(error); return false; } await fetchData(); return true;` y mostrar el toast segun el resultado en la pagina.",
  "grupo": "contexts-componentes"
 },
 {
  "archivo": "src/contexts/AuthContext.tsx",
  "linea": 330,
  "tipo": "A",
  "operacion": "update en 'registros_clientes' (rechazarRegistro): set estado='rechazado', notas. Se hace `await supabase.from('registros_clientes').update(...).eq('id', id)` sin comprobar error; la funcion es Promise<void>.",
  "que_ve_el_usuario": "src/pages/RegistrosClientes.tsx handleReject (linea 121) muestra 'Registro Rechazado - {negocio} ha sido rechazado' siempre. Si el update falla el registro sigue pendiente pero el admin cree que lo rechazo.",
  "arreglo": "Cambiar a Promise<boolean>: `const { error } = await supabase.from('registros_clientes').update({estado:'rechazado', notas}).eq('id', id); if (error) { console.error(error); return false; } await fetchRegistros(); return true;`. En handleReject solo toast de exito si resuelve true, si no toast destructivo.",
  "grupo": "contexts-componentes"
 },
 {
  "archivo": "src/components/portal/NotificationsDropdown.tsx",
  "linea": 72,
  "tipo": "A",
  "operacion": "update en 'notificaciones' (markAllAsRead): set leida=true para todas las del usuario. Error ignorado y luego se actualiza el estado local de forma optimista.",
  "que_ve_el_usuario": "El contador de no leidas pasa a 0 y todas se marcan como leidas en la UI aunque el update falle; al recargar reaparecen como no leidas. Severidad menor pero es un falso-exito optimista.",
  "arreglo": "`const { error } = await supabase.from('notificaciones').update({leida:true}).eq('usuario_id', user.id).eq('leida', false); if (error) { console.error(error); return; }` y solo entonces actualizar el estado local (o revertir si hay error).",
  "grupo": "contexts-componentes"
 },
 {
  "archivo": "src/components/portal/NotificationsDropdown.tsx",
  "linea": 58,
  "tipo": "A",
  "operacion": "update en 'notificaciones' (markAsRead): set leida=true para una notificacion. Error ignorado y estado local actualizado optimistamente.",
  "que_ve_el_usuario": "La notificacion se ve como leida (fondo/punto cambian y baja el contador) aunque el update falle; al recargar vuelve a aparecer como no leida. Falso-exito optimista de baja severidad.",
  "arreglo": "`const { error } = await supabase.from('notificaciones').update({leida:true}).eq('id', notificationId); if (error) { console.error(error); return; }` antes de actualizar el estado local, o revertir el cambio optimista si el error llega.",
  "grupo": "contexts-componentes"
 },
 {
  "archivo": "src/contexts/AuthContext.tsx",
  "linea": 144,
  "tipo": "B",
  "operacion": "select en 'registros_clientes' (fetchRegistros): `const { data } = await supabase...order(...)`. Error ignorado, solo `if (data)`.",
  "que_ve_el_usuario": "Si el select falla, `registros` queda vacio y la pantalla admin de Registros de Clientes muestra 0 pendientes, indistinguible de 'no hay registros'. El admin puede no atender solicitudes de clientes reales.",
  "arreglo": "Desestructurar error y exponerlo: `const { data, error } = await supabase...; if (error) { console.error(error); /* set estado de error */ return; }`. Mantener un estado de error en el contexto y que la pagina distinga 'sin registros' de 'fallo al cargar' con opcion de reintentar.",
  "grupo": "contexts-componentes"
 },
 {
  "archivo": "src/contexts/CurrencyContext.tsx",
  "linea": 24,
  "tipo": "B",
  "operacion": "select en 'configuracion' (cargarTasa): lee valor de clave='tasa_cambio' con maybeSingle(). `const { data } = ...`, error ignorado.",
  "que_ve_el_usuario": "Si el select falla, exchangeRate se queda en 0. Todos los precios en Bs. se muestran como 'Bs. 0,00' (convertToBS) y convertToUSD divide por cero (Infinity), en toda la tienda, sin ningun aviso. Falla critica silenciosa de precios.",
  "arreglo": "`const { data, error } = await supabase.from('configuracion').select('valor').eq('clave','tasa_cambio').maybeSingle(); if (error) { console.error(error); /* marcar tasa no disponible */ }`. Exponer un flag de 'tasa no cargada' y evitar mostrar precios en Bs (o mostrar aviso/reintento) mientras exchangeRate<=0 en vez de renderizar 0.",
  "grupo": "contexts-componentes"
 },
 {
  "archivo": "src/contexts/PermissionsContext.tsx",
  "linea": 27,
  "tipo": "B",
  "operacion": "rpc('mis_permisos') de lectura (load). `const { data } = await supabase.rpc('mis_permisos')`, error ignorado; si data es null cae al else y deja permisos={} y esAdminTotal=false, marcando loadedFor=uid (ready=true).",
  "que_ve_el_usuario": "Si la rpc falla, el usuario queda con cero permisos: can() devuelve false para todo y el Sidebar oculta todos los modulos (salvo Dashboard). Parece que el usuario 'no tiene permisos' cuando en realidad la carga fallo; un admin puede quedar bloqueado sin ningun mensaje.",
  "arreglo": "`const { data, error } = await supabase.rpc('mis_permisos'); if (error) { console.error(error); /* no marcar como cargado */ return; }`. Ante error no fijar loadedFor (mantener loading/ready en falso o exponer un estado de error) para no confundir 'sin permisos' con 'fallo de carga', y reintentar.",
  "grupo": "contexts-componentes"
 },
 {
  "archivo": "src/components/dashboard/RecentOrders.tsx",
  "linea": 38,
  "tipo": "B",
  "operacion": "select en 'ordenes' con join a clientes (fetchOrders): `const { data } = await supabase...limit(5)`. Error ignorado, solo `if (data)`.",
  "que_ve_el_usuario": "Si el select falla, `orders` queda vacio y el widget del dashboard muestra 'No hay ordenes recientes', indistinguible de que realmente no haya ordenes. El admin puede creer que no hay ventas.",
  "arreglo": "`const { data, error } = await supabase...; if (error) { console.error(error); setError(true); }` con un estado de error, y renderizar un mensaje de error/reintento distinto del estado vacio en lugar de solo 'No hay ordenes recientes'.",
  "grupo": "contexts-componentes"
 },
 {
  "archivo": "src/components/dashboard/TopClients.tsx",
  "linea": 26,
  "tipo": "B",
  "operacion": "select en 'clientes' (fetchTopClients): `const { data: clientesData } = await supabase.from('clientes').select(...).eq('activo',true).limit(10)`. Error ignorado, solo `if (clientesData)`. (Los select internos de 'ordenes' en linea 36 tambien ignoran error.)",
  "que_ve_el_usuario": "Si el select de clientes falla, `clients` queda vacio y el widget muestra 'No hay clientes registrados', indistinguible de que no existan clientes. El admin puede creer que no tiene clientes.",
  "arreglo": "`const { data: clientesData, error } = await supabase...; if (error) { console.error(error); setError(true); return; }` con estado de error y un mensaje/reintento distinto del vacio. Aplicar lo mismo al select de 'ordenes' de la linea 36 para no acumular ceros silenciosos.",
  "grupo": "contexts-componentes"
 },
 {
  "archivo": "src/contexts/StoreConfigContext.tsx",
  "linea": 123,
  "tipo": "B",
  "operacion": "select en 'banners' (fetchData): `const { data: bannersData } = await supabase.from('banners').select('*').order('orden')`. Error ignorado, solo `if (bannersData)`.",
  "que_ve_el_usuario": "Si el select falla, `banners` queda vacio: el carrusel de banners del portal del cliente (getActiveBanners) y la pantalla admin de Banners aparecen vacios, indistinguible de 'no hay banners configurados'.",
  "arreglo": "`const { data: bannersData, error } = await supabase.from('banners').select('*').order('orden'); if (error) console.error(error);` y exponer un estado de error de carga en el contexto para que las pantallas distingan 'sin banners' de 'fallo al cargar' (con reintento).",
  "grupo": "contexts-componentes"
 },
 {
  "archivo": "src/contexts/StoreConfigContext.tsx",
  "linea": 144,
  "tipo": "B",
  "operacion": "select en 'categorias' con conteo de productos (fetchData): `const { data: categoriasData } = await supabase.from('categorias').select('*, productos:productos(count)').order('orden')`. Error ignorado, solo `if (categoriasData)`.",
  "que_ve_el_usuario": "Si el select falla, `categorias` queda vacio: el portal del cliente (getActiveCategories) no muestra categorias para navegar el catalogo y la pantalla admin de Categorias aparece vacia, indistinguible de 'no hay categorias'.",
  "arreglo": "`const { data: categoriasData, error } = await supabase.from('categorias').select('*, productos:productos(count)').order('orden'); if (error) console.error(error);` y exponer un estado de error de carga para distinguir 'sin categorias' de 'fallo al cargar' con opcion de reintento.",
  "grupo": "contexts-componentes"
 }
]