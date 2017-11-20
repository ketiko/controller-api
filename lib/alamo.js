/**
 ** IMPORTANT:
 ** NEVER CALL THESE FUNCTIONS DIRECTLY, UNLESS YOU ARE THE OWNER OF THIS FEATURE,
 ** THESE ARE RUDEMENTARY CALLS, USE BUSINESS LEVEL OBJECTS TO CREATE RESPECTIVE
 ** RESOURCES FROM OTHER PARTS OF CODE.
 **/
const config = require('./config.js')
const http_help = require('./http_helper.js')
const fs = require('fs')
const query = require('./query.js')
const url = require('url')

let select_stack_and_region_by_space = query.bind(query, fs.readFileSync('./sql/select_stack_and_region_by_space.sql').toString('utf8'), (r) => { return r; });
let select_all_regions = query.bind(query, fs.readFileSync('./sql/select_all_regions.sql').toString('utf8'), (r) => { return r; });
let select_all_stacks = query.bind(query, fs.readFileSync('./sql/select_all_stacks.sql').toString('utf8'), (r) => { return r; });
let select_stack = query.bind(query, fs.readFileSync('./sql/select_stack.sql').toString('utf8'), (r) => { return r; });
let select_region = query.bind(query, fs.readFileSync('./sql/select_region.sql').toString('utf8'), (r) => { return r; });
let select_default_stack = query.bind(query, fs.readFileSync('./sql/select_default_stack.sql').toString('utf8'), (r) => { return r; });

function get_api_by_stack_name(stack_name) {
  console.assert(stack_name && stack_name !== '', 'The stack name provided by get_api_by_stack_name was empty')
  let stack_var_name = stack_name.toUpperCase().replace(/\-/g, '_') + '_STACK_API';
  if(!process.env[stack_var_name] && config.alamo_url) {
    console.warn(`WARNING: No process env was provided for stack ${stack_name}. Using default ${config.alamo_url} which will soon be deprecated!`)
  } else if(!process.env[stack_var_name] && !config.alamo_url) {
    console.error(`ERROR: No stack api url was provided in configuration for ${stack_name}, expecting ${stack_var_name} in environment!`)
    throw new http_help.InternalServerError('Internal Server Error')
  }
  return http_help.clean_forward_slash(process.env[stack_var_name] || config.alamo_url)
}

function get_api_by_region_name(region_name) {
  console.assert(region_name && region_name !== '', 'The region name provided by get_api_by_region_name was empty')
  let region_var_name = region_name.toUpperCase().replace(/\-/g, '_') + '_REGION_API';
  if(!process.env[region_var_name] && config.alamo_url) {
    console.warn(`WARNING: No process env was provided for region ${region_name}. Using default ${config.alamo_url} which will soon be deprecated!`)
  } else if(!process.env[region_var_name] && !config.alamo_url) {
    console.error(`ERROR: No stack api url was provided in configuration for ${region_name}, expecting ${region_var_name} in environment!`)
    throw new http_help.InternalServerError('Internal Server Error')
  }
  return http_help.clean_forward_slash(process.env[region_var_name] || config.alamo_url)
}

async function get_stack(pg_pool, stack_name) {
  let stack = await select_stack(pg_pool, [stack_name])
  if(stack.length !== 1) {
    throw new http_help.NotFoundError(`Unable to find region ${stack_name}.`)
  }
  return stack[0]
}

async function get_region(pg_pool, region_name) {
  let region = await select_region(pg_pool, [region_name])
  if(region.length !== 1) {
    throw new http_help.NotFoundError(`Unable to find region ${region_name}.`)
  }
  return region[0]
}

async function default_stack(pg_pool) {
  let stack = await select_default_stack(pg_pool, [])
  if(stack.length !== 1) {
    throw new http_help.UnprocessibleEntityError("Unable to determine a default stack, please specify one.")
  }
  return stack[0]
}

