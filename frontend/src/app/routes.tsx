import { lazy, Suspense, type ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { isDemo } from "@/config/app";
import { LoadingBlock } from "@/components/ui/Feedback";
import { RequireAuth, RequireRole } from "@/features/auth/guards";
import { STAFF_ROLES } from "@/features/auth/session";
import { NotFoundPage } from "@/features/public/StatusPages";
import { HomePage } from "@/features/public/HomePage";
import { ErrorBoundary } from "./ErrorBoundary";
import { AccountLayout, AdminLayout, BareLayout, PublicLayout } from "./layouts";

// Routes secondaires chargées à la demande.
const CatalogPage = lazy(() => import("@/features/catalog/CatalogPage"));
const PublicationPage = lazy(() => import("@/features/catalog/PublicationPage"));
const OffersPage = lazy(() => import("@/features/offers/OffersPage"));
const InfoPages = lazy(() => import("@/features/public/InfoPages"));
const LegalPage = lazy(() => import("@/features/public/LegalPage"));
const LoginPage = lazy(() => import("@/features/auth/LoginPage"));
const RegisterPage = lazy(() => import("@/features/auth/RegisterPage"));
const ForgotPasswordPage = lazy(() => import("@/features/auth/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("@/features/auth/ResetPasswordPage"));
const CheckoutPage = lazy(() => import("@/features/checkout/CheckoutPage"));
const OrderPaymentPage = lazy(() => import("@/features/checkout/OrderPaymentPage"));
const PaymentReturnPage = lazy(() => import("@/features/checkout/PaymentReturnPage"));
// Page du prestataire simulé : absente du build en mode api (la comparaison est résolue à la compilation).
const TestProviderPage = import.meta.env.VITE_APP_MODE === "api" ? null : lazy(() => import("@/features/checkout/TestProviderPage"));
const ReaderPage = lazy(() => import("@/features/library/ReaderPage"));
const DashboardPage = lazy(() => import("@/features/account/DashboardPage"));
const LibraryPage = lazy(() => import("@/features/library/LibraryPage"));
const SubscriptionsPage = lazy(() => import("@/features/subscriptions/SubscriptionsPage"));
const SubscriptionDetailPage = lazy(() => import("@/features/subscriptions/SubscriptionDetailPage"));
const OrdersPage = lazy(() => import("@/features/orders/OrdersPage"));
const OrderDetailPage = lazy(() => import("@/features/orders/OrderDetailPage"));
const SupportListPage = lazy(() => import("@/features/support/SupportListPage"));
const SupportNewPage = lazy(() => import("@/features/support/SupportNewPage"));
const SupportDetailPage = lazy(() => import("@/features/support/SupportDetailPage"));
const ProfilePage = lazy(() => import("@/features/account/ProfilePage"));
const AssistantPage = lazy(() => import("@/features/assistant/AssistantPage"));
const AdminDashboard = lazy(() => import("@/features/administration/AdminDashboard"));
const AdminCatalog = lazy(() => import("@/features/administration/AdminCatalog"));
const AdminEditionPage = lazy(() => import("@/features/administration/AdminEditionPage"));
const AdminNewPublication = lazy(() => import("@/features/administration/AdminNewPublication"));
const AdminNewEdition = lazy(() => import("@/features/administration/AdminNewEdition"));
const AdminOffers = lazy(() => import("@/features/administration/AdminOffers"));
const AdminNewOffer = lazy(() => import("@/features/administration/AdminNewOffer"));
const AdminOfferPage = lazy(() => import("@/features/administration/AdminOfferPage"));
const AdminImports = lazy(() => import("@/features/administration/AdminImports"));
const AdminCommerce = lazy(() => import("@/features/administration/AdminCommerce"));
const AdminEntitlements = lazy(() => import("@/features/administration/AdminEntitlements"));
const AdminTickets = lazy(() => import("@/features/administration/AdminTickets"));
const AdminTicketPage = lazy(() => import("@/features/administration/AdminTicketPage"));
const AdminApprovals = lazy(() => import("@/features/administration/AdminApprovals"));
const AdminAudit = lazy(() => import("@/features/administration/AdminAudit"));
const AdminRuns = lazy(() => import("@/features/administration/AdminRuns"));
const AdminRunPage = lazy(() => import("@/features/administration/AdminRunPage"));

function Page({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary inline>
      <Suspense
        fallback={
          <div className="container py-10">
            <LoadingBlock />
          </div>
        }
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

const auth = (node: ReactNode) => (
  <Page>
    <RequireAuth>{node}</RequireAuth>
  </Page>
);
const adminOnly = (node: ReactNode) => <RequireRole roles={["admin"]}>{node}</RequireRole>;

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<HomePage />} />
        <Route path="catalogue" element={<Page><CatalogPage /></Page>} />
        <Route path="publications/:idOrSlug" element={<Page><PublicationPage /></Page>} />
        <Route path="offres" element={<Page><OffersPage /></Page>} />
        <Route path="aide" element={<Page><InfoPages page="help" /></Page>} />
        <Route path="a-propos" element={<Page><InfoPages page="about" /></Page>} />
        <Route path="contact" element={<Page><InfoPages page="contact" /></Page>} />
        <Route path="conditions/:slug" element={<Page><LegalPage /></Page>} />
        <Route path="confidentialite" element={<Page><LegalPage slug="confidentialite" /></Page>} />
        <Route path="connexion" element={<Page><LoginPage /></Page>} />
        <Route path="inscription" element={<Page><RegisterPage /></Page>} />
        <Route path="mot-de-passe-oublie" element={<Page><ForgotPasswordPage /></Page>} />
        <Route path="reinitialiser" element={<Page><ResetPasswordPage /></Page>} />
        <Route path="commande" element={auth(<CheckoutPage />)} />
        <Route path="commande/:orderId" element={auth(<OrderPaymentPage />)} />
        <Route path="commande/:orderId/retour" element={auth(<PaymentReturnPage />)} />
        <Route path="kia" element={<Page><AssistantPage /></Page>} />
        <Route path="kia/:conversationId" element={<Page><AssistantPage /></Page>} />
        <Route path="compte" element={<RequireAuth><AccountLayout /></RequireAuth>}>
          <Route index element={<Page><DashboardPage /></Page>} />
          <Route path="bibliotheque" element={<Page><LibraryPage /></Page>} />
          <Route path="abonnements" element={<Page><SubscriptionsPage /></Page>} />
          <Route path="abonnements/:subscriptionId" element={<Page><SubscriptionDetailPage /></Page>} />
          <Route path="commandes" element={<Page><OrdersPage /></Page>} />
          <Route path="commandes/:orderId" element={<Page><OrderDetailPage /></Page>} />
          <Route path="assistance" element={<Page><SupportListPage /></Page>} />
          <Route path="assistance/nouvelle" element={<Page><SupportNewPage /></Page>} />
          <Route path="assistance/:caseId" element={<Page><SupportDetailPage /></Page>} />
          <Route path="profil" element={<Page><ProfilePage /></Page>} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route element={<BareLayout />}>
        <Route path="lire/:editionId" element={<Page><ReaderPage /></Page>} />
        {isDemo && TestProviderPage && <Route path="paiement-test/:sessionId" element={auth(<TestProviderPage />)} />}
      </Route>

      <Route path="admin" element={<RequireRole roles={STAFF_ROLES}><AdminLayout /></RequireRole>}>
        <Route index element={<Page><AdminDashboard /></Page>} />
        <Route path="catalogue" element={adminOnly(<Page><AdminCatalog /></Page>)} />
        <Route path="catalogue/nouveau" element={adminOnly(<Page><AdminNewPublication /></Page>)} />
        <Route path="catalogue/nouvelle-edition" element={adminOnly(<Page><AdminNewEdition /></Page>)} />
        <Route path="catalogue/:editionId" element={adminOnly(<Page><AdminEditionPage /></Page>)} />
        <Route path="offres" element={adminOnly(<Page><AdminOffers /></Page>)} />
        <Route path="offres/nouvelle" element={adminOnly(<Page><AdminNewOffer /></Page>)} />
        <Route path="offres/:offerId" element={adminOnly(<Page><AdminOfferPage /></Page>)} />
        <Route path="imports" element={adminOnly(<Page><AdminImports /></Page>)} />
        <Route path="commerce" element={<Page><AdminCommerce /></Page>} />
        <Route path="droits" element={<Page><AdminEntitlements /></Page>} />
        <Route path="tickets" element={<Page><AdminTickets /></Page>} />
        <Route path="tickets/:caseId" element={<Page><AdminTicketPage /></Page>} />
        <Route path="approbations" element={<Page><AdminApprovals /></Page>} />
        <Route path="audit" element={<Page><AdminAudit /></Page>} />
        <Route path="runs" element={<Page><AdminRuns /></Page>} />
        <Route path="runs/:runId" element={<Page><AdminRunPage /></Page>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
