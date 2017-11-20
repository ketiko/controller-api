"use strict"

const crypto = require('crypto');
const fs = require('fs');
const uuid = require('uuid');
const common = require('../common.js');
const config = require('../config.js');
const httph = require('../http_helper.js');
const query = require('../query.js');


function plans(regions) {
  return [
    {
      "addon_service": {
        "id": uuid.unparse(crypto.createHash('sha256').update('twilio').digest(), 16),
        "name": "twilio"
      },
      "created_at": "2016-08-09T12:00:00Z",
      "default": false,
      "description": "2500 voice minutes, 3000 SMS messages.",
      "human_name": "Small",
      "id": uuid.unparse(crypto.createHash('sha256').update("twilio:small").digest(), 16),
      "installable_inside_private_network": true,
      "installable_outside_private_network": true,
      "name":"twilio:small",
      "key":"small",
      "price": {
        "cents": 5000,
        "unit": "month"
      },
      "available_regions":regions,
      "compliance":[],
      "space_default": false,
      "state": "public",
      "updated_at": "2016-08-09T12:00:00Z"
    },
    {
      "addon_service": {
        "id": uuid.unparse(crypto.createHash('sha256').update('twilio').digest(), 16),
        "name": "twilio"
      },
      "created_at": "2016-08-09T12:00:00Z",
      "default": false,
      "description": "5000 voice minutes, 6000 SMS messages.",
      "human_name": "Medium",
      "id": uuid.unparse(crypto.createHash('sha256').update("twilio:medium").digest(), 16),
      "installable_inside_private_network": true,
      "installable_outside_private_network": true,
      "name":"twilio:medium",
      "key":"medium",
      "price": {
        "cents": 10000,
        "unit": "month"
      },
      "available_regions":regions,
      "compliance":[],
      "space_default": false,
      "state": "public",
      "updated_at": "2016-08-09T12:00:00Z"
    },
    {
      "addon_service": {
        "id": uuid.unparse(crypto.createHash('sha256').update('twilio').digest(), 16),
        "name": "twilio"
      },
      "created_at": "2016-08-09T12:00:00Z",
      "default": false,
      "description": "10000 voice minutes, 12000 SMS messages.",
      "human_name": "Large",
      "id": uuid.unparse(crypto.createHash('sha256').update("twilio:large").digest(), 16),
      "installable_inside_private_network": true,
      "installable_outside_private_network": true,
      "name":"twilio:large",
      "key":"large",
      "price": {
        "cents": 20000,
        "unit": "month"
      },
      "available_regions":regions,
      "compliance":[],
      "space_default": false,
      "state": "public",
      "updated_at": "2016-08-09T12:00:00Z"
    },
  ]
}

function info(regions) {
  return {
    "actions":[],
    "cli_plugin_name": "twilio",
    "created_at": "2016-08-09T12:00:00Z",
    "human_name": "Twilio",
    "description": "Send and receive SMS, MMS, faxes and phone calls. Built in 2FA tooling, call center and notification sdks.",
    "id": uuid.unparse(crypto.createHash('sha256').update('twilio').digest(), 16),
    "name": "twilio",
    "state": "ga",
    "available_regions":regions,
    "supports_multiple_installations": true,
    "supports_sharing": false,
    "updated_at": "2016-08-09T12:00:00Z"
  };
}

async function get_plans(type) {
  return plans()
}

function transform_alamo_service(app, addon, addon_plan, service) {
  return {
    "actions":[],
    "addon_service": {
      "id": uuid.unparse(crypto.createHash('sha256').update('twilio').digest(), 16),
      "name": "twilio"
    },
    "app": {
      "id": app.id,
      "name": app.name + '-' + app.space
    },
    "config_vars": service.config_vars,
    "created_at": (new Date(service.created)).toISOString(),
    "id": service.service,
    "name": service.name,
    "plan": {
      "id": addon_plan.id,
      "name": addon_plan.name
    },
    "provider_id": "twilio",
    "updated_at": (new Date(service.updated)).toISOString(),
    "web_url": "https://www.twilio.com"
  };
}

function create_service_attachment_name(addon_plan) {
  return 'twilio-' + common.random_name() + '-' + Math.floor(Math.random() * 10000);
}

function get_actions() {
  return [];
}

function action(pg_pool, plan, service, app, action_id, req_url) {
  throw new common.NotAllowedError("The addon does not support any actions.")
}

