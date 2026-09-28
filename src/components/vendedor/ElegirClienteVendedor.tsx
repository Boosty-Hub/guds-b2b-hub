import { useMemo, useState } from "react";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { VendedorLayout, BarraSuperiorMovil } from "./VendedorLayout";
import { listarBorradores } from "./borrador";
import type { ClienteCartera } from "./tipos";
import { Input } from "@/components/ui/input";
import { useCurrency } from "@/contexts/CurrencyContext";

// Primer paso de "Nuevo pedido" y "Registrar cobro": elegir un cliente activo de la cartera (búsqueda sin acentos).
export function ElegirClienteVendedor({ titulo, pregunta, volverA, clientes, cargando, usuarioId, onElegir, conBorradores = false, soloConDeuda = false }: {
  titulo: string;
  pregunta: string;
  volverA: string;
  clientes: ClienteCartera[];
  cargando: boolean;
  usuarioId?: string;
  onElegir: (id: string) => void;
  /** Marca y pone primero los clientes con un pedido sin enviar (borrador). */
  conBorradores?: boolean;
  /** Pone primero los clientes con saldo por cobrar (registrar cobro). */
  soloConDeuda?: boolean;
}) {
  const { formatPrice } = useCurrency();
  const [q, setQ] = useState("");
  const borradores = useMemo(() => (conBorradores && usuarioId ? listarBorradores(usuarioId) : {}), [conBorradores, usuarioId]);
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const t = norm(q.trim());
  const lista = clientes
    .filter((c) => !t || norm(`${c.nombre_negocio} ${c.codigo ?? ""} ${c.ciudad ?? ""}`).includes(t))
    .sort((a, b) => Number(!!borradores[b.id]) - Number(!!borradores[a.id])
      || (soloConDeuda ? Number(b.por_cobrar > 0.009) - Number(a.por_cobrar > 0.009) || b.prioridad - a.prioridad : 0)
      || a.nombre_negocio.localeCompare(b.nombre_negocio));
  return (
    <VendedorLayout title={titulo} pantallaCompletaMovil>
      <BarraSuperiorMovil titulo={titulo} subtitulo="Elige el cliente" volverA={volverA} />
      <div className="mx-auto max-w-2xl p-3 md:p-0">
        <h2 className="mb-2 hidden text-sm font-semibold md:block">{pregunta}</h2>
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, código o ciudad…" className="h-10 pl-8" data-testid="buscar-cliente" />
        </div>
        <div className="rounded-lg border border-border bg-card">
          {cargando ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
            : lista.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{clientes.length ? "Sin resultados" : "No tienes clientes activos en tu cartera"}</p>
            : (
              <ul className="divide-y divide-border" data-testid="lista-elegir-cliente">
                {lista.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40 active:bg-muted/60" onClick={() => onElegir(c.id)}
                      data-testid="elegir-cliente">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{c.nombre_negocio}</p>
                        <p className="truncate text-xs text-muted-foreground">{[c.codigo, c.ciudad].filter(Boolean).join(" · ")}</p>
                      </div>
                      <div className="shrink-0 text-right text-xs">
                        {borradores[c.id] && <span className="mb-0.5 block font-medium text-sky-700 dark:text-sky-300" data-testid="marca-borrador">Borrador · {borradores[c.id].lineas} prod.</span>}
                        {c.vencido > 0.009 ? <span className="font-medium text-destructive">Vencido {formatPrice(c.vencido)}</span>
                          : c.por_cobrar > 0.009 ? <span className="text-muted-foreground">Por cobrar {formatPrice(c.por_cobrar)}</span> : null}
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
    </VendedorLayout>
  );
}
