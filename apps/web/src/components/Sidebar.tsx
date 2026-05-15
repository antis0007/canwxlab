import type { ReactNode } from "react";

interface SidebarProps {
  children: ReactNode;
}

export function Sidebar({ children }: SidebarProps) {
  return (
    <aside className="sidebar">
      <header className="brand-block">
        <span className="eyebrow">Open Canadian Weather Lab</span>
        <h1>CanWxLab</h1>
        <p>Live map spine, simulation sandbox, and forecast verification foundation.</p>
      </header>
      {children}
    </aside>
  );
}
