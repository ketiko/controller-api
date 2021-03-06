const common = require('./common.js')
const httph = require('./http_helper.js')

async function create(pg_pool, req, res, regex) {
  let payload = await httph.buffer_json(req)
  if(!payload.action || !payload.key) {
    throw new common.BadRequestError()
  }
  let app = await common.app_exists(pg_pool, payload.key)
  payload.app = {
    "name":app.app_name,
    "id":app.app_uuid
  }
  payload.space = {
    "name":app.space_name
  }
  if(payload.action === 'released') {
    common.lifecycle.emit('released', payload);
  }
  common.notify_hooks(pg_pool, app.app_uuid, payload.action, JSON.stringify(payload), req.headers['x-username']);
  return httph.ok_response(res, JSON.stringify({"status":"ok"}));
}

module.exports = {
  http:{
    create
  }
}