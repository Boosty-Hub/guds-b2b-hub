import { useEffect, useState } from "react";
import { Building2, Info, MapPin } from "lucide-react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { EstadoVacio, SkeletonFilas } from "@/components/portal/sistema";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

// Direcciones del cliente (F6), solo lectura: la dirección fiscal de la ficha y las direcciones de entrega registradas
// (cliente_direcciones, sincronizadas con Odoo) con calle, complemento y ciudad. Los cambios los hace su ejecutivo.

interface DireccionFicha {
  nombre_negocio: string;
  calle: string | null;
  complemento: string | null;
  direccion: string | null;
  ciudad: string | null;
  estado: string | null;
  telefono: string | null;
}
interface DireccionEntrega {
  id: string;
  nombre: string | null;
  calle: string | null;
  complemento: string | null;
  direccion: string | null;
  ciudad: string | null;
  estado: string | null;
  telefono: string | null;
}

const lineas = (d: { calle: string | null; complemento: string | null; direccion: string | null; ciudad: string | null; estado: string | null }) => ({
  calle: d.calle?.trim() || d.direccion?.trim() || null,
  complemento: d.complemento?.trim() || null,
  ciudad: [d.ciudad?.trim(), d.estado?.trim()].filter(Boolean).join(", ") || null,
});

const PortalDirecciones = () => {
  const { user } = useAuth();
  const [cargando, setCargando] = useState(true);
  const [ficha, setFicha] = useState<DireccionFicha | null>(null);
  const [entregas, setEntregas] = useState<DireccionEntrega[]>([]);

  useEffect(() => {
    const cid = user?.cliente_id;
    if (!cid) { setCargando(false); return; }
    let vivo = true;
    Promise.all([
      supabase.from("clientes").select("nombre_negocio, calle, complemento, direccion, ciudad, estado, telefono").eq("id", cid).maybeSingle(),
      supabase.from("cliente_direcciones").select("id, nombre, calle, complemento, direccion, ciudad, estado, telefono")
        .eq("cliente_id", cid).eq("activo", true).order("nombre"),
    ]).then(([c, d]) => {
      if (!vivo) return;
      setFicha((c.data as DireccionFicha | null) ?? null);
      setEntregas((d.data as DireccionEntrega[] | null) ?? []);
      setCargando(false);
    });
    return () => { vivo = false; };
  }, [user?.cliente_id]);

  const principal = ficha ? lineas(ficha) : null;

  return (
    <PortalPagina titulo="Direcciones" volver="/portal/cuenta" etiquetaVolver="Mi cuenta" ancho="estrecho"
      descripcion="Tu dirección fiscal y las direcciones de entrega registradas.">
      {cargando ? (
        <SkeletonFilas n={3} alto="h-24" />
      ) : (
        <div className="space-y-5 pb-2">
          {ficha && principal && (
            <section className="rounded-xl border border-border bg-card p-4" data-testid="direccion-fiscal">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Building2 className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dirección fiscal</p>
                  <p className="truncate font-medium">{ficha.nombre_negocio}</p>
                </div>
              </div>
              <div className="mt-3 space-y-0.5 text-sm">
                <p>{principal.calle || "Sin dirección registrada"}</p>
                {principal.complemento && <p className="text-muted-foreground">{principal.complemento}</p>}
                {principal.ciudad && <p className="text-muted-foreground">{principal.ciudad}</p>}
                {ficha.telefono && <p className="text-muted-foreground tabular-nums">Tel. {ficha.telefono}</p>}
              </div>
            </section>
          )}

          <section className="space-y-3" aria-label="Direcciones de entrega">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Direcciones de entrega{entregas.length ? ` (${entregas.length})` : ""}
            </h2>
            {entregas.length === 0 ? (
              <div className="rounded-xl border border-border bg-card">
                <EstadoVacio icono={MapPin} titulo="No tienes otras direcciones de entrega" descripcion="Tus pedidos se entregan en la dirección fiscal." />
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2" data-testid="direcciones-entrega">
                {entregas.map((d) => {
                  const l = lineas(d);
                  return (
                    <li key={d.id} className="rounded-xl border border-border bg-card p-4 text-sm">
                      <p className="flex items-center gap-2 font-medium"><MapPin className="h-4 w-4 shrink-0 text-primary" />{d.nombre?.trim() || "Dirección de entrega"}</p>
                      <p className="mt-1.5">{l.calle || "—"}</p>
                      {l.complemento && <p className="text-muted-foreground">{l.complemento}</p>}
                      {l.ciudad && <p className="text-muted-foreground">{l.ciudad}</p>}
                      {d.telefono && <p className="text-muted-foreground tabular-nums">Tel. {d.telefono}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Para agregar o cambiar una dirección, pídeselo a tu ejecutivo de cuenta.
          </p>
        </div>
      )}
    </PortalPagina>
  );
};

export default PortalDirecciones;
