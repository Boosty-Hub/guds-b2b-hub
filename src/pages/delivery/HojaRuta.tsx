import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { supabase } from "@/lib/supabase";
import { cargarRutaAdmin, type ParadaAdmin, type RutaAdmin } from "@/components/delivery/rutas";
import { ESTADO_ENTREGA, fmtCantidad, fmtDia, telefonos } from "@/components/delivery/entregas";
import { fechaHora } from "@/components/delivery/fechas";

// Hoja de ruta imprimible (D3): la ruta PUBLICADA de un repartidor en un día, en orden, con cliente, dirección, teléfono,
// documento y productos (lo reservado en Odoo), y un espacio para la firma de quien recibe. Respaldo en papel.
const HojaRuta = () => {
  const [params] = useSearchParams();
  const rep = params.get("rep") ?? "";
  const fecha = params.get("fecha") ?? "";
  const [datos, setDatos] = useState<RutaAdmin | null>(null);
  const [repartidor, setRepartidor] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!rep || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { setError("Falta el repartidor o el día de la ruta."); return; }
    cargarRutaAdmin(rep, fecha).then(setDatos).catch((e) => setError((e as Error).message));
    supabase.from("usuarios").select("nombre, apellido").eq("id", rep).maybeSingle()
      .then(({ data }) => setRepartidor(data ? `${data.nombre} ${data.apellido ?? ""}`.trim() : ""));
  }, [rep, fecha]);

  useEffect(() => { document.title = `Hoja de ruta ${fecha}${repartidor ? ` · ${repartidor}` : ""}`; }, [fecha, repartidor]);

  const paradas: ParadaAdmin[] = (datos?.entregas ?? []).filter((e) => e.fecha_ruta === fecha).sort((a, b) => (a.orden_ruta ?? 999) - (b.orden_ruta ?? 999));
  const empresas = [...new Set(paradas.map((p) => p.empresa))].join(" + ");

  return (
    <div className="min-h-screen bg-background text-foreground print:bg-white print:text-black">
      <div className="mx-auto max-w-5xl p-4 print:max-w-none print:p-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
          <Button asChild variant="ghost" size="sm" className="gap-1"><Link to="/admin/delivery?vista=rutas"><ArrowLeft className="h-4 w-4" />Volver a rutas</Link></Button>
          <Button size="sm" className="gap-1.5" onClick={() => window.print()} disabled={!paradas.length}><Printer className="h-4 w-4" />Imprimir</Button>
        </div>

        {error ? <p className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">{error}</p>
        : !datos ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        : (
          <>
            <header className="mb-3 flex items-start justify-between gap-4 border-b-2 border-foreground pb-2 print:border-black">
              <div>
                <h1 className="text-xl font-bold">Hoja de ruta · {fmtDia(fecha)} {fecha.slice(0, 4)}</h1>
                <p className="text-sm">Repartidor: <span className="font-semibold">{repartidor || "—"}</span> · {paradas.length} {paradas.length === 1 ? "parada" : "paradas"}{empresas ? ` · ${empresas}` : ""}</p>
                <p className="text-xs text-muted-foreground print:text-black">
                  {datos.ruta?.publicada_at ? `Publicada ${fechaHora(datos.ruta.publicada_at)}${datos.ruta.publicada_por ? ` por ${datos.ruta.publicada_por}` : ""} · versión ${datos.ruta.version}` : "Ruta sin publicar"}
                  {" · "}Impresa {fechaHora(new Date().toISOString())}
                </p>
              </div>
              <Logo className="h-10 text-primary print:text-black" />
            </header>

            {paradas.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No hay paradas en la ruta publicada de ese día.</p> : (
              <ol className="space-y-2">
                {paradas.map((p, i) => {
                  const tels = telefonos(p.telefono);
                  const lleva = p.lineas.filter((l) => Number(l.cantidad) > 0);
                  const est = ESTADO_ENTREGA[p.estado];
                  return (
                    <li key={p.id} className="break-inside-avoid rounded-md border border-border p-2 text-sm print:border-black">
                      <div className="flex items-start gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-foreground text-base font-bold print:border-black">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <p className="font-semibold">{p.cliente}{p.sucursal ? ` › ${p.sucursal}` : ""}</p>
                            <p className="font-mono text-xs">{p.numero} · {p.empresa}{p.tipo === "reposicion" ? " · Reposición a consignación" : ""}{p.estado !== "asignada" && est ? ` · ${est.label}` : ""}</p>
                          </div>
                          {p.contacto && !p.contacto.startsWith(p.cliente ?? "\u0000") && <p className="text-xs">Entregar a: {p.contacto}</p>}
                          <p>{[p.direccion, p.ciudad, p.region?.replace(/\s*\(VE\)\s*$/, "")].filter(Boolean).join(", ") || "Sin dirección"}</p>
                          <p className="text-xs">Tel.: {tels.length ? tels.join(" · ") : "—"}{p.ubicacion ? ` · GPS ${p.ubicacion.lat.toFixed(5)}, ${p.ubicacion.lng.toFixed(5)}` : " · sin ubicación en el mapa"}{p.origen ? ` · Origen ${p.origen}` : ""}</p>
                          {lleva.length > 0 && (
                            <table className="mt-1 w-full text-xs">
                              <tbody>
                                {lleva.map((l, k) => (
                                  <tr key={k} className="border-t border-border/60 print:border-black/30">
                                    <td className="py-0.5 pr-2">{l.producto}</td>
                                    <td className="w-24 py-0.5 text-right tabular-nums">{fmtCantidad(l.cantidad)} {l.unidad && l.unidad !== "Units" ? l.unidad : "u."}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          <div className="mt-2 grid grid-cols-3 gap-3 text-[11px] text-muted-foreground print:text-black">
                            <span className="border-t border-foreground/60 pt-0.5 print:border-black">Recibió (nombre)</span>
                            <span className="border-t border-foreground/60 pt-0.5 print:border-black">Firma</span>
                            <span className="border-t border-foreground/60 pt-0.5 print:border-black">Hora / observaciones</span>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default HojaRuta;
