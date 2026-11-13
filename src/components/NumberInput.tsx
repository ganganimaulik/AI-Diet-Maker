'use client';
import { FocusEvent, InputHTMLAttributes, useRef, useState } from 'react';

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'defaultValue' | 'onChange'
>;

interface NumberInputProps extends NativeInputProps {
  value: number;
  onValueChange: (value: number) => void;
  /** Whole numbers only; a decimal typed in is cut down to its whole part. */
  integer?: boolean;
}

function toText(value: number): string {
  return Number.isFinite(value) ? String(value) : '';
}

function bound(limit: NativeInputProps['min']): number | null {
  if (limit === undefined || limit === '') return null;
  const n = Number(limit);
  return Number.isFinite(n) ? n : null;
}

// A number field that can be emptied while you type. What is in the box is
// kept as text, and only a complete number inside min/max is passed up, so
// clearing the box never snaps it back to 0 before the next digit lands.
// Leaving the box empty or out of range puts back the number it held when you
// tapped into it, not a digit that passed through while you were deleting.
export default function NumberInput({
  value,
  onValueChange,
  integer = false,
  min,
  max,
  onFocus,
  onBlur,
  inputMode,
  ...rest
}: NumberInputProps) {
  const [text, setText] = useState(() => toText(value));
  const [lastValue, setLastValue] = useState(value);
  const valueOnFocus = useRef<number | null>(null);

  const lower = bound(min);
  const upper = bound(max);

  const parse = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const result = integer ? Math.trunc(n) : n;
    if (lower !== null && result < lower) return null;
    if (upper !== null && result > upper) return null;
    return result;
  };

  // The number changed from outside (undo, an applied proposal, a reload):
  // show it, unless the box already reads as that number.
  if (!Object.is(value, lastValue)) {
    setLastValue(value);
    if (parse(text) !== value) setText(toText(value));
  }

  const handleFocus = (e: FocusEvent<HTMLInputElement>) => {
    valueOnFocus.current = value;
    onFocus?.(e);
  };

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    const typed = parse(text);
    if (typed === null) {
      const original = valueOnFocus.current ?? value;
      setText(toText(original));
      if (original !== value) onValueChange(original);
    } else if (typed !== value) {
      setText(toText(value));
    }
    valueOnFocus.current = null;
    onBlur?.(e);
  };

  return (
    <input
      {...rest}
      type="number"
      inputMode={inputMode ?? (integer ? 'numeric' : 'decimal')}
      min={min}
      max={max}
      value={text}
      onChange={e => {
        const raw = e.target.value;
        setText(raw);
        const parsed = parse(raw);
        if (parsed !== null && parsed !== value) onValueChange(parsed);
      }}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  );
}
