-- Backend-only access for the server-side service-role client.
-- RLS remains enabled; no privileges are granted to anon or authenticated.
grant usage on schema public to service_role;

grant select, insert, update, delete on table
  public.campaigns,
  public.campaign_runs,
  public.prospects,
  public.prospect_source_refs,
  public.activity_events,
  public.suppressions
  to service_role;
