import { useState, useEffect } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { 
  ChevronLeft,
  MapPin,
  Loader2,
  Home,
  Building2
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase, Cliente } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const PortalDirecciones = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [direcciones, setDirecciones] = useState<{ id: string; nombre: string | null; direccion: string | null; ciudad: string | null; estado: string | null; telefono: string | null }[]>([]);

  useEffect(() => {
    if (user?.cliente_id) {
      fetchCliente();
    } else {
      setLoading(false);
    }
  }, [user]);

  const fetchCliente = async () => {
    const [{ data }, { data: dirs }] = await Promise.all([
      supabase.from('clientes').select('*').eq('id', user?.cliente_id).single(),
      supabase.from('cliente_direcciones').select('id, nombre, direccion, ciudad, estado, telefono').eq('cliente_id', user?.cliente_id).eq('activo', true).order('nombre'),
    ]);
    if (data) setCliente(data);
    setDirecciones(dirs ?? []);
    setLoading(false);
  };

  return (
    <PortalMobileLayout showHeader={false} showNav={false}>
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 py-3 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold">Direcciones de Entrega</h1>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="px-4 py-4 space-y-4">
          {/* Main Address */}
          {cliente && (
            <div className="bg-card rounded-xl border-2 border-primary p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">{cliente.nombre_negocio}</p>
                    <Badge className="bg-primary text-white text-xs">Principal</Badge>
                  </div>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                <p className="text-foreground">{cliente.direccion}</p>
                <p className="text-muted-foreground">{cliente.ciudad}</p>
                {cliente.telefono && (
                  <p className="text-muted-foreground">Tel: {cliente.telefono}</p>
                )}
              </div>
            </div>
          )}

          {/* Info Message */}
          <div className="bg-blue-500/10 rounded-xl p-4 flex items-start gap-3">
            <MapPin className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-700">Dirección de entrega</p>
              <p className="text-xs text-blue-600 mt-1">
                Tu dirección principal es la registrada en tu cuenta de negocio. 
                Para modificarla, contacta a tu vendedor asignado.
              </p>
            </div>
          </div>

          {/* Direcciones de entrega registradas en Odoo */}
          {direcciones.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Otras direcciones de entrega ({direcciones.length})</p>
              {direcciones.map((d) => (
                <div key={d.id} className="rounded-xl border border-border bg-card p-4 text-sm">
                  <p className="flex items-center gap-2 font-medium"><MapPin className="h-4 w-4 text-primary" />{d.nombre || "Dirección de entrega"}</p>
                  <p className="mt-1 text-foreground">{d.direccion || "—"}</p>
                  <p className="text-muted-foreground">{[d.ciudad, d.estado].filter(Boolean).join(", ")}</p>
                  {d.telefono && <p className="text-muted-foreground">Tel: {d.telefono}</p>}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="h-16 w-16 rounded-full bg-muted mx-auto flex items-center justify-center mb-4">
                <Home className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground">No tienes otras direcciones de entrega registradas.</p>
            </div>
          )}
        </div>
      )}
    </PortalMobileLayout>
  );
};

export default PortalDirecciones;
