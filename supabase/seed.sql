insert into workspaces (id, name, slug, timezone, country_code, send_mode)
values ('11111111-1111-4111-8111-111111111111', 'Rank Local', 'rank-local', 'Europe/London', 'GB', 'disabled')
on conflict (id) do nothing;

insert into workspace_users (workspace_id, user_id, role, status)
values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'owner', 'active')
on conflict (workspace_id, user_id) do nothing;
