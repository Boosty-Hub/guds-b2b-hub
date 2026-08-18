import { createContext, useContext, useState, ReactNode } from "react";

interface ControlTowerContextType {
  open: boolean;
  toggle: () => void;
  close: () => void;
  collapsed: boolean;
  toggleCollapsed: () => void;
}

const ControlTowerContext = createContext<ControlTowerContextType | undefined>(undefined);

const COLLAPSE_KEY = "guds-torre-collapsed";

export const ControlTowerProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");

  const toggle = () => setOpen((v) => !v);
  const close = () => setOpen(false);
  const toggleCollapsed = () =>
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });

  return (
    <ControlTowerContext.Provider value={{ open, toggle, close, collapsed, toggleCollapsed }}>
      {children}
    </ControlTowerContext.Provider>
  );
};

export const useControlTower = () => {
  const ctx = useContext(ControlTowerContext);
  if (ctx === undefined) throw new Error("useControlTower must be used within a ControlTowerProvider");
  return ctx;
};
