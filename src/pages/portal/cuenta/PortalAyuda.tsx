import { useState } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  ChevronLeft,
  HelpCircle,
  Search,
  MessageCircle,
  Phone,
  Mail,
  ChevronRight,
  Package,
  CreditCard,
  Truck,
  ShieldQuestion
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const faqCategories = [
  {
    icon: Package,
    title: "Pedidos",
    questions: [
      "¿Cómo hago un pedido?",
      "¿Puedo modificar mi pedido?",
      "¿Cuál es el pedido mínimo?",
    ]
  },
  {
    icon: Truck,
    title: "Entregas",
    questions: [
      "¿Cuánto tarda la entrega?",
      "¿Cuál es el horario de entrega?",
      "¿Puedo programar mi entrega?",
    ]
  },
  {
    icon: CreditCard,
    title: "Pagos",
    questions: [
      "¿Qué métodos de pago aceptan?",
      "¿Cómo funciona el crédito?",
      "¿Cómo reporto un pago?",
    ]
  },
  {
    icon: ShieldQuestion,
    title: "Cuenta",
    questions: [
      "¿Cómo cambio mi contraseña?",
      "¿Cómo actualizo mis datos?",
      "¿Cómo elimino mi cuenta?",
    ]
  },
];

const PortalAyuda = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  return (
    <PortalMobileLayout showHeader={false} showNav={false}>
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 py-3 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold">Centro de Ayuda</h1>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="Buscar en ayuda..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Contact Options */}
        <div className="grid grid-cols-2 gap-3">
          <a href="https://wa.me/584141234567" target="_blank" rel="noopener noreferrer">
            <div className="bg-green-500 rounded-xl p-4 text-white text-center">
              <MessageCircle className="h-8 w-8 mx-auto mb-2" />
              <p className="font-medium">WhatsApp</p>
              <p className="text-xs opacity-90">Respuesta rápida</p>
            </div>
          </a>
          <a href="tel:+584141234567">
            <div className="bg-blue-500 rounded-xl p-4 text-white text-center">
              <Phone className="h-8 w-8 mx-auto mb-2" />
              <p className="font-medium">Llamar</p>
              <p className="text-xs opacity-90">Lun-Vie 8am-5pm</p>
            </div>
          </a>
        </div>

        {/* FAQ Categories */}
        <div className="space-y-3">
          <h3 className="font-semibold">Preguntas frecuentes</h3>
          
          {faqCategories.map((category) => {
            const Icon = category.icon;
            const isExpanded = expandedCategory === category.title;
            
            return (
              <div key={category.title} className="bg-card rounded-xl border border-border overflow-hidden">
                <button
                  onClick={() => setExpandedCategory(isExpanded ? null : category.title)}
                  className="w-full p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <span className="font-medium">{category.title}</span>
                  </div>
                  <ChevronRight className={`h-5 w-5 text-muted-foreground transition-transform ${
                    isExpanded ? "rotate-90" : ""
                  }`} />
                </button>
                
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-2">
                    {category.questions.map((question, idx) => (
                      <button
                        key={idx}
                        className="w-full text-left p-3 rounded-lg bg-muted text-sm hover:bg-muted/80 transition-colors"
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Email Support */}
        <div className="bg-muted rounded-xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Soporte por email</span>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            ¿No encontraste lo que buscabas? Escríbenos y te responderemos en menos de 24 horas.
          </p>
          <a href="mailto:soporte@guds.com">
            <Button variant="outline" className="w-full">
              Enviar email
            </Button>
          </a>
        </div>
      </div>
    </PortalMobileLayout>
  );
};

export default PortalAyuda;
