import { useEffect, useRef, useState } from "react";
import { DeliveryLayout } from "@/components/delivery/DeliveryLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  MapPin, 
  Navigation, 
  Clock,
  Package,
  Phone,
  ChevronRight,
  RotateCcw
} from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

interface PuntoRuta {
  id: string;
  orden: number;
  cliente: string;
  direccion: string;
  telefono: string;
  horaEstimada: string;
  productos: number;
  estado: "pendiente" | "en_camino" | "completado";
  coordenadas: { lat: number; lng: number };
}

const rutaData: PuntoRuta[] = [
  {
    id: "ENV-001",
    orden: 1,
    cliente: "Walmart Centro",
    direccion: "Av. Insurgentes Sur 1234, Col. Del Valle",
    telefono: "+52 55 1234 5678",
    horaEstimada: "10:30 AM",
    productos: 12,
    estado: "en_camino",
    coordenadas: { lat: 19.3910, lng: -99.1775 }
  },
  {
    id: "ENV-002",
    orden: 2,
    cliente: "Soriana Norte",
    direccion: "Blvd. Manuel Ávila Camacho 500",
    telefono: "+52 55 9876 5432",
    horaEstimada: "11:15 AM",
    productos: 8,
    estado: "pendiente",
    coordenadas: { lat: 19.4785, lng: -99.2385 }
  },
  {
    id: "ENV-003",
    orden: 3,
    cliente: "OXXO Zona 5",
    direccion: "Av. Universidad 1500, Col. Narvarte",
    telefono: "+52 55 5555 1234",
    horaEstimada: "12:00 PM",
    productos: 5,
    estado: "pendiente",
    coordenadas: { lat: 19.3856, lng: -99.1569 }
  },
  {
    id: "ENV-004",
    orden: 4,
    cliente: "Chedraui Express",
    direccion: "Av. Revolución 800, Col. Mixcoac",
    telefono: "+52 55 6666 7777",
    horaEstimada: "12:45 PM",
    productos: 10,
    estado: "pendiente",
    coordenadas: { lat: 19.3750, lng: -99.1850 }
  },
  {
    id: "ENV-005",
    orden: 5,
    cliente: "7-Eleven Centro",
    direccion: "Paseo de la Reforma 222",
    telefono: "+52 55 2222 1111",
    horaEstimada: "1:30 PM",
    productos: 6,
    estado: "pendiente",
    coordenadas: { lat: 19.4270, lng: -99.1677 }
  },
];

