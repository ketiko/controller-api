const crypto = require('crypto');
const fs = require('fs');
const uuid = require('uuid');
const httph = require('./http_helper.js');
const apps = require('./apps.js');
const addon_services = require('./addon-services.js');
const addon_attachments = require('./addon-attachments.js');
const builds = require('./builds.js');
const config = require('./config.js');
const config_vars = require('./config-var.js');
const common = require('./common.js');
const formation = require('./formations.js');
const logs = require('./log-drains');
const spaces = require('./spaces.js');
const releases = require('./releases.js');
const orgs = require('./organizations.js');
const query = require('./query.js');
const queue = require('./queue.js');
const routes = require('./routes.js');
const pipelines = require('./pipelines.js');

// private
function format_source_blob_from_build(app_uuid, app_name, build) {
  if(!build) {
    return null;
  }
  // for returning the build image lets use the GM from this app, rather than the build sources, as they may 
  // not exist if this is a pipelined app. 
  return {
    "checksum":build.source_blob.checksum,
    "url":`docker://${config.docker_registry_host}/${config.gm_registry_repo}/${app_name}-${app_uuid}:0.${build.slug.number}`,
    "version":build.source_blob.version
  };
}

// private
function format_log_drains(drains) {
  return drains.map((drain) => {
    return {
      "url":drain.url,
      "token":drain.token
    }
  })
}

// private
function format_addons(addons) {
  let addons_formatted = {}
  addons.forEach((x) => { addons_formatted[x.addon_service.name] = {plan:x.plan.name} });
  return addons_formatted
}

// private
function format_attachments(attachments) {
  return attachments.map((x) => { return { "name":x.name, "app":x.addon.app, "id":x.addon.id }});
}

// private
function format_formations(formations) {
  let formations_formatted = {};
  formations.forEach((form) => { 
    formations_formatted[form.type] = {
      "quantity":form.quantity,
      "size":form.size.replace(/-prod/g, '')
    }
    if(formations_formatted[form.type] === "web") {
      formations_formatted[form.type].port = form.port;
      formations_formatted[form.type]["health-check"] = form.healthcheck;
    }
    formations_formatted[form.type].command = form.command;
  });
  return formations_formatted;
}

// private
function format_sites(routes) {
  let sites_formatted = {};
  routes.forEach((route) => { 
    sites_formatted[route.site] = sites_formatted[route.site] || {routes:[]};
    sites_formatted[route.site].routes.push({"source_path":route.source_path, "target_path":route.target_path});
  });
  return sites_formatted;
}

// private
function format_config_vars(vars) {
  let keys = Object.keys(vars);
  let formatted_config_vars = {};
  keys.forEach((key) => {
    formatted_config_vars[key] = {
      "description":"",
      "required":(vars[key].indexOf("[redacted]") > -1)
    };
    if(vars[key].indexOf('[redacted]') === -1) {
      formatted_config_vars[key].value = vars[key];
    }
  });
  return formatted_config_vars;
}

// private
function format_pipeline_couplings(pipelines) {
  return pipelines.map((coupling) => {
    return {
      "pipeline":coupling.name,
      "stage":coupling.stage
    }
  })
}

// public
const select_app_setup = query.bind(query, fs.readFileSync('./sql/select_app_setup.sql').toString('utf8'), (r) => { return r; });
async function get_setup(pg_pool, req, res, regex) {
  let app_setup_uuid = httph.first_match(req.url, regex);
  let app_setups = await select_app_setup(pg_pool, [app_setup_uuid]);

  if(app_setups.length === 1) {
    let builds_obj = await builds.list(pg_pool, [app_setups[0].app]);

    let response_obj = {
      "id":app_setups[0].app_setup,
      "created_at":(new Date(app_setups[0].created)).toISOString(),
      "updated_at":(new Date(app_setups[0].updated)).toISOString(),
      "app":{
        "id":app_setups[0].app,
        "name":app_setups[0].name
      },
      "progress":app_setups[0].progress,
      "status":app_setups[0].status,
      "failure_message":app_setups[0].failure_messages,
      "manifest_errors":[],
      "postdeploy":null,
      "resolved_success_url":app_setups[0].success_url
    };
    if(builds_obj && builds_obj.length > 0) {
      builds_obj = builds_obj.sort((a, b) => { return (new Date(a.created)).getTime() > (new Date(b.created)).getTime() ? -1 : 1 });
      response_obj.build = {
        "id":builds_obj[0].build,
        "status":builds_obj[0].status,
        "output_stream_url":config.appkit_api_url + "/apps/" + builds_obj[0].app_key + "/builds/" + builds_obj[0].id + "/result"
      }
    }
    return httph.ok_response(res, JSON.stringify(response_obj));
  } else {
    throw new common.NotFoundError(`The specified app setup id ${app_setup_uuid} was not found.`)
  }
}

