import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, RefreshCw, Truck, Package, Navigation } from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { supabase } from "@/lib/supabase";

mapboxgl.accessToken = "pk.eyJ1IjoiZ3VkcyIsImEiOiJjbWt3cHR5emswMXE2M2ZuYngwcDJybXF6In0.k_RC8LITMponN_6XwIXARA";

interface Repartidor {
  id: string;
  nombre: string;
  apellido: string;
  latitud: number;
  longitud: number;
  entregas_activas: number;
  estado: "en_ruta" | "disponible" | "offline";
}

interface Entrega {
  id: string;
  cliente_nombre: string;
  direccion: string;
  latitud: number;
  longitud: number;
  estado: "asignada" | "en_camino" | "entregada" | "fallida";
  repartidor_nombre: string | null;
}

// Mock data para demostración - será reemplazado por datos reales de Supabase
const mockRepartidores: Repartidor[] = [
  { id: "1", nombre: "Carlos", apellido: "Ruiz", latitud: 19.4326, longitud: -99.1332, entregas_activas: 3, estado: "en_ruta" },
  { id: "2", nombre: "Miguel", apellido: "Torres", latitud: 19.4500, longitud: -99.1500, entregas_activas: 2, estado: "en_ruta" },
  { id: "3", nombre: "Ana", apellido: "García", latitud: 19.4100, longitud: -99.1200, entregas_activas: 0, estado: "disponible" },
];

const mockEntregas: Entrega[] = [
  { id: "E1", cliente_nombre: "Walmart Centro", direccion: "Av. Insurgentes Sur 1234", latitud: 19.3910, longitud: -99.1775, estado: "en_camino", repartidor_nombre: "Carlos Ruiz" },
  { id: "E2", cliente_nombre: "Soriana Norte", direccion: "Blvd. Manuel Ávila Camacho 500", latitud: 19.4785, longitud: -99.2385, estado: "asignada", repartidor_nombre: "Miguel Torres" },
  { id: "E3", cliente_nombre: "OXXO Zona 5", direccion: "Av. Universidad 1500", latitud: 19.3856, longitud: -99.1569, estado: "asignada", repartidor_nombre: null },
];

