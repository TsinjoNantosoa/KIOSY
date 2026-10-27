import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  BookOpen,
  Bot,
  ClipboardCheck,
  CreditCard,
  FileClock,
  FileUp,
  Home,
  KeyRound,
  LayoutDashboard,
  LibraryBig,
  LifeBuoy,
  Menu,
  MessagesSquare,
  Newspaper,
  Receipt,
  ScrollText,
  Tags,
  User,
} from "lucide-react";
import { brand } from "@/config/app";
import { cn } from "@/lib/cn";
import { t } from "@/locales";
import { Sheet } from "@/components/ui/Dialog";
import { Button, ButtonLink } from "@/components/ui/Button";
import { beginLogout, endLogout } from "@/features/auth/guards";
import { hasAnyRole, STAFF_ROLES, useLogout, useSession } from "@/features/auth/session";
import { AssistantLauncher } from "@/features/assistant/AssistantLauncher";
import { DemoBarSlot } from "@/features/demo/DemoBarSlot";
import { SESSION_EXPIRED_EVENT } from "@/services/queryClient";
import type { Role } from "@/contracts/models";

function SkipLink() {
  return (
    <a href="#contenu" className="sr-only z-[70] rounded-md bg-surface px-4 py-2 font-medium focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
      {t.common.skipToContent}
    </a>
  );
}

/** Redirige vers la connexion quand le serveur signale une session expirée (401). */
function SessionExpiryListener() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const onExpired = () => {
      const retour = `${location.pathname}${location.search}`;
      navigate(`/connexion?raison=session-expiree&retour=${encodeURIComponent(retour)}`, { replace: true });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [navigate, location.pathname, location.search]);
  return null;
}

/** Déplace le focus vers le contenu à chaque navigation (annonce du changement de page). */
function RouteFocus() {
  const location = useLocation();
  const first = useRef(true);
  useEffect(() => {
    endLogout();
    // Premier chargement : le focus reste au début du document (lien d'évitement en premier).
    if (first.current) {
      first.current = false;
      return;
    }
    if (location.hash) return;
    const main = document.getElementById("contenu");
    main?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [location.pathname, location.hash]);
  return null;
}

export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 rounded-md" aria-label={`${brand.name}, accueil`}>
      <span className="grid h-8 w-8 place-items-center rounded-md bg-brand font-serif text-lg font-bold text-white" aria-hidden>
        {brand.name.charAt(0)}
      </span>
      <span className="font-serif text-xl font-semibold tracking-tight">{brand.name}</span>
    </Link>
  );
}

const publicLinks = [
  { to: "/catalogue", label: t.nav.catalog },
  { to: "/offres", label: t.nav.offers },
  { to: "/aide", label: t.nav.help },
];

