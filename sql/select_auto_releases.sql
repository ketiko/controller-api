select
  apps.app,
  apps.name as app_name,
  spaces.name as space_name,
  builds.build,
  builds.created,
  builds.sha,
  auto_builds.repo,
  auto_builds.branch,
  auto_builds.wait_on_status_checks,
  authorizations.site,
  authorizations.token
from
  apps
  join spaces on apps.space = spaces.space
  join builds on apps.app = builds.app
  join auto_builds on auto_builds.app = apps.app
  join authorizations on auto_builds.authorization = authorizations.authorization
where
  builds.build = (
    select b.build
    from apps a join builds b on a.app = b.app
    where a.app = apps.app and a.deleted = false and b.deleted = false
    order by b.created desc offset 0 limit 1
  )
  and apps.deleted = false
  and builds.deleted = false
  and auto_builds.deleted = false
  and spaces.deleted = false
  and auto_builds.auto_deploy = true
  and builds.status = 'succeeded'
  and (select count(*) from releases where releases.app = apps.app and releases.build = builds.build) = 0
  and builds.created > (current_date - interval '1 day')
order by
  builds.created desc