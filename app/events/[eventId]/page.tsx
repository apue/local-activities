import Link from "next/link";

import styles from "../../public-event-ui.module.css";
import {
  formatReservationStatus,
  formatPublicEventTime,
  getPublicEvent,
} from "../../../src/server/public-events";

export const dynamic = "force-dynamic";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const event = await getPublicEvent(eventId);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.backLink} href="/">
          Back to upcoming
        </Link>

        <section className={styles.detailHero}>
          <p className={styles.eyebrow}>{event.organizer ?? "Organizer TBA"}</p>
          <h1>{event.title}</h1>
        </section>

        {event.posterImageUrl ? (
          <figure className={styles.posterFigure}>
            <img
              src={event.posterImageUrl}
              alt={event.posterImageAlt ?? `${event.title} poster`}
            />
          </figure>
        ) : null}

        <section className={styles.detailGrid}>
          <article className={styles.panel}>
            <h2>Activity details</h2>
            <p className={styles.summary}>
              {event.summary ?? "The official source did not provide a summary."}
            </p>
            {event.entryNotes ? (
              <p className={styles.summary}>{event.entryNotes}</p>
            ) : null}
            {event.registrationUrl ? (
              <a className={styles.actionButton} href={event.registrationUrl}>
                {event.registrationAction ?? "查看报名方式"}
              </a>
            ) : null}
          </article>

          <aside className={styles.panel}>
            <h2>Plan</h2>
            <div className={styles.field}>
              <span>Time</span>
              <strong>{event.scheduleText ?? formatPublicEventTime(event)}</strong>
            </div>
            <div className={styles.field}>
              <span>Venue</span>
              <strong>{event.venueName ?? event.venueAddress ?? "Venue TBA"}</strong>
              {event.venueAddress ? <small>{event.venueAddress}</small> : null}
            </div>
            <div className={styles.field}>
              <span>Reservation</span>
              <strong>{formatReservationStatus(event.reservationStatus)}</strong>
            </div>
            <div className={styles.field}>
              <span>Official source</span>
              <a href={event.sourceUrl}>{event.sourceUrl}</a>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
