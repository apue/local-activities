import { notFound } from "next/navigation";

import { getSupabaseAdminClient } from "./supabase-admin";

type PublicEventsClient = {
  from(table: "canonical_events"): {
    select(columns: string): {
      eq(column: string, value: string): {
        or(filter: string): {
          order(
            column: string,
            options: { ascending: boolean },
          ): {
            limit(
              count: number,
            ): PromiseLike<{ data: unknown[] | null; error: unknown }>;
          };
        };
      };
    };
  };
};

export type CanonicalEventRow = {
  event_id: string;
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
  summary: string | null;
  schedule_text?: string | null;
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
  summary?: string;
  scheduleText?: string;
  entryNotes?: string;
  status: "published";
};

const publicEventColumns = [
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
  "entry_notes",
  "status",
  "published_at",
].join(",");

export async function listPublicUpcomingEvents(now = new Date()) {
  return listPublicUpcomingEventsFromClient(
    getSupabaseAdminClient() as unknown as PublicEventsClient,
    now,
  );
}

export async function listPublicUpcomingEventsFromClient(
  client: PublicEventsClient,
  now = new Date(),
) {
  const { data, error } = await client
    .from("canonical_events")
    .select(publicEventColumns)
    .eq("status", "published")
    .or(buildUpcomingEventFilter(now))
    .order("starts_at", { ascending: true })
    .limit(100);

  if (error) return [];

  return filterUpcomingPublishedEvents(
    (data ?? []) as unknown as CanonicalEventRow[],
    now,
  ).map(shapePublicEvent);
}

export async function getPublicEvent(eventId: string, now = new Date()) {
  const { data, error } = await getSupabaseAdminClient()
    .from("canonical_events")
    .select(publicEventColumns)
    .eq("event_id", eventId)
    .eq("status", "published")
    .maybeSingle<CanonicalEventRow>();

  if (error) throw new Error("public_event_read_failed");
  if (!data) notFound();

  const [event] = filterUpcomingPublishedEvents([data], now);
  if (!event) notFound();
  return shapePublicEvent(event);
}

export function filterUpcomingPublishedEvents(
  events: CanonicalEventRow[],
  now = new Date(),
) {
  return events
    .filter((event) => event.status === "published")
    .filter((event) => {
      const relevantEnd = event.ends_at ?? event.starts_at;
      return Date.parse(relevantEnd) >= now.getTime();
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

export function buildUpcomingEventFilter(now = new Date()) {
  const nowIso = now.toISOString();
  return `starts_at.gte.${nowIso},ends_at.gte.${nowIso}`;
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
    sourceUrl: row.source_url,
    summary: row.summary ?? undefined,
    scheduleText: row.schedule_text ?? undefined,
    entryNotes: row.entry_notes ?? undefined,
    status: "published",
  };
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
