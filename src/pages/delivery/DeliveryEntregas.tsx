import { useState, useEffect, useCallback, useRef } from "react";
import { DeliveryLayout } from "@/components/delivery/DeliveryLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, MapPin, Phone, Clock, CheckCircle, Navigation, Loader2, Truck, Camera, Eraser } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";

// Pad de firma sencillo sobre canvas (mouse + touch)
function SignaturePad({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement> }) {
  const drawing = useRef(false);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true; const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#1a2230";
    const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return; const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
  };
  const end = () => { drawing.current = false; };
  return (
    <canvas
      ref={canvasRef} width={480} height={160}
      className="w-full h-40 rounded-lg border border-border bg-white touch-none"
      onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
    />
  );
}

interface EntregaRow {
  id: string;
  estado: "asignada" | "en_camino" | "entregada" | "fallida";
  prioridad: string | null;
  notas: string | null;
  motivo_fallo: string | null;
  receptor_nombre: string | null;
  orden?: {
    numero: string;
    total: number;
    direccion_entrega: string | null;
    ciudad_entrega: string | null;
    cliente?: { nombre_negocio: string; direccion: string; telefono: string | null; latitud: number | null; longitud: number | null } | null;
    orden_items?: { cantidad: number }[];
  } | null;
}

const estadoConfig: Record<string, { label: string; color: string; bg: string }> = {
  asignada: { label: "Asignada", color: "text-muted-foreground", bg: "bg-muted" },
  en_camino: { label: "En Camino", color: "text-amber-600", bg: "bg-amber-500/10" },
  entregada: { label: "Entregada", color: "text-green-600", bg: "bg-green-500/10" },
  fallida: { label: "Fallida", color: "text-red-600", bg: "bg-red-500/10" },
};

