import { z } from "zod";

import { authenticateCollectorRequest } from "./collector-auth";

type CollectorEventCandidatesEnv = {
  [key: string]: string | undefined;
  COLLECTOR_API_KEY?: string;
};

export type CollectorEventCandidateQuery = {
  title?: string;
  organizer?: string;
  startsAt?: string;
  endsAt?: string;
  venueName?: string;
  venueAddress?: string;
  sourceUrl?: string;
  limit: number;
};

export type CollectorEventCandidate = {
  eventId: string;
  title: string;
  organizer?: string | null;
  startsAt: string;
  endsAt?: string | null;
  timezone: "Asia/Shanghai";
  city: "Beijing";
  venueName?: string | null;
  venueAddress?: string | null;
  sourceUrl: string;
  scheduleText?: string | null;
  status: "draft" | "published" | "cancelled" | "withdrawn";
  publishedAt?: string | null;
};

export type CollectorEventCandidateStore = {
  findEventCandidates(
    input: CollectorEventCandidateQuery,
  ): Promise<CollectorEventCandidate[]>;
};

const eventCandidateRequestSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    organizer: z.string().trim().min(1).optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
    venueName: z.string().trim().min(1).optional(),
    venueAddress: z.string().trim().min(1).optional(),
    sourceUrl: z.string().url().optional(),
    limit: z.number().int().min(1).max(25).optional(),
  })
  .strict()
  .refine(
    (input) =>
      Boolean(
        input.title ||
          input.organizer ||
          input.startsAt ||
          input.venueName ||
          input.venueAddress ||
          input.sourceUrl,
      ),
    {
      message: "at least one blocking field is required",
    },
  );

export async function handleCollectorEventCandidates(
  request: Request,
  store: CollectorEventCandidateStore,
  env: CollectorEventCandidatesEnv,
) {
  const auth = authenticateCollectorRequest(request, env);
  if (!auth.ok) {
    return Response.json(
      {
        ok: false,
        error: auth.error,
      },
      { status: auth.status },
    );
  }

  const parsed = eventCandidateRequestSchema.safeParse(await parseJson(request));
  if (!parsed.success) return invalidRequestResponse(parsed.error);

  const candidates = await store.findEventCandidates({
    ...parsed.data,
    limit: parsed.data.limit ?? 10,
  });

  return Response.json({
    ok: true,
    candidates,
  });
}

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function invalidRequestResponse(error: z.ZodError) {
  return Response.json(
    {
      ok: false,
      error: "invalid_request",
      issues: error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    },
    { status: 400 },
  );
}
