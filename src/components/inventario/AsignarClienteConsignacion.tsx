import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ClienteOpcion { id: string; nombre_negocio: string; rif: string | null }

/** Elige a mano el cliente de un almacén de consignación. El vínculo queda "manual" y la sincronización con Odoo lo respeta. */
export function AsignarClienteConsignacion({ almacenId, clienteActual, abierto, onCerrar, onGuardado }: {
  almacenId: string; clienteActual: string | null; abierto: boolean; onCerrar: () => void; onGuardado: () => void;
}) {
  const { toast } = useToast();
  const [clientes, setClientes] = useState<ClienteOpcion[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(clienteActual);

  useEffect(() => {
    if (!abierto) return;
    setSel(clienteActual);
    setQ("");
    setCargando(true);
    supabase.from("clientes").select("id, nombre_negocio, rif").order("nombre_negocio").then(({ data }) => {
      setClientes((data as ClienteOpcion[] | null) ?? []);
      setCargando(false);
    });
  }, [abierto, clienteActual]);

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = t ? clientes.filter((c) => c.nombre_negocio.toLowerCase().includes(t) || (c.rif || "").toLowerCase().includes(t)) : clientes;
    return base.slice(0, 80);
  }, [clientes, q]);

  const guardar = async () => {
    setGuardando(true);
    const { error } = await supabase.from("almacenes").update({ cliente_id: sel }).eq("id", almacenId);
    setGuardando(false);
    if (error) {
      toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Cliente de la consignación actualizado", description: "Queda como vínculo manual; la sincronización con Odoo lo respeta." });
    onGuardado();
    onCerrar();
  };

  return (
    <Dialog open={abierto} onOpenChange={(o) => { if (!o) onCerrar(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cliente de la consignación</DialogTitle>
          <DialogDescription>En Odoo el almacén no guarda su cliente; aquí se confirma a quién pertenece la mercancía consignada.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por nombre o RIF..." className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
          {cargando ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : filtrados.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sin resultados</p>
          ) : filtrados.map((c) => (
            <button key={c.id} type="button" onClick={() => setSel(c.id)}
              className={cn("flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/50", sel === c.id && "bg-primary/5")}>
              <span className="min-w-0"><span className="block truncate font-medium">{c.nombre_negocio}</span><span className="font-mono text-xs text-muted-foreground">{c.rif || "—"}</span></span>
              {sel === c.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          ))}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => setSel(null)} disabled={!sel}>Quitar cliente</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
            <Button onClick={guardar} disabled={guardando || sel === clienteActual}>
              {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
