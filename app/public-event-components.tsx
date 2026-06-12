import Link from "next/link";

import {
  formatPublicEventOccurrences,
  formatPublicEventSchedule,
  formatReservationStatus,
  isPublicEventEnded,
  type PublicEvent,
} from "../src/server/public-events";
import styles from "./public-event-ui.module.css";

export function PublicEventCard({
  event,
  href,
  now = new Date(),
  statusLabel,
}: {
  event: PublicEvent;
  href: string;
  now?: Date;
  statusLabel?: string;
}) {
  return (
    <Link
      className={`${styles.eventCard} ${
        event.posterImageUrl ? styles.eventCardWithPoster : ""
      }`}
      href={href}
    >
      {event.posterImageUrl ? (
        <div className={styles.posterThumb}>
          <img
            src={event.posterImageUrl}
            alt={event.posterImageAlt ?? `${event.title} poster`}
          />
        </div>
      ) : null}
      <div className={styles.dateBlock}>
        {formatPublicEventSchedule(event, now)}
      </div>
      <div>
        <h2>{event.title}</h2>
        <p>{event.summary ?? event.organizer ?? event.sourceUrl}</p>
        <div className={styles.meta}>
          <span>{event.organizer ?? "Organizer TBA"}</span>
          <span>{event.venueName ?? event.venueAddress ?? "Venue TBA"}</span>
        </div>
        {event.registrationUrl || event.registrationQrImageUrl ? (
          <div className={styles.registrationEvidence}>
            {event.registrationUrl ? <span>报名链接</span> : null}
            {event.registrationQrImageUrl ? <span>报名二维码</span> : null}
          </div>
        ) : null}
      </div>
      <span className={styles.statusPill}>
        {statusLabel ?? publicEventStatusLabel(event, now)}
      </span>
    </Link>
  );
}

export function PublicEventDetailView({
  event,
  backLinks,
}: {
  event: PublicEvent;
  backLinks: Array<{ href: string; label: string }>;
}) {
  const occurrences = formatPublicEventOccurrences(event);

  return (
    <>
      {backLinks.map((link) => (
        <Link key={link.href} className={styles.backLink} href={link.href}>
          {link.label}
        </Link>
      ))}

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
          {event.registrationQrImageUrl ? (
            <section className={styles.qrSection}>
              <h3>{event.registrationAction ?? "扫码报名"}</h3>
              <img
                src={event.registrationQrImageUrl}
                alt={
                  event.registrationQrImageAlt ??
                  `${event.title} registration QR`
                }
              />
            </section>
          ) : null}
        </article>

        <aside className={styles.panel}>
          <h2>Plan</h2>
          <div className={styles.field}>
            <span>Time</span>
            <strong>{formatPublicEventSchedule(event)}</strong>
          </div>
          {occurrences.length ? (
            <div className={styles.field}>
              <span>Occurrences</span>
              <ul className={styles.occurrenceList}>
                {occurrences.map((occurrence) => (
                  <li key={occurrence}>{occurrence}</li>
                ))}
              </ul>
            </div>
          ) : null}
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
    </>
  );
}

export function publicEventStatusLabel(event: PublicEvent, now: Date) {
  if (isPublicEventEnded(event, now)) return "已结束";
  return formatReservationStatus(event.reservationStatus);
}
