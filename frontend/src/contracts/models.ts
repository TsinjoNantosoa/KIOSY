/**
 * Contrats de données partagés entre l'interface et les adaptateurs (démo / HTTP).
 *
 * Ils reprennent les entités de la section 16 du cahier des charges. Tant que le backend
 * ne publie pas son OpenAPI, ces types sont une PROPOSITION : ils seront remplacés par
 * des types générés (API01). Les champs sont en snake_case comme l'API FastAPI attendue.
 */

/** Date ISO 8601 en UTC, fournie par le serveur. L'affichage applique le fuseau choisi (OFF05). */
export type ISODateTime = string;

export type Universe = "presse" | "business" | "culture";
export type Language = "fr" | "mg" | "en";
export type ContentFormat = "text" | "pdf";
export type Role = "reader" | "publisher" | "support" | "manager" | "admin";

/**
 * Montant entier : `amount` exprimé en 10^-scale unités de `currency`.
 * Ex. MGA avec scale 0 : amount = 15000 signifie 15 000 Ar. Aucun flottant (DATA01).
 */
export interface Money {
  amount: number;
  currency: string;
  scale: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

// ---------------------------------------------------------------- Identité

export interface UserPreferences {
  time_zone: string;
  language: Language;
}

export interface User {
  id: string;
  email: string;
  display_name: string;
  roles: Role[];
  publisher_id: string | null;
  preferences: UserPreferences;
  is_demo: boolean;
}

export interface Session {
  user: User;
  expires_at: ISODateTime;
}

export interface ActiveSession {
  id: string;
  device_label: string;
  created_at: ISODateTime;
  last_seen_at: ISODateTime;
  current: boolean;
}

export interface Publisher {
  id: string;
  name: string;
  is_demo: boolean;
}

// ---------------------------------------------------------------- Catalogue

/** Cycle CAT04 : draft → review → published → suspended | archived. */
export type EditorialStatus = "draft" | "review" | "changes_requested" | "approved" | "published" | "suspended" | "archived";

export interface CoverSpec {
  /** Trois couleurs hexadécimales : fond, encre, accent. */
  palette: [string, string, string];
  motif: "columns" | "bars" | "arcs" | "grid" | "waves" | "rings";
  kicker: string;
}

export interface Publication {
  id: string;
  slug: string;
  title: string;
  author: string;
  publisher: Publisher;
  universe: Universe;
  language: Language;
  summary: string;
  tags: string[];
  cover: CoverSpec;
  kind: "series" | "work";
  is_demo: boolean;
}

export type AvailabilityState = "available" | "unavailable" | "rights_expired" | "withdrawn";

export interface Availability {
  state: AvailabilityState;
  territories: string[];
  rights_valid_until: ISODateTime | null;
  reason: string | null;
}

export interface Edition {
  id: string;
  publication_id: string;
  label: string;
  published_at: ISODateTime;
  format: ContentFormat;
  language: Language;
  page_count: number | null;
  word_count: number | null;
  status: EditorialStatus;
  availability: Availability;
  /** Les trois permissions de la section 5 sont distinctes. */
  permissions: { public_excerpt: boolean; ai_indexing: boolean; full_text_public: boolean };
  is_free: boolean;
  version: number;
  asset_id: string | null;
}

export interface CatalogItem {
  publication: Publication;
  latest_edition: Edition;
  edition_count: number;
  price_from: Money | null;
  has_free_content: boolean;
  formats: ContentFormat[];
}

export type PriceFilter = "free" | "paid";
export type CatalogSort = "relevance" | "recent" | "title" | "price_asc" | "price_desc";

export interface CatalogQuery {
  q?: string;
  universe?: Universe;
  language?: Language;
  format?: ContentFormat;
  price?: PriceFilter;
  sort?: CatalogSort;
  page?: number;
  page_size?: number;
}

export interface CatalogFacets {
  universe: Record<Universe, number>;
  language: Partial<Record<Language, number>>;
  format: Record<ContentFormat, number>;
}

export interface CatalogPage extends Page<CatalogItem> {
  facets: CatalogFacets;
}

export interface PublicationDetail {
  publication: Publication;
  editions: Edition[];
  offers: Offer[];
}

export interface Excerpt {
  edition_id: string;
  markdown: string;
  truncated: boolean;
  max_chars: number;
  notice: string;
}

export interface AssetAccess {
  asset_id: string;
  edition_id: string;
  title: string;
  edition_label: string;
  publication_slug: string;
  format: ContentFormat;
  /** URL signée de courte durée : ne jamais la persister ni la journaliser. */
  url: string;
  media_type: "text/markdown" | "application/pdf";
  expires_at: ISODateTime;
  download_allowed: boolean;
}

// ---------------------------------------------------------------- Offres

export type OfferKind = "free" | "single" | "subscription";
export type OfferStatus = "active" | "unavailable" | "sold_out" | "retired";

export type OfferScope =
  | { kind: "edition"; edition_id: string; publication_id: string; label: string }
  | { kind: "collection"; universe: Universe; label: string; includes_future_additions: boolean }
  | { kind: "free_selection"; label: string };

export interface Duration {
  unit: "day" | "month" | "year";
  count: number;
}

export interface Offer {
  id: string;
  version: number;
  kind: OfferKind;
  title: string;
  description: string;
  price: Money;
  duration: Duration | null;
  renewal: "manual" | "none";
  scope: OfferScope;
  restrictions: string[];
  conditions_version: string;
  status: OfferStatus;
  status_reason: string | null;
  /** Présent uniquement pour une offre explicitement contingentée (OFF03, CON01). */
  quota: { total: number; remaining: number } | null;
  is_demo: boolean;
}

export interface Overlap {
  entitlement_id: string;
  description: string;
}

export type BlockingReason =
  | "ALREADY_OWNED"
  | "OFFER_UNAVAILABLE"
  | "OFFER_SOLD_OUT"
  | "AUTH_REQUIRED"
  | "FREE_CONTENT"
  | "PENDING_ORDER";

export interface Eligibility {
  offer_id: string;
  can_purchase: boolean;
  already_owned: boolean;
  blocking_reason: BlockingReason | null;
  overlaps: Overlap[];
  /** Commande existante à reprendre lorsque blocking_reason = PENDING_ORDER. */
  pending_order_id: string | null;
}

export interface Quote {
  quote_id: string;
  offer: Offer;
  lines: { label: string; amount: Money }[];
  total: Money;
  access_starts_at: ISODateTime;
  access_ends_at: ISODateTime | null;
  eligibility: Eligibility;
  renewal_of_subscription_id: string | null;
  quote_expires_at: ISODateTime;
}

// ---------------------------------------------------------------- Commandes et paiements

export type OrderStatus = "created" | "pending_payment" | "paid" | "fulfilled" | "cancelled" | "payment_exception";
export type PaymentStatus = "initiated" | "pending" | "succeeded" | "failed" | "cancelled" | "refund_pending" | "refunded";
export type ReservationStatus = "reserved" | "consumed" | "released" | "expired";

/** Instantané immuable de l'offre au moment de la commande (OFF01). */
export interface OfferSnapshot {
  offer_id: string;
  offer_version: number;
  title: string;
  kind: OfferKind;
  price: Money;
  duration: Duration | null;
  renewal: "manual" | "none";
  scope_label: string;
  conditions_version: string;
}

export interface Order {
  id: string;
  reference: string;
  status: OrderStatus;
  lines: { label: string; snapshot: OfferSnapshot; amount: Money }[];
  total: Money;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  payment: { status: PaymentStatus; provider: string; mode: "test" | "sandbox" | "live"; updated_at: ISODateTime } | null;
  reservation: { status: ReservationStatus; expires_at: ISODateTime } | null;
  subscription_id: string | null;
  edition_id: string | null;
  renewal_of_subscription_id: string | null;
  /** Vrai seulement si un justificatif existe réellement côté serveur. */
  receipt_available: boolean;
  exception_reason: string | null;
  is_demo: boolean;
}

export interface CheckoutSession {
  session_id: string;
  order_id: string;
  /** URL du prestataire (externe) ou page de test interne en mode démo. */
  redirect_url: string;
  expires_at: ISODateTime;
  mode: "test" | "sandbox" | "live";
}

// ---------------------------------------------------------------- Accès

export type EntitlementSource = "purchase" | "subscription" | "gift" | "admin_grant" | "free";
export type EntitlementStatus = "active" | "expired" | "revoked" | "suspended";

export interface Entitlement {
  id: string;
  user_id: string;
  source: EntitlementSource;
  source_ref: string;
  scope: { kind: "edition"; edition_id: string } | { kind: "collection"; universe: Universe; label: string };
  valid_from: ISODateTime;
  valid_until: ISODateTime | null;
  status: EntitlementStatus;
}

export interface LibraryItem {
  edition: Edition;
  publication: Publication;
  entitlement: Entitlement;
}

export interface AccessSummary {
  publication_id: string;
  /** Éditions de la publication lisibles maintenant par l'utilisateur. */
  readable_edition_ids: string[];
  entitlements: Entitlement[];
}

export type SubscriptionStatus =
  | "pending_payment"
  | "active"
  | "cancel_at_period_end"
  | "past_due"
  | "expired"
  | "suspended";

export interface Subscription {
  id: string;
  offer: OfferSnapshot;
  universe: Universe;
  status: SubscriptionStatus;
  current_period_start: ISODateTime;
  current_period_end: ISODateTime;
  renewal: "manual";
  scope_label: string;
  scheduled_change: { target_offer_title: string; effective_at: ISODateTime } | null;
  history: { at: ISODateTime; label: string }[];
}

// ---------------------------------------------------------------- Propositions d'action

export type ActionType =
  | "purchase"
  | "cancel_subscription"
  | "change_plan"
  | "create_support_case"
  | "access_exception";

export type ProposalStatus = "pending" | "confirmed" | "rejected" | "expired" | "superseded" | "failed";

/** Devis d'action préparé par le serveur (section 7 et SAFE01). */
export interface ActionProposal {
  id: string;
  type: ActionType;
  status: ProposalStatus;
  title: string;
  resource: { type: string; id: string; label: string; version: number };
  consequences: string[];
  amount: Money | null;
  conditions_version: string | null;
  expires_at: ISODateTime;
  approval: "self" | "manager";
  origin: "form" | "assistant";
  created_at: ISODateTime;
  result: { summary: string; links: { label: string; to: string }[] } | null;
}

// ---------------------------------------------------------------- Assistant

export type RunStatus = "queued" | "running" | "waiting_user" | "waiting_approval" | "completed" | "failed" | "cancelled";

export interface Conversation {
  id: string;
  title: string;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  active_run_id: string | null;
  is_demo: boolean;
}

export interface PublicationCardData {
  publication_id: string;
  slug: string;
  title: string;
  subtitle: string;
  universe: Universe;
  cover: CoverSpec;
  reason: string;
}

export interface OfferComparisonRow {
  offer_id: string;
  title: string;
  price: Money;
  duration: Duration | null;
  renewal: "manual" | "none";
  includes: string;
  note: string | null;
  status: "recommended" | "redundant" | "neutral" | "unavailable";
}

export interface Citation {
  id: string;
  document_title: string;
  section: string;
  quote: string;
  version: string;
  effective_date: ISODateTime;
  /** Route interne construite par le serveur ; null si le passage n'est pas ouvrable pour cet utilisateur. */
  href: string | null;
}

export type MessageBlock =
  | { type: "text"; markdown: string }
  | { type: "publications"; items: PublicationCardData[] }
  | { type: "offer_comparison"; rows: OfferComparisonRow[] }
  | { type: "citations"; items: Citation[] }
  | { type: "clarification"; question: string; options: string[] }
  | { type: "proposal"; proposal_id: string }
  | { type: "notice"; tone: "info" | "warning"; text: string }
  | { type: "error"; code: string; text: string; retryable: boolean }
  | { type: "handoff"; text: string; case_id: string | null }
  | { type: "auth_required"; text: string };

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  created_at: ISODateTime;
  blocks: MessageBlock[];
  run_id: string | null;
}

