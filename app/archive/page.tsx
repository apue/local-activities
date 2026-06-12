import Link from "next/link";

import { PublicEventCard, publicEventStatusLabel } from "../public-event-components";
import styles from "../public-event-ui.module.css";
import { listPublicArchiveEvents } from "../../src/server/public-events";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const events = await listPublicArchiveEvents();
  const now = new Date();

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <nav className={styles.topNav} aria-label="Public views">
          <Link href="/">Upcoming</Link>
          <span>All activities</span>
        </nav>

        <section className={styles.archiveHeader}>
          <p className={styles.eyebrow}>Published archive</p>
          <h1>All activities</h1>
          <p>
            A public record of published activities, including events that have
            already ended.
          </p>
        </section>

        <section className={styles.eventList} aria-label="All activities">
          {events.map((event) => (
            <PublicEventCard
              key={event.eventId}
              event={event}
              href={`/events/${event.eventId}`}
              now={now}
              statusLabel={publicEventStatusLabel(event, now)}
            />
          ))}
          {events.length === 0 ? (
            <div className={styles.empty}>No published activities yet.</div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
