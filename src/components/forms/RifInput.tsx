import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const LETRAS_RIF = ["J", "G", "V", "E", "P"] as const;

interface RifInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Compone un RIF venezolano (letra-8 dígitos-dígito verificador) a partir de
 * un select de letra y un input numérico, y lo expone como un solo string
 * "J-12345678-9" para no requerir columnas nuevas en la DB.
 */
export function parseRif(rif: string): { letra: string; numero: string } {
  // Acepta tanto la forma parcial ("J-123456") como la final ya compuesta con
  // el dígito verificador ("J-12345678-9"): se le quitan todos los guiones y
  // se toman solo los dígitos, sin importar cuántos segmentos tenga.
  const match = /^([JGVEP])-?(.*)$/i.exec(rif.trim());
  if (!match) return { letra: "J", numero: "" };
  const numero = match[2].replace(/\D/g, "").slice(0, 9);
  return { letra: match[1].toUpperCase(), numero };
}

export function isValidRif(rif: string): boolean {
  return /^[JGVEP]-\d{8}-\d$/.test(rif.trim());
}

export function RifInput({ value, onChange, disabled }: RifInputProps) {
  const { letra, numero } = parseRif(value);

  const compose = (nextLetra: string, nextNumero: string) => {
    const digits = nextNumero.replace(/\D/g, "").slice(0, 9);
    if (digits.length < 9) {
      onChange(digits ? `${nextLetra}-${digits}` : "");
      return;
    }
    onChange(`${nextLetra}-${digits.slice(0, 8)}-${digits.slice(8, 9)}`);
  };

  return (
    <div className="flex gap-2">
      <Select
        value={letra}
        onValueChange={(l) => compose(l, numero)}
        disabled={disabled}
      >
        <SelectTrigger className="w-20 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LETRAS_RIF.map((l) => (
            <SelectItem key={l} value={l}>{l}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        inputMode="numeric"
        placeholder="12345678-9"
        value={numero}
        disabled={disabled}
        onChange={(e) => compose(letra, e.target.value)}
      />
    </div>
  );
}
