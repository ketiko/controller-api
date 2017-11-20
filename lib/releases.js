"use strict"

const crypto = require('crypto');
const fs = require('fs');
const uuid = require('uuid');
const builds = require('./builds.js');
const config = require('./config.js');
const common = require('./common.js');
const logs = require('./log-drains.js');
const http_help = require('./http_helper.js');
const formation = require('./formations.js');
const github = require('./github.js');
const query = require('./query.js');
const spaces = require('./spaces.js');

// private
const pull_auto_releases = query.bind(query, fs.readFileSync("./sql/select_auto_releases.sql").toString('utf8'), (r) => { return r; });
async function auto_releases(pg_pool) {
  try {
    let auto = await pull_auto_releases(pg_pool, [])
    for(let i=0; i < auto.length; i++) {
      let auto_release = auto[i]
      let release_url = config.alamo_app_controller_url + '/apps/' + ( auto_release.app_name + '-' + auto_release.space_name ) + '/releases';
      let payload = JSON.stringify({ "slug":auto_release.build, "description":"Auto-Deploy " + (auto_release.build.split('-')[0]) });
      let headers = {'Authorization':config.simple_key, 'User-Agent':'alamo'};
      github.add_status('pending', auto_release.app_name, auto_release.spacename, auto_release.token, auto_release.repo, auto_release.sha, 'Deployment started.');
      try {
        await http_help.request('post', release_url, headers, payload)
        github.add_status('success', auto_release.app_name, auto_release.spacename, auto_release.token, auto_release.repo, auto_release.sha, 'Deployment successful.');
        console.log('release automatically created for ' + auto_release.app);
      } catch (err) {
        github.add_status('failure', auto_release.app_name, auto_release.spacename, auto_release.token, auto_release.repo, auto_release.sha, 'Deployment failed.');
        console.error("Unable to kick off new auto-release:", err)
      }
    }
  } catch (err) {
    console.error("Cannot pull auto releases: ", err)
  } finally {
    setTimeout(() => { auto_releases(pg_pool).catch((e) => { console.error(e) }) }, 15000);
  }
}

// private
function begin_timers(pg_pool) {
  setTimeout(() => { auto_releases(pg_pool).catch((e) => { console.error(e) }) }, 15000);
}

// private
async function request_release(pg_pool, app_dest, image) {
  let formations = await formation.list_types(pg_pool, app_dest.name, app_dest.space)
  if(formations.length === 0) {
    console.assert(app_dest.app, 'No uuid found on destination app.');
    console.assert(app_dest.name, 'No name found on destination app.');
    console.assert(app_dest.space, 'No space found on destination app.');
    // there is no record for a formation, we'll create a default web formation.
    let dyno_info = await formation.create_dyno(pg_pool, app_dest.app, app_dest.name, app_dest.space, 'web', null, 1, config.dyno_default_size, config.default_port, null)
    let new_formations = await formation.list_types(pg_pool, app_dest.name, app_dest.space)
    if(new_formations.length === 0) {
      console.log('unable to pull formations', new_formations.length);
      throw new common.InternalServerError()
    }
    formations = new_formations;
  }
  let results = []
  for (let i=0 ; i < formations.length; i++) {
    let form = formations[i]
    results.push(await common.alamo.deploy(pg_pool, app_dest.space, app_dest.name, form.type, image, form.command, form.port, form.healthcheck))
  }
  return results;
}

// private
const create_release_record = query.bind(query, fs.readFileSync("./sql/insert_release.sql").toString('utf8'), null)
const query_releases_by_app = query.bind(query, fs.readFileSync("./sql/select_releases.sql").toString('utf8'), null)
const select_release = query.bind(query, fs.readFileSync("./sql/select_release.sql").toString('utf8'), null)
const get_next_release_version = query.bind(query, fs.readFileSync("./sql/select_next_release.sql").toString('utf8'), (r) => { return r.next_version; });
const get_latest_release_by_app = query.bind(query, fs.readFileSync('./sql/select_latest_release_by_app.sql').toString('utf8'), (d) => { return d; });
async function latest_release(pg_pool, app_uuid) {
  let releases = await get_latest_release_by_app(pg_pool, [app_uuid]);
  if(releases.length === 0 || releases[0].app !== app_uuid) {
    throw new common.NotFoundError(`There were no releases found for the app ${app_uuid}.`)
  }
  return releases[0]
}

async function list(pg_pool, app_uuid) {
  return await query_releases_by_app(pg_pool, [app_uuid]);
}

async function get(pg_pool, app_uuid, release_id) {
  let releases = await select_release(pg_pool, [release_id])
  if(releases.length === 0 || releases[0].app_uuid !== app_uuid) {
    throw new common.NotFoundError(`The specified release ${release_id} was not found.`)
  }
  return releases[0]
}

// private
function release_obj_to_postgres(release) {
  console.assert(release.build, 'A build is required for each release, none was specified.');
  console.assert(release.id, 'A release id is required for a release record, none was specified.');
  console.assert(release.app, 'An app id is required for a release record, none was specified.');
  return [release.id, release.app, release.created, release.updated, release.build, release.logs, release.app_logs, release.status, release.user_agent, release.description, release.trigger, release.trigger_notes, release.version, false];
}

