import type { ButtonHTMLAttributes, ReactElement } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = "primary", className = "", ...props }: ButtonProps): ReactElement {
  return <button className={`ui-button ui-button-${variant} ${className}`.trim()} {...props} />;
}
