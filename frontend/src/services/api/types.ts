import type {
  AccessSummary,
  ActionProposal,
  ActiveSession,
  AdminEditionRow,
  AdminUserRef,
  AgentRun,
  ApprovalRequest,
  AssetAccess,
  AuditEvent,
  CatalogItem,
  CatalogPage,
  CatalogQuery,
  CheckoutSession,
  Conversation,
  ContractDocument,
  EditionInput,
  EditorialStatus,
  Eligibility,
  Entitlement,
  Excerpt,
  ImportJob,
  LibraryItem,
  Message,
  NewSupportCase,
  Offer,
  OfferCreateInput,
  OfferInput,
  OpsSnapshot,
  Order,
  Page,
  Publication,
  PublicationDetail,
  PublicationInput,
  Publisher,
  Quote,
  RunDiagnostic,
  RunEvent,
  Session,
  StartRunResponse,
  Subscription,
  SupportCase,
  SupportStatus,
  UserPreferences,
} from "@/contracts/models";

/**
 * Interface unique d'accès aux données. Deux implémentations :
 * - `createHttpApi` : appels au backend FastAPI (mode api) ;
 * - `createDemoApi` : données fictives en mémoire (mode demo).
 * Les composants ne connaissent que cette interface.
 */

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface MutationOptions {
  /** Clé d'idempotence (CON04) : stable pour une même intention, nouvelle pour une autre. */
  idempotencyKey: string;
}

export interface RunEventHandlers {
  onEvent: (event: RunEvent) => void;
  /** Coupure du flux : ce n'est pas un échec métier (UX05). */
  onConnectionChange?: (state: "live" | "reconnecting" | "polling") => void;
}

