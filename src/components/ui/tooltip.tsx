import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

// El proveedor ya no envuelve toda la app (así Radix Tooltip y su motor de posicionamiento no pesan en el arranque de
// los portales): lo ponen los layouts que usan tooltips (MainLayout, Sidebar) para compartir los retardos entre ellos,
// y un Tooltip fuera de cualquier proveedor crea el suyo en vez de fallar.
const HayProveedor = React.createContext(false);

const TooltipProvider = ({ children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) => (
  <TooltipPrimitive.Provider {...props}>
    <HayProveedor.Provider value={true}>{children}</HayProveedor.Provider>
  </TooltipPrimitive.Provider>
);

const Tooltip = (props: React.ComponentProps<typeof TooltipPrimitive.Root>) => {
  const hayProveedor = React.useContext(HayProveedor);
  const raiz = <TooltipPrimitive.Root {...props} />;
  return hayProveedor ? raiz : <TooltipPrimitive.Provider>{raiz}</TooltipPrimitive.Provider>;
};

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
