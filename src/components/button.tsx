import type { ButtonHTMLAttributes } from "react";

const base =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-foreground px-4 py-2 text-base font-medium text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-60";

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`${base} ${className}`} {...props} />;
}
