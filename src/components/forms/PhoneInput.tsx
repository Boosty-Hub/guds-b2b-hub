import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Solo prefijos de teléfonos móviles (se quitaron los locales)
const PREFIJOS = ["0412", "0414", "0416", "0422", "0424", "0426"];

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function parsePhone(telefono: string): { prefijo: string; numero: string } {
  const match = /^(0\d{3})-?(\d{0,7})$/.exec(telefono.trim());
  if (!match) return { prefijo: "0412", numero: "" };
  return { prefijo: match[1], numero: match[2] };
}

export function isValidPhone(telefono: string): boolean {
  return /^0\d{3}-\d{7}$/.test(telefono.trim());
}

export function PhoneInput({ value, onChange, disabled }: PhoneInputProps) {
  const { prefijo, numero } = parsePhone(value);

  const compose = (nextPrefijo: string, nextNumero: string) => {
    const digits = nextNumero.replace(/\D/g, "").slice(0, 7);
    onChange(digits ? `${nextPrefijo}-${digits}` : "");
  };

  return (
    <div className="flex gap-2">
      <Select
        value={prefijo}
        onValueChange={(p) => compose(p, numero)}
        disabled={disabled}
      >
        <SelectTrigger className="w-24 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PREFIJOS.map((p) => (
            <SelectItem key={p} value={p}>{p}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        inputMode="numeric"
        placeholder="1234567"
        value={numero}
        disabled={disabled}
        onChange={(e) => compose(prefijo, e.target.value)}
      />
    </div>
  );
}
