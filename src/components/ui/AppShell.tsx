'use client';
// Moldura das páginas do sistema: cabeçalho fixo com marca, navegação, "Novo vídeo"
// e menu da conta. O editor usa a tela inteira e tem a própria barra.
import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {Icon, Logo, type IconName} from './Icon';

const NAV: {href: string; label: string; icon: IconName; match: (p: string) => boolean}[] = [
  {href: '/', label: 'Projetos', icon: 'grid', match: (p) => p === '/' || (p.startsWith('/projects') && p !== '/projects/new')},
  {href: '/styles', label: 'Estilos', icon: 'palette', match: (p) => p.startsWith('/styles')},
  {href: '/settings', label: 'Configurações', icon: 'settings', match: (p) => p.startsWith('/settings')},
];

export const logout = async () => {
  await fetch('/api/auth/logout', {method: 'POST'}).catch(() => undefined);
  window.location.href = '/login';
};

export function AppShell({children, wide = false}: {children: React.ReactNode; wide?: boolean}) {
  const path = usePathname() ?? '/';
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-xl">
        <div className={`mx-auto flex h-14 items-center gap-2 px-4 sm:gap-4 ${wide ? 'max-w-[1600px]' : 'max-w-7xl'}`}>
          <Link href="/" className="mr-2 flex items-center gap-2.5">
            <Logo />
            <span className="hidden text-[15px] font-extrabold tracking-tight sm:inline">
              Editor de Vídeo <span className="text-brand">IA</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((n) => {
              const on = n.match(path);
              return (
                <Link key={n.href} href={n.href} className={on ? 'tab-on' : 'tab'} aria-current={on ? 'page' : undefined} title={n.label}>
                  <Icon name={n.icon} />
                  <span className="hidden md:inline">{n.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {path !== '/projects/new' && (
              <Link href="/projects/new" className="btn-primary">
                <Icon name="plus" />
                <span className="hidden sm:inline">Novo vídeo</span>
              </Link>
            )}
            <AccountMenu />
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function AccountMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-panel2 text-muted transition hover:border-line2 hover:text-text" onClick={() => setOpen(!open)} aria-label="Conta" aria-expanded={open}>
        <Icon name="user" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 animate-fade-in overflow-hidden rounded-xl border border-line bg-panel2 p-1 shadow-pop">
          <div className="px-3 py-2 text-xs text-muted">Conta</div>
          <MenuLink href="/settings" icon="settings" label="Configurações" />
          <MenuLink href="/styles" icon="palette" label="Meus estilos" />
          <div className="my-1 border-t border-line" />
          <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-red-300 hover:bg-panel3" onClick={logout}>
            <Icon name="logout" /> Sair
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({href, icon, label}: {href: string; icon: IconName; label: string}) {
  return (
    <Link href={href} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-panel3">
      <Icon name={icon} className="text-muted" /> {label}
    </Link>
  );
}

/** título de página com trilha (breadcrumb) e ações à direita */
export function PageHeader({title, subtitle, crumbs, actions}: {title: React.ReactNode; subtitle?: React.ReactNode; crumbs?: {href: string; label: string}[]; actions?: React.ReactNode}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav className="mb-2 flex items-center gap-1 text-xs text-muted">
            {crumbs.map((c) => (
              <span key={c.href} className="flex items-center gap-1">
                <Link href={c.href} className="hover:text-text">
                  {c.label}
                </Link>
                <Icon name="chevronRight" size={12} />
              </span>
            ))}
          </nav>
        )}
        <h1 className="truncate text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Page({children, narrow = false}: {children: React.ReactNode; narrow?: boolean}) {
  return <main className={`mx-auto w-full px-4 py-8 sm:py-10 ${narrow ? 'max-w-4xl' : 'max-w-7xl'}`}>{children}</main>;
}
