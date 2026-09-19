-- 007_audit_page_roles.sql
-- Widens the website_audit_pages.page_role check constraint so the multi-signal classifier (audit-crawler/v3)
-- can store the two new roles: gallery (portfolio/our-work pages) and blog (articles/news/guides).
-- No new tables or columns; RLS and grants from 006 are unchanged.

-- ---------------------------------------------------------------------------
-- website_audit_pages.page_role: add 'gallery' and 'blog'
-- Postgres names an inline column check <table>_<column>_check; there is no "add constraint if not exists",
-- so drop-if-exists then re-add keeps the statement idempotent. Existing rows use a subset of the values.
-- ---------------------------------------------------------------------------
alter table website_audit_pages drop constraint if exists website_audit_pages_page_role_check;
alter table website_audit_pages add constraint website_audit_pages_page_role_check
  check (page_role in ('homepage', 'service', 'location', 'about', 'contact', 'testimonials', 'gallery', 'blog', 'other'));
