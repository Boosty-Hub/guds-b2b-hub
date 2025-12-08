import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

export const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
  const { user, isAuthenticated, loading } = useAuth();
  const location = useLocation();

  // Mostrar loader mientras se verifica la autenticación
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Verificando sesión...</p>
        </div>
      </div>
    );
  }

  // Si no está autenticado, redirigir al login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Si hay roles permitidos definidos, verificar que el usuario tenga uno de ellos
  if (allowedRoles && allowedRoles.length > 0) {
    if (!user || !allowedRoles.includes(user.role)) {
      // Redirigir al dashboard correspondiente según el rol del usuario
      const redirectPath = getRedirectPath(user?.role);
      return <Navigate to={redirectPath} replace />;
    }
  }

  return <>{children}</>;
};

// Función auxiliar para obtener la ruta de redirección según el rol
function getRedirectPath(role?: string): string {
  switch (role) {
    case "admin":
      return "/admin/dashboard";
    case "vendedor":
      return "/vendedor";
    case "delivery":
      return "/delivery";
    case "cliente":
      return "/portal";
    default:
      return "/login";
  }
}
