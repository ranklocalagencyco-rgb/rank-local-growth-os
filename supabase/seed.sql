insert into workspaces (id, name, slug, timezone, country_code, send_mode)
values ('00000000-0000-0000-0000-000000000001', 'Rank Local', 'rank-local', 'Europe/London', 'GB', 'disabled')
on conflict (id) do nothing;

insert into workspace_users (workspace_id, user_id, role, status)
values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'owner', 'active')
on conflict (workspace_id, user_id) do nothing;
