import { useState } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  ChevronLeft,
  CreditCard,
  Building2,
  Smartphone,
  Banknote,
  Plus,
  Check
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const metodosPago = [
  { 
    id: "transferencia", 
    name: "Transferencia Bancaria", 
    icon: Building2, 
    description: "Banco Nacional - ****4521",
    active: true 
  },
  { 
    id: "pago_movil", 
    name: "Pago Móvil", 
    icon: Smartphone, 
    description: "0414-***-**89",
    active: true 
  },
  { 
    id: "efectivo", 
    name: "Efectivo contra entrega", 
    icon: Banknote, 
    description: "Pago al momento de la entrega",
    active: true 
  },
  { 
    id: "credito", 
    name: "Crédito", 
    icon: CreditCard, 
    description: "Línea de crédito aprobada",
    active: true 
  },
];

const PortalMetodosPago = () => {
  const navigate = useNavigate();
  const [selectedMethod, setSelectedMethod] = useState("transferencia");

  return (
    <PortalMobileLayout showHeader={false} showNav={false}>
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 py-3 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold">Métodos de Pago</h1>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Payment Methods */}
        <div className="space-y-3">
          {metodosPago.map((metodo) => {
            const Icon = metodo.icon;
            const isSelected = selectedMethod === metodo.id;
            
            return (
              <button
                key={metodo.id}
                onClick={() => setSelectedMethod(metodo.id)}
                className={`w-full bg-card rounded-xl border p-4 flex items-center gap-4 transition-colors ${
                  isSelected ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
                  isSelected ? "bg-primary/10" : "bg-muted"
                }`}>
                  <Icon className={`h-6 w-6 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-medium">{metodo.name}</p>
                  <p className="text-sm text-muted-foreground">{metodo.description}</p>
                </div>
                {isSelected && (
                  <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-4 w-4 text-white" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Info */}
        <div className="bg-muted rounded-xl p-4">
          <h3 className="font-semibold mb-2">Información</h3>
          <p className="text-sm text-muted-foreground">
            Selecciona tu método de pago preferido. Este será el método sugerido 
            al momento de realizar un pedido, pero siempre podrás cambiarlo.
          </p>
        </div>

        {/* Bank Info */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-semibold mb-3">Datos para transferencia</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Banco</span>
              <span className="font-medium">Banco Nacional</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cuenta</span>
              <span className="font-medium font-mono">0102-0345-6789-0123</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">RIF</span>
              <span className="font-medium">J-12345678-9</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Titular</span>
              <span className="font-medium">GUDS Distribuidora C.A.</span>
            </div>
          </div>
        </div>

        {/* Pago Móvil Info */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-semibold mb-3">Datos para Pago Móvil</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Teléfono</span>
              <span className="font-medium font-mono">0414-123-4567</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Banco</span>
              <span className="font-medium">0102 - Banco Nacional</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cédula/RIF</span>
              <span className="font-medium">J-12345678-9</span>
            </div>
          </div>
        </div>
      </div>
    </PortalMobileLayout>
  );
};

export default PortalMetodosPago;
