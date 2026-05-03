// Centralized formatting utilities using Dynatrace user preferences
// All date, number, and duration formatting MUST go through these functions.

import { getTimezone, getRegionalFormat } from "@dynatrace-sdk/user-preferences";

function getUserLocale(): string {
  try {
    return getRegionalFormat() || navigator.language || "en";
  } catch {
    return navigator.language || "en";
  }
}

function getUserTimezone(): string {
  try {
    return getTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}

export function formatDateTime(
  value: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === null || value === undefined) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString(getUserLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: getUserTimezone(),
    ...options,
  });
}

export function formatNumber(
  value: number | string | null | undefined,
  options?: Intl.NumberFormatOptions
): string {
  const n = Number(value);
  if (value === null || value === undefined || isNaN(n)) return "0";
  return new Intl.NumberFormat(getUserLocale(), options).format(n);
}

export function formatPercent(value: number | null | undefined, decimals: number = 1): string {
  if (value === null || value === undefined || isNaN(value)) return "0%";
  return new Intl.NumberFormat(getUserLocale(), {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value / 100);
}

export function formatDurationMs(ms: number | string | null | undefined): string {
  const n = Number(ms);
  if (ms === null || ms === undefined || isNaN(n)) return "0 ms";
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)} s`;
  if (n < 3_600_000) return `${(n / 60_000).toFixed(1)} min`;
  return `${(n / 3_600_000).toFixed(1)} h`;
}

/**
 * Sanitize a Dynatrace entity ID for safe DQL interpolation.
 * Valid entity IDs match: TYPE-HEXSTRING (e.g. HOST-ABC123DEF456).
 * Throws if the value doesn't match the expected pattern.
 */
export function sanitizeEntityId(id: string): string {
  if (!/^[A-Z_]+-[0-9A-F]{16}$/i.test(id)) {
    throw new Error(`Invalid entity ID format: ${id.substring(0, 40)}`);
  }
  return id;
}
