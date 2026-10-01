import { Navigate, useParams } from "react-router-dom";

// "Contactos y acceso al portal" del cliente (18l) quedó unificado en la pestaña Contactos de su ficha y en el módulo
// Contactos (20v): contactos, acceso al portal, empresas del portal y otros usuarios del portal. Los enlaces viejos
// (/admin/clientes/:id/usuarios) llevan a esa pestaña.
const ClienteUsuarios = () => {
  const { clienteId } = useParams<{ clienteId: string }>();
  return <Navigate to={`/admin/clientes/${clienteId}?tab=contactos`} replace />;
};

export default ClienteUsuarios;
