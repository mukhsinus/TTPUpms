import type { PropsWithChildren, ReactElement } from "react";

interface CardProps extends PropsWithChildren {
  title?: string;
  subtitle?: string;
  className?: string;
}

export function Card({ title, subtitle, className = "", children }: CardProps): ReactElement {
  return (
    <section className={`ui-card ${className}`.trim()}>
      {title ? <h3 className="ui-card-title">{title}</h3> : null}
      {subtitle ? <p className="ui-card-subtitle">{subtitle}</p> : null}
      {children}
    </section>
  );
}
