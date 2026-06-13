import { notFound } from "next/navigation";

import { extractFirstHttpUrl } from "../shared/seed-url";
import { getSupabaseAdminClient } from "./supabase-admin";

export type PublicEventsClient = {
  from(table: "canonical_events"): PublicEventsQuery;
};

type PublicEventsQuery = {
  select(columns: string): PublicEventsQuery;
  eq(column: string, value: string): PublicEventsQuery;
  or(filter: string): PublicEventsQuery;
  order(column: string, options: { ascending: boolean }): PublicEventsQuery;
  limit(count: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
  maybeSingle?<T>(): PromiseLike<{ data: T | null; error: unknown }>;
};

export type CanonicalEventRow = {
  event_id: string;
  data_class?: "production" | "eval" | "test" | "smoke" | null;
  eval_run_id?: string | null;
  title: string;
  organizer: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: "Asia/Shanghai";
  city: "Beijing";
  venue_name: string | null;
  venue_address: string | null;
  reservation_status: "required" | "not_required" | "unknown";
  registration_action: string | null;
  registration_url: string | null;
  source_url: string;
  poster_image_url?: string | null;
  poster_image_alt?: string | null;
  poster_image_source_url?: string | null;
  registration_qr_image_url?: string | null;
  registration_qr_image_alt?: string | null;
  summary: string | null;
  schedule_text?: string | null;
  public_eligibility?: "public" | "not_public" | "unclear" | null;
  event_kind?:
    | "single"
    | "multi_day"
    | "long_running"
    | "recurring"
    | "news"
    | "visit"
    | "cancellation"
    | "unsupported"
    | null;
  schedule_kind?:
    | "single"
    | "multi_day"
    | "long_running"
    | "recurring"
    | "unsupported"
    | null;
  recurrence_rule?: string | null;
  occurrence_starts_at?: string[] | null;
  poster_asset_id?: string | null;
  qr_asset_id?: string | null;
  registration_qr_asset_id?: string | null;
  resolution_decision?:
    | "new_event"
    | "same_event"
    | "update_existing"
    | "cancel_existing"
    | "withdraw_existing"
    | "not_public_activity"
    | "insufficient_info"
    | null;
  hard_blockers?: Array<Record<string, unknown>> | null;
  soft_blockers?: Array<Record<string, unknown>> | null;
  entry_notes: string | null;
  status: "draft" | "published" | "cancelled" | "withdrawn";
  published_at: string | null;
};

export type PublicEvent = {
  eventId: string;
  title: string;
  organizer?: string;
  startsAt: string;
  endsAt?: string;
  timezone: "Asia/Shanghai";
  city: "Beijing";
  venueName?: string;
  venueAddress?: string;
  reservationStatus: "required" | "not_required" | "unknown";
  registrationAction?: string;
  registrationUrl?: string;
  sourceUrl: string;
  posterImageUrl?: string;
  posterImageAlt?: string;
  posterImageSourceUrl?: string;
  registrationQrImageUrl?: string;
  registrationQrImageAlt?: string;
  summary?: string;
  scheduleText?: string;
  scheduleKind?: NonNullable<CanonicalEventRow["schedule_kind"]>;
  recurrenceRule?: string;
  occurrenceStartsAt?: string[];
  entryNotes?: string;
  status: "published";
};

type PublicScheduleInput = {
  starts_at?: string;
  startsAt?: string;
  ends_at?: string | null;
  endsAt?: string;
  schedule_text?: string | null;
  scheduleText?: string;
  schedule_kind?: CanonicalEventRow["schedule_kind"];
  scheduleKind?: PublicEvent["scheduleKind"];
  occurrence_starts_at?: string[] | null;
  occurrenceStartsAt?: string[];
};

export type PublicEventReadDataClass = "production" | "eval";

export type PublicEventReadOptions =
  | Date
  | {
      dataClass?: PublicEventReadDataClass;
      evalRunId?: string;
      now?: Date;
    };

type NormalizedPublicEventReadOptions = {
  dataClass: PublicEventReadDataClass;
  evalRunId?: string;
  now: Date;
};

const basePublicEventColumns = [
  "event_id",
  "title",
  "organizer",
  "starts_at",
  "ends_at",
  "timezone",
  "city",
  "venue_name",
  "venue_address",
  "reservation_status",
  "registration_action",
  "registration_url",
  "source_url",
  "summary",
  "schedule_text",
  "public_eligibility",
  "event_kind",
  "schedule_kind",
  "recurrence_rule",
  "occurrence_starts_at",
  "resolution_decision",
  "entry_notes",
  "status",
  "published_at",
].join(",");

const publicEventColumns = [
  basePublicEventColumns,
  "poster_image_url",
  "poster_image_alt",
  "poster_image_source_url",
  "registration_qr_image_url",
  "registration_qr_image_alt",
].join(",");

export async function listPublicUpcomingEvents(
  options: PublicEventReadOptions = new Date(),
) {
  return listPublicUpcomingEventsFromClient(
    getSupabaseAdminClient() as unknown as PublicEventsClient,
    options,
  );
}

export async function listPublicArchiveEvents(options?: PublicEventReadOptions) {
  return listPublicArchiveEventsFromClient(
    getSupabaseAdminClient() as unknown as PublicEventsClient,
    options,
  );
}

export async function listPublicUpcomingEventsFromClient(
  client: PublicEventsClient,
  options: PublicEventReadOptions = new Date(),
) {
  const scope = normalizePublicEventReadOptions(options);
  const first = await queryPublicUpcomingEvents(client, publicEventColumns, scope);
  const { data, error } =
    first.error && isMissingOptionalPublicAssetColumnError(first.error)
      ? await queryPublicUpcomingEvents(client, basePublicEventColumns, scope)
      : first;

  if (error) return [];

  return filterUpcomingPublishedEvents(
    (data ?? []) as unknown as CanonicalEventRow[],
    scope.now,
  ).map(shapePublicEvent);
}

export async function listPublicArchiveEventsFromClient(
  client: PublicEventsClient,
  options?: PublicEventReadOptions,
) {
  const scope = normalizePublicEventReadOptions(options);
  const first = await queryPublicArchiveEvents(client, publicEventColumns, scope);
  const { data, error } =
    first.error && isMissingOptionalPublicAssetColumnError(first.error)
      ? await queryPublicArchiveEvents(client, basePublicEventColumns, scope)
      : first;

  if (error) return [];

  return filterPublicRenderablePublishedEvents(
    (data ?? []) as unknown as CanonicalEventRow[],
  ).map(shapePublicEvent);
}

export async function getPublicEvent(
  eventId: string,
  options: PublicEventReadOptions = new Date(),
) {
  const event = await getPublicEventFromClient(
    getSupabaseAdminClient() as unknown as PublicEventsClient,
    eventId,
    options,
  );

  if (!event) notFound();
  return event;
}

export async function getPublicEventFromClient(
  client: PublicEventsClient,
  eventId: string,
  options: PublicEventReadOptions = new Date(),
) {
  const scope = normalizePublicEventReadOptions(options);
  const first = await queryPublicEvent(client, publicEventColumns, eventId, scope);
  const { data, error } =
    first.error && isMissingOptionalPublicAssetColumnError(first.error)
      ? await queryPublicEvent(client, basePublicEventColumns, eventId, scope)
      : first;

  if (error) throw new Error("public_event_read_failed");
  if (!data) return null;

  const [event] = filterPublicRenderablePublishedEvents([data]);
  if (!event) return null;
  return shapePublicEvent(event);
}

function queryPublicUpcomingEvents(
  client: PublicEventsClient,
  columns: string,
  scope: NormalizedPublicEventReadOptions,
) {
  return applyPublicEventReadScope(
    client
    .from("canonical_events")
    .select(columns)
    .eq("status", "published"),
    scope,
  )
    .or(buildUpcomingEventFilter(scope.now))
    .order("starts_at", { ascending: true })
    .limit(100);
}

function queryPublicArchiveEvents(
  client: PublicEventsClient,
  columns: string,
  scope: NormalizedPublicEventReadOptions,
) {
  return applyPublicEventReadScope(
    client
    .from("canonical_events")
    .select(columns)
    .eq("status", "published"),
    scope,
  )
    .order("starts_at", { ascending: false })
    .limit(200);
}

function queryPublicEvent(
  client: PublicEventsClient,
  columns: string,
  eventId: string,
  scope: NormalizedPublicEventReadOptions,
) {
  const query = applyPublicEventReadScope(
    client
    .from("canonical_events")
    .select(columns)
    .eq("event_id", eventId)
    .eq("status", "published"),
    scope,
  );

  if (!query.maybeSingle) {
    throw new Error("public_event_client_missing_maybe_single");
  }

  return query.maybeSingle<CanonicalEventRow>();
}

export function normalizePublicEventReadOptions(
  options?: PublicEventReadOptions,
): NormalizedPublicEventReadOptions {
  if (options instanceof Date) {
    return {
      dataClass: "production",
      now: options,
    };
  }

  const dataClass = options?.dataClass ?? "production";
  const evalRunId = options?.evalRunId?.trim();
  if (dataClass === "eval" && !evalRunId) {
    throw new Error("public_event_eval_run_id_required");
  }
  if (dataClass !== "eval" && evalRunId) {
    throw new Error("public_event_eval_run_id_scope_invalid");
  }

  return {
    dataClass,
    evalRunId,
    now: options?.now ?? new Date(),
  };
}

function applyPublicEventReadScope(
  query: PublicEventsQuery,
  scope: NormalizedPublicEventReadOptions,
) {
  const scoped = query.eq("data_class", scope.dataClass);
  if (scope.dataClass === "eval") {
    return scoped.eq("eval_run_id", scope.evalRunId ?? "");
  }
  return scoped;
}

function isMissingOptionalPublicAssetColumnError(error: unknown) {
  const message =
    typeof error === "object" && error && "message" in error
      ? String(error.message)
      : String(error ?? "");
  return (
    message.includes("poster_image_url") ||
    message.includes("poster_image_alt") ||
    message.includes("poster_image_source_url") ||
    message.includes("registration_qr_image_url") ||
    message.includes("registration_qr_image_alt")
  );
}

export function filterUpcomingPublishedEvents(
  events: CanonicalEventRow[],
  now = new Date(),
) {
  return filterPublicRenderablePublishedEvents(events)
    .filter((event) => {
      return getPublicEventEndTime(event, now) >= now.getTime();
    })
    .sort((a, b) => getPublicEventSortTime(a, now) - getPublicEventSortTime(b, now))
    .filter((event, index, sorted) => {
      const key = buildPublicEventDedupeKey(event);
      return (
        sorted.findIndex((candidate) => buildPublicEventDedupeKey(candidate) === key) ===
        index
      );
    });
}

export function filterPublicRenderablePublishedEvents(events: CanonicalEventRow[]) {
  return events
    .filter((event) => event.status === "published")
    .filter(isPublicRenderableEvent);
}

export function buildUpcomingEventFilter(now = new Date()) {
  const nowIso = now.toISOString();
  return `starts_at.gte.${nowIso},ends_at.gte.${nowIso},schedule_kind.eq.recurring`;
}

export function shapePublicEvent(row: CanonicalEventRow): PublicEvent {
  return {
    eventId: row.event_id,
    title: row.title,
    organizer: row.organizer ?? undefined,
    startsAt: row.starts_at,
    endsAt: row.ends_at ?? undefined,
    timezone: row.timezone,
    city: row.city,
    venueName: row.venue_name ?? undefined,
    venueAddress: row.venue_address ?? undefined,
    reservationStatus: row.reservation_status,
    registrationAction: row.registration_action ?? undefined,
    registrationUrl: row.registration_url ?? undefined,
    sourceUrl: extractFirstHttpUrl(row.source_url) ?? row.source_url,
    posterImageUrl: row.poster_image_url ?? undefined,
    posterImageAlt: row.poster_image_alt ?? undefined,
    posterImageSourceUrl: row.poster_image_source_url ?? undefined,
    registrationQrImageUrl: row.registration_qr_image_url ?? undefined,
    registrationQrImageAlt: row.registration_qr_image_alt ?? undefined,
    summary: row.summary ?? undefined,
    scheduleText: row.schedule_text ?? undefined,
    scheduleKind: row.schedule_kind ?? undefined,
    recurrenceRule: row.recurrence_rule ?? undefined,
    occurrenceStartsAt: row.occurrence_starts_at ?? undefined,
    entryNotes: row.entry_notes ?? undefined,
    status: "published",
  };
}

function isPublicRenderableEvent(event: CanonicalEventRow) {
  if (event.public_eligibility === "not_public") return false;
  if (
    event.event_kind === "news" ||
    event.event_kind === "visit" ||
    event.event_kind === "cancellation"
  ) {
    return false;
  }
  return (
    event.resolution_decision !== "not_public_activity" &&
    event.resolution_decision !== "insufficient_info"
  );
}

export function formatReservationStatus(
  status: PublicEvent["reservationStatus"],
) {
  return status === "required" ? "需要预约" : "无需预约";
}

export function formatPublicEventTime(
  event:
    | Pick<CanonicalEventRow, "starts_at" | "ends_at">
    | Pick<PublicEvent, "startsAt" | "endsAt">,
) {
  const startsAt = "starts_at" in event ? event.starts_at : event.startsAt;
  const endsAt = "ends_at" in event ? event.ends_at : event.endsAt;
  const start = new Date(startsAt);
  const date = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Shanghai",
  }).format(start);
  const startTime = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(start);

  if (!endsAt) return `${date} ${startTime}`;

  const endTime = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(endsAt));

  return `${date} ${startTime}-${endTime}`;
}

