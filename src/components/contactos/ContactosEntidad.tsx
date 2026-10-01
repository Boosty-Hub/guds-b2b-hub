import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OdooBadge } from "@/components/OdooBadge";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { ContactoHoja } from "./ContactoHoja";
import { ContactoFormDialog } from "./ContactoFormDialog";
import { EstadoAccesoBadge } from "./EstadoAccesoBadge";
import { SELECT_CONTACTO, cargarAccesos, estadoAcceso, type AccesoPortal, type Contacto } from "./tipos";

/**
 * Contactos de un cliente o de un proveedor (pestaña Contactos de su ficha): lista compacta, alta y la hoja de cada contacto
 * con su acceso al portal. `extraColumna` agrega una columna por contacto (p. ej. el estado de su envío a Odoo).
 */
export function ContactosEntidad({ tipo, entidadId, entidadNombre, onCambio, extraColumna }: {
  tipo: "cliente" | "proveedor";
  entidadId: string;
  entidadNombre: string;
  onCambio?: (n: number) => void;
  extraColumna?: { titulo: string; celda: (k: Contacto) => ReactNode };
}) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const { soloLectura } = useEmpresa();
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [accesos, setAccesos] = useState<Map<string, AccesoPortal>>(new Map());
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const puedeCrear = !soloLectura && (tipo === "cliente"
    ? can("clientes", "editar") || can("contactos", "editar")
    : user?.role === "admin" && (can("compras", "editar") || can("contactos", "editar")));

  const cargar = useCallback(async () => {
    setCargando(true);
    const [{ data }, acc] = await Promise.all([
      supabase.from("cliente_contactos").select(SELECT_CONTACTO).eq(tipo === "cliente" ? "cliente_id" : "proveedor_id", entidadId)
        .order("es_principal", { ascending: false }).order("nombre"),
      cargarAccesos(),
    ]);
    const lista = (data as unknown as Contacto[] | null) ?? [];
    setContactos(lista);
    setAccesos(acc);
    setCargando(false);
    return lista.length;
  }, [tipo, entidadId]);
  useEffect(() => { cargar(); }, [cargar]);
  const recargar = async () => { const n = await cargar(); onCambio?.(n); };

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <p className="text-xs text-muted-foreground">
          {tipo === "cliente" ? "Personas del cliente. Con correo, cada una puede tener su usuario del portal." : "Personas del proveedor (no entran al portal de clientes)."}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button asChild size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs">
            <Link to={`/admin/contactos?${tipo}=${entidadId}`}><ExternalLink className="h-3.5 w-3.5" /> Ver en Contactos</Link>
          </Button>
          {puedeCrear && <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setNuevo(true)}><Plus className="h-3.5 w-3.5" /> Nuevo contacto</Button>}
        </div>
      </div>
      {cargando ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : contactos.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Sin contactos.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contacto</TableHead><TableHead>Cargo</TableHead><TableHead>Correo</TableHead><TableHead>Teléfono</TableHead>
              {tipo === "cliente" && <TableHead>Portal</TableHead>}
              {extraColumna && <TableHead>{extraColumna.titulo}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {contactos.map((k) => (
              <TableRow key={k.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setAbierto(k.id)}>
                <TableCell className="whitespace-nowrap font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="max-w-[220px] truncate" title={k.nombre}>{k.nombre}</span>
                    {k.origen === "odoo" && <OdooBadge />}
                    {k.es_principal && <Badge variant="secondary" className="text-[10px]">Principal</Badge>}
                    {!k.activo && <Badge variant="outline" className="text-[10px]">Inactivo</Badge>}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground"><span className="block max-w-[160px] truncate">{k.cargo || "—"}</span></TableCell>
                <TableCell className="text-muted-foreground"><span className="block max-w-[220px] truncate">{k.email || "—"}</span></TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{k.celular || k.telefono || "—"}</TableCell>
                {tipo === "cliente" && <TableCell><EstadoAccesoBadge estado={estadoAcceso(accesos.get(k.id), k)} /></TableCell>}
                {extraColumna && <TableCell className="whitespace-nowrap text-xs">{extraColumna.celda(k)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ContactoHoja contactoId={abierto} onClose={() => setAbierto(null)} onCambio={recargar} />
      <ContactoFormDialog open={nuevo} onOpenChange={setNuevo} contacto={null} vinculoInicial={{ tipo, id: entidadId, nombre: entidadNombre }}
        onGuardado={(id) => { recargar(); setAbierto(id); }} />
    </div>
  );
}
