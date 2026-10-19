/**
 * Minimal CalDAV client for iCloud / generic CalDAV (PROPFIND + calendar-query).
 * Uses Basic auth with an app-specific password — never log credentials.
 *
 * @package @heizplan/api
 */

import type { CalendarInfo } from "@heizplan/shared";
import type { CalendarCredentials } from "./store.js";

export interface CalDavEvent {
  uid: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  calendarId: string;
  calendarHref: string;
  href: string;
}

export class CalDavError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "CalDavError";
    this.status = status;
  }
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function resolveUrl(base: string, href: string): string {
  if (/^https?:\/\//i.test(href)) {
    return href;
  }
  const origin = new URL(base);
  if (href.startsWith("/")) {
    return `${origin.origin}${href}`;
  }
  return new URL(href, base.endsWith("/") ? base : `${base}/`).toString();
}

async function caldavRequest(
  creds: CalendarCredentials,
  url: string,
  method: string,
  body: string,
  depth: string,
): Promise<string> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: basicAuth(creds.username, creds.appPassword),
      Depth: depth,
      "Content-Type": "application/xml; charset=utf-8",
      Accept: "application/xml, text/xml, */*",
    },
    body,
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  if (!res.ok) {
    // Never echo Authorization or body (may contain secrets in error pages).
    throw new CalDavError(
      `CalDAV ${method} failed (${res.status}) for ${new URL(url).pathname}`,
      res.status,
    );
  }
  return text;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractTag(xml: string, localName: string): string | null {
  const re = new RegExp(
    `<(?:[A-Za-z0-9_]+:)?${localName}[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${localName}>`,
    "i",
  );
  const m = xml.match(re);
  return m ? decodeXml(m[1].trim()) : null;
}

function extractAllHrefBlocks(xml: string): Array<{ href: string; block: string }> {
  const responses: Array<{ href: string; block: string }> = [];
  const re =
    /<(?:[A-Za-z0-9_]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?response>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const href = extractTag(block, "href");
    if (href) {
      responses.push({ href, block });
    }
  }
  return responses;
}

const PRINCIPAL_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal/></d:prop>
</d:propfind>`;

const HOME_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set/></d:prop>
</d:propfind>`;

const CALENDARS_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <cs:getctag/>
  </d:prop>
