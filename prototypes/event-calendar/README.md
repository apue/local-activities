# Event Calendar Prototype

Static public-facing prototype for issue #11.

Preview locally from the repository root:

```bash
python3 -m http.server 4173
```

Then open:

```text
http://localhost:4173/prototypes/event-calendar/
```

The prototype is intentionally isolated from the Next.js app. It uses mock data derived from recent WeChat datasource analysis and exercises the public user states needed before production implementation:

- grouped cultural-calendar homepage
- desktop list plus detail preview
- mobile list-to-detail flow
- QR registration evidence
- no-registration events
- image-derived activity fields
- missing-field review state
- ended event reference state
