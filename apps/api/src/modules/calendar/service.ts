/**
 * Calendar rules orchestration — connection, CRUD, evaluate/sync.
 *
 * @package @heizplan/api
 */

import type {
  CalendarConnectionStatus,
  CalendarConnectionUpdate,
  CalendarEvaluateResult,
  CalendarRule,
  CalendarStatusResponse,
} from "@heizplan/shared";
import { config } from "../../config.js";
import { getCloudQuota } from "../cloud/quota.js";
import {
  CalDavError,
  discoverCalendars,
  fetchEvents,
} from "./caldav.js";
import { reconcileOverrides } from "./engine.js";
import {
  clearCalendarCredentials,
  deleteCalendarRule,
  loadActiveOverrides,
  loadCalendarCredentials,
  loadCalendarMeta,
  loadCalendarRules,
  saveCalendarCredentials,
  saveCalendarMeta,
  upsertCalendarRule,
  type CalendarCredentials,
} from "./store.js";

function dataDir(): string {
  return config.bridgeDataDir;
}

/**
 * Optional env bootstrap (ICAL_URL / ICAL_USER / ICAL_APP_PASSWORD).
 * Only seeds when no credentials file exists — never overwrites Settings.
 */
export async function maybeBootstrapFromEnv(): Promise<void> {
  const existing = await loadCalendarCredentials(dataDir());
  if (existing) {
    return;
  }
  const url = process.env.ICAL_URL?.trim() || "https://caldav.icloud.com";
  const username = process.env.ICAL_USER?.trim();
  const appPassword = process.env.ICAL_APP_PASSWORD?.trim();
  if (!username || !appPassword) {
    return;
  }
  await saveCalendarCredentials(dataDir(), { url, username, appPassword });
  console.log("[calendar] seeded credentials from ICAL_* env (password not logged)");
}

export async function getConnectionStatus(): Promise<CalendarConnectionStatus> {
  await maybeBootstrapFromEnv();
  const creds = await loadCalendarCredentials(dataDir());
  const meta = await loadCalendarMeta(dataDir());
  if (!creds) {
    return {
      configured: false,
      url: null,
      username: null,
      hasPassword: false,
      lastOkAt: meta.lastOkAt,
      lastError: meta.lastError,
      calendars: [],
    };
  }
  return {
    configured: true,
    url: creds.url,
    username: creds.username,
    hasPassword: Boolean(creds.appPassword),
    lastOkAt: meta.lastOkAt,
    lastError: meta.lastError,
    calendars: meta.calendars,
  };
}

export async function updateConnection(
  body: CalendarConnectionUpdate,
): Promise<CalendarConnectionStatus> {
  const url = (body.url || "https://caldav.icloud.com").trim().replace(/\/+$/, "");
  const username = (body.username || "").trim();
  if (!url || !/^https:\/\//i.test(url)) {
    throw new Error("url must be an https CalDAV base (e.g. https://caldav.icloud.com)");
  }
  if (!username) {
    throw new Error("username (Apple-ID / CalDAV user) is required");
  }

  const existing = await loadCalendarCredentials(dataDir());
  const password =
    typeof body.appPassword === "string" && body.appPassword.length > 0
      ? body.appPassword
      : existing?.appPassword;
  if (!password) {
    throw new Error("appPassword required on first save");
  }

  const creds = await saveCalendarCredentials(dataDir(), {
    url,
    username,
    appPassword: password,
  });

  // Discover immediately so Settings can list calendars.
  try {
    const calendars = await discoverCalendars(creds);
    await saveCalendarMeta(dataDir(), {
      lastOkAt: new Date().toISOString(),
      lastError: null,
      calendars,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "CalDAV discovery failed";
    await saveCalendarMeta(dataDir(), {
      lastOkAt: null,
      lastError: message,
      calendars: [],
    });
    throw err;
  }

  return getConnectionStatus();
}

export async function disconnectCalendar(): Promise<CalendarConnectionStatus> {
  await clearCalendarCredentials(dataDir());
  await saveCalendarMeta(dataDir(), {
    lastOkAt: null,
    lastError: null,
    calendars: [],
  });
  return getConnectionStatus();
}

export async function listRules(): Promise<CalendarRule[]> {
  return loadCalendarRules(dataDir());
}

export async function createRule(
  input: Partial<CalendarRule>,
): Promise<CalendarRule> {
  return upsertCalendarRule(dataDir(), input);
}

export async function updateRule(
  id: string,
  input: Partial<CalendarRule>,
): Promise<CalendarRule> {
  return upsertCalendarRule(dataDir(), input, id);
}

export async function removeRule(id: string): Promise<boolean> {
  return deleteCalendarRule(dataDir(), id);
}

export async function getCalendarStatus(): Promise<CalendarStatusResponse> {
  const [connection, rules, active, quota] = await Promise.all([
    getConnectionStatus(),
    listRules(),
    loadActiveOverrides(dataDir()),
    getCloudQuota(),
  ]);
  return { connection, rules, active, quota };
}

async function requireCreds(): Promise<CalendarCredentials> {
  await maybeBootstrapFromEnv();
  const creds = await loadCalendarCredentials(dataDir());
  if (!creds) {
    throw new Error("CalDAV not configured — save URL, Apple-ID and App-Passwort in Settings.");
  }
  return creds;
}

/**
 * Fetch events + reconcile overrides.
 * Window: from 15m ago to +24h (covers floating start edges).
 */
export async function evaluateCalendar(
  opts?: { hoursAhead?: number },
): Promise<CalendarEvaluateResult> {
  const creds = await requireCreds();
  let meta = await loadCalendarMeta(dataDir());
  let calendars = meta.calendars;

  try {
    if (calendars.length === 0) {
      calendars = await discoverCalendars(creds);
    }
    const hours = opts?.hoursAhead ?? 24;
    const from = new Date(Date.now() - 15 * 60_000);
    const to = new Date(Date.now() + hours * 3_600_000);
    const events = await fetchEvents(creds, calendars, from, to);
    await saveCalendarMeta(dataDir(), {
      lastOkAt: new Date().toISOString(),
      lastError: null,
      calendars,
    });
    const rules = await loadCalendarRules(dataDir());
    return reconcileOverrides(events, rules);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar evaluate failed";
    await saveCalendarMeta(dataDir(), {
      lastOkAt: meta.lastOkAt,
      lastError: message,
      calendars,
    });
    if (err instanceof CalDavError) {
      throw err;
    }
    throw err;
  }
}

/** Refresh calendar list without evaluating rules. */
export async function refreshCalendarList(): Promise<CalendarConnectionStatus> {
  const creds = await requireCreds();
  try {
    const calendars = await discoverCalendars(creds);
    await saveCalendarMeta(dataDir(), {
      lastOkAt: new Date().toISOString(),
      lastError: null,
      calendars,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Discovery failed";
    const meta = await loadCalendarMeta(dataDir());
    await saveCalendarMeta(dataDir(), {
      lastOkAt: meta.lastOkAt,
      lastError: message,
      calendars: meta.calendars,
    });
    throw err;
  }
  return getConnectionStatus();
}
