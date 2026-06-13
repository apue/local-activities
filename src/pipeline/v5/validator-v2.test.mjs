import { describe, expect, it } from "vitest";

import { validateV5Extraction } from "./validator-v2.mjs";

const fixedNow = "2026-06-10T04:00:00.000Z";

const normalized = Object.freeze({
  title: "文化中心活动",
  sourceName: "Example Cultural Center",
  sourceUrl: "https://mp.weixin.qq.com/s/example",
  publishedAt: "2026-06-09T12:00:00.000Z",
  markdown: "北京文化中心将举办面向公众的文化活动。",
});

describe("V5 Validator v2", () => {
  it("accepts an ordinary public Beijing event with complete schedule, venue, and registration facts", () => {
    const validation = validateV5Extraction({
      normalized,
      now: fixedNow,
      extraction: eventExtraction({
        events: [{
          title: "文化中心讲座",
          city: "Beijing",
          startsAt: "2026-06-20T10:00:00+08:00",
          endsAt: "2026-06-20T11:30:00+08:00",
          venue: "北京文化中心",
          address: "北京市朝阳区示例路1号",
          registrationAction: "required",
          registrationUrl: "https://example.org/register",
        }],
      }),
    });

    expect(validation).toMatchObject({
      version: "v5-validator.v2",
      status: "valid",
      checkedAt: fixedNow,
      hardIssues: [],
      softIssues: [],
      repairableIssues: [],
    });
    expect(validation.eventResults).toEqual([
      expect.objectContaining({ eventIndex: 0, status: "valid", issues: [] }),
    ]);
  });

  it("validates each event in a multi-event extraction and remains valid when all events are valid", () => {
    const validation = validateV5Extraction({
      normalized,
      now: fixedNow,
      extraction: eventExtraction({
        events: [
          {
            title: "上午讲座",
            city: "北京",
            startsAt: "2026-06-20T10:00:00+08:00",
            venue: "北京文化中心",
            registrationAction: "not_required",
          },
          {
            title: "下午放映",
            city: "Beijing",
            startsAt: "2026-06-20T15:00:00+08:00",
            venue: "北京文化中心影厅",
            registrationAction: "walk_in",
          },
        ],
      }),
    });

    expect(validation.status).toBe("valid");
    expect(validation.eventResults).toHaveLength(2);
    expect(validation.issues).toEqual([]);
  });

  it("accepts recurring events when recurrence or schedule text makes attendance clear", () => {
    const validation = validateV5Extraction({
      normalized,
      now: fixedNow,
      extraction: eventExtraction({
        events: [{
          title: "每周电影放映",
          city: "Beijing",
          recurrence: { frequency: "weekly", until: "2026-07-01" },
          scheduleText: "6月14日至7月1日每周日下午14:00放映。",
          venue: "北京文化中心影厅",
          registrationAction: "required",
          registrationUrl: "https://example.org/film",
        }],
      }),
    });

    expect(validation.status).toBe("valid");
    expect(validation.issues).toEqual([]);
  });

  it("accepts multiple explicit occurrence start times as a recurring schedule shape", () => {
    const validation = validateV5Extraction({
      normalized,
      now: fixedNow,
      extraction: eventExtraction({
        events: [{
          title: "韩国电影放映《听说》",
          city: "Beijing",
          occurrenceStartsAt: [
            "2026-06-15T16:00:00+08:00",
            "2026-06-15T19:00:00+08:00",
          ],
          venue: "驻华韩国文化院忠武路馆",
          registrationAction: "qr_code",
          registrationQrUrl: "https://example.org/qr.png",
          scheduleText: "6月15日 16:00/19:00 两场",
        }],
      }),
    });

    expect(validation.status).toBe("valid");
    expect(validation.issues).toEqual([]);
  });

  it("accepts long-running events when a date range and opening schedule are present", () => {
    const validation = validateV5Extraction({
      normalized,
      now: fixedNow,
      extraction: eventExtraction({
        events: [{
          title: "文化展览",
          city: "Beijing",
          startsAt: "2026-06-12",
          endsAt: "2026-07-20",
          scheduleText: "展期内周二至周日10:00-18:00开放。",
          openingHours: "Tue-Sun 10:00-18:00",
          venue: "北京文化中心展厅",
          registrationAction: "not_required",
        }],
      }),
    });

    expect(validation.status).toBe("valid");
    expect(validation.hardIssues).toEqual([]);
    expect(validation.softIssues).toEqual([]);
  });

  it("excludes non-public or internal-only items as hard issues", () => {
    const validation = validateV5Extraction({
      normalized,
      now: fixedNow,
      extraction: eventExtraction({
        publicEligibility: "invited_only",
        events: [{
          title: "使馆内部招待会",
          city: "Beijing",
          startsAt: "2026-06-20T19:00:00+08:00",
          venue: "Embassy Residence",
          audience: "staff_only",
          registrationAction: "invite_only",
        }],
      }),
    });

    expect(validation.status).toBe("invalid");
    expect(validation.hardIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["public_eligibility_not_public", "audience_not_general_public"]),
    );
  });

  it("excludes events that are clearly outside Beijing", () => {
    const validation = validateV5Extraction({
      normalized,
      now: fixedNow,
      extraction: eventExtraction({
        events: [{
          title: "上海文化讲座",
          city: "Shanghai",
          startsAt: "2026-06-20T10:00:00+08:00",
          venue: "Shanghai Cultural Center",
          registrationAction: "not_required",
        }],
      }),
    });

    expect(validation.status).toBe("invalid");
    expect(validation.hardIssues).toEqual([
      expect.objectContaining({ code: "city_not_beijing", eventIndex: 0, severity: "hard" }),
    ]);
  });

  it("excludes news, official visits, recaps, and past-only articles as hard issues", () => {
    const cases = [
      ["news", "classification_news_not_event"],
      ["official_visit", "classification_official_visit_not_event"],
      ["recap", "classification_recap_not_event"],
    ];

    for (const [classification, code] of cases) {
      const validation = validateV5Extraction({
        normalized,
        now: fixedNow,
        extraction: eventExtraction({
          classification,
          events: [{
            title: "代表团访问新闻",
            city: "Beijing",
            startsAt: "2026-06-20T10:00:00+08:00",
            venue: "北京",
            registrationAction: "not_required",
          }],
        }),
      });

      expect(validation.status).toBe("invalid");
      expect(validation.hardIssues.map((issue) => issue.code)).toContain(code);
    }

    const pastOnly = validateV5Extraction({
      normalized,
      now: fixedNow,
      extraction: eventExtraction({
        classification: "event",
        reason: "活动回顾",
        events: [{
          title: "上周活动回顾",
          city: "Beijing",
          startsAt: "2026-05-01T10:00:00+08:00",
          endsAt: "2026-05-01T12:00:00+08:00",
          venue: "北京文化中心",
          registrationAction: "not_required",
        }],
      }),
    });

    expect(pastOnly.status).toBe("invalid");
    expect(pastOnly.hardIssues.map((issue) => issue.code)).toContain("event_past_or_recap_only");
  });

  it("marks missing schedule, attendance path, registration evidence, and low confidence as repairable soft issues", () => {
    const validation = validateV5Extraction({
      normalized,
      now: fixedNow,
      extraction: eventExtraction({
        confidence: 0.42,
        events: [{
          title: "信息不完整的活动",
          city: "Beijing",
          registrationAction: "required",
        }],
      }),
    });

    expect(validation.status).toBe("needs_info");
    expect(validation.hardIssues).toEqual([]);
    expect(validation.softIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "event_schedule_missing",
        "event_attendance_path_missing",
        "registration_evidence_missing",
        "extraction_confidence_low",
      ]),
    );
    expect(validation.repairableIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "event_schedule_missing",
        "event_attendance_path_missing",
        "registration_evidence_missing",
      ]),
    );
  });

  it("requires matching QR or mini-program evidence for QR and mini-program registration actions", () => {
    const validation = validateV5Extraction({
      normalized,
      now: fixedNow,
      extraction: eventExtraction({
        events: [{
          title: "需要扫码预约的活动",
          city: "Beijing",
          startsAt: "2026-06-20T10:00:00+08:00",
          venue: "北京文化中心",
          registrationAction: "qr_code",
        }],
      }),
    });

    expect(validation.status).toBe("needs_info");
    expect(validation.softIssues.map((issue) => issue.code)).toContain("registration_evidence_missing");
  });

  it("does not treat plain registration text as an actionable registration path", () => {
    const validation = validateV5Extraction({
      normalized,
      now: fixedNow,
      extraction: eventExtraction({
        events: [{
          title: "需要提前预约的活动",
          city: "Beijing",
          startsAt: "2026-06-20T10:00:00+08:00",
          venue: "北京文化中心",
          registrationAction: "required",
          registrationEvidence: "入场需提前预约，名额有限。",
        }],
      }),
    });

    expect(validation.status).toBe("needs_info");
    expect(validation.softIssues.map((issue) => issue.code)).toContain("registration_evidence_missing");
  });

  it("does not treat the source article URL as a registration URL", () => {
    const validation = validateV5Extraction({
      normalized,
      now: fixedNow,
      extraction: eventExtraction({
        events: [{
          title: "需要提前预约的活动",
          city: "Beijing",
          startsAt: "2026-06-20T10:00:00+08:00",
          venue: "北京文化中心",
          registrationAction: "required",
          registrationUrl: normalized.sourceUrl,
        }],
      }),
    });

    expect(validation.status).toBe("needs_info");
    expect(validation.softIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["registration_url_is_source_article", "registration_evidence_missing"]),
    );
  });

  it("accepts image evidence as a QR registration path", () => {
    const validation = validateV5Extraction({
      normalized,
      now: fixedNow,
      extraction: eventExtraction({
        events: [{
          title: "需要扫码预约的活动",
          city: "Beijing",
          startsAt: "2026-06-20T10:00:00+08:00",
          venue: "北京文化中心",
          registrationAction: "qr_code",
          evidence: [{ imageId: "image-001", role: "registration_qr", confidence: 0.93 }],
        }],
      }),
    });

    expect(validation.status).toBe("valid");
    expect(validation.softIssues).toEqual([]);
  });

  it("accepts a mini-program path as a mini-program registration path", () => {
    const validation = validateV5Extraction({
      normalized,
      now: fixedNow,
      extraction: eventExtraction({
        events: [{
          title: "需要小程序预约的活动",
          city: "Beijing",
          startsAt: "2026-06-20T10:00:00+08:00",
          venue: "北京文化中心",
          registrationAction: "mini_program",
          miniProgramPath: "pages/events/detail?id=123",
        }],
      }),
    });

    expect(validation.status).toBe("valid");
    expect(validation.softIssues).toEqual([]);
  });

  it("treats non-event and failed extraction decisions as invalid hard issues", () => {
    for (const [decision, code] of [
      ["non_event", "extraction_non_event"],
      ["failed", "extraction_failed"],
    ]) {
      const validation = validateV5Extraction({
        normalized,
        now: fixedNow,
        extraction: eventExtraction({ decision, events: [] }),
      });

      expect(validation.status).toBe("invalid");
      expect(validation.hardIssues.map((issue) => issue.code)).toContain(code);
    }
  });
});

function eventExtraction(overrides = {}) {
  return {
    version: "v5-test-extraction.v1",
    decision: "event",
    classification: "event",
    publicEligibility: "public",
    publicEligibilityReason: "open to the general public",
    confidence: 0.86,
    events: [],
    ...overrides,
  };
}