async function get_app_definition(pg_pool, req, res, regex) {
  let app_key           = httph.first_match(req.url, regex)
  let app               = await common.app_exists(pg_pool, app_key)
  let space             = await common.space_exists(pg_pool, app.space_uuid)
  let config_var_set    = await config_vars.get_app_only(pg_pool, app.app_name, app.space_name)
  let formation_result  = await formation.list_types(pg_pool, app.app_name, app.space_name)
  let addons_result     = await addon_services.addons.list(pg_pool, app.app_uuid, app.app_name, app.space_name, app.org_name)
  let attach_result     = await addon_attachments.list_by_app(pg_pool, app.app_uuid)
  let build             = await builds.latest_build(pg_pool, app.app_uuid)
  let logs_result       = await logs.list('/apps/' + app.app_name + '-' + app.space_name + '/log-drains')
  let pipeline_result   = await pipelines.couplings.list_by_app(pg_pool, [app.app_uuid])
  let routes_result     = await routes.list(pg_pool, [app.app_uuid])

  // ensure we filter for socs
  config_var_set        = (space.tags.indexOf('compliance=socs') > -1) ? config_vars.socs(config_var_set) : config_var_set

  httph.ok_response(res, JSON.stringify({
    "app":{
      "locked":false,
      "name":app.app_name,
      "organization":app.org_name,
      "region":"us",
      "personal":false,
      "space":app.space_name,
      "stack":"ds1"
    },
    "env":format_config_vars(config_var_set),
    "formation":format_formations(formation_result),
    "addons":format_addons(addons_result),
    "attachments":format_attachments(attach_result),
    "source_blob":format_source_blob_from_build(app.app_uuid, app.app_name, build),
    "log-drains":format_log_drains(JSON.parse(logs_result)),
    "pipeline-couplings":format_pipeline_couplings(pipeline_result),
    "sites":format_sites(routes_result)
  }));
}

// public
function check_setup_config_vars(payload) {
  console.assert(!payload.env || typeof payload.env === "object", "Configuration vars was not an object of key value pairs.");
  let config_vars = {};
  if(payload.env) {
    let keys = Object.keys(payload.env);
    for(let i=0; i < keys.length; i++) {
      let entry = payload.env[keys[i]];

      console.assert( ( entry.required && (entry.required === true || entry.required === "true") && entry.value ) || !entry.required,
        'The configuration variable ' + keys[i] + ' was required but not provided' );
      if(entry.value) {
        config_vars[keys[i]] = entry.value;
      }
    }
  }
  return config_vars;
}

// public
function check_setup_formations(payload) {
  console.assert(!payload.formation || typeof payload.formation === "object", "Formation was not an object of key value pairs.");
  if(!payload.formation) {
    return [];
  }
  let formation_types = Object.keys(payload.formation)
  let formations_to_create = []
  for(let i=0; i < formation_types.length; i++) {
    let entry = payload.formation[formation_types[i]];
    let new_entry = {
      "type":formation_types[i],
      "quantity":entry.quantity,
      "size":entry.size,
      "port":entry.port,
      "command":entry.command,
      "healthcheck":entry['health-check']
    };
    formation.check(new_entry, [entry.size]);
    formations_to_create.push(new_entry);
  }
  return formations_to_create;
}

// public
function check_setup_addons(payload) {
  console.assert(!payload.addons || typeof payload.addons === "object", "Addons was not an object of key value pairs.");
  if(!payload.addons) {
    return [];
  }
  let addon_entries = Object.keys(payload.addons)
  let addons_to_create = []
  for(let i=0; i < addon_entries.length; i++) {
    let entry = payload.addons[addon_entries[i]];
    console.assert(entry.plan, "The addon to be created " + addon_entries[i] + " did not have a plan associated with it.");
    addons_to_create.push(entry.plan);
  }
  return addons_to_create;
}

// public
function check_setup_attachments(payload) {
  console.assert(!payload.attachments || Array.isArray(payload.attachments), "Attachments was not an array of objects.");
  if(!payload.attachments) {
    return [];
  }
  let attachments = payload.attachments.map((x) => { return x.id; });
  console.assert(attachments.every((x) => { return !!x; }), "One or more attachments did not contain an id.");
  return attachments;
}

// public
function check_setup_build(payload) {
  return payload.source_blob.url;
}

// public
function check_setup_drains(payload) {
  return payload['log-drains'] ? payload['log-drains'].map((x) => { return x.url; }) : [];
}

// public
function check_setup_couplings(payload) {
  return payload['pipeline-couplings'] ? payload['pipeline-couplings'] : [];
}

