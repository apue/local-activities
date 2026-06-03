import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CollectorEventCandidate,
  CollectorEventCandidateQuery,
  CollectorEventCandidateStore,
} from "./collector-event-candidates-route-handlers";
import { getSupabaseAdminClient } from "./supabase-admin";

type CanonicalEventCandidateRow = {
  event_id: string;
  title: string;
  organizer: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: "Asia/Shanghai";
  city: "Beijing";
  venue_name: string | null;
  venue_address: string | null;
  source_url: string;
  schedule_text?: string | null;
  status: "draft" | "published" | "cancelled" | "withdrawn";
  published_at: string | null;
};

type DraftEventCandidateRow = {
  draft_id: string;
  title: string;
  organizer: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: "Asia/Shanghai";
  city: "Beijing";
  venue_name: string | null;
  venue_address: string | null;
  article_url: string;
  schedule_text?: string | null;
  review_state: string;
};

const candidateColumns = [
  "event_id",
  "title",
  "organizer",
  "starts_at",
  "ends_at",
  "timezone",
  "city",
  "venue_name",
  "venue_address",
  "source_url",
  "status",
  "published_at",
].join(",");

const draftCandidateColumns = [
  "draft_id",
  "title",
  "organizer",
  "starts_at",
  "ends_at",
  "timezone",
  "city",
  "venue_name",
  "venue_address",
  "article_url",
  "schedule_text",
  "review_state",
].join(",");

const candidateWindowMs = 14 * 24 * 60 * 60 * 1000;

export function getSupabaseCollectorEventCandidateStore(
  client = getSupabaseAdminClient(),
): CollectorEventCandidateStore {
  return new SupabaseCollectorEventCandidateStore(client);
}

class SupabaseCollectorEventCandidateStore
  implements CollectorEventCandidateStore
{
  constructor(private readonly client: SupabaseClient) {}

  async findEventCandidates(
    input: CollectorEventCandidateQuery,
  ): Promise<CollectorEventCandidate[]> {
    const canonical = await this.findCanonicalEventCandidates(input);
    const drafts = await this.findDraftEventCandidates(input);
    return [...canonical, ...drafts].slice(0, input.limit);
  }

  private async findCanonicalEventCandidates(
    input: CollectorEventCandidateQuery,
  ): Promise<CollectorEventCandidate[]> {
    let query = this.client
      .from("canonical_events")
      .select(candidateColumns)
      .in("status", ["published", "cancelled"]);

    if (input.sourceUrl) query = query.eq("source_url", input.sourceUrl);
    if (input.title) query = query.ilike("title", `%${input.title}%`);
    if (input.organizer) {
      query = query.ilike("organizer", `%${input.organizer}%`);
    }
    if (input.venueName) {
      query = query.ilike("venue_name", `%${input.venueName}%`);
    }
    if (input.venueAddress) {
      query = query.ilike("venue_address", `%${input.venueAddress}%`);
    }
    if (input.startsAt) {
      const window = buildCandidateWindow(input.startsAt, input.endsAt);
      query = query.gte("starts_at", window.start).lte("starts_at", window.end);
    }

    const { data, error } = await query
      .order("starts_at", { ascending: false })
      .limit(input.limit);
    if (error) throw new Error("event_candidate_lookup_failed");

    const rows = (data ?? []) as unknown as CanonicalEventCandidateRow[];
    return rows.map(mapCanonicalEventCandidateRow);
  }

  private async findDraftEventCandidates(
    input: CollectorEventCandidateQuery,
  ): Promise<CollectorEventCandidate[]> {
    let query = this.client
      .from("event_drafts")
      .select(draftCandidateColumns)
      .in("review_state", ["needs_review", "ready_for_review", "possible_duplicate"]);

    if (input.sourceUrl) query = query.eq("article_url", input.sourceUrl);
    if (input.title) query = query.ilike("title", `%${input.title}%`);
    if (input.organizer) {
      query = query.ilike("organizer", `%${input.organizer}%`);
    }
    if (input.venueName) {
      query = query.ilike("venue_name", `%${input.venueName}%`);
    }
    if (input.venueAddress) {
      query = query.ilike("venue_address", `%${input.venueAddress}%`);
    }
    if (input.startsAt) {
      const window = buildCandidateWindow(input.startsAt, input.endsAt);
      query = query.gte("starts_at", window.start).lte("starts_at", window.end);
    }

    const { data, error } = await query
      .order("starts_at", { ascending: false })
      .limit(input.limit);
    if (error) throw new Error("event_candidate_lookup_failed");

    const rows = (data ?? []) as unknown as DraftEventCandidateRow[];
    return rows.map(mapDraftEventCandidateRow);
  }
}

function buildCandidateWindow(startsAt: string, endsAt?: string) {
  const start = new Date(startsAt).getTime();
  const end = endsAt ? new Date(endsAt).getTime() : start;
  return {
    start: new Date(start - candidateWindowMs).toISOString(),
    end: new Date(end + candidateWindowMs).toISOString(),
  };
}

function mapDraftEventCandidateRow(
  row: DraftEventCandidateRow,
): CollectorEventCandidate {
  return {
    eventId: row.draft_id,
    title: row.title,
    organizer: row.organizer,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    city: row.city,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    sourceUrl: row.article_url,
    scheduleText: row.schedule_text,
    status: "draft",
    publishedAt: null,
  };
}

function mapCanonicalEventCandidateRow(
  row: CanonicalEventCandidateRow,
): CollectorEventCandidate {
  return {
    eventId: row.event_id,
    title: row.title,
    organizer: row.organizer,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    city: row.city,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    sourceUrl: row.source_url,
    scheduleText: row.schedule_text,
    status: row.status,
    publishedAt: row.published_at,
  };
}