</d:propfind>`;

function calendarQueryBody(startIso: string, endIso: string): string {
  // CalDAV expects UTC timestamps like 20261019T183000Z
  const fmt = (iso: string): string => {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return (
      `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
      `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
    );
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${fmt(startIso)}" end="${fmt(endIso)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
}

function parsePrincipal(xml: string): string | null {
  const inner = extractTag(xml, "current-user-principal");
  if (!inner) {
    return null;
  }
  return extractTag(inner, "href");
}

function parseHomeSet(xml: string): string | null {
  const inner = extractTag(xml, "calendar-home-set");
  if (!inner) {
    return null;
  }
  return extractTag(inner, "href");
}

function isCalendarResource(block: string): boolean {
  return /<(?:[A-Za-z0-9_]+:)?calendar\b/i.test(block);
}

/**
 * Discover calendars for an iCloud / CalDAV account.
 * Does not return or log the app password.
 */
export async function discoverCalendars(
  creds: CalendarCredentials,
): Promise<CalendarInfo[]> {
  const rootXml = await caldavRequest(
    creds,
    creds.url,
    "PROPFIND",
    PRINCIPAL_BODY,
    "0",
  );
  const principalHref = parsePrincipal(rootXml);
  if (!principalHref) {
    throw new CalDavError("CalDAV: current-user-principal not found");
  }
  const principalUrl = resolveUrl(creds.url, principalHref);

  const homeXml = await caldavRequest(
    creds,
    principalUrl,
    "PROPFIND",
    HOME_BODY,
    "0",
  );
  const homeHref = parseHomeSet(homeXml);
  if (!homeHref) {
    throw new CalDavError("CalDAV: calendar-home-set not found");
  }
  const homeUrl = resolveUrl(creds.url, homeHref);

  const listXml = await caldavRequest(
    creds,
    homeUrl,
    "PROPFIND",
    CALENDARS_BODY,
    "1",
  );
  const calendars: CalendarInfo[] = [];
  for (const { href, block } of extractAllHrefBlocks(listXml)) {
    if (!isCalendarResource(block)) {
      continue;
    }
    const displayName = extractTag(block, "displayname") || href;
    const abs = resolveUrl(creds.url, href);
    calendars.push({
      id: href,
      href: abs,
      displayName,
    });
  }
  if (calendars.length === 0) {
    throw new CalDavError("CalDAV: no calendars found on account");
  }
  return calendars;
}

/** Parse iCalendar DATE-TIME / DATE into ISO. */
export function parseIcalDate(raw: string, params = ""): string {
  const value = raw.trim();
  if (/^\d{8}$/.test(value)) {
    const y = value.slice(0, 4);
    const mo = value.slice(4, 6);
    const d = value.slice(6, 8);
    // All-day: treat as local midnight UTC for matching windows.
    return `${y}-${mo}-${d}T00:00:00.000Z`;
  }
  const m = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/,
  );
  if (!m) {
    throw new Error(`Unsupported iCal date: ${value}`);
  }
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  if (m[7] === "Z" || /VALUE=DATE/i.test(params)) {
    return `${iso}.000Z`;
  }
  // Floating / TZID — interpret as UTC-ish wall clock (good enough for home LAN).
  if (/TZID=/i.test(params)) {
    return new Date(iso).toISOString();
  }
  return new Date(`${iso}Z`).toISOString();
}

function unfoldIcal(data: string): string {
  return data.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

/** Extract VEVENT fields from calendar-data payload. */
export function parseVEvents(
  calendarData: string,
  calendar: CalendarInfo,
  eventHref: string,
): CalDavEvent[] {
  const unfolded = unfoldIcal(calendarData);
  const events: CalDavEvent[] = [];
  const blocks = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  for (const chunk of blocks) {
    const body = chunk.split(/END:VEVENT/i)[0] ?? "";
    const uid = body.match(/^UID:(.*)$/im)?.[1]?.trim();
    const summary = body.match(/^SUMMARY:(.*)$/im)?.[1]?.trim() ?? "(ohne Titel)";
    const dtStartLine = body.match(/^(DTSTART[^:]*):(.*)$/im);
    const dtEndLine = body.match(/^(DTEND[^:]*):(.*)$/im);
    if (!uid || !dtStartLine) {
      continue;
    }
    const startParams = dtStartLine[1] ?? "";
    const startRaw = dtStartLine[2] ?? "";
    let startsAt: string;
    let endsAt: string;
    try {
      startsAt = parseIcalDate(startRaw, startParams);
      if (dtEndLine) {
        endsAt = parseIcalDate(dtEndLine[2] ?? "", dtEndLine[1] ?? "");
      } else {
        // Default 1h if no DTEND
        endsAt = new Date(Date.parse(startsAt) + 3_600_000).toISOString();
      }
    } catch {
      continue;
    }
    events.push({
      uid,
      summary: summary.replace(/\\,/g, ",").replace(/\\n/g, " "),
      startsAt,
      endsAt,
      calendarId: calendar.id,
      calendarHref: calendar.href,
      href: eventHref,
    });
  }
  return events;
}

/**
 * Fetch VEVENTs overlapping [from, to] across discovered calendars.
 */
export async function fetchEvents(
  creds: CalendarCredentials,
  calendars: CalendarInfo[],
  from: Date,
  to: Date,
): Promise<CalDavEvent[]> {
  const events: CalDavEvent[] = [];
  const startIso = from.toISOString();
  const endIso = to.toISOString();
  const body = calendarQueryBody(startIso, endIso);

  for (const cal of calendars) {
    const xml = await caldavRequest(creds, cal.href, "REPORT", body, "1");
    for (const { href, block } of extractAllHrefBlocks(xml)) {
      const data = extractTag(block, "calendar-data");
      if (!data) {
        continue;
      }
      events.push(...parseVEvents(data, cal, resolveUrl(creds.url, href)));
    }
  }

  return events.sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
}