async function default_region(pg_pool) {
  let stack = await select_default_stack(pg_pool, [])
  if(stack.length !== 1) {
    throw new http_help.UnprocessibleEntityError("Unable to determine a default stack, please specify one.")
  }
  return stack[0]
}

let api_cache = {}
async function fetch_api_by_space(pg_pool, space_name) {
  console.assert(space_name, 'The space for api urls was not found');
  if(!api_cache[space_name]) {
    let info = await select_stack_and_region_by_space(pg_pool, [space_name]);
    if(info && info.length > 0) {
      api_cache[space_name] = info[0];
      api_cache[space_name].stack_api = get_api_by_stack_name(info[0].stack_name)
      api_cache[space_name].region_api = get_api_by_region_name(info[0].region_name)
    } else {
      console.log('ERROR: region and stack api does not exist for space:', space_name)
      api_cache[space_name] = {
        'stack_name':'default',
        'region_name':'default',
        'stack_api':config.alamo_url,
        'region_api':config.alamo_url
      }
    }
  }
  return api_cache[space_name]
}

async function get_region_name_by_space(pg_pool, space_name) {
  let info = await fetch_api_by_space(pg_pool, space_name)
  return info.region_name
}

async function get_stack_api_by_space(pg_pool, space_name) {
  let info = await fetch_api_by_space(pg_pool, space_name)
  return info.stack_api
}

async function get_region_api_by_space(pg_pool, space_name) {
  let info = await fetch_api_by_space(pg_pool, space_name)
  return info.region_api
}

async function get_all_regions(pg_pool) {
  let regions = await select_all_regions(pg_pool, [])
  return regions.map((r) => { return {name:r.region_name, url:get_api_by_region_name(r.region_name)} })
}

async function get_all_stacks(pg_pool) {
  let stacks = await select_all_stacks(pg_pool, [])
  return stacks.map((r) => { return {name:r.stack_name, url:get_api_by_stack_name(r.stack_name)} })
}

async function alamo_fetch(method, uri, payload, headers) {
  headers = headers || {}
  headers = Object.assign(headers, config.alamo_headers)

  let purl = url.parse(uri);
  uri = purl.protocol + '//' + purl.host + purl.pathname;

  if(purl.auth && !headers['Authorization'] && !headers['authorization']) {
    headers['Authorization'] = 'Basic ' + (new Buffer(purl.auth)).toString('base64');
  }

  if(!uri.startsWith('https://') && !uri.startsWith('http://')) {
    console.error(`Unable to use call ${method} ${uri}, the url did not start with https or http.`)
    throw new http_help.InternalServerError('Internal Server Error')
  }
  if(typeof payload !== 'string') {
    payload = JSON.stringify(payload)
  }
  let data = await http_help.request(method, uri, headers, payload);
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch (e) {
      // do nothing, leave it as a string
    }
  }
  return data;
}


function get_alamo_app_name(app_name, formation_type) {
  return app_name + (formation_type === 'web' ? '' : '--' + formation_type);
}

async function request_config_set(pg_pool, app_name, space_name) {
  return await alamo_fetch('get', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/config/set/${app_name}-${space_name}`, null)
}

async function create_config_set(pg_pool, app_name, space_name) {
  return await alamo_fetch('post', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/config/set`, 
    JSON.stringify({name:`${app_name}-${space_name}`, space:space_name, appname:app_name, type:'app'}))
}

async function delete_config_set(pg_pool, app_name, space_name) {
  return await alamo_fetch('delete', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/config/set/${app_name}-${space_name}`, null)
}

async function add_config_vars(pg_pool, app_name, space_name, set) {
  return await alamo_fetch('post', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/config/set/configvar`, 
  JSON.stringify(Object.keys(set).map((x) => { 
    return {setname:`${app_name}-${space_name}`, varname:x, varvalue:set[x].toString()}
  })));
}

