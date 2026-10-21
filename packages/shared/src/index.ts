/**
 * Shared domain types for API, PWA and bridge adapter.
 * @package @heizplan/shared
 */

/** How a zone display name was resolved. */
export type ZoneNameSource = "cloud" | "map" | "hap" | "mock";

/** Where open-window state was resolved from. */
export type WindowOpenSource =
  | "hap"
  | "cloud"
  | "fixture"
  | "manual"
  | "none";

/** Resume strategy after local auto-off when the window closes. */
export type OpenWindowResumeMode = "restore_setpoint" | "clear_overlay";

/** Single thermostat / accessory folded into a room tile. */
export interface ZoneDevice {
  id: string;
  name: string;
  serialNo?: string | null;
  /** Low-battery hint from HAP, if known. */
  batteryLow?: boolean | null;
  currentTempC?: number | null;
  targetTempC?: number | null;
  /** Contact / open-window hint from this accessory, if known. */
  windowOpen?: boolean | null;
}

/**
 * What currently drives the room off the Smart Schedule baseline.
 * - none: follows schedule (or unknown — see {@link followsSchedule})
 * - manual: user setpoint / PWA overlay / inferred setpoint drift
 * - calendar: active CalendarOverride rule
 */
export type ZoneOverlayControl = "none" | "manual" | "calendar";

/**
 * Why the room is not on the Smart Schedule baseline.
 * - manual_overlay: local PWA/HAP overlay tracker
 * - calendar: CalendarOverride
 * - setpoint_mismatch: HAP setpoint ≠ cached schedule setpoint for “now”
 */
export type ZoneOffScheduleReason =
  | "manual_overlay"
  | "calendar"
  | "setpoint_mismatch";

/** Heating zone / room as seen by the PWA / API. */
export interface Zone {
  id: string;
  name: string;
  /** Current temperature in °C, if known. */
  currentTempC: number | null;
  /** Target / setpoint temperature in °C, if heating. */
  targetTempC: number | null;
  /** Whether an overlay / manual setpoint is active. */
  overlayActive: boolean;
  /** ISO timestamp when a timed overlay ends (local tracker or fixture). */
  overlayEndsAt?: string | null;
  /**
   * Distinguishes manual vs calendar when {@link overlayActive} (or calendar
   * hold) is true. UI footer uses this instead of a generic “manual” hand.
   */
  overlayControl?: ZoneOverlayControl;
  /** Active calendar rule display name when overlayControl === "calendar". */
  calendarRuleName?: string | null;
  /** Active calendar rule id when overlayControl === "calendar". */
  calendarRuleId?: string | null;
  /**
   * True only when HAP setpoint matches the cached Smart Schedule setpoint
   * for now (±tolerance) and no calendar override is active.
   * Null when the schedule cache is missing (must not imply “on schedule”).
   */
  followsSchedule?: boolean | null;
  /** Cached schedule setpoint for “now” (Home timetable), if known. */
  scheduleTargetTempC?: number | null;
  /** Why the room is off-schedule when {@link followsSchedule} is false. */
  offScheduleReason?: ZoneOffScheduleReason | null;
  /** Heating power hint 0–100, if available. */
  heatingPowerPercent: number | null;
  /** Relative humidity 0–100, if a sensor is present. */
  humidityPercent?: number | null;
  /**
   * Legacy alias: true when {@link followsSchedule} is true.
   * Prefer followsSchedule — HAP alone cannot prove schedule compliance.
   */
  onSchedule?: boolean;
  /**
   * Open window detected for this room.
   * V3 Bridge HAP typically does not expose this — see windowSource.
   */
  windowOpen?: boolean;
  /** Provenance of {@link windowOpen}. */
  windowSource?: WindowOpenSource;
  /** ISO timestamp when open-window was first observed (local). */
  windowDetectedAt?: string | null;
  /** True while local auto-off holds heating off for an open window. */
  openWindowAutoOffActive?: boolean;
  /** ISO timestamp of last bridge update. */
  updatedAt: string | null;
  /** HAP accessory aids controlled by this room tile (aggregated). */
  deviceIds?: string[];
  /** Number of thermostats folded into this room. */
  deviceCount?: number;
  /** Devices belonging to this room (for detail screen). */
  devices?: ZoneDevice[];
  /** Where the friendly name came from. */
  nameSource?: ZoneNameSource;
  /**
   * Heat-up learning tip for room detail („Start empfohlen um …“).
   * Null when not enough ok samples yet.
   */
  heatupHint?: HeatupZoneHint | null;
}

