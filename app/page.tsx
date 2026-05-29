import Link from "next/link";

import styles from "./public-event-ui.module.css";
import {
  formatPublicEventTime,
  listPublicUpcomingEvents,
} from "../src/server/public-events";

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
          </div>
        </section>

        <section className={styles.eventList} aria-label="Upcoming events">
          {events.map((event) => (
            <Link
              key={event.eventId}
              className={styles.eventCard}
              href={`/events/${event.eventId}`}
            >
              <div className={styles.dateBlock}>
                {event.scheduleText ?? formatPublicEventTime(event)}
              </div>
              <div>
                <h2>{event.title}</h2>
                <p>{event.summary ?? event.organizer ?? event.sourceUrl}</p>
                <div className={styles.meta}>
                  <span>{event.organizer ?? "Organizer TBA"}</span>
                  <span>{event.venueName ?? event.venueAddress ?? "Venue TBA"}</span>
                </div>
              </div>
              <span className={styles.statusPill}>
                {event.reservationStatus === "required"
                  ? "Reservation"
                  : event.reservationStatus}
              </span>
            </Link>
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