export const LiveDeliveryMap = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [repartidores, setRepartidores] = useState<Repartidor[]>(mockRepartidores);
  const [entregas, setEntregas] = useState<Entrega[]>(mockEntregas);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedRepartidor, setSelectedRepartidor] = useState<string | null>(null);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [-99.1332, 19.4326],
      zoom: 11,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.current.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true,
      }),
      "top-right"
    );

    return () => {
      map.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (!map.current) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    // Add repartidor markers (truck icons)
    repartidores.forEach((rep) => {
      const el = document.createElement("div");
      el.className = "repartidor-marker";
      el.innerHTML = `
        <div style="
          width: 44px;
          height: 44px;
          background: ${rep.estado === "en_ruta" ? "#f59e0b" : rep.estado === "disponible" ? "#22c55e" : "#6b7280"};
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          border: 3px solid white;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          cursor: pointer;
        ">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>
            <path d="M15 18H9"/>
            <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>
            <circle cx="17" cy="18" r="2"/>
            <circle cx="7" cy="18" r="2"/>
          </svg>
        </div>
      `;

      const marker = new mapboxgl.Marker(el)
        .setLngLat([rep.longitud, rep.latitud])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 }).setHTML(`
            <div style="padding: 12px; min-width: 180px;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <div style="
                  width: 32px; height: 32px; border-radius: 50%;
                  background: ${rep.estado === "en_ruta" ? "#f59e0b20" : "#22c55e20"};
                  display: flex; align-items: center; justify-content: center;
                ">
                  <span style="color: ${rep.estado === "en_ruta" ? "#f59e0b" : "#22c55e"}; font-weight: bold;">
                    ${rep.nombre[0]}${rep.apellido[0]}
                  </span>
                </div>
                <div>
                  <strong style="font-size: 14px;">${rep.nombre} ${rep.apellido}</strong>
                  <div style="font-size: 11px; color: ${rep.estado === "en_ruta" ? "#f59e0b" : "#22c55e"};">
                    ${rep.estado === "en_ruta" ? "En Ruta" : "Disponible"}
                  </div>
                </div>
              </div>
              <div style="font-size: 12px; color: #666;">
                📦 ${rep.entregas_activas} entregas activas
              </div>
            </div>
          `)
        )
        .addTo(map.current!);

      markersRef.current.push(marker);
    });

    // Add entrega markers (package icons)
    entregas.forEach((entrega) => {
      const color = entrega.estado === "entregada" ? "#22c55e" :
                    entrega.estado === "en_camino" ? "#f59e0b" :
                    entrega.estado === "fallida" ? "#ef4444" : "#6b7280";

      const marker = new mapboxgl.Marker({ color })
        .setLngLat([entrega.longitud, entrega.latitud])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 }).setHTML(`
            <div style="padding: 12px; min-width: 180px;">
              <strong style="font-size: 14px;">${entrega.cliente_nombre}</strong>
              <div style="font-size: 12px; color: #666; margin-top: 4px;">
                ${entrega.direccion}
              </div>
              <div style="margin-top: 8px; display: flex; gap: 8px; align-items: center;">
                <span style="
                  padding: 2px 8px;
                  border-radius: 12px;
                  font-size: 11px;
                  font-weight: 500;
                  background: ${color}20;
                  color: ${color};
                ">
                  ${entrega.estado === "en_camino" ? "En Camino" :
                    entrega.estado === "entregada" ? "Entregada" :
                    entrega.estado === "fallida" ? "Fallida" : "Asignada"}
                </span>
              </div>
              ${entrega.repartidor_nombre ? `
                <div style="font-size: 12px; color: #666; margin-top: 8px;">
                  🚚 ${entrega.repartidor_nombre}
                </div>
              ` : ''}
            </div>
          `)
        )
        .addTo(map.current!);

      markersRef.current.push(marker);
    });
  }, [repartidores, entregas]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    // TODO: Fetch real data from Supabase
    // For now, just simulate a refresh
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsRefreshing(false);
  };

  const focusOnRepartidor = (rep: Repartidor) => {
    setSelectedRepartidor(rep.id);
    map.current?.flyTo({
      center: [rep.longitud, rep.latitud],
      zoom: 15,
      duration: 1000,
    });
  };

  const resetView = () => {
    setSelectedRepartidor(null);
    map.current?.flyTo({
      center: [-99.1332, 19.4326],
      zoom: 11,
      duration: 1000,
    });
  };

  const stats = {
    enRuta: repartidores.filter(r => r.estado === "en_ruta").length,
    disponibles: repartidores.filter(r => r.estado === "disponible").length,
    entregasPendientes: entregas.filter(e => e.estado !== "entregada").length,
  };

  return (
    <div className="space-y-4">
      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Truck className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.enRuta}</p>
                <p className="text-xs text-muted-foreground">En Ruta</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                <Truck className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.disponibles}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                <Package className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.entregasPendientes}</p>
                <p className="text-xs text-muted-foreground">Entregas Pendientes</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Map Card */}
      <Card className="border-border">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2">
            <Navigation className="h-5 w-5 text-primary" />
            Mapa en Vivo - Repartidores
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={resetView}>
              <MapPin className="h-4 w-4 mr-1" />
              Ver Todo
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div ref={mapContainer} className="h-[500px] rounded-lg overflow-hidden" />
          
          {/* Legend */}
          <div className="flex items-center justify-between mt-4">
            <div className="flex gap-6">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full bg-amber-500" />
                <span className="text-sm text-muted-foreground">Repartidor en ruta</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full bg-green-500" />
                <span className="text-sm text-muted-foreground">Repartidor disponible</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-gray-500" />
                <span className="text-sm text-muted-foreground">Entrega pendiente</span>
              </div>
            </div>
            <span className="text-sm text-muted-foreground">
              Última actualización: hace 1 min
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Repartidores List */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle>Repartidores Activos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            {repartidores.map((rep) => (
              <div
                key={rep.id}
                className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                  selectedRepartidor === rep.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                }`}
                onClick={() => focusOnRepartidor(rep)}
              >
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                    rep.estado === "en_ruta" ? "bg-amber-500/20" : "bg-green-500/20"
                  }`}>
                    <Truck className={`h-5 w-5 ${
                      rep.estado === "en_ruta" ? "text-amber-500" : "text-green-500"
                    }`} />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{rep.nombre} {rep.apellido}</p>
                    <div className="flex items-center gap-2">
                      <Badge variant={rep.estado === "en_ruta" ? "default" : "secondary"} className="text-xs">
                        {rep.estado === "en_ruta" ? "En Ruta" : "Disponible"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {rep.entregas_activas} entregas
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
