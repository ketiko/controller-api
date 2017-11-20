"use strict";

const http_help = require('./http_helper.js');
const url = require('url');

let config = {
  jenkins_url:http_help.clean_forward_slash(process.env.JENKINS_URL),
  build_shuttle_url:http_help.clean_forward_slash(process.env.BUILD_SHUTTLE_URL), // deprecate
  simple_key:process.env.AUTH_KEY,
  alamo_app_controller_url:http_help.clean_forward_slash(process.env['ALAMO_APP_CONTROLLER_URL'] || "http://localhost:5000"),
  appkit_api_url:http_help.clean_forward_slash(process.env['APPKIT_API_URL'] || "http://localhost:5000"),
  docker_registry_host:process.env.DOCKER_REGISTRY_HOST,
  prometheus_metrics_url:process.env.PROMETHEUS_METRICS_URL,
  log_shuttle_url:process.env.LOG_SHUTTLE_URL, // deprecate
  log_session_url:process.env.LOG_SESSION_URL, // deprecate
  default_port:process.env.DEFAULT_PORT ? parseInt(process.env.DEFAULT_PORT, 10) : 9000,
  gm_docker_repo:process.env.DOCKER_REPO,
  envs_blacklist:process.env.BLACKLIST_ENV || 'PASS,KEY,SECRET,PRIVATE,TOKEN,SALT',
  influxdb_metrics_url:process.env.INFLUXDB_METRICS_URL,
  dyno_default_size:process.env.DYNO_DEFAULT_SIZE || "scout",
  anomaly_metrics_drain:process.env.ANOMALY_METRICS_DRAIN,
  papertrail_drain:process.env.PAPERTRAIL_DRAIN,
  twilio_auth:process.env.TWILIO_AUTH_KEY,
  alamo_headers:{}
};


module.exports = config;