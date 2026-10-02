import type {
  ActionProposal,
  ActiveSession,
  AgentRun,
  ApprovalRequest,
  AuditEvent,
  Conversation,
  Edition,
  Entitlement,
  ImportJob,
  Message,
  Offer,
  Order,
  Publication,
  Publisher,
  RunDiagnostic,
  RunEvent,
  Subscription,
  SupportCase,
  User,
} from "@/contracts/models";
import { seedDemoDb } from "./seed";

/**
 * « Serveur » de démonstration : état en mémoire, persisté dans localStorage pour survivre
 * à un rechargement pendant une démonstration. Ne contient aucun secret ni donnée réelle.
 */

export const DEMO_DB_KEY = "kiosy-demo-db-v3";
export const DEMO_SESSION_KEY = "kiosy-demo-session";
export const ANONYMOUS_OWNER = "anonymous";

export interface DemoUser extends User {
  /** Mot de passe de démonstration public, identique pour toutes les personas fictives. */
  demo_password: string;
}

export interface OwnedOrder extends Order {
  user_id: string;
}
export interface OwnedSubscription extends Subscription {
  user_id: string;
  version: number;
}
export interface OwnedProposal extends ActionProposal {
  user_id: string;
  payload: {
    offer_id?: string;
    offer_version?: number;
    subscription_id?: string;
    target_offer_id?: string;
    support?: { category: SupportCase["category"]; subject: string; body: string; edition_id: string | null };
    edition_id?: string;
    days?: number;
    beneficiary_id?: string;
  };
  run_id: string | null;
}
export interface OwnedConversation extends Conversation {
  owner: string;
}
export interface ScheduledMessage extends Message {
  owner: string;
  visible_at: string;
}
export interface ScheduledRun extends AgentRun {
  owner: string;
  events: RunEvent[];
  diagnostic: Omit<RunDiagnostic, "run">;
  cancelled_at: string | null;
}
export interface PaymentSession {
  id: string;
  order_id: string;
  expires_at: string;
  /** Résultat choisi sur la page du prestataire de test ; « no_response » simule un statut incertain. */
  outcome: "succeeded" | "failed" | "cancelled" | "no_response" | null;
  deliver_at: string | null;
  delivered: boolean;
}
export interface ScheduledImport extends ImportJob {
  schedule: { status: ImportJob["status"]; at: string; progress: number }[];
  final_error: ImportJob["error"];
}
export interface OwnedCase extends SupportCase {
  owner: string;
}

export interface DemoDb {
  version: 3;
  counter: number;
  users: DemoUser[];
  publishers: Publisher[];
  publications: Publication[];
  editions: Edition[];
  offers: Offer[];
  offer_history: Record<string, Offer[]>;
  entitlements: Entitlement[];
  subscriptions: OwnedSubscription[];
  orders: OwnedOrder[];
  payment_sessions: PaymentSession[];
  proposals: OwnedProposal[];
  conversations: OwnedConversation[];
  messages: ScheduledMessage[];
  runs: ScheduledRun[];
  cases: OwnedCase[];
  imports: ScheduledImport[];
  audit: AuditEvent[];
  approvals: ApprovalRequest[];
  sessions: Record<string, ActiveSession[]>;
  idempotency: Record<string, { fingerprint: string; result: unknown }>;
  flags: { outage: boolean; session_expired: boolean };
}

// ------------------------------------------------------------------ horloge

let clockOffsetMs = 0;
/** Horloge de la démo ; les tests peuvent l'avancer (expiration de réservation, de proposition...). */
export const clock = {
  now: () => Date.now() + clockOffsetMs,
  iso: () => new Date(Date.now() + clockOffsetMs).toISOString(),
  advance: (ms: number) => {
    clockOffsetMs += ms;
  },
  reset: () => {
    clockOffsetMs = 0;
  },
};

export function isoIn(ms: number): string {
  return new Date(clock.now() + ms).toISOString();
}

// ------------------------------------------------------------------ persistance

let db: DemoDb | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function getDb(): DemoDb {
  if (db) return db;
  const raw = storage()?.getItem(DEMO_DB_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DemoDb;
      if (parsed.version === 3) {
        db = parsed;
        return db;
      }
    } catch {
      // État corrompu : on repart de la graine.
    }
  }
  db = seedDemoDb();
  saveDb();
  return db;
}

export function saveDb(): void {
  if (!db) return;
  try {
    storage()?.setItem(DEMO_DB_KEY, JSON.stringify(db));
  } catch {
    // Quota plein ou stockage indisponible : la démo continue en mémoire.
  }
}

export function resetDemoDb(): void {
  db = seedDemoDb();
  saveDb();
}

export function nextId(prefix: string): string {
  const current = getDb();
  current.counter += 1;
  return `${prefix}_${current.counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ------------------------------------------------------------------ session de démonstration

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Seul l'identifiant de persona fictive est conservé (pas de token). */
export function getDemoSessionUserId(): string | null {
  return sessionStore()?.getItem(DEMO_SESSION_KEY) ?? null;
}

export function setDemoSessionUserId(userId: string | null): void {
  const store = sessionStore();
  if (!store) return;
  if (userId) store.setItem(DEMO_SESSION_KEY, userId);
  else store.removeItem(DEMO_SESSION_KEY);
}
