import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, History, Loader2, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { fechaHora } from "./formato";

// Comentarios de una factura (fase 21b, solo GUDS): historial completo (vigentes, reemplazados y retirados) con autor y
// fecha. Un comentario no se sobrescribe: "Editar" crea uno nuevo que reemplaza al anterior y "Retirar" lo saca de la
// vista del cliente; los dos quedan en el historial. Visibles para el cliente por defecto (decisión del 30-sep: sin
// aprobación); los internos solo se ven en el admin.

interface ComentarioHist {
  id: string; texto: string; visible: boolean; fecha: string; autor: string | null; vigente: boolean;
  retirado_at: string | null; retirado_motivo: "retirado" | "reemplazado" | null; retirado_por: string | null; reemplaza_id: string | null;
}

export function ComentariosFacturaDialog({ facturaId, numero, open, onOpenChange, puedeEditar, onCambio }: {
  facturaId: string | null;
  numero?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  puedeEditar: boolean;
  onCambio?: () => void;
}) {
  const [lista, setLista] = useState<ComentarioHist[] | null>(null);
  const [texto, setTexto] = useState("");
  const [visible, setVisible] = useState(true);
  const [editando, setEditando] = useState<ComentarioHist | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [historial, setHistorial] = useState(false);

  const cargar = useCallback(async () => {
    if (!facturaId) return;
    const { data, error } = await supabase.rpc("comentarios_factura", { p_factura_id: facturaId });
    if (error) { toast({ title: "No se pudieron cargar los comentarios", description: error.message, variant: "destructive" }); setLista([]); return; }
    setLista((data as ComentarioHist[]) ?? []);
  }, [facturaId]);

  useEffect(() => {
    if (!open) return;
    setLista(null); setTexto(""); setVisible(true); setEditando(null); setHistorial(false);
    cargar();
  }, [open, cargar]);

  const guardar = async () => {
    if (!facturaId || !texto.trim() || guardando) return;
    setGuardando(true);
    const { error } = await supabase.rpc("comentar_factura", {
      p_factura_id: facturaId, p_texto: texto.trim(), p_visible: visible, p_reemplaza: editando?.id ?? null,
    });
    setGuardando(false);
    if (error) { toast({ title: "No se guardó el comentario", description: error.message, variant: "destructive" }); return; }
    toast({ title: editando ? "Comentario actualizado" : "Comentario agregado", description: visible ? "El cliente lo verá en su estado de cuenta." : "Interno: solo lo ve el equipo." });
    setTexto(""); setEditando(null); setVisible(true);
    await cargar();
    onCambio?.();
  };

  const retirar = async (c: ComentarioHist) => {
    const { error } = await supabase.rpc("retirar_comentario_factura", { p_comentario_id: c.id });
    if (error) { toast({ title: "No se retiró el comentario", description: error.message, variant: "destructive" }); return; }
    if (editando?.id === c.id) { setEditando(null); setTexto(""); }
    await cargar();
    onCambio?.();
  };

  const vigentes = (lista ?? []).filter((c) => c.vigente);
  const anteriores = (lista ?? []).filter((c) => !c.vigente);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!guardando) onOpenChange(o); }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg" data-testid="comentarios-dialogo">
        <DialogHeader className="text-left">
          <DialogTitle className="text-base">Comentarios de {numero ?? "la factura"}</DialogTitle>
          <DialogDescription className="text-xs">Los visibles salen en el estado de cuenta del cliente (enlace, PDF, correo y portal). Quedan con autor e historial.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {lista === null ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            : vigentes.length === 0 ? <p className="py-2 text-sm text-muted-foreground">Sin comentarios vigentes.</p>
            : vigentes.map((c) => (
              <div key={c.id} className="rounded-md border border-border px-3 py-2" data-testid="comentario-vigente">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={c.visible ? "secondary" : "outline"} className="gap-1 px-1.5 py-0 text-[10px]">
                    {c.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}{c.visible ? "Visible para el cliente" : "Interno"}
                  </Badge>
                  {puedeEditar && (
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Editar" onClick={() => { setEditando(c); setTexto(c.texto); setVisible(c.visible); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Retirar" onClick={() => retirar(c)} data-testid="retirar-comentario"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{c.texto}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{c.autor ?? "—"} · {fechaHora(c.fecha)}</p>
              </div>
            ))}
          {anteriores.length > 0 && (
            <div>
              <button type="button" className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => setHistorial((h) => !h)} aria-expanded={historial}>
                <History className="h-3.5 w-3.5" />{historial ? "Ocultar historial" : `Historial (${anteriores.length})`}
              </button>
              {historial && (
                <ul className="mt-1.5 space-y-1.5">
                  {anteriores.map((c) => (
                    <li key={c.id} className="rounded-md bg-muted/40 px-3 py-1.5 text-xs" data-testid="comentario-anterior">
                      <p className="whitespace-pre-wrap text-muted-foreground line-through decoration-muted-foreground/40">{c.texto}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {c.autor ?? "—"} · {fechaHora(c.fecha)} · {c.retirado_motivo === "reemplazado" ? "reemplazado" : "retirado"}{c.retirado_por ? ` por ${c.retirado_por}` : ""} el {fechaHora(c.retirado_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {puedeEditar && (
          <div className={cn("space-y-2 border-t border-border pt-3", editando && "rounded-md")}>
            <Label htmlFor="comentario-texto" className="text-xs">{editando ? "Editar comentario (reemplaza al anterior)" : "Nuevo comentario"}</Label>
            <Textarea id="comentario-texto" rows={3} maxLength={500} value={texto} onChange={(e) => setTexto(e.target.value)}
              placeholder="Ej.: Esto es el IGTF; lo paga en bolívares la próxima semana." data-testid="comentario-texto" />
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={visible} onCheckedChange={setVisible} data-testid="comentario-visible" />
                {visible ? "Visible para el cliente" : "Interno (solo el equipo)"}
              </label>
              <span className="text-[11px] tabular-nums text-muted-foreground">{texto.length}/500</span>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {editando && <Button variant="ghost" onClick={() => { setEditando(null); setTexto(""); setVisible(true); }}>Cancelar edición</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cerrar</Button>
          {puedeEditar && (
            <Button onClick={guardar} disabled={guardando || !texto.trim()} className="gap-2" data-testid="comentario-guardar">
              {guardando && <Loader2 className="h-4 w-4 animate-spin" />}{editando ? "Guardar cambio" : "Agregar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
