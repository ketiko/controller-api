"use strict"

process.env.DEFAULT_PORT = "5000";
process.env.PORT = 5000;
process.env.AUTH_KEY = 'hello';
const init = require('./support/init.js');
const httph = require('../lib/http_helper.js');
const expect = require("chai").expect;
const alamo_headers = {"Authorization":process.env.AUTH_KEY, "User-Agent":"Hello"};

describe("audits: writing and reading events", function() {  
  this.timeout(100000);

  let appname_brand_new = "alamotest" + Math.floor(Math.random() * 10000)

  it("covers creating the test app for services", (done) => {
    httph.request('post', 'http://localhost:5000/apps', alamo_headers,
      JSON.stringify({org:"test", space:"default", name:appname_brand_new}), 
      (err, data) => {
        expect(err).to.be.null;
        expect(data).to.be.a('string');
        done();
    });
  });
});