export interface KiosyApi {
  legal: {
    current(documentId: string, opts?: RequestOptions): Promise<ContractDocument>;
    get(documentId: string, version: string, opts?: RequestOptions): Promise<ContractDocument>;
  };
  auth: {
    getSession(opts?: RequestOptions): Promise<Session | null>;
    login(input: { email: string; password: string }): Promise<Session>;
    register(input: { display_name: string; email: string; password: string; accepted_terms_version: string }): Promise<Session>;
    logout(): Promise<void>;
    requestPasswordReset(input: { email: string }): Promise<void>;
    resetPassword(input: { token: string; password: string }): Promise<void>;
    listSessions(opts?: RequestOptions): Promise<ActiveSession[]>;
    revokeSession(sessionId: string): Promise<void>;
    updatePreferences(input: Partial<UserPreferences> & { display_name?: string }): Promise<Session>;
  };
  catalog: {
    search(query: CatalogQuery, opts?: RequestOptions): Promise<CatalogPage>;
    featured(opts?: RequestOptions): Promise<CatalogItem[]>;
    getPublication(idOrSlug: string, opts?: RequestOptions): Promise<PublicationDetail>;
    getExcerpt(editionId: string, opts?: RequestOptions): Promise<Excerpt>;
  };
  offers: {
    list(filter: { publication_id?: string }, opts?: RequestOptions): Promise<Offer[]>;
    get(offerId: string, opts?: RequestOptions): Promise<Offer>;
  };
  me: {
    library(opts?: RequestOptions): Promise<LibraryItem[]>;
    access(publicationId: string, opts?: RequestOptions): Promise<AccessSummary>;
    eligibility(offerIds: string[], opts?: RequestOptions): Promise<Eligibility[]>;
    assetAccess(editionId: string, opts?: RequestOptions): Promise<AssetAccess>;
    orders(opts?: RequestOptions): Promise<Order[]>;
    subscriptions(opts?: RequestOptions): Promise<Subscription[]>;
    subscription(id: string, opts?: RequestOptions): Promise<Subscription>;
  };
  commerce: {
    quote(input: { offer_id: string; renewal_of_subscription_id?: string | null }, opts?: RequestOptions): Promise<Quote>;
    createOrder(
      input: { quote_id: string; offer_id: string; offer_version: number; renewal_of_subscription_id?: string | null; accepted_conditions_version: string },
      opts: MutationOptions,
    ): Promise<Order>;
    getOrder(orderId: string, opts?: RequestOptions): Promise<Order>;
    createCheckout(orderId: string, opts: MutationOptions): Promise<CheckoutSession>;
  };
  proposals: {
    get(id: string, opts?: RequestOptions): Promise<ActionProposal>;
    confirm(id: string, opts: MutationOptions): Promise<ActionProposal>;
    reject(id: string, opts: MutationOptions): Promise<ActionProposal>;
    prepareCancellation(subscriptionId: string): Promise<ActionProposal>;
    preparePlanChange(subscriptionId: string, targetOfferId: string): Promise<ActionProposal>;
  };
  assistant: {
    listConversations(opts?: RequestOptions): Promise<Conversation[]>;
    createConversation(): Promise<Conversation>;
    getConversation(id: string, opts?: RequestOptions): Promise<Conversation>;
    listMessages(conversationId: string, opts?: RequestOptions): Promise<Message[]>;
    startRun(conversationId: string, input: { text: string }, opts: MutationOptions): Promise<StartRunResponse>;
    getRun(runId: string, opts?: RequestOptions): Promise<AgentRun>;
    listRunEvents(runId: string, afterSeq: number, opts?: RequestOptions): Promise<RunEvent[]>;
    /** Suit les événements d'un run à partir de `afterSeq`. Retourne une fonction d'arrêt. */
    followRun(runId: string, afterSeq: number, handlers: RunEventHandlers): () => void;
    cancelRun(runId: string): Promise<AgentRun>;
    sendFeedback(messageId: string, input: { rating: -1 | 1; reason?: string | null }): Promise<{ message_id: string; rating: -1 | 1; reason: string | null }>;
  };
  support: {
    list(opts?: RequestOptions): Promise<SupportCase[]>;
    get(id: string, opts?: RequestOptions): Promise<SupportCase>;
    create(input: NewSupportCase, opts: MutationOptions): Promise<SupportCase>;
    reply(id: string, body: string, opts: MutationOptions): Promise<SupportCase>;
  };
  admin: {
    ops(opts?: RequestOptions): Promise<OpsSnapshot>;
    publishers(opts?: RequestOptions): Promise<Publisher[]>;
    editions(filter: { status?: EditorialStatus; q?: string }, opts?: RequestOptions): Promise<AdminEditionRow[]>;
    edition(editionId: string, opts?: RequestOptions): Promise<AdminEditionRow>;
    createPublication(input: PublicationInput & { edition: EditionInput }): Promise<AdminEditionRow>;
    createEdition(publicationId: string, input: EditionInput): Promise<AdminEditionRow>;
    updatePublication(publicationId: string, input: PublicationInput): Promise<Publication>;
    updateEdition(editionId: string, input: EditionInput & { version: number }): Promise<AdminEditionRow>;
    transitionEdition(editionId: string, input: { to: EditorialStatus; version: number; reason: string }): Promise<AdminEditionRow>;
    offers(opts?: RequestOptions): Promise<Offer[]>;
    createOffer(input: OfferCreateInput): Promise<Offer>;
    offerVersions(offerId: string, opts?: RequestOptions): Promise<Offer[]>;
    updateOffer(offerId: string, input: OfferInput & { version: number }): Promise<Offer>;
    imports(opts?: RequestOptions): Promise<ImportJob[]>;
    uploadImport(input: { file: File; edition_id: string }, opts: MutationOptions): Promise<ImportJob>;
    orders(filter: { status?: string }, opts?: RequestOptions): Promise<(Order & { customer: AdminUserRef })[]>;
    reconcilePayment(orderId: string): Promise<Order>;
    subscriptions(opts?: RequestOptions): Promise<(Subscription & { customer: AdminUserRef })[]>;
    users(opts?: RequestOptions): Promise<AdminUserRef[]>;
    entitlements(userId: string, opts?: RequestOptions): Promise<Entitlement[]>;
    supportCases(filter: { status?: SupportStatus }, opts?: RequestOptions): Promise<SupportCase[]>;
    supportCase(id: string, opts?: RequestOptions): Promise<SupportCase>;
    replySupportCase(id: string, input: { body: string; status: SupportStatus }, opts: MutationOptions): Promise<SupportCase>;
    requestAccessException(caseId: string, input: { reason: string; edition_id: string; days: number }): Promise<ApprovalRequest>;
    approvals(opts?: RequestOptions): Promise<ApprovalRequest[]>;
    decideApproval(id: string, input: { decision: "approve" | "reject"; reason: string }, opts: MutationOptions): Promise<ApprovalRequest>;
    audit(filter: { q?: string; result?: AuditEvent["result"] }, opts?: RequestOptions): Promise<Page<AuditEvent>>;
    runs(opts?: RequestOptions): Promise<RunDiagnostic[]>;
    run(runId: string, opts?: RequestOptions): Promise<RunDiagnostic>;
  };
}