// public
const insert_app_setup = query.bind(query, fs.readFileSync('./sql/insert_app_setup.sql').toString('utf8'), (r) => { return r; });
const update_app_setup = query.bind(query, fs.readFileSync('./sql/update_app_setup.sql').toString('utf8'), (r) => { return r; });
async function setup(pg_pool, req, res, regex) {
  let payload = await httph.buffer_json(req);
  try {
    payload.app.org = payload.app.organization;
    apps.check_payload(payload.app);
    payload.app.name = payload.app.name.toLowerCase().trim();
    payload.app.space = payload.app.space.toLowerCase().trim();
  } catch (e) {
    throw new common.UnprocessableEntityError(e.message);
  }
  try {
    let setup_payload = {};
    // check/transform config vars
    setup_payload.config_vars     = check_setup_config_vars(payload);
    // check/transform formations
    setup_payload.formations      = check_setup_formations(payload);
    // check/transform addons to create
    setup_payload.addons          = check_setup_addons(payload);
    // check/transform addon_attachments
    setup_payload.attachments     = check_setup_attachments(payload);
    // check/transform release
    setup_payload.source_blob_url = check_setup_build(payload);
    // check/transform logs
    setup_payload.drains          = check_setup_drains(payload);
    // check/transform pipelines
    setup_payload.couplings       = check_setup_couplings(payload);

    // create app
    let app_info        = await apps.create(pg_pool, payload.app.org, payload.app.space, payload.app.name);
    let app_setup_uuid  = uuid.v4();
    let app_setup       = await insert_app_setup(pg_pool, [app_setup_uuid, app_info.id]);
    let app_uuid        = app_info.id;
    let app_name        = payload.app.name;
    let space_name      = app_info.space.name;
    let space_tags      = app_info.space.compliance;
    let org             = app_info.organization.name;
    let processing      = queue.create();

    // create config vars
    processing.add("configuration variables", config_vars.update.bind(config_vars.update,
      pg_pool, 
      app_uuid, 
      app_name, 
      space_name, 
      space_tags, 
      org, 
      JSON.stringify(setup_payload.config_vars)));

    // create formation
    setup_payload.formations.forEach((form) => {
      processing.add("formation creation [" + form.type + "]", formation.create.bind(formation.create,
        pg_pool,
        app_uuid,
        app_name,
        space_name,
        space_tags,
        org,
        form.type, 
        form.size, 
        form.quantity, 
        form.command,
        form.port,
        form.healthcheck,
        false));
    });

    // create addons
    setup_payload.addons.forEach((plan) => {
      processing.add("addon creation [" + plan + "]", addon_services.addons.create.bind(addon_services.addons.create,
        pg_pool, 
        app_uuid, 
        app_name, 
        space_name, 
        space_tags, 
        org, 
        plan));
    });

    // create attachments
    setup_payload.attachments.forEach((attachment) => {
      processing.add("addon attachment [" + attachment + "]", addon_attachments.create.bind(addon_attachments.create,
        pg_pool, 
        app_uuid, 
        app_name, 
        space_name, 
        space_tags, 
        org, 
        attachment));
    });

    // create a build
    processing.add("building " + setup_payload.source_blob_url, builds.create.bind(builds.create,
      pg_pool, 
      app_uuid, 
      app_name, 
      space_name, 
      space_tags, 
      org, 
      null,
      '',
      '',
      '',
      '',
      '',
      setup_payload.source_blob_url));

    // create log drain
    setup_payload.drains.forEach((drain) => {
      processing.add("log drain creation to " + drain, logs.create.bind(logs.create,
        pg_pool,
        app_uuid,
        app_name,
        space_name,
        drain));
    });

    // create pipeline couplings
    setup_payload.couplings.forEach((coupling) => {
      processing.add("pipeline coupling " + coupling.pipeline + " at stage " + coupling.stage, pipelines.couplings.create.bind(pipelines.couplings.create,
        pg_pool,
        app_uuid,
        app_name,
        space_name,
        org,
        coupling.pipeline,
        coupling.stage));
    });

    processing.onprogress = function(progress) {
      update_app_setup(pg_pool, [app_setup_uuid, progress, null, null]).catch((err) => {
        console.error("Unable to update app setup progress.", err);
      })
    }

    // order matters, formations need to exist before addons/attachments can be added.
    processing.runAsync((errors, results) => {
      // roll up errors
      errors = errors.filter((x) => { return x && x.err; }).map((x) => {
        let error = x.err;
        let name = x.name;
        console.warn("Error creating app-setups for " + app_name, x);
        if(error.code && error.message) {
          return name + " [" + error.code + "]: " + error.message; 
        } else {
          return name + " " + JSON.stringify(error);
        }
      })
      update_app_setup(pg_pool, [app_setup_uuid, 1, errors.length > 0 ? errors.join(', ') : '', errors.length > 0 ? 'failed' : 'succeeded']).catch((err) => { if(err) { 
        console.error("Unable to update app setup once finished.", err);
      }})
    })

    // todo: add build
    return httph.created_response(res, JSON.stringify({
      "id":app_setup_uuid,
      "created_at":(new Date(app_setup[0].created)).toISOString(),
      "updated_at":(new Date(app_setup[0].created)).toISOString(),
      "app":{
        "id":app_uuid,
        "name":app_name
      },
      "build":{
        "id":null,
        "status":"queued",
        "output_stream_url":null
      },
      "progress":0,
      "status":app_setup[0].status,
      "failure_message":"",
      "manifest_errors":[],
      "postdeploy":null,
      "resolved_success_url":null
    }));
  } catch (e) {
    throw new common.UnprocessableEntityError(e.message);
  }
}


module.exports = {
  create:setup,
  get:get_setup,
  definition:get_app_definition
}