/** Persisted open-window preferences (local, no paywall). */
export interface OpenWindowSettings {
  /**
   * When false, open windows are ignored (no badges, no auto-off).
   * Default true — show detection even if auto-off is off.
   */
  detectionEnabled: boolean;
  /** Default for all rooms unless overridden per room. */
  globalAutoOff: boolean;
  /**
   * After window closes and auto-off was applied:
   * - restore_setpoint: re-apply previous target + heat (default)
   * - clear_overlay: HAP clearOverlay / schedule approximation
   */
  resumeMode: OpenWindowResumeMode;
  /** Per-room override of globalAutoOff (room tile ids). */
  rooms: Record<string, { autoOff?: boolean }>;
}

export interface HapCapabilityAccessory {
  aid: number;
  name: string;
  services: Array<{
    type: string;
    name: string;
    characteristics: Array<{
      iid: number;
      type: string;
      name: string;
      format?: string;
      perms?: string[];
      value?: unknown;
    }>;
  }>;
  hasThermostat: boolean;
  hasContactSensor: boolean;
  hasHumidity: boolean;
  proprietaryServiceCount: number;
}

/** Diagnostic dump of what the paired V3 Bridge exposes over HAP. */
export interface HapCapabilitiesReport {
  generatedAt: string;
  paired: boolean;
  accessoryCount: number;
  thermostatCount: number;
  contactSensorCount: number;
  note: string;
  accessories: HapCapabilityAccessory[];
}

export interface HealthStatus {
  status: "ok" | "degraded";
  service: string;
  version: string;
  bridge: BridgeStatusSummary;
  timestamp: string;
}

export type BridgePairingState =
  | "unpaired"
  | "awaiting_pin"
  | "pairing"
  | "paired"
  | "error";

export interface BridgeStatusSummary {
  state: BridgePairingState;
  paired: boolean;
  message: string;
}

/** Naming metadata status for the room overview. */
export interface ZoneNamingInfo {
  /** Dominant / best naming source currently applied. */
  source: ZoneNameSource | "none";
  /** Last successful cloud metadata sync, if any. */
  syncedAt: string | null;
  /** Whether a Tado cloud refresh token is stored locally. */
  cloudLinked: boolean;
  /** Devices that still fall back to HAP serial labels. */
  unresolvedDeviceCount: number;
}

/**
 * Tado Cloud Home/Away (geofencing / presenceLock).
 * Not available via local HAP on V3 bridge — cloud cache only.
 */
export type HomePresenceMode = "unknown" | "home" | "away";

export type HomePresenceSource = "none" | "cloud" | "manual" | "cache";

export interface HomePresenceStatus {
  mode: HomePresenceMode;
  source: HomePresenceSource;
  /** From Tado `/homes/{id}/state` — manual lock vs geo Auto-Assist. */
  presenceLocked: boolean | null;
  /** ISO of last successful cloud fetch (or null). */
  fetchedAt: string | null;
  /** True when cache is older than the configured poll interval. */
  stale: boolean;
  /** Configured sparse poll interval (minutes). */
  ttlMinutes: number;
  message: string;
}

export interface ZonesResponse {
  zones: Zone[];
  source: "mock" | "bridge" | "empty";
  naming?: ZoneNamingInfo;
  /** Home/Away — cloud cache; never fetched on every zones poll. */
  presence?: HomePresenceStatus;
}

/** Cloud OAuth / metadata link status (names only — not live control). */
export interface CloudStatus {
  linked: boolean;
  homeId: number | null;
  homeName: string | null;
  syncedAt: string | null;
  deviceCount: number;
  zoneCount: number;
  message: string;
}

/**
 * Home-level cloud sync status (metadata + openWindow).
 * Schedules are cached per room and synced only on demand.
 */
