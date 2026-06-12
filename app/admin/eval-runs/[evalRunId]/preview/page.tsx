import Link from "next/link";

import { requireAdminPreviewAuth } from "../../../eval-preview-auth";
import { PublicEventCard } from "../../../../public-event-components";
import styles from "../../../../public-event-ui.module.css";
import { listPublicArchiveEvents } from "../../../../../src/server/public-events";

export const dynamic = "force-dynamic";

export default async function EvalRunPreviewPage({
  params,
}: {
  params: Promise<{ evalRunId: string }>;
}) {
  await requireAdminPreviewAuth();
  const { evalRunId } = await params;
  const now = new Date();
  const events = await listPublicArchiveEvents({
    dataClass: "eval",
    evalRunId,
    now,
  });

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <nav className={styles.topNav} aria-label="Admin eval views">
          <Link href="/admin">Admin</Link>
          <span>Eval preview</span>
        </nav>

        <section className={styles.archiveHeader}>
          <p className={styles.eyebrow}>Evaluation preview</p>
          <h1>Eval run</h1>
          <p>{evalRunId}</p>
        </section>

        <section className={styles.eventList} aria-label="Eval run events">
          {events.map((event) => (
            <PublicEventCard
              key={event.eventId}
              event={event}
              href={`/admin/eval-runs/${encodeURIComponent(
                evalRunId,
              )}/events/${encodeURIComponent(event.eventId)}`}
              now={now}
            />
          ))}
          {events.length === 0 ? (
            <div className={styles.empty}>
              No published eval events are available for this run.
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
