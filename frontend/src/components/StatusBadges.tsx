import type {
  EditorialStatus,
  Entitlement,
  ImportStatus,
  OrderStatus,
  PaymentStatus,
  ProposalStatus,
  RunStatus,
  SubscriptionStatus,
  SupportStatus,
} from "@/contracts/models";
import { t } from "@/locales";
import { Badge, type BadgeTone } from "./ui/Badge";

const orderTone: Record<OrderStatus, BadgeTone> = {
  created: "neutral",
  pending_payment: "warning",
  paid: "info",
  fulfilled: "success",
  cancelled: "neutral",
  payment_exception: "danger",
};
const paymentTone: Record<PaymentStatus, BadgeTone> = {
  initiated: "neutral",
  pending: "warning",
  succeeded: "success",
  failed: "danger",
  cancelled: "neutral",
  refund_pending: "warning",
  refunded: "info",
};
const subTone: Record<SubscriptionStatus, BadgeTone> = {
  pending_payment: "warning",
  active: "success",
  cancel_at_period_end: "warning",
  past_due: "danger",
  expired: "neutral",
  suspended: "danger",
};
const editorialTone: Record<EditorialStatus, BadgeTone> = { draft: "neutral", review: "warning", published: "success", suspended: "danger", archived: "neutral" };
const proposalTone: Record<ProposalStatus, BadgeTone> = { pending: "warning", confirmed: "success", rejected: "neutral", expired: "neutral", superseded: "neutral", failed: "danger" };
const runTone: Record<RunStatus, BadgeTone> = { queued: "neutral", running: "info", waiting_user: "warning", waiting_approval: "warning", completed: "success", failed: "danger", cancelled: "neutral" };
const supportTone: Record<SupportStatus, BadgeTone> = { open: "info", in_progress: "info", waiting_reader: "warning", resolved: "success", closed: "neutral" };
const importTone: Record<ImportStatus, BadgeTone> = { uploaded: "neutral", quarantined: "info", validating: "info", extracting: "info", indexing: "info", ready: "success", failed: "danger" };

export const OrderStatusBadge = ({ status }: { status: OrderStatus }) => <Badge tone={orderTone[status]}>{t.orderStatus[status]}</Badge>;
export const PaymentStatusBadge = ({ status }: { status: PaymentStatus }) => <Badge tone={paymentTone[status]}>{t.paymentStatus[status]}</Badge>;
export const SubscriptionStatusBadge = ({ status }: { status: SubscriptionStatus }) => <Badge tone={subTone[status]}>{t.subscriptionStatus[status]}</Badge>;
export const EditorialStatusBadge = ({ status }: { status: EditorialStatus }) => <Badge tone={editorialTone[status]}>{t.editorialStatus[status]}</Badge>;
export const ProposalStatusBadge = ({ status }: { status: ProposalStatus }) => <Badge tone={proposalTone[status]}>{t.proposalStatus[status]}</Badge>;
export const RunStatusBadge = ({ status }: { status: RunStatus }) => <Badge tone={runTone[status]}>{t.runStatus[status]}</Badge>;
export const SupportStatusBadge = ({ status }: { status: SupportStatus }) => <Badge tone={supportTone[status]}>{t.supportStatus[status]}</Badge>;
export const ImportStatusBadge = ({ status }: { status: ImportStatus }) => <Badge tone={importTone[status]}>{t.importStatus[status]}</Badge>;

export function EntitlementBadge({ entitlement }: { entitlement: Entitlement }) {
  const active = entitlement.status === "active" && (!entitlement.valid_until || Date.parse(entitlement.valid_until) > Date.now());
  if (active) return <Badge tone="success">Accès actif</Badge>;
  if (entitlement.status === "expired" || !active) return <Badge tone="neutral">Accès expiré</Badge>;
  return <Badge tone="danger">Accès {entitlement.status === "revoked" ? "révoqué" : "suspendu"}</Badge>;
}