export interface CloudSyncStatus {
  linked: boolean;
  /** Last successful home cloud sync (metadata ± openWindow). */
  lastSyncedAt: string | null;
  /** Configured auto-sync interval in hours (default 4). */
  autoSyncHours: number;
  /** True when lastSyncedAt is older than autoSyncHours (or never). */
  autoSyncDue: boolean;
  homeName: string | null;
  /** Per-room schedule cache timestamps (room-zN → ISO). */
  scheduleSyncedAt: Record<string, string>;
}

/**
 * Persistent daily budget for all Tado cloud HTTP calls
 * (metadata, schedule, openWindow, auth refresh, …).
 */
export interface CloudQuotaStatus {
  /** Requests already counted today (Europe/Berlin calendar day). */
  used: number;
  /** Configurable daily cap (default 80). */
  limit: number;
  remaining: number;
  /** ISO timestamp of next midnight Europe/Berlin. */
  resetsAt: string;
  /** Calendar day key YYYY-MM-DD in Europe/Berlin. */
  dayKey: string;
  /** True when remaining ≤ 10% of limit (min 5). */
  nearLimit: boolean;
  /** True when remaining === 0. */
  blocked: boolean;
  /** Optional last limit hint from response headers. */
  headerLimitHint: number | null;
}

/** One counted cloud HTTP call (no tokens/secrets). */
export interface CloudQuotaLogEntry {
  id: string;
  /** ISO timestamp. */
  at: string;
  /** Europe/Berlin day key when the call was counted. */
  dayKey: string;
  method: string;
  /** Path only (host stripped); never includes auth query secrets. */
  path: string;
  /** Human-readable reason, e.g. schedule.blocks. */
  label: string;
  /** Quota delta (usually 1). */
  delta: number;
  /** Optional group id when several calls belong to one user action (e.g. schedule sync). */
  groupId?: string | null;
  /** Optional group label, e.g. "Schedule lesen". */
  groupLabel?: string | null;
}

export interface CloudQuotaLogResponse {
  entries: CloudQuotaLogEntry[];
  /** Total entries retained in the ring buffer. */
  retained: number;
  /** Max ring size. */
  maxRetained: number;
  /** When true, only today's (Berlin) entries are included. */
  todayOnly: boolean;
  dayKey: string;
}

/** Day-type keys used by Tado timetable blocks. */
export type ScheduleDayType =
  | "MONDAY_TO_SUNDAY"
  | "MONDAY_TO_FRIDAY"
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";

export type TimetableKind = "ONE_DAY" | "THREE_DAY" | "SEVEN_DAY";

export type SchedulePresence = "HOME" | "AWAY";

/** One heating block in a Smart Schedule day. */
export interface ScheduleBlock {
  dayType: ScheduleDayType;
  /** HH:MM (24h). */
  start: string;
  /** HH:MM (24h); "00:00" at end of day means 24:00. */
  end: string;
  power: "ON" | "OFF";
  tempC: number | null;
  geolocationOverride?: boolean;
}

/** Away mode is a single setpoint (not a day timetable) in the Tado API. */
export interface AwayConfiguration {
  power: "ON" | "OFF";
  tempC: number | null;
}

/** Smart Schedule snapshot for one cloud zone (Home timetable + Away). */
export interface ZoneSchedule {
  roomId: string;
  cloudZoneId: number;
  zoneName: string;
  timetableType: TimetableKind;
  timetableTypeId: 0 | 1 | 2;
  /** Blocks for the active Home timetable (all dayTypes). */
  homeBlocks: ScheduleBlock[];
  away: AwayConfiguration;
  fetchedAt: string;
}

/** PUT body to persist Home day blocks or Away config to the Tado cloud. */
export interface ZoneScheduleUpdate {
  presence: SchedulePresence;
  /** Required when presence=HOME — replace all blocks for this dayType. */
  dayType?: ScheduleDayType;
  blocks?: ScheduleBlock[];
  /** Active / target timetable id (required for HOME writes). */
  timetableTypeId?: 0 | 1 | 2;
  /**
   * When true, PUT activeTimetable before writing blocks
   * (extra cloud request — only when the user changes ONE/THREE/SEVEN day mode).
   */
  switchActiveTimetable?: boolean;
  /** Required when presence=AWAY. */
  away?: AwayConfiguration;
}