async function add_config_var(pg_pool, app_name, space_name, name, value) {
  return await alamo_fetch('post', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/config/set/configvar`, 
    JSON.stringify([{setname:`${app_name}-${space_name}`, varname:name, varvalue:value.toString()}]))
}

async function update_config_var(pg_pool, app_name, space_name, name, value) {
  return await alamo_fetch('patch', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/config/set/configvar`, 
    JSON.stringify({setname:`${app_name}-${space_name}`, varname:name, varvalue:value.toString()}))
}

async function delete_config_var(pg_pool, app_name, space_name, name) {
  return await alamo_fetch('delete', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/config/set/${app_name}-${space_name}/configvar/${name}`, null)
}

async function service_plans(pg_pool, service_name) {
  return (await Promise.all((await get_all_regions(pg_pool))
    .map(async (region) => (await alamo_fetch('get', `${region.url}/v1/service/${service_name}/plans`, null)).map((x) => Object.assign({"regions":[region.name]}, x)))))
    .reduce((plans, reg_plans) => {
      return plans
        // if any existing plans already have a plan in reg_plans add its regions.
        .map((plan) => Object.assign(plan, {"regions":plan.regions.concat(reg_plans.filter((reg_plan) => plan.size === reg_plan.size).reduce((sum, x) => sum.concat(x.regions), []))}))
        // concat all regional_plans which are not in the current plans.
        .concat(reg_plans.filter((reg_plan) => !plans.some((plan) => reg_plan.size === plan.size)))
    }, [])
}

async function vault_plans(pg_pool) {
  return (await Promise.all((await get_all_regions(pg_pool))
    .map(async (region) => (await alamo_fetch('get', `${region.url}/v1/service/vault/plans`, null))
      .map((result) => { return {size:result, description:result, regions:[region.name]} }))))
    .reduce((plans, reg_plans) => {
      return plans
        // if any existing plans already have a plan in reg_plans add its regions.
        .map((plan) => Object.assign(plan, {"regions":plan.regions.concat(reg_plans.filter((reg_plan) => plan.size === reg_plan.size).reduce((sum, x) => sum.concat(x.regions), []))}))
        // concat all regional_plans which are not in the current plans.
        .concat(reg_plans.filter((reg_plan) => !plans.some((plan) => reg_plan.size === plan.size)))
    }, [])
}

let sizes_cache = null
async function sizes(pg_pool) {
  console.assert(pg_pool, 'Sizes did not recieve a pg_pool connector')
  if(sizes_cache) {
    return sizes_cache;
  }
  sizes_cache = (await Promise.all((await get_all_stacks(pg_pool))
    .map(async (stack) => (await alamo_fetch('get', `${stack.url}/v1/apps/plans`, null)).map((x) => Object.assign({"stacks":[stack.name]}, x)))))
    .reduce((plans, reg_plans) => {
      return plans
        // if any existing plans already have a plan in reg_plans add its stacks.
        .map((plan) => Object.assign(plan, {"stacks":plan.stacks.concat(reg_plans.filter((reg_plan) => plan.name === reg_plan.name).reduce((sum, x) => sum.concat(x.stacks), []))}))
        // concat all regional_plans which are not in the current plans.
        .concat(reg_plans.filter((reg_plan) => !plans.some((plan) => reg_plan.name === plan.name)))
    }, [])
  return sizes_cache
}

async function sizes_by_space(pg_pool, space_name) {
  return await alamo_fetch('get', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/apps/plans`, null)
}

