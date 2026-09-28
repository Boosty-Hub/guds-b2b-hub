import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mapa, type MarcadorMapa } from "./Mapa";
import { geocodificar, type ResultadoGeo } from "./mapbox";
import { CENTRO_VENEZUELA, leerCoordenadas, type Punto } from "./geo";

const ZOOM_TIPO: Record<string, number> = { address: 17, street: 16, neighborhood: 15, locality: 14, place: 13, district: 11, region: 8 };

/** Poner un pin en el mapa: la búsqueda (geocodificación temporal de Mapbox) SOLO centra el mapa; el pin lo pone la
 *  persona tocando el mapa (y lo ajusta arrastrándolo), o pegando coordenadas. Lo que se guarda es ese pin. */
export function SelectorPin({ pin, onPin, busquedaInicial = "", extras = [], soloLectura = false, className = "h-[300px] sm:h-[380px]" }: {
  pin: Punto | null;
  onPin: (p: Punto) => void;
  busquedaInicial?: string;
  extras?: MarcadorMapa[];
  soloLectura?: boolean;
  className?: string;
}) {
  const [q, setQ] = useState(busquedaInicial);
  const [resultados, setResultados] = useState<ResultadoGeo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [avisoBusqueda, setAvisoBusqueda] = useState("");
  const [sel, setSel] = useState<ResultadoGeo | null>(null);
  const [coords, setCoords] = useState("");
  const [avisoCoords, setAvisoCoords] = useState("");
  const [enfoque, setEnfoque] = useState<{ lat: number; lng: number; zoom?: number; clave: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inicial = useRef(pin);

  const irA = (r: ResultadoGeo) => { setSel(r); setEnfoque({ lat: r.lat, lng: r.lng, zoom: ZOOM_TIPO[r.tipo] ?? 14, clave: Date.now() }); };

  const buscar = async (texto = q) => {
    if (!texto.trim()) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBuscando(true); setAvisoBusqueda("");
    try {
      const r = await geocodificar(texto, pin ?? CENTRO_VENEZUELA, ac.signal);
      setResultados(r);
      if (r.length) irA(r[0]);
      else setAvisoBusqueda("No se encontró esa dirección: prueba con el sector o la ciudad.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setAvisoBusqueda((e as Error).message);
    } finally {
      setBuscando(false);
    }
  };

  // Sin pin: se busca la dirección para centrar el mapa
  useEffect(() => {
    if (!inicial.current && busquedaInicial.trim()) buscar(busquedaInicial);
    return () => abortRef.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const usarCoords = () => {
    const p = leerCoordenadas(coords);
    if (!p) { setAvisoCoords("Formato: 10.4912, -66.8765 (o un enlace de Google Maps)"); return; }
    setAvisoCoords("");
    onPin(p);
    setEnfoque({ ...p, zoom: 17, clave: Date.now() });
  };

  const marcadores = useMemo<MarcadorMapa[]>(() => [
    ...extras,
    ...(sel ? [{ id: "busqueda", lat: sel.lat, lng: sel.lng, tono: "busqueda" as const, titulo: `Resultado de la búsqueda (aproximado): ${sel.nombre}` }] : []),
    ...(pin ? [{ id: "pin", lat: pin.lat, lng: pin.lng, tono: "pin" as const, arrastrable: !soloLectura, titulo: "Ubicación de entrega" }] : []),
  ], [extras, sel, pin, soloLectura]);

  return (
    <div className="space-y-2">
      {!soloLectura && (
        <>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); buscar(); }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar dirección, sector o ciudad" aria-label="Buscar dirección" className="h-9" />
            <Button type="submit" variant="outline" className="h-9 shrink-0 gap-1.5" disabled={buscando || !q.trim()}>
              {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}<span className="hidden sm:inline">Buscar</span>
            </Button>
          </form>
          {resultados.length > 1 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Resultados de la búsqueda">
              {resultados.map((r) => (
                <button key={r.id} type="button" onClick={() => irA(r)}
                  className={`max-w-full truncate rounded-full border px-2 py-0.5 text-xs ${sel?.id === r.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                  {r.nombre}{r.detalle && r.detalle !== r.nombre ? ` · ${r.detalle}` : ""}
                </button>
              ))}
            </div>
          )}
          {avisoBusqueda && <p className="text-xs text-muted-foreground">{avisoBusqueda}</p>}
        </>
      )}
      <Mapa
        className={className}
        etiqueta="Mapa para ubicar el pin"
        marcadores={marcadores}
        centroInicial={pin}
        zoomInicial={pin ? 16 : 11}
        enfoque={enfoque}
        onClickMapa={soloLectura ? undefined : onPin}
        onArrastrar={soloLectura ? undefined : (_id, p) => onPin(p)}
      />
      {!soloLectura && (
        <>
          <p className="text-xs text-muted-foreground">
            <Crosshair className="mr-1 inline h-3.5 w-3.5" />Toca el mapa en la entrada del local para poner el pin y arrástralo para ajustarlo.
            La búsqueda solo centra el mapa (es aproximada); se guarda el pin que pongas tú.
          </p>
          <div className="flex gap-2">
            <Input value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="O pega coordenadas: 10.4912, -66.8765" aria-label="Coordenadas"
              className="h-8 text-xs" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); usarCoords(); } }} />
            <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 text-xs" onClick={usarCoords} disabled={!coords.trim()}>Usar</Button>
          </div>
          {avisoCoords && <p className="text-xs text-destructive">{avisoCoords}</p>}
        </>
      )}
    </div>
  );
}