export interface CloudAuthStart {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface CloudAuthPollResult {
  status: "pending" | "linked" | "expired" | "error";
  message: string;
  cloud?: CloudStatus;
}

/**
 * CalendarOverride layer — priority above manual overlay and cloud baseline:
 *   CalendarOverride (time-bounded) > manual room overlay > Smart Schedule (cloud baseline)
 *
 * Prefer HAP overlay (0 cloud spend). Cloud writes reuse CloudQuota
 * (`remaining` / `resetsAt`) via schedule-service — never a second counter.
 */

/** How a calendar event is matched. */
export type CalendarMatchKind =
  | "title_contains"
  | "title_equals"
  | "title_regex"
  /** Exact CalDAV UID(s) from the event picker (supports multi-select). */
  | "event_uid";

/**
 * When relative to the calendar event the rule applies.
 * Plain-language mapping (UI, heat):
 * - during → „Während des ganzen Termins“
 * - before → „Rechtzeitig vor dem Termin warm“ (target reached at start − readyMinutesBefore)
 * - after  → „Nach dem Termin wieder warm“ (target reached at end + readyMinutesAfter)
 *
 * Legacy aliases `at_start` / `at_end` normalise to before / after.
 */
export type CalendarRuleTiming = "during" | "before" | "after";

/** @deprecated Prefer {@link CalendarRuleTiming} `before` / `after`. */
export type CalendarRuleTimingLegacy = "at_start" | "at_end";

/** Where the override is applied. */
export type CalendarApplyPath = "hap_overlay" | "cloud_write";

export type CalendarRuleMode = "heat" | "off" | "eco";

/**
 * When a calendar rule may apply relative to Tado Home/Away.
 * Plain UI: Immer / Nur wenn jemand zu Hause / Nur wenn niemand zu Hause.
 */
export type CalendarPresenceCondition = "always" | "home" | "away";

export interface CalendarRuleMatch {
  kind: CalendarMatchKind;
  /**
   * Title pattern (contains/equals/regex) or primary event UID.
   * For event_uid multi-select see {@link eventUids}.
   */
  value: string;
  /** When kind=event_uid: all selected UIDs (value is usually the first). */
  eventUids?: string[];
}

/** Persisted user rule (no secrets). */
export interface CalendarRule {
  id: string;
  /** Human name — required for new rules from the wizard. */
  name: string;
  enabled: boolean;
  /**
   * Restrict to one discovered calendar href/id; null = all calendars
   * on the configured CalDAV account.
   */
  calendarId: string | null;
  match: CalendarRuleMatch;
  /**
   * Rooms to heat (or legacy single-mode room list when offRoomIds empty
   * and mode=off).
   */
  roomIds: string[];
  /** Rooms to switch off while the rule applies. */
  offRoomIds: string[];
  /**
   * Legacy single mode for roomIds when offRoomIds is empty.
   * Wizard prefers roomIds=heat + offRoomIds=off with mode=heat.
   */
  mode: CalendarRuleMode;
  /** Setpoint for heated rooms; ignored for pure off. */
  targetTempC: number | null;
  /**
   * When heat rooms apply relative to the event (default during).
   * Plain UI: „Wann heizen?“ under „Räume heizen“.
   */
  timing: CalendarRuleTiming;
  /**
   * When off rooms apply relative to the event (default during).
   * Plain UI: „Wann ausschalten?“ under „Räume ausschalten“.
   */
  offTiming: CalendarRuleTiming;
  /**
   * For `before`: minutes before event start when the setpoint should already
   * be reached (e.g. 60 → Bad warm um 7:00 bei Termin 8:00). Default 60.
   */
  readyMinutesBefore: number;
  /**
   * For `after`: minutes after event end when the setpoint should be reached
   * (e.g. 60 → Schlafzimmer warm um 14:00 bei Ende 13:00). Default 60.
   */
  readyMinutesAfter: number;
  /**
   * Default hap_overlay (local, quota-free).
   * cloud_write only when remaining > 0 and the engine opts in.
   */
  applyPath: CalendarApplyPath;
  /**
   * Geofencing gate (default always).
   * When home/away and current presence does not match (or is unknown),
   * the rule is not applied.
   */
  presenceCondition: CalendarPresenceCondition;
  /** Higher wins when multiple rules match the same room. */
  priority: number;
  createdAt: string;
  updatedAt: string;
}

/** @deprecated Use {@link CalendarRule} — kept for earlier schedule-sync hooks. */
export interface CalendarRuleHook {
  matchValue: string;
  roomId: string;
  targetTempC: number | null;
  mode: CalendarRuleMode;
  endsAt?: string | null;
}

/** Public connection status — never includes the app password. */
export interface CalendarConnectionStatus {
  configured: boolean;
  /** CalDAV base URL (e.g. https://caldav.icloud.com). */
  url: string | null;
  username: string | null;
  /** Apple ID / CalDAV user is set (password never exposed). */
  hasPassword: boolean;
  /** Last successful CalDAV discovery / event fetch. */
  lastOkAt: string | null;
  lastError: string | null;
  calendars: CalendarInfo[];
}

export interface CalendarInfo {
  id: string;
  href: string;
  displayName: string;
}

/** Body to save CalDAV credentials (password write-only). */
export interface CalendarConnectionUpdate {
  url: string;
  username: string;
  /** Omit or empty to keep the previously stored password. */
  appPassword?: string;
}

/** One currently applied calendar override (runtime + persisted). */
export interface CalendarActiveOverride {
  ruleId: string;
  ruleName: string;
  roomId: string;
  eventUid: string;
  eventSummary: string;
  startsAt: string;
  endsAt: string;
  appliedAt: string;
  applyPath: CalendarApplyPath;
  targetTempC: number | null;
  mode: CalendarRuleMode;
  /** Cloud path: baseline restore still pending after endsAt. */
  needsRestore: boolean;
}

export interface CalendarEvaluateResult {
  matched: number;
  applied: number;
  cleared: number;
  skippedQuota: number;
  active: CalendarActiveOverride[];
  quota: CloudQuotaStatus;
  eventsFetched: number;
  evaluatedAt: string;
  message: string;
}

/** Upcoming CalDAV event for the PWA picker (no secrets). */
export interface CalendarEventPreview {
  uid: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  calendarId: string;
  calendarName: string;
  /** True when this UID is in the persisted selection. */
  selected: boolean;
}

export interface CalendarEventsResponse {
  events: CalendarEventPreview[];
  /** UIDs Jonas marked as “berücksichtigen”. Empty = all events (pattern-only). */
  selectedUids: string[];
  fetchedAt: string;
  /** When true, evaluate only considers selected UIDs. */
  selectionActive: boolean;
}

export interface CalendarEventSelectionUpdate {
  selectedUids: string[];
}

export interface CalendarStatusResponse {
  connection: CalendarConnectionStatus;
  rules: CalendarRule[];
  active: CalendarActiveOverride[];
  quota: CloudQuotaStatus;
  /** Persisted event UIDs to consider (may be empty). */
  selectedUids: string[];
  /** Cached Home/Away (disk-only; refresh via /api/cloud/presence). */
  presence: HomePresenceStatus;
}

/** @deprecated Prefer HeatupRoomSummary / HeatupPrediction. */
export interface HeatupLearningHook {
  roomId: string;
  sampleCount: number;
  estimatedPreheatMinutes: number | null;
}

/** Outdoor temperature provider used for heat-up features. */
export type OutdoorProviderId = "brightsky" | "openmeteo" | "stub";

export type HeatupSampleQuality = "ok" | "rejected";

export type HeatupRejectReason =
  | "window_open"
  | "manual_abort"
  | "target_changed"
  | "too_short"
  | "stalled"
  | "delta_too_small";

/** One completed heat-up observation for a room. */
export interface HeatupSample {
  id: string;
  roomId: string;
  startedAt: string;
  endedAt: string;
  startTempC: number;
  targetTempC: number;
  deltaTC: number;
  outdoorTempC: number | null;
  durationMinutes: number;
  quality: HeatupSampleQuality;
  rejectReason?: HeatupRejectReason | null;
}

export type HeatupConfidence = "low" | "medium" | "high" | "none";

/** Prediction backend: Model 0 EMA → Model 3 OLS → manual fallback. */
export type HeatupPredictMethod =
  | "model0"
  | "model3"
  | "manual"
  | "bucket"
  | "none";

/** Compact heat-up tip embedded on a zone tile / detail payload. */
export interface HeatupZoneHint {
  recommendedStartAt: string | null;
  estimatedMinutes: number | null;
  outdoorTempC: number | null;
  method: HeatupPredictMethod;
  message: string;
  sampleCount: number;
}

/** Recommended preheat timing for a target (e.g. Bad 07:00 → 22°C). */
export interface HeatupPrediction {
  roomId: string;
  targetTempC: number;
  currentTempC: number | null;
  outdoorTempC: number | null;
  outdoorProvider: OutdoorProviderId | null;
  estimatedMinutes: number | null;
  /** ISO time to start heating so the room reaches target by `readyAt`. */
  recommendedStartAt: string | null;
  readyAt: string;
  confidence: HeatupConfidence;
  method: HeatupPredictMethod;
  sampleCount: number;
  message: string;
}

export interface HeatupRoomSummary {
  roomId: string;
  okSampleCount: number;
  rejectedSampleCount: number;
  lastSampleAt: string | null;
  /** True when UI may show “Start empfohlen um …”. */
  readyForUi: boolean;
  latestPrediction: HeatupPrediction | null;
}

export interface HeatupStatus {
  provider: OutdoorProviderId;
  fallback: OutdoorProviderId | null;
  lat: number;
  lon: number;
  lastOutdoorTempC: number | null;
  lastOutdoorAt: string | null;
  lastOutdoorSource: OutdoorProviderId | null;
  message: string;
}

/* -------------------------------------------------------------------------- */
/* Protocol / event log (Heizplan › Protokoll)                                 */
/* -------------------------------------------------------------------------- */

/** Coarse filter chips in the Protokoll UI. */
export type ProtocolEventCategory =
  | "polling"
  | "user"
  | "feedback"
  | "calendar"
  | "presence"
  | "quota"
  | "window"
  | "heatup"
  | "schedule"
  | "bridge"
  | "system";

/**
 * Stable event type ids — keep additive; UI maps to German labels.
 * Never put tokens/secrets in related detail payloads.
 */
export type ProtocolEventType =
  | "polling.zones"
  | "polling.calendar"
  | "user.setpoint"
  | "user.power"
  | "user.resume_schedule"
  | "user.quick_action"
  | "user.settings"
  | "user.navigate"
  | "feedback.error"
  | "feedback.success"
  | "calendar.override_apply"
  | "calendar.override_clear"
  | "presence.home"
  | "presence.away"
  | "presence.changed"
  | "quota.near_limit"
  | "quota.blocked"
  /** Mirrored from cloud-quota-log — each counted Cloud HTTP call. */
  | "quota.request"
  | "window.open"
  | "window.closed"
  | "window.auto_off"
  | "window.resume"
  | "heatup.accept"
  | "heatup.reject"
  | "heatup.started"
  | "schedule.sync"
  | "schedule.home_sync"
  | "bridge.disconnect"
  | "bridge.reconnect"
  | "bridge.error"
  | "system.info";

/** One protocol ring-buffer entry (persisted under bridge data). */
export interface ProtocolEvent {
  id: string;
  /** ISO timestamp. */
  at: string;
  /** Europe/Berlin day key YYYY-MM-DD. */
  dayKey: string;
  category: ProtocolEventCategory;
  type: ProtocolEventType;
  /** Short German summary for the list. */
  message: string;
  roomId?: string | null;
  /**
   * Optional safe detail bag (strings/numbers/bools only).
   * Never include tokens, PINs, passwords, or full URLs with query secrets.
   */
  detail?: Record<string, string | number | boolean | null> | null;
}

export interface ProtocolEventsQuery {
  /** Filter by category (omit / "all" = no filter). */
  category?: ProtocolEventCategory | "all";
  /** Substring match on message + type (case-insensitive). */
  q?: string;
  /** ISO lower bound (inclusive). */
  since?: string;
  /** ISO upper bound (inclusive). */
  until?: string;
  /** Max entries to return (newest first). */
  limit?: number;
  /** When true, only today's Berlin day. */
  todayOnly?: boolean;
}

export interface ProtocolEventsResponse {
  entries: ProtocolEvent[];
  retained: number;
  maxRetained: number;
  dayKey: string;
  todayOnly: boolean;
  categories: ProtocolEventCategory[];
}
