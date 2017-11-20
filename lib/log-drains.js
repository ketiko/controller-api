"use strict"

const url = require('url');
const config = require('./config.js');
const common = require('./common.js');
const httph = require('./http_helper.js');

let curl = url.parse(config.log_shuttle_url);
let log_shuttle_url = curl.protocol + "//" + curl.host;
let log_shuttle_token = curl.auth ? curl.auth : '';
let log_shuttle_headers = {"content-type":"application/json","authorization":log_shuttle_token}


async function create(pg_pool, app_uuid, app_name, space_name, url) {
  let data = await httph.request('post', log_shuttle_url + '/apps/' + app_name + '-' + space_name + '/log-drains', log_shuttle_headers, JSON.stringify({url}))
  data = JSON.parse(data.toString());
  common.notify_hooks(pg_pool, app_uuid, 'logdrain_change', JSON.stringify({
    'action':'logdrain_change',
    'app':{
      'name':app_name,
      'id':app_uuid
    },
    'space':{
      'name':space_name
    },
    'change':'create',
    'changes':[ { "url":data.url, "id":data.id } ]
  }));
  return data
}

// TODO: Make these function off of just app/space name and ids not urls.
async function list(purl) {
  return await httph.request('get',  log_shuttle_url + purl, log_shuttle_headers, null)
}

async function get(purl) {
  return await httph.request('get',  log_shuttle_url + purl, log_shuttle_headers, null)
}

async function del(pg_pool, drain_id, app_uuid, app_name, space_name, url) {
  let data = await httph.request('delete',  log_shuttle_url + url, log_shuttle_headers, null)
  common.notify_hooks(pg_pool, app_uuid, 'logdrain_change', JSON.stringify({
    'action':'logdrain_change',
    'app':{
      'name':app_name,
      'id':app_uuid
    },
    'space':{
      'name':space_name
    },
    'change':'delete',
    'changes':[ { "id":drain_id } ]
  }))
  return data
}


async function http_create(pg_pool, req, res, regex) {
  let app_key = httph.first_match(req.url, regex)
  let app = await common.app_exists(pg_pool, app_key);
  let body = await httph.buffer_json(req, res)
  if(!body || !body.url) {
    throw new common.BadRequestError('The request did not include a "url" parameter.');
  }
  return httph.created_response(res, JSON.stringify(await create(pg_pool, app.app_uuid, app.app_name, app.space_name, body.url)))
}

async function http_list(pg_pool, req, res, regex) {
  let app_key = httph.first_match(req.url, regex)
  let app = await common.app_exists(pg_pool, app_key)
  return httph.ok_response(res, await list(req.url))
}

async function http_get(pg_pool, req, res, regex) {
  let app_key = httph.first_match(req.url, regex)
  let app = await common.app_exists(pg_pool, app_key)
  return httph.ok_response(res, await get(req.url))
}

async function http_delete(pg_pool, req, res, regex) {
  let app_key = httph.first_match(req.url, regex)
  let drain_id = httph.second_match(req.url, regex)
  let app = await common.app_exists(pg_pool, app_key)
  return httph.ok_response(res, await del(pg_pool, drain_id, app.app_uuid, app.app_name, app.space_name, req.url))
}

async function delete_all_drains(pg_pool, app_name, space_name, org_name) {
  let data = await httph.request('get',  log_shuttle_url + '/apps/' + app_name + '-' + space_name + '/log-drains', log_shuttle_headers, null)
  try {
    data = JSON.parse(data.toString());
  } catch (e) {
    console.log('error in delete_all_drains:', e.message, e.stack);
    throw new common.ServiceUnavailableError("Backing shuttle services is unavailable.")
  }
  for(let i=0; i < data.length; i++) {
    let logdrain = data[i]
    await httph.request('delete',  log_shuttle_url + '/apps/' + app_name + '-' + space_name + '/log-drains/' + logdrain.id, log_shuttle_headers, null)
  }
  return data;
}

async function event(app, space, data) {
  if(Buffer.isBuffer(data)) {
    data = data.toString('utf8');
  }
  if(typeof data !== 'string') {
    data = data.toString();
  }
  let payload = {
    "log":data,
    "stream":"stdout",
    "time":((new Date()).toISOString()),
    "docker":{
      "container_id":""
    },
    "kubernetes":
    {
      "namespace_name":space,
      "pod_id":"",
      "pod_name":"alamo",
      "container_name":app,
      "labels":{
        "name":""
      },
      "host":""
    },
    "topic":space,
    "tag":""
  };
  try {
    await httph.request('post', log_shuttle_url + '/log-events', log_shuttle_headers, JSON.stringify(payload))
  } catch (err) {
    console.warn("Unable to submit custom log message:", err);
  }
}

module.exports = {
  http:{
    create:http_create,
    list:http_list,
    get:http_get,
    delete:http_delete
  },
  create,
  list,
  get,
  delete:del,
  delete_all_drains,
  event
}