import { forwardRef, type ButtonHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/** Botón de la cuenta (avatar) del header de escritorio del portal: el mismo antes y después de cargar el menú. */
export const BotonCuenta = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>((props, ref) => {
  const { user } = useAuth();
  const ini = `${user?.nombre?.charAt(0) ?? ""}${user?.apellido?.charAt(0) ?? ""}`.toUpperCase() || "U";
  return (
    <button ref={ref} type="button" className="flex h-9 items-center gap-1.5 rounded-md pl-1 pr-1.5 hover:bg-muted" aria-label="Menú de la cuenta" {...props}>
      <Avatar className="h-7 w-7">
        <AvatarImage src={user?.avatar} alt="" />
        <AvatarFallback className="bg-muted text-[11px] font-semibold text-foreground">{ini}</AvatarFallback>
      </Avatar>
      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
    </button>
  );
});
BotonCuenta.displayName = "BotonCuenta";