export function formatPublicEventSchedule(
  event: PublicScheduleInput,
  now = new Date(),
) {
  const scheduleText = event.schedule_text ?? event.scheduleText;
  if (scheduleText) return scheduleText;

  const scheduleKind = event.schedule_kind ?? event.scheduleKind;
  const startsAt = event.starts_at ?? event.startsAt;
  const endsAt = event.ends_at ?? event.endsAt;

  if (!startsAt) return "时间待定";

  if (scheduleKind === "recurring") {
    const occurrences = event.occurrence_starts_at ?? event.occurrenceStartsAt;
    const upcoming = getUpcomingOccurrence(occurrences, now);
    if (upcoming) return `每周 · 下次 ${formatPublicEventTime({ startsAt: upcoming })}`;
  }

  if ((scheduleKind === "multi_day" || scheduleKind === "long_running") && endsAt) {
    return formatDateRange(startsAt, endsAt);
  }

  return formatPublicEventTime({ startsAt, endsAt: endsAt ?? undefined });
}

export function formatPublicEventOccurrences(event: PublicScheduleInput) {
  const occurrences = event.occurrence_starts_at ?? event.occurrenceStartsAt ?? [];
  return occurrences.map((startsAt) => formatPublicEventTime({ startsAt }));
}

export function isPublicEventEnded(event: PublicScheduleInput, now = new Date()) {
  const occurrences = event.occurrence_starts_at ?? event.occurrenceStartsAt;
  const upcomingOccurrence = getUpcomingOccurrence(occurrences, now);
  if (upcomingOccurrence) return false;

  const startsAt = event.starts_at ?? event.startsAt;
  const endsAt = event.ends_at ?? event.endsAt;
  if (!startsAt) return false;

  const endTime = Date.parse(endsAt ?? startsAt);
  return Number.isFinite(endTime) && endTime < now.getTime();
}

