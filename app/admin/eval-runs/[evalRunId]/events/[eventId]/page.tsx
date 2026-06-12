import { requireAdminPreviewAuth } from "../../../../eval-preview-auth";
import { PublicEventDetailView } from "../../../../../public-event-components";
import styles from "../../../../../public-event-ui.module.css";
import { getPublicEvent } from "../../../../../../src/server/public-events";

export const dynamic = "force-dynamic";

export default async function EvalRunEventDetailPage({
  params,
}: {
  params: Promise<{ evalRunId: string; eventId: string }>;
}) {
  await requireAdminPreviewAuth();
  const { evalRunId, eventId } = await params;
  const event = await getPublicEvent(eventId, {
    dataClass: "eval",
    evalRunId,
  });

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <PublicEventDetailView
          event={event}
          backLinks={[
            {
              href: `/admin/eval-runs/${encodeURIComponent(evalRunId)}/preview`,
              label: "Back to eval preview",
            },
            { href: "/admin", label: "Back to admin" },
          ]}
        />
      </div>
    </main>
  );
}
