import { appConfig } from "@/config/app";
import type { Duration, Money } from "@/contracts/models";

/**
 * Formats d'affichage via Intl. Les dates serveur sont en UTC et affichées dans le fuseau
 * choisi (OFF05). Les montants sont des entiers avec une échelle explicite : on ne suppose
 * jamais que toutes les devises ont deux décimales.
 */

export function moneyToNumber(money: Money): number {
  return money.amount / 10 ** money.scale;
}

export function formatMoney(money: Money): string {
  if (money.amount === 0) return "Gratuit";
  return new Intl.NumberFormat(appConfig.locale, {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: money.scale,
    maximumFractionDigits: money.scale,
  }).format(moneyToNumber(money));
}

export function formatDate(iso: string, timeZone: string = appConfig.defaultTimeZone): string {
  return new Intl.DateTimeFormat(appConfig.locale, { dateStyle: "long", timeZone }).format(new Date(iso));
}

export function formatDateShort(iso: string, timeZone: string = appConfig.defaultTimeZone): string {
  return new Intl.DateTimeFormat(appConfig.locale, { dateStyle: "medium", timeZone }).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone: string = appConfig.defaultTimeZone): string {
  return new Intl.DateTimeFormat(appConfig.locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));
}

export function timeZoneLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat(appConfig.locale, { timeZone, timeZoneName: "short" }).formatToParts(new Date());
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
    return `${timeZone.replace(/_/g, " ")} (${name})`;
  } catch {
    return timeZone;
  }
}

export function formatDuration(duration: Duration | null): string {
  if (!duration) return "Sans limite de durée annoncée";
  const n = duration.count;
  if (duration.unit === "day") return n > 1 ? `${n} jours` : "1 jour";
  if (duration.unit === "year") return n > 1 ? `${n} ans` : "1 an";
  return `${n} mois`;
}

export function formatBytes(bytes: number): string {
  return new Intl.NumberFormat(appConfig.locale, { style: "unit", unit: bytes > 1_000_000 ? "megabyte" : "kilobyte", maximumFractionDigits: 1 }).format(
    bytes > 1_000_000 ? bytes / 1_000_000 : bytes / 1_000,
  );
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0 s";
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes} min ${String(seconds).padStart(2, "0")} s` : `${seconds} s`;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${new Intl.NumberFormat(appConfig.locale).format(count)} ${count > 1 ? plural : singular}`;
}
