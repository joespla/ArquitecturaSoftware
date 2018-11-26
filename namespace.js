

var Socket = require('./socket');
var Emitter = require('events').EventEmitter;
var hasBin = require('has-binary2');
var debug = require('debug')('socket.io:namespace');


module.exports = exports = Namespace;


exports.events = [
  'connect',    // for symmetry with client
  'connection',
  'newListener'
];


exports.flags = [
  'json',
  'volatile',
  'local'
];


var emit = Emitter.prototype.emit;

function Namespace(server, name){
  this.name = name;
  this.server = server;
  this.sockets = {};
  this.connected = {};
  this.fns = [];
  this.ids = 0;
  this.rooms = [];
  this.flags = {};
  this.initAdapter();
}

Namespace.prototype.__proto__ = Emitter.prototype;


exports.flags.forEach(function(flag){
  Object.defineProperty(Namespace.prototype, flag, {
    get: function() {
      this.flags[flag] = true;
      return this;
    }
  });
});

Namespace.prototype.use = function(fn){
  if (this.server.eio && this.name === '/') {
    debug('removing initial packet');
    delete this.server.eio.initialPacket;
  }
  this.fns.push(fn);
  return this;
};


Namespace.prototype.run = function(socket, fn){
  var fns = this.fns.slice(0);
  if (!fns.length) return fn(null);

  function run(i){
    fns[i](socket, function(err){
      // upon error, short-circuit
      if (err) return fn(err);

      // if no middleware left, summon callback
      if (!fns[i + 1]) return fn(null);

      // go on to next
      run(i + 1);
    });
  }

  run(0);
};


Namespace.prototype.to =
Namespace.prototype.in = function(name){
  if (!~this.rooms.indexOf(name)) this.rooms.push(name);
  return this;
};


Namespace.prototype.add = function(client, query, fn){
  debug('adding socket to nsp %s', this.name);
  var socket = new Socket(this, client, query);
  var self = this;
  this.run(socket, function(err){
    process.nextTick(function(){
      if ('open' == client.conn.readyState) {
        if (err) return socket.error(err.data || err.message);

        // track socket
        self.sockets[socket.id] = socket;

        socket.onconnect();
        if (fn) fn();

        // fire user-set events
        self.emit('connect', socket);
        self.emit('connection', socket);
      } else {
        debug('next called after client was closed - ignoring socket');
      }
    });
  });
  return socket;
};


Namespace.prototype.remove = function(socket){
  if (this.sockets.hasOwnProperty(socket.id)) {
    delete this.sockets[socket.id];
  } else {
    debug('ignoring remove for %s', socket.id);
  }
};


Namespace.prototype.send =
Namespace.prototype.write = function(){
  var args = Array.prototype.slice.call(arguments);
  args.unshift('message');
  this.emit.apply(this, args);
  return this;
};


Namespace.prototype.clients = function(fn){
  this.adapter.clients(this.rooms, fn);
  // reset rooms for scenario:
  // .in('room').clients() (GH-1978)
  this.rooms = [];
  return this;
};