let template_urls = {};
async function template_by_space(pg_pool, space_name) {
  if(template_urls[space_name]) {
    return template_urls[space_name]
  }
  template_urls[space_name] = await alamo_fetch('get', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/utils/urltemplates`, null);
  return template_urls[space_name]
}

async function get_alamo_namespaces(pg_pool) {
  return await Promise.all((await get_all_stacks(pg_pool)).map(async (x) => { return alamo_fetch('get', `${x.url}/v1/spaces`, null) }));
}

async function service_config_vars(pg_pool, service_name, service_id, space_name, app_name) {
  return await alamo_fetch('get', `${await get_region_api_by_space(pg_pool, space_name)}/v1/service/${service_name}/url/${service_id}`, null)
}

async function create_service(pg_pool, service_name, plan, tags, space_name, app_name) {
  return await alamo_fetch('post', `${await get_region_api_by_space(pg_pool, space_name)}/v1/service/${service_name}/instance`, {plan, billingcode:tags})
}

async function delete_service(pg_pool, service_name, spec, space_name, app_name) {
  return await alamo_fetch('delete', `${await get_region_api_by_space(pg_pool, space_name)}/v1/service/${service_name}/instance/${spec}`, null)
}

async function bind_service(pg_pool, space_name, alamo_app_name, type, name) {
  return await alamo_fetch('post', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/space/${space_name}/app/${alamo_app_name}/bind`, {appname:alamo_app_name, space:space_name, bindtype:type, bindname:name});
}

