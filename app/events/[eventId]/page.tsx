import { PublicEventDetailView } from "../../public-event-components";
import styles from "../../public-event-ui.module.css";
import { getPublicEvent } from "../../../src/server/public-events";

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
        <PublicEventDetailView
          event={event}
          backLinks={[
            { href: "/", label: "Back to upcoming" },
            { href: "/archive", label: "View all activities" },
          ]}
        />
      </div>
    </main>
  );
}
