select
  routes.route, apps.name || '-' || spaces.name app, sites.domain site, routes.source_path, routes.target_path, routes.created, routes.updated
from
  routes
join
  apps on (apps.app = routes.app)
join
  spaces on (spaces.space = apps.space)
join
  sites on (sites.site = routes.site)
where
  (apps.app::varchar(256) = $1::varchar(256)
    or (apps.name::varchar(128) || '-' || spaces.name::varchar(128)) = $1)
  and routes.deleted = false
  and apps.deleted = false
  and spaces.deleted = false