async function unbind_service(pg_pool, space_name, alamo_app_name, foreign_key) {
  return await alamo_fetch('delete', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/space/${space_name}/app/${alamo_app_name}/bind/${foreign_key}`, null)
}

async function memcached_stats(pg_pool, space_name, alamo_app_name, service_id) {
  return await alamo_fetch('get', `${await get_region_api_by_space(pg_pool, space_name)}/v1/service/memcached/operations/stats/${service_id}`, null)
}

async function memcached_flush(pg_pool, space_name, alamo_app_name, service_id) {
  return await alamo_fetch('delete', `${await get_region_api_by_space(pg_pool, space_name)}/v1/service/memcached/operations/cache/${service_id}`, null)
}

async function vault_credentials(pg_pool, service_id, space_name, app_name) {
  return await alamo_fetch('get', `${await get_region_api_by_space(pg_pool, space_name)}/v1/service/vault/credentials/${service_id}`, null)
}

async function dyno_create(pg_pool, name, space, type, port, size, healthcheck) {
  let alamo_name = get_alamo_app_name(name, type);
  let app_params = {
    appname: alamo_name,
    appport: type === 'web' ? port : -1
  };

  // add app-dyno, we ignore whether this succeds or fails, its fairly inconsequential, ignore errors produced.
  try {
    await alamo_fetch('post', `${await get_stack_api_by_space(pg_pool, space)}/v1/app`, JSON.stringify(app_params), {'x-ignore-errors':'true'})
  } catch (e) {
    // do nothing
  }
  // add app-dyno to space
  let payload = JSON.stringify({
    instances: 1,
    plan: size,
    healthcheck: type === 'web' ? healthcheck : null
  });
  await alamo_fetch('put', `${await get_stack_api_by_space(pg_pool, space)}/v1/space/${space}/app/${alamo_name}`, payload);
  // copy the bindings from the source app to the dest app, if
  // the source and the dest are the same just apply the config bind.
  //return {bindings:(await create_dyno_bindings(name, space, alamo_name, space))};

  let app_info = await alamo_fetch('get', `${await get_stack_api_by_space(pg_pool, space)}/v1/space/${space}/app/${name}`, null);
  // trap condition that should never happen, we should never have an app that's different from the source
  // with no bindings to copy, otherwise we've ran into quite the unusual case...
  if ((app_info.bindings === null || app_info.bindings.length === 0) && (name !== alamo_name)) {
    console.warn(`FATAL ERROR: We tried to copy the bindings from two different kubernetes containers,
               this normally should ALWAYS have bindings on the source but had none! Investigate this!
                - source: kubernetes( container: ${name}, namespace: ${space}
                - target: kubernetes( container: ${alamo_name}, namespace: ${space}`);
  }
  if ((app_info.bindings === null || app_info.bindings.length === 0)) {
    // this is a brand new app, we just need to bind to our own config set.
    return [await alamo_fetch('post',`${await get_stack_api_by_space(pg_pool, space)}/v1/space/${space}/app/${alamo_name}/bind`, 
      JSON.stringify({
        appname: alamo_name,
        space: space,
        bindtype: 'config',
        bindname: `${name}-${space}`
      }))]
  } else {
    return await Promise.all(app_info.bindings.map(async function(binding) {
      return alamo_fetch('post',`${await get_stack_api_by_space(pg_pool, space)}/v1/space/${space}/app/${alamo_name}/bind`,
        JSON.stringify({
          appname: alamo_name,
          space,
          bindtype: binding.bindtype,
          bindname: binding.bindname
        }));
    }));
  }
}

async function dyno_delete(pg_pool, name, space, type) {
  let alamo_name = get_alamo_app_name(name, type);
  // Unbind config set, dyno thing, keep it here.
  let bindings = await alamo_fetch('delete',`${await get_stack_api_by_space(pg_pool, space)}/v1/space/${space}/app/${alamo_name}/bind/config:${name}-${space}`, null)
    // Remove dyno from space.
  let app_space = await alamo_fetch('delete',`${await get_stack_api_by_space(pg_pool, space)}/v1/space/${space}/app/${alamo_name}`, null);
  // Remove dyno completely, this is somewhat inconsequential, so do not care about the error if any are returned.
  alamo_fetch('delete',`${await get_stack_api_by_space(pg_pool, space)}/v1/app/${alamo_name}`, null, {'x-ignore-errors':'true'}).catch((e) => { /* Do not care */ })
  return {bindings};
}


async function dyno_stop(pg_pool, space_name, alamo_app_name, dyno_id) {
  return await alamo_fetch('delete', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/space/${space_name}/app/${alamo_app_name}/instance/${dyno_id}`, null);
}

async function dyno_info(pg_pool, space_name, alamo_app_name) {
  return await alamo_fetch('get', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/space/${space_name}/app/${alamo_app_name}/instance`, null)
}

async function dyno_restart(pg_pool, space_name, alamo_app_name) {
  return await alamo_fetch('post', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/space/${space_name}/app/${alamo_app_name}/restart`, null)
}

async function dyno_scale(pg_pool, app_name, space_name, type, instances) {
  let alamo_name = get_alamo_app_name(app_name, type);
  return await alamo_fetch('put', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/space/${space_name}/app/${alamo_name}/scale`, JSON.stringify({instances}));
}

async function dyno_change_port(pg_pool, name, space, port) {
  return await update_config_var(pg_pool, name, space, 'PORT', port)
}

async function dyno_change_plan(pg_pool, name, space, type, plan) {
  let alamo_name = get_alamo_app_name(name, type)
  return await alamo_fetch('put', `${await get_stack_api_by_space(pg_pool, space)}/v1/space/${space}/app/${alamo_name}/plan`, JSON.stringify({plan}))
}

async function dyno_change_healthcheck(pg_pool, name, space, type, healthcheck) {
  let alamo_name = get_alamo_app_name(name, type)
  return await alamo_fetch('put', `${await get_stack_api_by_space(pg_pool, space)}/v1/space/${space}/app/${alamo_name}/healthcheck`, JSON.stringify({healthcheck}))
}

async function dyno_remove_healthcheck(pg_pool, name, space, type) {
  let alamo_name = get_alamo_app_name(name, type)
  return await alamo_fetch('delete', `${await get_stack_api_by_space(pg_pool, space)}/v1/space/${space}/app/${alamo_name}/healthcheck`, null)
}

async function create_alamo_namespace(pg_pool, space, internal) {
  return await alamo_fetch('post', `${await get_stack_api_by_space(pg_pool, space)}/v1/space`, JSON.stringify({name:space, internal}))
}

// public
// Kubenetes requires we break up commands into an array, hopefully this adequately splits the command into
// an appropriate command array with the 0th value being the command. Note that while i hoped to have something
// built in to use (or a library) I couldn't find one, so here's my best attempt that accounts for quotes.
function parse_command_args(arg) {
  let args = arg.split(' ');
  let targets = [];

  let inside_quote = false;
  let leaving_quote = false;
  args.forEach((x) => {
    if (x === '') {
      return;
    }
    if (x[0] === '"') {
      inside_quote = true;
      x = x.substring(1);
    }
    if (x[x.length - 1] === '"' && inside_quote) {
      x = x.substring(0, x.length - 1);
      leaving_quote = true;
    }
    if (inside_quote) {
      if (!targets[targets.length - 1]) {
        targets[targets.length - 1] === '';
      }
      targets[targets.length - 1] += ' ' + x;
    } else {
      targets.push(x);
    }
    if (leaving_quote) {
      inside_quote = leaving_quote = false;
    }
  });
  return targets;
}

async function deploy(pg_pool, space_name, app_name, formation_type, image, command, port) {
  let alamo_app_name = get_alamo_app_name(app_name, formation_type)
  if(!command || command === '') {
    command = null
  } else {
    command = parse_command_args(command)
  }
  if(formation_type !== 'web') {
    port = -1
  }
  if(process.env.DEBUG) {
    console.log(`deploy requested: kubernetes(container: ${alamo_app_name} namespace: ${space_name}) command: [${command}] port: ${port} image: ${image}`);
  }
  await alamo_fetch('post', `${await get_stack_api_by_space(pg_pool, space_name)}/v1/app/deploy`, {appname:alamo_app_name, appimage:image, space:space_name, command, port})
}

async function create_route(pg_pool, space_name, app_name, domain, source_path, target_path) {
  let payload = {
    domain,
    path:source_path,
    space:space_name,
    app:app_name,
    replacepath:target_path
  };
  return await alamo_fetch('post', `${await get_region_api_by_space(pg_pool, space_name)}/v1/router/${domain}/path`, payload)
}

async function delete_route(pg_pool, region_name, domain, source_path) {
  return await alamo_fetch('delete', `${get_api_by_region_name(region_name)}/v1/router/${domain}/path${source_path}`, {})
}

async function push_routes(pg_pool, region_name, domain) {
  return await alamo_fetch('put', `${get_api_by_region_name(region_name)}/v1/router/${domain}`, {});
}

async function create_domain(pg_pool, region_name, domain, internal) {
  return await alamo_fetch('post', `${get_api_by_region_name(region_name)}/v1/router/`, {domain, internal});
}

async function delete_domain(pg_pool, region_name, domain) {
  return await alamo_fetch('delete', `${get_api_by_region_name(region_name)}/v1/router/${domain}`, null)
}

async function certificate_status(region_name, id) {
  return await alamo_fetch('get', `${get_api_by_region_name(region_name)}/v1/certs/${id}`, null);
}

async function certificate_install(region_name, id) {
  return await alamo_fetch('post',`${get_api_by_region_name(region_name)}/v1/certs/${id}/install`, null);
}

async function certificate_request(region_name, comment, cn, SAN, requestedby) {
  return await alamo_fetch('post', `${get_api_by_region_name(region_name)}/v1/certs`, JSON.stringify({comment, cn, SAN, requestedby}))
}


async function postgres_backups_list(pg_pool, space_name, app_name, service_id, action_id) {
  return await alamo_fetch('get', `${await get_region_api_by_space(pg_pool, space_name)}/v2/services/postgres/${service_id}/backups`, null)
}
async function postgres_backups_capture(pg_pool, space_name, app_name, service_id, action_id) {
  return await alamo_fetch('put', `${await get_region_api_by_space(pg_pool, space_name)}/v2/services/postgres/${service_id}/backups`, null)
}
async function postgres_backups_restore(pg_pool, space_name, app_name, service_id, action_id, req_url, backup) {
  return await alamo_fetch('put', `${await get_region_api_by_space(pg_pool, space_name)}/v2/services/postgres/${service_id}/backups/${backup}`, null)
}
async function postgres_creds_list(pg_pool, space_name, app_name, service_id, action_id) {
  return await alamo_fetch('get', `${await get_region_api_by_space(pg_pool, space_name)}/v2/services/postgres/${service_id}/roles`, null)
}
async function postgres_creds_create(pg_pool, space_name, app_name, service_id, action_id) {
  console.log(`calling post ${await get_region_api_by_space(pg_pool, space_name)}/v2/services/postgres/${service_id}/roles`)
  return await alamo_fetch('post', `${await get_region_api_by_space(pg_pool, space_name)}/v2/services/postgres/${service_id}/roles`, null)
}
async function postgres_creds_destroy(pg_pool, space_name, app_name, service_id, action_id, req_url, role) {
  return await alamo_fetch('delete', `${await get_region_api_by_space(pg_pool, space_name)}/v2/services/postgres/${service_id}/roles/${role}`, null)
}
async function postgres_creds_rotate(pg_pool, space_name, app_name, service_id, action_id, req_url, role) {
  return await alamo_fetch('put', `${await get_region_api_by_space(pg_pool, space_name)}/v2/services/postgres/${service_id}/roles/${role}`, null)
}
async function postgres_logs(pg_pool, space_name, app_name, service_id, action_id) {
  let logs = await alamo_fetch('get', `${await get_region_api_by_space(pg_pool, space_name)}/v2/services/postgres/${service_id}/logs`, null)
  if(logs.error) {
    throw new http_help.UnprocessibleEntityError(logs.error)
  }
  return  (await Promise.all(logs.sort((a, b) => { 
    return (Date.parse(a.updated_at) > Date.parse(b.updated_at) ? -1 : 1) 
  }).slice(0, 2).map(async (x) => { 
    return await alamo_fetch('get', `${await get_region_api_by_space(pg_pool, space_name)}/v2/services/postgres/${service_id}/logs/${x.name}`, null)
  }))).join('\n').split('\n')
}
async function postgres_restart(pg_pool, space_name, app_name, service_id, action_id) {
  return await alamo_fetch('put', `${await get_region_api_by_space(pg_pool, space_name)}/v2/services/postgres/${service_id}`, null)
}


module.exports = {
  deploy,
  default_stack,
  default_region,
  stack:get_stack,
  region:get_region,
  regions:get_all_regions,
  stacks:get_all_stacks,
  app_name:get_alamo_app_name,
  spaces:{
    list:get_alamo_namespaces,
    create:create_alamo_namespace
  },
  sites:{
    create_route,
    delete_route,
    push_routes,
    create_domain,
    delete_domain
  },
  postgres:{
    backups:{
      list:postgres_backups_list,
      capture:postgres_backups_capture,
      restore:postgres_backups_restore,
    },
    credentials:{
      list:postgres_creds_list,
      create:postgres_creds_create,
      destroy:postgres_creds_destroy,
      rotate:postgres_creds_rotate,
    },
    logs:postgres_logs,
    restart:postgres_restart,
  },
  parse_command_args,
  sizes,
  sizes_by_space,
  service_plans,
  service_config_vars,
  create_service,
  bind_service,
  unbind_service,
  delete_service,
  vault_plans,
  config:{
    set:{
      create:create_config_set,
      delete:delete_config_set,
      request:request_config_set
    },
    update:update_config_var,
    batch:add_config_vars,
    add:add_config_var,
    delete:delete_config_var,
  },
  dyno:{
    create:dyno_create,
    delete:dyno_delete,
    stop:dyno_stop,
    info:dyno_info,
    restart:dyno_restart,
    scale:dyno_scale,
    change_port:dyno_change_port,
    change_plan:dyno_change_plan,
    change_healthcheck:dyno_change_healthcheck,
    remove_healthcheck:dyno_remove_healthcheck
  },
  certificate:{
    status:certificate_status,
    install:certificate_install,
    create:certificate_request
  },
  memcached:{
    stats:memcached_stats,
    flush:memcached_flush
  },
  url_templates:template_by_space,
  region_name_by_space:get_region_name_by_space,
  vault_credentials
};