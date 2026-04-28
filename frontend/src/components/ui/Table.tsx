import type { HTMLAttributes, PropsWithChildren, ReactElement } from "react";

type TableProps = PropsWithChildren<{
  className?: HTMLAttributes<HTMLTableElement>["className"];
}>;

export function Table({ children, className }: TableProps): ReactElement {
  return (
    <div className="ui-table-wrap">
      <table className={className ? `ui-table ${className}` : "ui-table"}>{children}</table>
    </div>
  );
}
