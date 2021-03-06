"use strict"

const crypto = require('crypto');
const uuid = require('uuid');
const addons = require('./addons.js');
const common = require('../common.js');
const config = require('../config.js');
const formation = require('../formations.js');
const httph = require('../http_helper.js');

module.exports = function(long_name, short_name, keyed_name, alamo_name, plan_price, description, actions, transform_alamo_plans, transform_appkit_plan) {

  async function provision(pg_pool, type, app_name, space_name, org_name, addon_plan) {
    let key = addon_plan.key;
    if(transform_appkit_plan) {
      key = transform_appkit_plan(addon_plan.key)
    }
    let formations = await formation.list_types(pg_pool, app_name, space_name)
    if(formations.length === 0) {
      throw new common.NoFormationsFoundError()
    }
    let response = await common.alamo.create_service(pg_pool, type, key, org_name, space_name, app_name)
    let specs = response.spec.split(':');
    if(!specs[1] || specs[1] === '') {
      throw new common.WaitingForResourcesError()
    }
    let config_service_vars = {};
    Object.keys(response).forEach((key) => {
      if(key !== 'spec') {
        config_service_vars[key] = response[key];
      }
    });
    let results = await Promise.all(formations.map(async (form) => {
      return common.alamo.bind_service(pg_pool, space_name, common.alamo.app_name(app_name, form.type), specs[0], specs[1])
    }));
    return {foreign_key:response.spec, config_vars:config_service_vars, reply:results, created:new Date()}
  }

  async function unprovision(pg_pool, type, app_name, space_name, org, addon_plan, service) {
    let spec = service.foreign_key.split(':');
    let formations = await formation.list_types(pg_pool, app_name, space_name)
    await Promise.all(formations.map(async (form) => {
      return await common.alamo.unbind_service(pg_pool, space_name, common.alamo.app_name(app_name, form.type), service.foreign_key)
    }))
    await common.alamo.delete_service(pg_pool, type, spec[1], space_name, app_name)
    return service.foreign_key
  }

  async function attach(pg_pool, app, addon_plan, service) {
    let specs = service.foreign_key.split(':');
    let formations = await formation.list_types(pg_pool, app.name, app.space)
    if(formations.length === 0) {
      throw new common.NoFormationsFoundError()
    }
    await Promise.all(formations.map(async (form) => {
      return await common.alamo.bind_service(pg_pool, app.space, common.alamo.app_name(app.name, form.type), specs[0], specs[1])
    }))
    return service
  }

  async function detach(pg_pool, app, addon_plan, service) {
    let formations = await formation.list_types(pg_pool, app.name, app.space)
    if(formations.length === 0) {
      throw new common.NoFormationsFoundError()
    }
    await Promise.all(formations.map(async (form) => {
      return await common.alamo.unbind_service(pg_pool, app.space, common.alamo.app_name(app.name, form.type), service.foreign_key)
    }))
    return service
  }

  function get_actions() {
    if(actions && actions["info"]) {
      return actions["info"];
    } else {
      return null;
    }
  }

  async function action(pg_pool, plan, service, app, action_id, req_url, payload) {
    if(actions && actions[action_id]) {
      return await actions[action_id].exec(pg_pool, plan, service, app, action_id, req_url, payload)
    } else {
      throw new common.NotFoundError("No such action found.")
    }
  }

  const addon_definition = {
    human_name:long_name,
    short_name:short_name,
    name:keyed_name,
    alamo_name,
    id:uuid.unparse(crypto.createHash('sha256').update(keyed_name).digest(), 16),
    plan_price,
    plans:[],
    provision,
    unprovision,
    action,
    get_actions,
    attach,
    detach,
    description,
    transform_alamo_plans
  };

  return {
    config_vars:addons.config_vars.bind(null, addon_definition),
    info:addons.info.bind(null, addon_definition), 
    plans:addons.plans.bind(null, addon_definition),
    provision:addons.provision.bind(null, addon_definition),
    unprovision:addons.unprovision.bind(null, addon_definition),
    detach:addons.detach.bind(null, addon_definition),
    attach:addons.attach.bind(null, addon_definition),
    action:addons.action.bind(null, addon_definition),
    get_actions:addons.get_actions.bind(null, addon_definition),
    timers:{begin:addons.begin_timers.bind(null, addon_definition)}
  }
}