const DeliveryEntregas = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const [entregas, setEntregas] = useState<EntregaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EntregaRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const [receptor, setReceptor] = useState("");
  const [notas, setNotas] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [fotoFile, setFotoFile] = useState<File | null>(null);
  const sigRef = useRef<HTMLCanvasElement>(null);

  const fetchEntregas = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("entregas")
      .select("id,estado,prioridad,notas,motivo_fallo,receptor_nombre,orden:ordenes(numero,total,direccion_entrega,ciudad_entrega,cliente:clientes(nombre_negocio,direccion,telefono,latitud,longitud),orden_items(cantidad))")
      .eq("repartidor_id", user.id)
      .order("fecha_asignacion", { ascending: false });
    if (data) setEntregas(data as unknown as EntregaRow[]);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { fetchEntregas(); }, [fetchEntregas]);

  const pendientes = entregas.filter((e) => e.estado === "asignada" || e.estado === "en_camino");
  const completadas = entregas.filter((e) => e.estado === "entregada" || e.estado === "fallida");

  const productos = (e: EntregaRow) => (e.orden?.orden_items || []).reduce((s, i) => s + Number(i.cantidad), 0);

  // Sube una imagen (blob) al bucket público 'imagenes' bajo entregas/ y devuelve la URL
  const subirImagen = async (blob: Blob, nombre: string): Promise<string | null> => {
    const path = `entregas/${nombre}`;
    const { error } = await supabase.storage.from("imagenes").upload(path, blob, { upsert: true, contentType: blob.type || "image/png" });
    if (error) { toast({ title: "No se pudo subir la imagen", description: error.message, variant: "destructive" }); return null; }
    return supabase.storage.from("imagenes").getPublicUrl(path).data.publicUrl;
  };

  const firmaTieneTrazos = () => {
    const c = sigRef.current; if (!c) return false;
    const ctx = c.getContext("2d")!; const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) { if (d[i] !== 0) return true; }
    return false;
  };

  const cambiarEstado = async (e: EntregaRow, estado: string, extra?: { receptor?: string; notas?: string; motivo?: string }) => {
    setBusy(true);
    let firmaUrl: string | null = null;
    let fotoUrl: string | null = null;

    if (estado === "entregada") {
      // Firma (canvas) → PNG
      if (firmaTieneTrazos()) {
        const blob: Blob | null = await new Promise((res) => sigRef.current!.toBlob(res, "image/png"));
        if (blob) firmaUrl = await subirImagen(blob, `firma-${e.id}-${e.orden?.numero || ""}.png`);
      }
      // Foto de evidencia
      if (fotoFile) fotoUrl = await subirImagen(fotoFile, `foto-${e.id}-${fotoFile.name}`);
    }

    const { error } = await supabase.rpc("actualizar_estado_entrega", {
      p_entrega_id: e.id, p_estado: estado,
      p_receptor: extra?.receptor || null, p_notas: extra?.notas || null, p_motivo: extra?.motivo || null,
      p_firma_url: firmaUrl, p_foto_url: fotoUrl,
    });
    setBusy(false);
    if (error) { toast({ title: "No se pudo actualizar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Entrega actualizada", description: `${e.orden?.numero || ""} → ${estadoConfig[estado].label}` });
    setConfirmOpen(false); setFailOpen(false); setSelected(null); setReceptor(""); setNotas(""); setMotivo(""); setFotoFile(null);
    fetchEntregas();
  };

  const navegar = (e: EntregaRow) => {
    const c = e.orden?.cliente;
    const url = c?.latitud && c?.longitud
      ? `https://www.google.com/maps/dir/?api=1&destination=${c.latitud},${c.longitud}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((c?.direccion || e.orden?.direccion_entrega || "") + " " + (e.orden?.ciudad_entrega || ""))}`;
    window.open(url, "_blank");
  };
  const llamar = (tel?: string | null) => { if (tel) window.open(`tel:${tel}`, "_self"); };

  const Tarjeta = ({ e, idx, activa }: { e: EntregaRow; idx: number; activa: boolean }) => (
    <Card className={`border-border ${activa && idx === 0 ? "border-amber-500/50" : ""}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`h-11 w-11 rounded-full flex items-center justify-center ${activa && idx === 0 ? "bg-amber-500 text-white" : "bg-muted"}`}>
              <span className="text-base font-bold">{idx + 1}</span>
            </div>
            <div>
              <p className="font-semibold">{e.orden?.cliente?.nombre_negocio || "Cliente"}</p>
              <p className="text-xs text-muted-foreground">{e.orden?.numero}{e.prioridad === "alta" ? " · Prioridad alta" : ""}</p>
            </div>
          </div>
          <Badge className={`${estadoConfig[e.estado].bg} ${estadoConfig[e.estado].color} border-0`}>{estadoConfig[e.estado].label}</Badge>
        </div>
        <div className="space-y-1.5 text-sm text-muted-foreground mb-3">
          <p className="flex items-start gap-2"><MapPin className="h-4 w-4 mt-0.5 shrink-0" />{e.orden?.cliente?.direccion || e.orden?.direccion_entrega || "Sin dirección"}</p>
          {e.orden?.cliente?.telefono && <p className="flex items-center gap-2"><Phone className="h-4 w-4" />{e.orden.cliente.telefono}</p>}
          <p className="flex items-center gap-2"><Package className="h-4 w-4" />{productos(e)} productos · {formatPrice(Number(e.orden?.total || 0))}</p>
          {e.estado === "fallida" && e.motivo_fallo && <p className="text-red-600">Motivo: {e.motivo_fallo}</p>}
          {e.estado === "entregada" && e.receptor_nombre && <p className="text-green-600">Recibió: {e.receptor_nombre}</p>}
        </div>
        {activa && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => llamar(e.orden?.cliente?.telefono)} disabled={!e.orden?.cliente?.telefono}><Phone className="h-4 w-4 mr-1" />Llamar</Button>
            <Button size="sm" variant="outline" onClick={() => navegar(e)}><Navigation className="h-4 w-4 mr-1" />Navegar</Button>
            {e.estado === "asignada" && (
              <Button size="sm" className="bg-amber-500 hover:bg-amber-600" onClick={() => cambiarEstado(e, "en_camino")} disabled={busy}><Truck className="h-4 w-4 mr-1" />En camino</Button>
            )}
            {e.estado === "en_camino" && (
              <>
                <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => { setSelected(e); setConfirmOpen(true); }}><CheckCircle className="h-4 w-4 mr-1" />Entregar</Button>
                <Button size="sm" variant="destructive" onClick={() => { setSelected(e); setFailOpen(true); }}>Reportar fallo</Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <DeliveryLayout title="Mis Entregas">
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>
      ) : (
        <Tabs defaultValue="pendientes" className="space-y-6">
          <TabsList>
            <TabsTrigger value="pendientes" className="gap-2"><Clock className="h-4 w-4" />Pendientes ({pendientes.length})</TabsTrigger>
            <TabsTrigger value="completadas" className="gap-2"><CheckCircle className="h-4 w-4" />Completadas ({completadas.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pendientes" className="space-y-4">
            {pendientes.length === 0 ? (
              <Card className="border-border"><CardContent className="p-12 text-center">
                <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
                <p className="text-lg font-medium">¡Todo al día!</p>
                <p className="text-muted-foreground">No tienes entregas pendientes</p>
              </CardContent></Card>
            ) : pendientes.map((e, i) => <Tarjeta key={e.id} e={e} idx={i} activa />)}
          </TabsContent>

          <TabsContent value="completadas" className="space-y-4">
            {completadas.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">Aún no tienes entregas completadas</p>
            ) : completadas.map((e, i) => <Tarjeta key={e.id} e={e} idx={i} activa={false} />)}
          </TabsContent>
        </Tabs>
      )}

      {/* Confirmar entrega */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirmar entrega — {selected?.orden?.numero}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><label className="text-sm text-muted-foreground">Nombre de quien recibe</label>
              <Input value={receptor} onChange={(e) => setReceptor(e.target.value)} placeholder="Ej. Sra. Ana (encargada)" /></div>
            <div>
              <label className="text-sm text-muted-foreground flex items-center gap-1"><Camera className="h-3.5 w-3.5" /> Foto de evidencia</label>
              <Input type="file" accept="image/*" capture="environment" onChange={(e) => setFotoFile(e.target.files?.[0] || null)} />
              {fotoFile && <p className="text-xs text-green-600 mt-1">Foto lista: {fotoFile.name}</p>}
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-muted-foreground">Firma del receptor</label>
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { const c = sigRef.current; if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height); }}>
                  <Eraser className="h-3.5 w-3.5 mr-1" /> Limpiar
                </Button>
              </div>
              <SignaturePad canvasRef={sigRef} />
            </div>
            <div><label className="text-sm text-muted-foreground">Notas (opcional)</label>
              <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Observaciones de la entrega" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>Cancelar</Button>
            <Button className="bg-green-600 hover:bg-green-700" disabled={busy || !receptor.trim()} onClick={() => selected && cambiarEstado(selected, "entregada", { receptor, notas })}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar entrega"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reportar fallo */}
      <Dialog open={failOpen} onOpenChange={setFailOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reportar entrega fallida — {selected?.orden?.numero}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><label className="text-sm text-muted-foreground">Motivo del fallo</label>
              <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Local cerrado, cliente no responde…" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFailOpen(false)} disabled={busy}>Cancelar</Button>
            <Button variant="destructive" disabled={busy || !motivo.trim()} onClick={() => selected && cambiarEstado(selected, "fallida", { motivo })}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reportar fallo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DeliveryLayout>
  );
};

export default DeliveryEntregas;
