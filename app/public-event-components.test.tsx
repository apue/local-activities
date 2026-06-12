import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PublicEventCard,
  PublicEventDetailView,
} from "./public-event-components";
import type { PublicEvent } from "../src/server/public-events";

const event: PublicEvent = {
  eventId: "event-1",
  title: "Italian Design Weekend",
  organizer: "Italian Cultural Institute",
  startsAt: "2026-06-06T06:00:00.000Z",
  endsAt: "2026-06-06T08:00:00.000Z",
  timezone: "Asia/Shanghai",
  city: "Beijing",
  venueName: "Italian Cultural Institute",
  venueAddress: "Sanlitun, Beijing",
  reservationStatus: "required",
  registrationAction: "扫码报名",
  registrationUrl: "https://example.com/register",
  sourceUrl: "https://mp.weixin.qq.com/s/example",
  posterImageUrl: "https://cdn.example.com/poster.jpg",
  posterImageAlt: "Activity poster",
  registrationQrImageUrl: "https://cdn.example.com/qr.png",
  registrationQrImageAlt: "Registration QR",
  summary: "A weekend programme about Italian design.",
  status: "published",
};

describe("public event shared components", () => {
  it("renders card poster and registration evidence for production or eval pages", () => {
    const html = renderToStaticMarkup(
      <PublicEventCard
        event={event}
        href="/events/event-1"
        now={new Date("2026-06-01T00:00:00.000Z")}
      />,
    );

    expect(html).toContain("https://cdn.example.com/poster.jpg");
    expect(html).toContain("报名链接");
    expect(html).toContain("报名二维码");
    expect(html).toContain("需要预约");
  });

  it("renders detail poster, QR, and official source from the same event shape", () => {
    const html = renderToStaticMarkup(
      <PublicEventDetailView
        event={event}
        backLinks={[{ href: "/archive", label: "View all activities" }]}
      />,
    );

    expect(html).toContain("https://cdn.example.com/poster.jpg");
    expect(html).toContain("https://cdn.example.com/qr.png");
    expect(html).toContain("https://mp.weixin.qq.com/s/example");
  });
});