function AccountActions({ onNavigate, stacked = false }: { onNavigate?: () => void; stacked?: boolean }) {
  const { user, status } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  if (status === "loading") return <span className="h-11 w-24" aria-hidden />;
  if (logout.isError) {
    return (
      <div className={cn("flex items-center gap-2 text-sm", stacked && "flex-col items-stretch")} role="alert">
        <span>Les données locales sont effacées, mais la session serveur peut rester active.</span>
        <Button variant="outline" size="sm" loading={logout.isPending} onClick={() => logout.mutate()}>Réessayer la révocation</Button>
      </div>
    );
  }
  if (status === "unavailable") return <span className="text-sm text-caution">Session invérifiable</span>;
  if (!user) {
    return (
      <div className={cn("flex gap-2", stacked && "flex-col")}>
        <ButtonLink to="/connexion" variant="outline" onClick={onNavigate}>
          {t.nav.login}
        </ButtonLink>
        {stacked && (
          <ButtonLink to="/inscription" onClick={onNavigate}>
            {t.nav.register}
          </ButtonLink>
        )}
      </div>
    );
  }
  return (
    <div className={cn("flex items-center gap-2", stacked && "flex-col items-stretch")}>
      {hasAnyRole(user, STAFF_ROLES) && (
        <ButtonLink to="/admin" variant="ghost" onClick={onNavigate}>
          {t.nav.admin}
        </ButtonLink>
      )}
      {hasAnyRole(user, ["publisher"]) && (
        <ButtonLink to="/publisher" variant="ghost" onClick={onNavigate}>Espace éditeur</ButtonLink>
      )}
      <ButtonLink to="/compte" variant="outline" onClick={onNavigate} icon={<User className="h-4 w-4" aria-hidden />}>
        <span className="max-w-[10rem] truncate">{t.nav.account}</span>
      </ButtonLink>
      <Button
        variant="ghost"
        loading={logout.isPending}
        onClick={() => {
          // Redirection d'abord : sinon la garde de route renverrait vers /connexion.
          beginLogout();
          onNavigate?.();
          navigate("/", { replace: true });
          logout.mutate();
        }}
      >
        {t.nav.logout}
      </Button>
    </div>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85">
      <div className="container flex h-16 items-center gap-4">
        <Logo />
        <nav aria-label={t.nav.mainNav} className="ml-6 hidden items-center gap-1 lg:flex">
          {publicLinks.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => cn("rounded-md px-3 py-2 text-[0.95rem] font-medium text-ink-muted hover:bg-sunken hover:text-ink", isActive && "text-ink underline decoration-brand decoration-2 underline-offset-8")}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto hidden lg:block">
          <AccountActions />
        </div>
        <Button variant="ghost" className="ml-auto lg:hidden" aria-label={t.nav.menu} aria-expanded={open} onClick={() => setOpen(true)} icon={<Menu className="h-5 w-5" aria-hidden />}>
          <span className="sr-only sm:not-sr-only">{t.nav.menu}</span>
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen} title={brand.name} side="left" width="max-w-xs">
        <nav aria-label={t.nav.mainNav} className="flex flex-col gap-1 p-4">
          <NavLink to="/" end className="rounded-md px-3 py-3 font-medium hover:bg-sunken">
            {t.nav.home}
          </NavLink>
          {publicLinks.map((l) => (
            <NavLink key={l.to} to={l.to} className="rounded-md px-3 py-3 font-medium hover:bg-sunken">
              {l.label}
            </NavLink>
          ))}
          <NavLink to="/kia" className="rounded-md px-3 py-3 font-medium hover:bg-sunken">
            Assistant {brand.assistantName}
          </NavLink>
        </nav>
        <div className="mt-auto border-t border-line p-4">
          <AccountActions stacked onNavigate={() => setOpen(false)} />
        </div>
      </Sheet>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-line bg-sunken/50">
      <div className="container grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <Logo />
          <p className="text-sm leading-6 text-ink-muted">{brand.tagline}</p>
        </div>
        <FooterColumn title="Découvrir" links={[["/catalogue", "Catalogue"], ["/offres", "Offres et abonnements"], ["/kia", `Assistant ${brand.assistantName}`]]} />
        <FooterColumn title="Aide" links={[["/aide", "Questions fréquentes"], ["/contact", "Contact et assistance"], ["/a-propos", "À propos"]]} />
        <FooterColumn
          title="Informations (provisoires)"
          links={[["/conditions/vente", "Conditions de vente"], ["/conditions/utilisation", "Conditions d'utilisation"], ["/confidentialite", "Confidentialité"]]}
        />
      </div>
      <p className="container pb-8 text-xs text-ink-subtle">
        {brand.name} et {brand.assistantName} sont des noms provisoires. Les textes contractuels affichés sont des brouillons à valider.
      </p>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h2 className="mb-3 font-sans text-sm font-semibold uppercase tracking-wider text-ink-muted">{title}</h2>
      <ul className="space-y-2">
        {links.map(([to, label]) => (
          <li key={to}>
            <Link to={to} className="text-sm text-ink hover:text-brand hover:underline">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PublicLayout() {
  const location = useLocation();
  const hideLauncher = location.pathname.startsWith("/kia");
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <DemoBarSlot />
      <Header />
      <main id="contenu" tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>
      <Footer />
      {!hideLauncher && <AssistantLauncher />}
      <SessionExpiryListener />
      <RouteFocus />
    </div>
  );
}

export function BareLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <DemoBarSlot compact />
      <main id="contenu" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        <Outlet />
      </main>
      <SessionExpiryListener />
    </div>
  );
}

const accountLinks = [
  { to: "/compte", label: "Tableau de bord", icon: LayoutDashboard, end: true },
  { to: "/compte/bibliotheque", label: t.nav.library, icon: LibraryBig },
  { to: "/compte/abonnements", label: t.nav.subscriptions, icon: Newspaper },
  { to: "/compte/commandes", label: t.nav.orders, icon: Receipt },
  { to: "/compte/assistance", label: t.nav.support, icon: LifeBuoy },
  { to: "/kia", label: t.nav.conversations, icon: MessagesSquare },
  { to: "/compte/profil", label: t.nav.profile, icon: User },
];

function SideNav({ label, links }: { label: string; links: { to: string; label: string; icon: typeof Home; end?: boolean }[] }) {
  return (
    <nav aria-label={label}>
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
        {links.map(({ to, label: text, icon: Icon, end }) => (
          <li key={to} className="shrink-0">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-ink-muted hover:bg-sunken hover:text-ink",
                  isActive && "bg-brand-soft text-brand-strong hover:bg-brand-soft",
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden />
              {text}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AccountLayout() {
  const { user } = useSession();
  return (
    <div className="container py-6 md:py-10">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-10">
        <aside className="min-w-0 md:sticky md:top-24 md:self-start">
          <p className="mb-3 hidden truncate text-sm text-ink-muted md:block">{user?.display_name}</p>
          <SideNav label={t.nav.accountNav} links={accountLinks} />
        </aside>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

const adminLinks: { to: string; label: string; icon: typeof Home; end?: boolean; roles: Role[] }[] = [
  { to: "/admin", label: "Tableau de bord", icon: BarChart3, end: true, roles: ["admin", "manager", "support"] },
  { to: "/admin/catalogue", label: "Catalogue", icon: BookOpen, roles: ["admin", "manager"] },
  { to: "/admin/revues", label: "Revue éditoriale", icon: ClipboardCheck, roles: ["admin", "manager"] },
  { to: "/admin/offres", label: "Offres", icon: Tags, roles: ["admin"] },
  { to: "/admin/imports", label: "Imports", icon: FileUp, roles: ["admin"] },
  { to: "/admin/commerce", label: "Commandes et abonnements", icon: CreditCard, roles: ["admin", "manager", "support"] },
  { to: "/admin/droits", label: "Droits d'accès", icon: KeyRound, roles: ["admin", "manager", "support"] },
  { to: "/admin/tickets", label: "Tickets", icon: LifeBuoy, roles: ["admin", "manager", "support"] },
  { to: "/admin/approbations", label: "Approbations", icon: ClipboardCheck, roles: ["admin", "manager", "support"] },
  { to: "/admin/audit", label: "Audit", icon: ScrollText, roles: ["admin", "manager"] },
  { to: "/admin/runs", label: "Diagnostic IA", icon: Bot, roles: ["admin"] },
];

export function AdminLayout() {
  const { user } = useSession();
  const links = adminLinks.filter((l) => hasAnyRole(user, l.roles));
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SkipLink />
      <DemoBarSlot />
      <header className="border-b border-line bg-surface">
        <div className="container flex h-14 items-center gap-3">
          <Logo to="/admin" />
          <span className="hidden rounded bg-ink px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white sm:inline">Administration</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm text-ink-muted sm:inline">
              {user?.display_name} · {user?.roles.map((r) => t.role[r]).join(", ")}
            </span>
            <ButtonLink to="/" variant="ghost" size="sm" icon={<FileClock className="h-4 w-4" aria-hidden />}>
              Site public
            </ButtonLink>
          </div>
        </div>
      </header>
      <div className="container grid flex-1 grid-cols-[minmax(0,1fr)] gap-6 py-6 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-8">
        <aside className="min-w-0 md:sticky md:top-6 md:self-start">
          <SideNav label={t.nav.adminNav} links={links} />
        </aside>
        <main id="contenu" tabIndex={-1} className="min-w-0 outline-none">
          <Outlet />
        </main>
      </div>
      <SessionExpiryListener />
      <RouteFocus />
    </div>
  );
}

const publisherLinks = [
  { to: "/publisher", label: "Tableau de bord", icon: BarChart3, end: true },
  { to: "/publisher/publications", label: "Publications", icon: BookOpen },
  { to: "/publisher/imports", label: "Imports", icon: FileUp },
  { to: "/publisher/reviews", label: "Demandes de correction", icon: ClipboardCheck },
];

export function PublisherLayout() {
  const { user } = useSession();
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SkipLink />
      <DemoBarSlot />
      <header className="border-b border-line bg-surface">
        <div className="container flex h-14 items-center gap-3">
          <Logo to="/publisher" />
          <span className="hidden rounded bg-brand px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white sm:inline">Espace éditeur</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm text-ink-muted sm:inline">{user?.display_name}</span>
            <ButtonLink to="/" variant="ghost" size="sm">Site public</ButtonLink>
          </div>
        </div>
      </header>
      <div className="container grid flex-1 grid-cols-[minmax(0,1fr)] gap-6 py-6 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-8">
        <aside className="min-w-0 md:sticky md:top-6 md:self-start">
          <SideNav label="Navigation éditeur" links={publisherLinks} />
        </aside>
        <main id="contenu" tabIndex={-1} className="min-w-0 outline-none"><Outlet /></main>
      </div>
      <SessionExpiryListener />
      <RouteFocus />
    </div>
  );
}