export interface PublicStep {
  key: string;
  label: string;
  state: "running" | "done" | "failed";
}

export interface AgentRun {
  id: string;
  conversation_id: string;
  status: RunStatus;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  last_seq: number;
  steps: PublicStep[];
  error: { code: string; message: string } | null;
}

export type RunEvent =
  | { seq: number; run_id: string; at: ISODateTime; type: "status"; status: RunStatus }
  | { seq: number; run_id: string; at: ISODateTime; type: "step"; step: PublicStep }
  | { seq: number; run_id: string; at: ISODateTime; type: "message"; message_id: string }
  | { seq: number; run_id: string; at: ISODateTime; type: "error"; code: string; message: string };

export interface StartRunResponse {
  run_id: string;
  status: RunStatus;
  status_url: string;
  user_message: Message;
}

// ---------------------------------------------------------------- Support

export type SupportCategory = "access" | "payment" | "subscription" | "content" | "other";
export type SupportStatus = "open" | "in_progress" | "waiting_reader" | "resolved" | "closed";

export interface SupportMessage {
  id: string;
  author: "reader" | "support" | "system";
  author_label: string;
  body: string;
  at: ISODateTime;
}

export interface SupportCase {
  id: string;
  reference: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  requester: { id: string; label: string };
  assignee: { id: string; label: string } | null;
  related: { order_id: string | null; edition_id: string | null; subscription_id: string | null };
  messages: SupportMessage[];
}

