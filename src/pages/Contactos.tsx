import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Building2, Loader2, Plus, Truck, UserRound, X } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { usePagination } from "@/hooks/use-pagination";
import { OdooBadge } from "@/components/OdooBadge";
import { EmpresaDistintivo } from "@/components/EmpresaSelector";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { useColumnas } from "@/components/datos/columnas";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesPrueba, pasaPrueba, coincide, contadorFiltrado, normalizarTexto, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { ContactoHoja } from "@/components/contactos/ContactoHoja";
import { ContactoFormDialog } from "@/components/contactos/ContactoFormDialog";
import { EstadoAccesoBadge } from "@/components/contactos/EstadoAccesoBadge";
import {
  ETIQUETA_ACCESO, SELECT_CONTACTO, cargarAccesos, enlaceVinculo, estadoAcceso, nombreVinculo, tipoVinculo, type AccesoPortal, type Contacto,
} from "@/components/contactos/tipos";

// Módulo Contactos (20v): todas las personas de clientes, de proveedores y sueltas, con su acceso al portal de clientes.
// ?contacto=<id> abre su ficha (lo usa el buscador global); ?cliente=<id> / ?proveedor=<id> muestra solo los de esa ficha.

const Contactos = () => {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const { can } = usePermissions();
  const { empresas, soloLectura } = useEmpresa();
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [accesos, setAccesos] = useState<Map<string, AccesoPortal>>(new Map());
  const [cargando, setCargando] = useState(true);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [nuevo, setNuevo] = useState(false);
  const abierto = params.get("contacto");
  const soloCliente = params.get("cliente");
  const soloProveedor = params.get("proveedor");
  const personalAdmin = user?.role === "admin";
  const puedeCrear = !soloLectura && (can("contactos", "editar") || can("clientes", "editar") || (personalAdmin && can("compras", "editar")));

  const cargar = useCallback(async () => {
    const [{ data }, acc] = await Promise.all([
      supabase.from("cliente_contactos").select(SELECT_CONTACTO).order("nombre"),
      cargarAccesos(),
    ]);
    setContactos((data as unknown as Contacto[] | null) ?? []);
    setAccesos(acc);
    setCargando(false);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const setParam = (clave: string, valor: string | null) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (valor) n.set(clave, valor); else n.delete(clave);
    return n;
  }, { replace: true });

  // ---- Filtros (en la URL) ----
  const acceso = (k: Contacto) => estadoAcceso(accesos.get(k.id), k);
  const pruebasVinculo: OpcionPrueba<Contacto>[] = [
    { valor: "cliente", etiqueta: "De un cliente", prueba: (k) => !!k.cliente_id },
    { valor: "proveedor", etiqueta: "De un proveedor", prueba: (k) => !!k.proveedor_id },
    { valor: "suelto", etiqueta: "Sueltos", prueba: (k) => !k.cliente_id && !k.proveedor_id },
  ];
  const pruebasPortal: OpcionPrueba<Contacto>[] = [
    { valor: "con", etiqueta: "Con acceso activo", prueba: (k) => ["activo", "temporal"].includes(acceso(k)) },
    { valor: "temporal", etiqueta: ETIQUETA_ACCESO.temporal, prueba: (k) => acceso(k) === "temporal" },
    { valor: "desactivado", etiqueta: "Acceso desactivado", prueba: (k) => acceso(k) === "desactivado" },
    { valor: "sin", etiqueta: "Sin acceso", prueba: (k) => acceso(k) === "sin" },
  ];
  const pruebasActivo: OpcionPrueba<Contacto>[] = [
    { valor: "si", etiqueta: "Activos", prueba: (k) => k.activo }, { valor: "no", etiqueta: "Inactivos", prueba: (k) => !k.activo },
  ];
  const pruebasOrigen: OpcionPrueba<Contacto>[] = [
    { valor: "odoo", etiqueta: "Odoo", prueba: (k) => k.origen === "odoo" }, { valor: "guds", etiqueta: "Creados en GUDS", prueba: (k) => k.origen === "guds" },
  ];
  const filtroEmpresa = useFiltroEmpresa(contactos);
  const f = useFiltros([
    { clave: "vinculo", etiqueta: "Pertenece a", todos: "Clientes, proveedores y sueltos", principal: true, opciones: opcionesPrueba(contactos, pruebasVinculo) },
    { clave: "portal", etiqueta: "Portal", todos: "Con y sin acceso", principal: true, opciones: opcionesPrueba(contactos, pruebasPortal) },
    { clave: "activo", etiqueta: "Situación", todos: "Activos e inactivos", opciones: opcionesPrueba(contactos, pruebasActivo) },
    { clave: "origen", etiqueta: "Origen", todos: "Odoo y GUDS", opciones: opcionesPrueba(contactos, pruebasOrigen) },
    filtroEmpresa,
  ]);
  const pasa = (k: Contacto) => pasaPrueba(pruebasVinculo, f.v("vinculo"), k) && pasaPrueba(pruebasPortal, f.v("portal"), k)
    && pasaPrueba(pruebasActivo, f.v("activo"), k) && pasaPrueba(pruebasOrigen, f.v("origen"), k)
    && (!filtroEmpresa || coincide(k.empresa_id, f.v("empresa")))
    && (!soloCliente || k.cliente_id === soloCliente) && (!soloProveedor || k.proveedor_id === soloProveedor);
  const base = useMemo(() => contactos.filter(pasa),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contactos, accesos, f.firma, soloCliente, soloProveedor]);
  const filtrados = useMemo(() => {
    const t = normalizarTexto(q);
    const digitos = q.replace(/\D/g, "");
    if (!t) return base;
    return base.filter((k) => [k.nombre, k.cargo, k.email, nombreVinculo(k)].some((v) => normalizarTexto(v).includes(t))
      || (digitos.length >= 4 && [k.telefono, k.celular].some((v) => (v ?? "").replace(/\D/g, "").includes(digitos))));
  }, [base, q]);

  const { ordenadas, orden, alternar } = useOrdenTabla(filtrados, {
    nombre: (k) => k.nombre, cargo: (k) => k.cargo, vinculo: (k) => nombreVinculo(k) ?? "", email: (k) => k.email,
    portal: (k) => acceso(k), estado: (k) => (k.activo ? 1 : 0),
  });
  const pg = usePagination(ordenadas, 50, `${f.firma}|${q}|${soloCliente}|${soloProveedor}`);
  const exportar = () => exportarCSV("contactos", ordenadas, [
    { titulo: "Contacto", valor: (k) => k.nombre }, { titulo: "Cargo", valor: (k) => k.cargo },
    { titulo: "Pertenece a", valor: (k) => ({ cliente: "Cliente", proveedor: "Proveedor", suelto: "Suelto" })[tipoVinculo(k)] },
    { titulo: "Cliente o proveedor", valor: (k) => nombreVinculo(k) }, { titulo: "Correo", valor: (k) => k.email },
    { titulo: "Teléfono", valor: (k) => k.telefono }, { titulo: "Celular", valor: (k) => k.celular },
    { titulo: "Portal", valor: (k) => ETIQUETA_ACCESO[acceso(k)] }, { titulo: "Activo", valor: (k) => (k.activo ? "Sí" : "No") },
    { titulo: "Origen", valor: (k) => (k.origen === "odoo" ? "Odoo" : "GUDS") },
  ]);
  const empresaDe = (id: string | null) => empresas.find((e) => e.id === id) ?? null;
  // Nombre del cliente o proveedor del filtro ?cliente= / ?proveedor= (aunque aún no tenga contactos)
  const [nombreEntidad, setNombreEntidad] = useState<string | null>(null);
  useEffect(() => {
    setNombreEntidad(null);
    if (soloCliente) supabase.from("clientes").select("nombre_negocio").eq("id", soloCliente).maybeSingle().then(({ data }) => setNombreEntidad((data as { nombre_negocio: string } | null)?.nombre_negocio ?? null));
    else if (soloProveedor) supabase.from("proveedores").select("nombre").eq("id", soloProveedor).maybeSingle().then(({ data }) => setNombreEntidad((data as { nombre: string } | null)?.nombre ?? null));
  }, [soloCliente, soloProveedor]);
  const vinculoActivo = f.v("vinculo");

  const cols = useColumnas("contactos", [
    { etiqueta: "Contacto", fija: true }, { etiqueta: "Cargo" }, { etiqueta: "Pertenece a" }, { etiqueta: "Correo" }, { etiqueta: "Teléfono" },
    { etiqueta: "Portal" }, ...(soloLectura ? [{ etiqueta: "Empresa" }] : []), { etiqueta: "Estado" },
  ]);
  const IconoVinculo = ({ k }: { k: Contacto }) => {
    const t = tipoVinculo(k);
    const I = t === "cliente" ? Building2 : t === "proveedor" ? Truck : UserRound;
    return <I className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={t === "cliente" ? "Cliente" : t === "proveedor" ? "Proveedor" : "Suelto"} />;
  };

  return (
    <MainLayout title="Contactos">
      {cols.estilo}
      <KpiStrip items={[
        { label: "Contactos", valor: base.length, tono: "primario", onClick: () => f.set("vinculo", ""), activo: !vinculoActivo },
        { label: "De clientes", valor: base.filter((k) => k.cliente_id).length, onClick: () => f.set("vinculo", "cliente"), activo: vinculoActivo === "cliente" },
        { label: "De proveedores", valor: base.filter((k) => k.proveedor_id).length, onClick: () => f.set("vinculo", "proveedor"), activo: vinculoActivo === "proveedor" },
        { label: "Sueltos", valor: base.filter((k) => !k.cliente_id && !k.proveedor_id).length, onClick: () => f.set("vinculo", "suelto"), activo: vinculoActivo === "suelto" },
        { label: "Con acceso al portal", valor: base.filter((k) => ["activo", "temporal"].includes(acceso(k))).length, tono: "positivo",
          detalle: `${base.filter((k) => acceso(k) === "temporal").length} con clave temporal` },
        { label: "De Odoo", valor: base.filter((k) => k.origen === "odoo").length, tono: "tenue" },
      ]} />

      <BarraLista
        busqueda={q}
        onBusqueda={setQ}
        placeholder="Buscar por nombre, correo, teléfono o empresa…"
        filtros={<FiltrosLista filtros={f} resultados={filtrados.length} />}
        contador={cargando ? undefined : contadorFiltrado(filtrados.length, contactos.length, f.activos || !!q || !!soloCliente || !!soloProveedor, "contactos")}
        acciones={
          <>
            {cols.selector}
            <BotonExportar onClick={exportar} total={ordenadas.length} />
            {puedeCrear && <Button size="sm" className="h-8 gap-1.5" onClick={() => setNuevo(true)} data-testid="nuevo-contacto"><Plus className="h-3.5 w-3.5" /> Nuevo contacto</Button>}
          </>
        }
      />
      {(soloCliente || soloProveedor) && (
        <div className="-mt-1 mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2 pr-1">
            {soloCliente ? "Cliente" : "Proveedor"}: <span className="font-medium">{nombreEntidad ?? "—"}</span>
            <button type="button" className="rounded-full p-0.5 hover:bg-muted" aria-label="Quitar filtro de cliente o proveedor"
              onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.delete("cliente"); n.delete("proveedor"); return n; }, { replace: true })}><X className="h-3 w-3" /></button>
          </span>
          <Link to={soloCliente ? `/admin/clientes/${soloCliente}` : `/admin/proveedores/${soloProveedor}`} className="text-primary hover:underline">Ver ficha</Link>
        </div>
      )}

      {cargando ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table data-tabla="contactos">
            <TableHeader>
              <TableRow>
                <EncabezadoOrdenable clave="nombre" orden={orden} onOrdenar={alternar}>Contacto</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="cargo" orden={orden} onOrdenar={alternar}>Cargo</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="vinculo" orden={orden} onOrdenar={alternar}>Pertenece a</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="email" orden={orden} onOrdenar={alternar}>Correo</EncabezadoOrdenable>
                <TableHead>Teléfono</TableHead>
                <EncabezadoOrdenable clave="portal" orden={orden} onOrdenar={alternar}>Portal</EncabezadoOrdenable>
                {soloLectura && <TableHead>Empresa</TableHead>}
                <EncabezadoOrdenable clave="estado" orden={orden} onOrdenar={alternar}>Estado</EncabezadoOrdenable>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pg.pageItems.length === 0 ? (
                <TableRow><TableCell colSpan={soloLectura ? 8 : 7} className="py-10 text-center text-muted-foreground">
                  {contactos.length ? "Ningún contacto coincide con la búsqueda o los filtros." : "Todavía no hay contactos."}
                </TableCell></TableRow>
              ) : pg.pageItems.map((k) => {
                const enlace = enlaceVinculo(k);
                return (
                  <TableRow key={k.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setParam("contacto", k.id)} data-testid="fila-contacto">
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <span className="max-w-[240px] truncate font-medium" title={k.nombre}>{k.nombre}</span>
                        {k.origen === "odoo" && <OdooBadge sincronizado={k.odoo_sync_at} />}
                        {k.es_principal && <Badge variant="secondary" className="px-1 py-0 text-[10px]">Principal</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground"><span className="block max-w-[150px] truncate" title={k.cargo ?? undefined}>{k.cargo || "—"}</span></TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <IconoVinculo k={k} />
                        {enlace ? (
                          <Link to={enlace} className="max-w-[220px] truncate text-primary hover:underline" onClick={(e) => e.stopPropagation()} title={nombreVinculo(k) ?? undefined}>
                            {nombreVinculo(k) ?? "—"}
                          </Link>
                        ) : <span className="text-muted-foreground">Suelto</span>}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground"><span className="block max-w-[220px] truncate" title={k.email ?? undefined}>{k.email || "—"}</span></TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{k.celular || k.telefono || "—"}</TableCell>
                    <TableCell>{k.cliente_id || acceso(k) !== "sin" ? <EstadoAccesoBadge estado={acceso(k)} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                    {soloLectura && (
                      <TableCell className="whitespace-nowrap">
                        {k.empresa_id
                          ? <span className="flex items-center gap-1.5"><EmpresaDistintivo empresa={empresaDe(k.empresa_id)} className="h-4 w-4 text-[8px]" />{empresaDe(k.empresa_id)?.nombre_corto}</span>
                          : <span className="text-muted-foreground">Compartido</span>}
                      </TableCell>
                    )}
                    <TableCell><Badge variant={k.activo ? "default" : "secondary"}>{k.activo ? "Activo" : "Inactivo"}</Badge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <DataTablePagination pagination={pg} />
        </div>
      )}

      <ContactoHoja contactoId={abierto} onClose={() => setParam("contacto", null)} onCambio={cargar} />
      <ContactoFormDialog open={nuevo} onOpenChange={setNuevo} contacto={null}
        vinculoInicial={soloCliente ? { tipo: "cliente", id: soloCliente, nombre: nombreEntidad }
          : soloProveedor ? { tipo: "proveedor", id: soloProveedor, nombre: nombreEntidad } : null}
        onGuardado={(id) => { cargar(); setParam("contacto", id); }} />
    </MainLayout>
  );
};

export default Contactos;
