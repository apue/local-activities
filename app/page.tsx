import Link from "next/link";

import { PublicEventCard } from "./public-event-components";
import styles from "./public-event-ui.module.css";
import { listPublicUpcomingEvents } from "../src/server/public-events";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const events = await listPublicUpcomingEvents();

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Beijing activity calendar</p>
            <h1>Local Activities</h1>
            <p>
              Admin-curated activities worth planning for the coming days.
            </p>
            <div className={styles.heroLinks}>
              <Link href="/archive">View all published activities</Link>
            </div>
          </div>
        </section>

        <section className={styles.eventList} aria-label="Upcoming events">
          {events.map((event) => (
            <PublicEventCard
              key={event.eventId}
              event={event}
              href={`/events/${event.eventId}`}
            />
          ))}
          {events.length === 0 ? (
            <div className={styles.empty}>
              No published upcoming activities yet. Check back after the next
              collector review.
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