export interface NewSupportCase {
  category: SupportCategory;
  subject: string;
  body: string;
  order_id?: string | null;
  edition_id?: string | null;
  subscription_id?: string | null;
}

// ---------------------------------------------------------------- Administration

export type ImportStatus = "uploaded" | "quarantined" | "validating" | "extracting" | "indexing" | "ready" | "failed";

export interface ImportJob {
  id: string;
  file_name: string;
  size_bytes: number;
  media_type: string;
  edition_id: string | null;
  edition_label: string | null;
  status: ImportStatus;
  progress: number;
  error: { code: string; message: string } | null;
  warnings: string[];
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface AuditEvent {
  id: string;
  at: ISODateTime;
  actor: { id: string; label: string; role: Role | "system" | "agent" };
  action: string;
  target: { type: string; id: string; label: string };
  reason: string | null;
  result: "success" | "denied" | "failed";
  request_id: string;
}

export interface ApprovalRequest {
  id: string;
  proposal: ActionProposal;
  requested_by: { id: string; label: string };
  reason: string;
  status: "pending" | "approved" | "rejected";
  decided_by: { id: string; label: string } | null;
  decided_at: ISODateTime | null;
  case_id: string | null;
}

export interface RunDiagnosticStep {
  id: string;
  agent: string;
  tool: string | null;
  mcp_server: string | null;
  started_at: ISODateTime;
  duration_ms: number;
  status: "ok" | "needs_input" | "blocked" | "failed";
  error_code: string | null;
  summary: string;
  evidence_refs: string[];
}

export interface RunDiagnostic {
  run: AgentRun;
  actor_label: string;
  request_summary: string;
  model: string;
  prompt_version: string;
  steps: RunDiagnosticStep[];
  tokens: { input: number; output: number } | null;
  cost: { amount_usd: number | null; kind: "measured" | "estimated" | "unavailable"; tariff_version: string | null };
  is_simulated: boolean;
}

export interface OpsSnapshot {
  generated_at: ISODateTime;
  is_demo: boolean;
  counts: {
    publications_in_review: number;
    imports_failed: number;
    orders_pending_payment: number;
    payment_exceptions: number;
    tickets_open: number;
    approvals_pending: number;
    runs_failed: number;
    proposals_expired: number;
  };
}

export interface AdminEditionRow {
  edition: Edition;
  publication: Publication;
}

export interface PublicationInput {
  title: string;
  author: string;
  publisher_id: string;
  universe: Universe;
  language: Language;
  summary: string;
  tags: string[];
}

export interface EditionInput {
  label: string;
  format: ContentFormat;
  published_at: ISODateTime;
  permissions: Edition["permissions"];
  is_free: boolean;
}

export interface OfferInput {
  title: string;
  description: string;
  price_amount: number;
  restrictions: string[];
  status: Extract<OfferStatus, "active" | "unavailable">;
}

export interface EditorialReview {
  id: string;
  edition_id: string;
  edition_label: string;
  publication_title: string;
  decision: "changes_requested" | "approved";
  comment: string;
  created_at: ISODateTime;
}

export interface ContractDocument {
  document_id: string;
  version: string;
  title: string;
  effective_at: ISODateTime;
  source: "backend" | "demo";
  sections: { id: string; title: string; body: string }[];
}

export interface OfferCreateInput {
  kind: OfferKind;
  title: string;
  description: string;
  price: Money;
  duration: Duration | null;
  scope: OfferScope;
  restrictions: string[];
  conditions_version: string;
  quota_total: number | null;
  status: Extract<OfferStatus, "active" | "unavailable">;
}

export interface AdminUserRef {
  id: string;
  display_name: string;
  email: string;
}
