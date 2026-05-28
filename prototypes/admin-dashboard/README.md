# Admin Dashboard Prototype

Static MVP admin dashboard prototype for issue #15.

Preview locally from the repository root:

```bash
python3 -m http.server 4173
```

Then open:

```text
http://localhost:4173/prototypes/admin-dashboard/
```

The prototype is intentionally isolated from the production Next.js app. It focuses on the first solo-operator workflow:

- small overview of what needs attention
- event draft inbox
- event draft review modal with editable publish fields
- source health list
- recent collector runs
- source and run error detail modal
- published event sanity list

It does not implement production admin routes, authentication, analytics, collector APIs, or database integration.
