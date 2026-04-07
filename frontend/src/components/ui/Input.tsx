import type { InputHTMLAttributes, ReactElement } from "react";

export function Input(props: InputHTMLAttributes<HTMLInputElement>): ReactElement {
  return <input className="ui-input" {...props} />;
}
