import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Mail, Phone, MapPin, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { OdooBadge } from "@/components/OdooBadge";
import { EmpresaDistintivo } from "@/components/EmpresaSelector";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { useColumnas } from "@/components/datos/columnas";

interface Proveedor {
  id: string;
  empresa_id: string | null;
  odoo_id: number | null;
  codigo: string;
  nombre: string;
  rif: string | null;
  email: string | null;
  telefono: string | null;
  celular: string | null;
  direccion: string | null;
  ciudad: string | null;
  estado: string | null;
  es_empresa: boolean | null;
  tipo_residencia: string | null;
  condicion_pago: string | null;
  dias_credito: number | null;
  sitio_web: string | null;
  notas: string | null;
  activo: boolean;
  cliente_id: string | null;
  odoo_sync_at: string | null;
}

function Campo({ label, children, odoo }: { label: string; children?: React.ReactNode; odoo?: boolean }) {
  const vacio = children === null || children === undefined || children === "";
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">{label}{odoo && <OdooBadge />}</p>
      <div className="mt-0.5 break-words font-medium">{vacio ? <span className="font-normal text-muted-foreground">—</span> : children}</div>
    </div>
  );
}

const Proveedores = () => {
  const { empresas, soloLectura } = useEmpresa();
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Proveedor | null>(null);

  useEffect(() => {
    supabase.from("proveedores").select("*").order("nombre").then(({ data }) => {
      setProveedores((data as Proveedor[] | null) ?? []);
      setLoading(false);
    });
  }, []);

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return proveedores;
    return proveedores.filter((p) =>
      [p.nombre, p.rif, p.codigo, p.ciudad, p.email].some((v) => (v || "").toLowerCase().includes(t)));
  }, [proveedores, q]);
  const { ordenadas, orden, alternar } = useOrdenTabla(filtrados, {
    codigo: (p) => p.codigo, nombre: (p) => p.nombre, rif: (p) => p.rif, ciudad: (p) => p.ciudad, condicion: (p) => p.condicion_pago, estado: (p) => (p.activo ? 1 : 0),
  });
  const pg = usePagination(ordenadas, 50);
  const exportar = () => exportarCSV("proveedores", ordenadas, [
    { titulo: "Código", valor: (p) => p.codigo }, { titulo: "Proveedor", valor: (p) => p.nombre }, { titulo: "RIF", valor: (p) => p.rif },
    { titulo: "Ciudad", valor: (p) => p.ciudad }, { titulo: "Teléfono", valor: (p) => p.telefono }, { titulo: "Email", valor: (p) => p.email },
    { titulo: "Condición de pago", valor: (p) => p.condicion_pago }, { titulo: "Activo", valor: (p) => (p.activo ? "Sí" : "No") },
  ]);
  const empresaDe = (id: string | null) => empresas.find((e) => e.id === id) ?? null;

  const cols = useColumnas("proveedores", [{ etiqueta: "Código" }, { etiqueta: "Proveedor", fija: true }, { etiqueta: "RIF" }, { etiqueta: "Ciudad" }, { etiqueta: "Condición de pago" }, ...(soloLectura ? [{ etiqueta: "Empresa" }] : []), { etiqueta: "Estado" }]);
  return (
    <MainLayout title="Proveedores">
      {cols.estilo}
      <KpiStrip items={[
        { label: "Proveedores", valor: proveedores.length, tono: "primario" },
        { label: "Empresas", valor: proveedores.filter((p) => p.es_empresa).length },
        { label: "También son clientes", valor: proveedores.filter((p) => p.cliente_id).length },
      ]} />

      <BarraLista
        busqueda={q}
        onBusqueda={setQ}
        placeholder="Buscar por nombre, RIF, ciudad o correo..."
        filtros={
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <OdooBadge /> Proveedores sincronizados desde Odoo · se editan en Odoo
          </span>
        }
        contador={`${filtrados.length} registros`}
        acciones={<>{cols.selector}<BotonExportar onClick={exportar} total={ordenadas.length} /></>}
      />

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table data-tabla="proveedores">
            <TableHeader>
              <TableRow>
                <EncabezadoOrdenable clave="codigo" orden={orden} onOrdenar={alternar}>Código</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="nombre" orden={orden} onOrdenar={alternar}>Proveedor</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="rif" orden={orden} onOrdenar={alternar}>RIF</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="ciudad" orden={orden} onOrdenar={alternar}>Ciudad</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="condicion" orden={orden} onOrdenar={alternar}>Condición de pago</EncabezadoOrdenable>
                {soloLectura && <TableHead>Empresa</TableHead>}
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pg.pageItems.length === 0 ? (
                <TableRow><TableCell colSpan={soloLectura ? 7 : 6} className="py-10 text-center text-muted-foreground">Sin proveedores</TableCell></TableRow>
              ) : pg.pageItems.map((p) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSel(p)}>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{p.codigo}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="max-w-[260px] truncate font-medium" title={p.nombre}>{p.nombre}</span>
                      {p.odoo_id && <OdooBadge />}
                      {p.cliente_id && <span className="whitespace-nowrap text-xs text-primary">· también cliente</span>}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{p.rif || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="block max-w-[160px] truncate" title={p.ciudad || undefined}>{p.ciudad || "—"}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="block max-w-[180px] truncate" title={p.condicion_pago || undefined}>{p.condicion_pago || "—"}</span>
                  </TableCell>
                  {soloLectura && (
                    <TableCell className="whitespace-nowrap">
                      {p.empresa_id
                        ? <span className="flex items-center gap-1.5"><EmpresaDistintivo empresa={empresaDe(p.empresa_id)} className="h-4 w-4 text-[8px]" />{empresaDe(p.empresa_id)?.nombre_corto}</span>
                        : <span className="text-muted-foreground">Compartido</span>}
                    </TableCell>
                  )}
                  <TableCell><Badge variant={p.activo ? "default" : "secondary"}>{p.activo ? "Activo" : "Archivado"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DataTablePagination pagination={pg} />
        </div>
      )}

      <Sheet open={!!sel} onOpenChange={(o) => { if (!o) setSel(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {sel && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">{sel.nombre}{sel.odoo_id && <OdooBadge sincronizado={sel.odoo_sync_at} />}</SheetTitle>
                <SheetDescription>{sel.codigo} · {sel.es_empresa ? "Empresa" : "Persona natural"}</SheetDescription>
              </SheetHeader>
              <Button asChild size="sm" className="mt-3 w-full gap-1.5">
                <Link to={`/admin/proveedores/${sel.id}`}><Wallet className="h-3.5 w-3.5" /> Ver estado de cuenta y documentos</Link>
              </Button>
              <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
                <Campo label="RIF" odoo={!!sel.odoo_id}>{sel.rif}</Campo>
                <Campo label="Residencia" odoo={!!sel.odoo_id}>{sel.tipo_residencia}</Campo>
                <Campo label="Condición de pago" odoo={!!sel.odoo_id}>{sel.condicion_pago}</Campo>
                <Campo label="Días de crédito" odoo={!!sel.odoo_id}>{sel.dias_credito ?? 0}</Campo>
                <div className="col-span-2 space-y-1.5 rounded-lg border border-border p-2.5">
                  {sel.email && <p className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{sel.email}</p>}
                  {(sel.telefono || sel.celular) && <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{[sel.telefono, sel.celular].filter(Boolean).join(" · ")}</p>}
                  {(sel.direccion || sel.ciudad) && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />{[sel.direccion, sel.ciudad, sel.estado].filter(Boolean).join(", ")}</p>}
                  {!sel.email && !sel.telefono && !sel.celular && !sel.direccion && <p className="text-muted-foreground">Sin datos de contacto</p>}
                </div>
                {sel.sitio_web && <Campo label="Sitio web" odoo={!!sel.odoo_id}>{sel.sitio_web}</Campo>}
                {sel.notas && <div className="col-span-2"><Campo label="Notas" odoo={!!sel.odoo_id}>{sel.notas}</Campo></div>}
                {sel.cliente_id && (
                  <div className="col-span-2 rounded-lg bg-primary/5 p-2.5">
                    También es cliente · <Link to={`/admin/clientes/${sel.cliente_id}`} className="font-medium text-primary underline">ver ficha de cliente</Link>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </MainLayout>
  );
};

export default Proveedores;