const DeliveryRuta = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [selectedPunto, setSelectedPunto] = useState<PuntoRuta | null>(rutaData[0]);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [-99.1677, 19.4100],
      zoom: 11.5,
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

    // Add markers for each delivery point
    rutaData.forEach((punto, index) => {
      const el = document.createElement("div");
      el.className = "custom-marker";
      el.innerHTML = `
        <div style="
          width: 36px;
          height: 36px;
          background: ${punto.estado === "en_camino" ? "#f59e0b" : punto.estado === "completado" ? "#22c55e" : "#6b7280"};
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 14px;
          border: 3px solid white;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        ">
          ${punto.orden}
        </div>
      `;

      new mapboxgl.Marker(el)
        .setLngLat([punto.coordenadas.lng, punto.coordenadas.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 }).setHTML(`
            <div style="padding: 8px; min-width: 150px;">
              <strong style="font-size: 14px;">${punto.cliente}</strong><br/>
              <span style="color: #666; font-size: 12px;">${punto.horaEstimada}</span><br/>
              <span style="color: #666; font-size: 12px;">${punto.productos} productos</span>
            </div>
          `)
        )
        .addTo(map.current!);
    });

    // Draw route line
    map.current.on("load", () => {
      const coordinates = rutaData.map(p => [p.coordenadas.lng, p.coordenadas.lat]);
      
      map.current!.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: coordinates,
          },
        },
      });

      map.current!.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#f59e0b",
          "line-width": 4,
          "line-opacity": 0.8,
        },
      });
    });

    return () => {
      map.current?.remove();
    };
  }, []);

  const navigateToPoint = (punto: PuntoRuta) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${punto.coordenadas.lat},${punto.coordenadas.lng}`;
    window.open(url, "_blank");
  };

  const focusOnPoint = (punto: PuntoRuta) => {
    setSelectedPunto(punto);
    map.current?.flyTo({
      center: [punto.coordenadas.lng, punto.coordenadas.lat],
      zoom: 15,
      duration: 1000,
    });
  };

  const resetView = () => {
    map.current?.flyTo({
      center: [-99.1677, 19.4100],
      zoom: 11.5,
      duration: 1000,
    });
  };

  return (
    <DeliveryLayout title="Mi Ruta">
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Map */}
        <Card className="border-border lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Navigation className="h-5 w-5 text-amber-500" />
              Mapa de Ruta
            </CardTitle>
            <Button variant="outline" size="sm" onClick={resetView}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Reiniciar Vista
            </Button>
          </CardHeader>
          <CardContent>
            <div ref={mapContainer} className="h-[500px] rounded-lg overflow-hidden" />
            <div className="flex items-center justify-between mt-4 text-sm">
              <div className="flex gap-4">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-amber-500" />
                  <span className="text-muted-foreground">En camino</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-gray-500" />
                  <span className="text-muted-foreground">Pendiente</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-green-500" />
                  <span className="text-muted-foreground">Completado</span>
                </div>
              </div>
              <span className="text-muted-foreground">{rutaData.length} paradas</span>
            </div>
          </CardContent>
        </Card>

        {/* Route List */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg">Orden de Entregas</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {rutaData.map((punto, index) => (
                <div
                  key={punto.id}
                  className={`p-4 cursor-pointer transition-colors ${
                    selectedPunto?.id === punto.id ? "bg-amber-500/10" : "hover:bg-muted/50"
                  }`}
                  onClick={() => focusOnPoint(punto)}
                >
                  <div className="flex items-start gap-3">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      punto.estado === "en_camino" ? "bg-amber-500 text-white" :
                      punto.estado === "completado" ? "bg-green-500 text-white" : "bg-muted"
                    }`}>
                      <span className="text-sm font-bold">{punto.orden}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="font-medium truncate">{punto.cliente}</p>
                        <Badge variant={
                          punto.estado === "en_camino" ? "default" :
                          punto.estado === "completado" ? "secondary" : "outline"
                        } className="ml-2 flex-shrink-0">
                          {punto.estado === "en_camino" ? "En camino" :
                           punto.estado === "completado" ? "Completado" : "Pendiente"}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{punto.direccion}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {punto.horaEstimada}
                        </span>
                        <span className="flex items-center gap-1">
                          <Package className="h-3 w-3" />
                          {punto.productos} prod.
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {selectedPunto?.id === punto.id && (
                    <div className="flex gap-2 mt-3 pl-11">
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`tel:${punto.telefono}`, "_self");
                        }}
                      >
                        <Phone className="h-4 w-4 mr-1" />
                        Llamar
                      </Button>
                      <Button 
                        size="sm"
                        className="bg-amber-500 hover:bg-amber-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateToPoint(punto);
                        }}
                      >
                        <Navigation className="h-4 w-4 mr-1" />
                        Navegar
                      </Button>
                    </div>
                  )}

                  {index < rutaData.length - 1 && (
                    <div className="flex items-center gap-2 mt-2 pl-11 text-xs text-muted-foreground">
                      <ChevronRight className="h-3 w-3" />
                      <span>~15 min</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary */}
      <Card className="border-border mt-6">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-8">
              <div>
                <p className="text-sm text-muted-foreground">Total Paradas</p>
                <p className="text-2xl font-bold">{rutaData.length}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Distancia Estimada</p>
                <p className="text-2xl font-bold">32 km</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Tiempo Estimado</p>
                <p className="text-2xl font-bold">2h 45min</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Productos Totales</p>
                <p className="text-2xl font-bold">{rutaData.reduce((acc, p) => acc + p.productos, 0)}</p>
              </div>
            </div>
            <Button className="bg-amber-500 hover:bg-amber-600" size="lg" onClick={() => navigateToPoint(rutaData[0])}>
              <Navigation className="h-5 w-5 mr-2" />
              Iniciar Navegación
            </Button>
          </div>
        </CardContent>
      </Card>
    </DeliveryLayout>
  );
};

export default DeliveryRuta;