function getPublicEventEndTime(event: CanonicalEventRow, now: Date) {
  const upcomingOccurrence = getUpcomingOccurrence(event.occurrence_starts_at, now);
  if (upcomingOccurrence) return Date.parse(upcomingOccurrence);
  return Date.parse(event.ends_at ?? event.starts_at);
}

function getPublicEventSortTime(event: CanonicalEventRow, now: Date) {
  const upcomingOccurrence = getUpcomingOccurrence(event.occurrence_starts_at, now);
  return Date.parse(upcomingOccurrence ?? event.starts_at);
}

function getUpcomingOccurrence(
  occurrences: string[] | null | undefined,
  now: Date,
) {
  return (occurrences ?? [])
    .filter((occurrence) => Date.parse(occurrence) >= now.getTime())
    .sort()[0];
}

function buildPublicEventDedupeKey(event: CanonicalEventRow) {
  return [
    normalizePublicKeyPart(event.title),
    event.starts_at,
    normalizePublicKeyPart(event.venue_name ?? event.venue_address ?? ""),
  ].join("|");
}

function normalizePublicKeyPart(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

function formatDateRange(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const startDate = formatMonthDay(start);
  const endDate = formatMonthDay(end);
  const startTime = formatClockTime(start);
  const endTime = formatClockTime(end);

  if (startDate === endDate) return `${startDate} ${startTime}-${endTime}`;
  return `${startDate}-${endDate} ${startTime}-${endTime}`;
}

function formatMonthDay(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function formatClockTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(date);
}
