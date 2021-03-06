#!/usr/bin/env node
var dnode   = require('dnode'),
    path    = require('path'),
    net     = require('net'),
    config  = require('../js/config.js'),
    git_util   = require('../js/git_util.js'),
    util       = require('../js/util.js'),
    Codesearch = require('../js/codesearch.js'),
    Batch      = require('../js/batch.js'),
    parseopt   = require('../js/lib/parseopt.js'),
    backend    = require('../js/backend.js')

function Client(parent, remote) {
  var self = this;
  this.parent = parent;
  this.remote = remote;
  this.queue  = [];
  this.conn   = parent.codesearch.connect();
  this.conn.on('ready', function() {
                 var q;
                 if (self.queue.length) {
                   q = self.queue.shift();
                   self.search(q.search, q.cb);
                 } else {
                   self.ready();
                 }
               });
}

Client.prototype.ready = function() {
  if (this.remote.ready)
    util.remote_call(this.remote, 'ready');
}

Client.prototype.search = function (search, cb) {
  if (this.conn.readyState !== 'ready') {
    this.queue.push({
                      search: search,
                      cb: cb
                    });
    return;
  }
  var search = this.conn.search(search.line, search.file, search.repo);
  var batch  = new Batch(function (m) {
                           util.remote_call(cb, 'match', m);
                         }, 50);
  search.on('error', util.remote_call.bind(null, cb, 'error'));
  search.on('done',  function () {
              batch.flush();
              util.remote_call.apply(null, [cb, 'done'].concat(Array.prototype.slice.call(arguments)));
            });
  search.on('match', batch.send.bind(batch));
}

function Server(backend) {
  var parent = this;
  this.clients = [];

  this.codesearch = new Codesearch(backend.repo, [], {
                                     args: ['--load_index', backend.index].concat(backend.search_args || [])
                                   });
  this.Server = function (remote, conn) {
    parent.clients[conn.id] = new Client(parent, remote);
    conn.on('end', function() {
              var client = parent.clients[conn.id];
              delete parent.clients[conn.id];
            });
    this.try_search = function(search, cb) {
      if (parent.clients[conn.id].conn.readyState !== 'ready') {
        util.remote_call(cb, 'not_ready');
        return;
      }
      parent.clients[conn.id].search(search, cb);
    }
    this.search = function(search, cb) {
      parent.clients[conn.id].search(search, cb);
    }
  }
}

var parser = new parseopt.OptionParser();
backend.addBackendOpt(config, parser);

var opts = parser.parse(process.argv);

var backend = backend.selectBackend(config, opts);

var server = dnode(new Server(backend).Server);
server.listen(backend.port);
