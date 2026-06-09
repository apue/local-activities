alter table public.evaluation_runs
  add column if not exists validity text not null default 'valid',
  add column if not exists invalidated_reason text,
  add column if not exists invalidated_at timestamptz;

alter table public.evaluation_runs
  drop constraint if exists evaluation_runs_validity_check;

alter table public.evaluation_runs
  add constraint evaluation_runs_validity_check
  check (validity in ('valid', 'invalidated'));

create index if not exists evaluation_runs_validity_started_idx
  on public.evaluation_runs (validity, started_at desc);
