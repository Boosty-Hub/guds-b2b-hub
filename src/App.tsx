import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Ordenes from "./pages/Ordenes";
import Clientes from "./pages/Clientes";
import Productos from "./pages/Productos";
import Inventario from "./pages/Inventario";
import Precios from "./pages/Precios";
import Cuentas from "./pages/Cuentas";
import Configuracion from "./pages/Configuracion";
import NotFound from "./pages/NotFound";

// Portal de Cliente
import PortalDashboard from "./pages/portal/PortalDashboard";
import PortalCatalogo from "./pages/portal/PortalCatalogo";
import PortalPedidos from "./pages/portal/PortalPedidos";
import PortalPagos from "./pages/portal/PortalPagos";
import PortalCuenta from "./pages/portal/PortalCuenta";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Admin Dashboard */}
          <Route path="/" element={<Index />} />
          <Route path="/ordenes" element={<Ordenes />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/productos" element={<Productos />} />
          <Route path="/inventario" element={<Inventario />} />
          <Route path="/precios" element={<Precios />} />
          <Route path="/cuentas" element={<Cuentas />} />
          <Route path="/configuracion" element={<Configuracion />} />
          
          {/* Portal de Cliente */}
          <Route path="/portal" element={<PortalDashboard />} />
          <Route path="/portal/catalogo" element={<PortalCatalogo />} />
          <Route path="/portal/pedidos" element={<PortalPedidos />} />
          <Route path="/portal/pagos" element={<PortalPagos />} />
          <Route path="/portal/cuenta" element={<PortalCuenta />} />
          
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
