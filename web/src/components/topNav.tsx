'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/swarms/control', label: 'Swarms' },
  { href: '/roles/create', label: 'Roles' },
  { href: '/tasks/upload', label: 'Tasks' },
  { href: '/mcp', label: 'MCP Servers' },
] as const;

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="topNavWrap">
      <nav className="topNav" aria-label="Primary">
        <div className="topNavBrand">NeuralSwarm</div>
        <div className="topNavLinks">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link key={item.href} href={item.href} className={`topNavLink${active ? ' isActive' : ''}`}>
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
