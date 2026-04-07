import type { PropsWithChildren, ReactElement } from "react";

export function Table({ children }: PropsWithChildren): ReactElement {
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">{children}</table>
    </div>
  );
}