let twilio_headers = {
  "Authorization":"Basic " + (config.twilio_auth ? (new Buffer(config.twilio_auth)).toString('base64') : ''),
  "Content-Type":"application/x-www-form-urlencoded"
};

const insert_service = query.bind(query, fs.readFileSync('./sql/insert_service.sql').toString('utf8'), (r) => { return r; });
const insert_service_attachment = query.bind(query, fs.readFileSync('./sql/insert_service_attachment.sql').toString('utf8'), (r) => { return r; });
async function provision(pg_pool, app, addon_plan, cb) {
  let service_uuid = uuid.v4();
  let foreign_key = app.name + '-' + app.space + '-' + service_uuid
  let data = await httph.request('post', 'https://api.twilio.com/2010-04-01/Accounts.json', twilio_headers, 'FriendlyName=' + foreign_key)
  data = JSON.parse(data);
  let service = {
    "foreign_key":"twilio:" + foreign_key,
    "config_vars":{
      "TWILIO_AUTH_TOKEN":data.auth_token,
      "TWILIO_SID":data.sid
    }
  };
  await common.alamo.config.batch(pg_pool, app.name, app.space, service.config_vars);
  let created_updated = new Date();
  let addon = info();
  await insert_service(pg_pool, [service_uuid, addon.id, addon.name, addon_plan.id, addon_plan.name, addon_plan.price.cents, service.foreign_key, created_updated, created_updated])
  let service_attachment_uuid = uuid.v4();
  let service_attachment_name = create_service_attachment_name(addon, addon_plan);
  await insert_service_attachment(pg_pool, [service_attachment_uuid, service_attachment_name, service_uuid, app.id, true, created_updated, created_updated])
  service.name = service_attachment_name;
  service.service = service_uuid;
  service.created = created_updated;
  service.updated = created_updated;
  return service
}

const delete_service = query.bind(query, fs.readFileSync('./sql/delete_service.sql').toString('utf8'), (r) => { return r; });
const delete_service_attachment = query.bind(query, fs.readFileSync('./sql/delete_service_attachment.sql').toString('utf8'), (r) => { return r; });
async function unprovision(pg_pool, app, addon_plan, service, cb) {
  let data = await httph.request('get', 'https://api.twilio.com/2010-04-01/Accounts.json?FriendlyName=' + app.name + '-' + app.space + '-' + app.id, twilio_headers, null)
  data = JSON.parse(data);
  await httph.request('post', 'https://api.twilio.com/2010-04-01/Accounts/' + data.accounts[0].sid + '.json', twilio_headers, 'Status=closed')
  await common.alamo.config.delete(pg_pool, app.name, app.space, "TWILIO_AUTH_TOKEN");
  await common.alamo.config.delete(pg_pool, app.name, app.space, "TWILIO_SID");
  let service_attachment = await delete_service_attachment(pg_pool, [service.service, app.id])
  await delete_service(pg_pool, [service.service])
  return service
}

async function attach(pg_pool, target_app, addon_plan, service, owner) {
  throw new common.NotAllowedError("Attaching and dettaching are not supported by this addon.")
}

async function detach(pg_pool, app, addon_plan, service) {
  throw new common.NotAllowedError("Attaching and dettaching are not supported by this addon.")
}

async function get_config_vars(pg_pool, service) {
  if(service.foreign_key.indexOf('twilio:') === -1) {
    throw new common.InternalServerError("No service foriegn key found on twilio instance.")
  }
  let key = service.foreign_key.replace(/twilio\:/g, '');
  let data = await httph.request('get', 'https://api.twilio.com/2010-04-01/Accounts.json', twilio_headers, 'FriendlyName=' + key)
  data = JSON.parse(data);
  return {
    "TWILIO_AUTH_TOKEN":data.auth_token,
    "TWILIO_SID":data.sid
  }
}

function begin_timers(addon) {
}

module.exports = function(cb, pg_pool) { 
  if(config.twilio_auth) {
    common.alamo.regions(pg_pool).then((regions) => {
      cb({
        get_plans,
        info:info.bind(plans, regions.map((x) => x.name)),
        plans:plans.bind(plans, regions.map((x) => x.name)),
        provision,
        unprovision,
        attach,
        detach,
        action,
        get_actions,
        config_vars:get_config_vars,
        timers:{begin:begin_timers}
      });
    }).catch((e) => console.error(e))
  }
};