// private
function release_obj_to_response(release) {
  return {
    app:{
      id:release.app,
      name:release.app_name + '-' + release.space_name
    },
    created_at:release.created.toISOString(),
    description:release.description,
    slug:{
      id:release.build
    },
    id:release.id || release.release,
    status:release.status || "succeeded",
    user:{
      id:uuid.unparse(crypto.createHash('sha256').update(release.org).digest(), 16),
      email:""
    },
    version:release.version,
    current:release.current
  };
}

// public
async function create_release(pg_pool, app_src, app_dest, build_uuid, description, trigger, trigger_notes, agent) {
  // Do not check for pipeline limitations here, its used by pipelines.
  let version = await get_next_release_version(pg_pool, [app_dest.app])
  version = version[0]
  let build = await builds.succeeded(pg_pool, build_uuid)
  // (exists, foreign_build_key, build_desc, registry_image, build_repo, build_branch, build_sha) => {
  if(!build) {
    throw new common.ConflictError(`The build id ${build_uuid} does not exist or is still in process of buildling`)
  }
  await request_release(pg_pool, app_dest, build.docker_registry_url)
  let release = {
    id:uuid.v4(),
    app:app_dest.app,
    app_name:app_dest.name,
    space_name:app_dest.space,
    org:app_dest.org,
    build:build_uuid,
    logs:'',
    app_logs:'',
    status:'succeeded',
    user_agent:agent,
    description,
    trigger,
    trigger_notes,
    version:version,
    current:true
  }
  release.updated = release.created = new Date();
  await create_release_record(pg_pool, release_obj_to_postgres(release))
  
  logs.event(app_dest.name, app_dest.space, "Release v" + version + " created (" + description + ")");
  common.notify_hooks(pg_pool, app_dest.app, 'release', JSON.stringify({
    'action':'release',
    'app':{
      'name':app_dest.name,
      'id':app_dest.app
    },
    'space':{
      'name':app_dest.space
    },
    'release':{
      'id':release.id,
      'result':'succeeded',
      'created_at':release.created.toISOString(),
      'version':version,
      'description':description
    },
    'build':{
      'id':build.id,
      'result':'succeeded',
      'repo':build.repo,
      'commit':build.sha,
      'branch':build.branch
    }
  }))
  return release_obj_to_response(release)
}

async function create(pg_pool, app_uuid, app_name, space_name, space_tags, org, description, slug, release_id, trigger_notes) {
  if(!slug && !release_id) {
    throw new common.UnprocessibleEntityError(`The specified "slug" (or) "release" field was not provided.`)
  }
  if(slug && release_id) {
    throw new common.UnprocessibleEntityError(`The specified request may only contain either a "slug" field for the build to deploy or the "release" field for the release to roll back to, not both.`)
  }

  let target_app = {app:app_uuid, name:app_name, space:space_name, org}
  let desc_build = 'new_build'
  if(slug) {
    description = description || 'Deploy of ' + slug
  } else {
    let release = await select_release( pg_pool, [release_id])
    if(release.length === 0) {
      throw new common.UnprocessibleEntityError(`The specified release ${release_id} does not exist.`)
    }
    slug = release[0].build
    description = 'Rollback to ' + release[0].id
    desc_build = 'rollback'
  }
  return await create_release(pg_pool, target_app, target_app, slug, description, desc_build, trigger_notes || '', 'aka');
}

// public
async function http_create(pg_pool, req, res, regex) {
  let app_key = http_help.first_match(req.url, regex)
  let app = await common.app_exists(pg_pool, app_key)
  let space = await common.space_exists(pg_pool, app.space_uuid)
  let data = await http_help.buffer_json(req)
  return http_help.created_response(res, 
    JSON.stringify(await create(pg_pool, app.app_uuid, app.app_name, app.space_name, space.tags, app.org_uuid, data.description, data.slug, data.release, data.trigger_notes)))
}

// public
async function http_list(pg_pool, req, res, regex) {
  let app_key = http_help.first_match(req.url, regex)
  let app = await common.app_exists(pg_pool, app_key)
  let space = await common.space_exists(pg_pool, app.space_uuid)
  let releases = await list(pg_pool, app.app_uuid)
  return http_help.ok_response(res, JSON.stringify(releases.map(release_obj_to_response)))
}

// public
async function http_get(pg_pool, req, res, regex) {
  let app_key = http_help.first_match(req.url, regex)
  let release_id = http_help.second_match(req.url, regex)
  let app = await common.app_exists(pg_pool, app_key)
  let space = await common.space_exists(pg_pool, app.space_uuid)
  let release = await get(pg_pool, app.app_uuid, release_id)
  return http_help.ok_response(res, JSON.stringify(release_obj_to_response(release)));
}

module.exports = {
  http:{
    create:http_create,
    get:http_get,
    list:http_list
  },
  create,
  list,
  get,
  create_release,
  latest_release,
  timers:{begin:begin_timers},
};