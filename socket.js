var Emitter = require('events').EventEmitter;
var parser = require('socket.io-parser');
var hasBin = require('has-binary2');
var url = require('url');
var debug = require('debug')('socket.io:socket');


module.exports = exports = Socket;


exports.events = [
  'error',
  'connect',
  'disconnect',
  'disconnecting',
  'newListener',
  'removeListener'
];


var flags = [
  'json',
  'volatile',
  'broadcast',
  'local'
];


var emit = Emitter.prototype.emit;


function Socket(nsp, client, query){
  this.nsp = nsp;
  this.server = nsp.server;
  this.adapter = this.nsp.adapter;
  this.id = nsp.name !== '/' ? nsp.name + '#' + client.id : client.id;
  this.client = client;
  this.conn = client.conn;
  this.rooms = {};
  this.acks = {};
  this.connected = true;
  this.disconnected = false;
  this.handshake = this.buildHandshake(query);
  this.fns = [];
  this.flags = {};
  this._rooms = [];
}

/**
 * Inherits from `EventEmitter`.
 */

Socket.prototype.__proto__ = Emitter.prototype;


flags.forEach(function(flag){
  Object.defineProperty(Socket.prototype, flag, {
    get: function() {
      this.flags[flag] = true;
      return this;
    }
  });
});


Object.defineProperty(Socket.prototype, 'request', {
  get: function() {
    return this.conn.request;
  }
});

Socket.prototype.buildHandshake = function(query){
  var self = this;
  function buildQuery(){
    var requestQuery = url.parse(self.request.url, true).query;
    //if socket-specific query exist, replace query strings in requestQuery
    return Object.assign({}, query, requestQuery);
  }
  return {
    headers: this.request.headers,
    time: (new Date) + '',
    address: this.conn.remoteAddress,
    xdomain: !!this.request.headers.origin,
    secure: !!this.request.connection.encrypted,
    issued: +(new Date),
    url: this.request.url,
    query: buildQuery()
  };
};


Socket.prototype.to =
Socket.prototype.in = function(name){
  if (!~this._rooms.indexOf(name)) this._rooms.push(name);
  return this;
};


Socket.prototype.send =
Socket.prototype.write = function(){
  var args = Array.prototype.slice.call(arguments);
  args.unshift('message');
  this.emit.apply(this, args);
  return this;
};


Socket.prototype.packet = function(packet, opts){
  packet.nsp = this.nsp.name;
  opts = opts || {};
  opts.compress = false !== opts.compress;
  this.client.packet(packet, opts);
};

Socket.prototype.leave = function(room, fn){
  debug('leave room %s', room);
  var self = this;
  this.adapter.del(this.id, room, function(err){
    if (err) return fn && fn(err);
    debug('left room %s', room);
    delete self.rooms[room];
    fn && fn(null);
  });
  return this;
};

Socket.prototype.leaveAll = function(){
  this.adapter.delAll(this.id);
  this.rooms = {};
};


Socket.prototype.onconnect = function(){
  debug('socket connected - writing packet');
  this.nsp.connected[this.id] = this;
  this.join(this.id);
  var skip = this.nsp.name === '/' && this.nsp.fns.length === 0;
  if (skip) {
    debug('packet already sent in initial handshake');
  } else {
    this.packet({ type: parser.CONNECT });
  }
};

Socket.prototype.onevent = function(packet){
  var args = packet.data || [];
  debug('emitting event %j', args);

  if (null != packet.id) {
    debug('attaching ack callback to event');
    args.push(this.ack(packet.id));
  }

  this.dispatch(args);
};

Socket.prototype.ondisconnect = function(){
  debug('got disconnect packet');
  this.onclose('client namespace disconnect');
};


Socket.prototype.onerror = function(err){
  if (this.listeners('error').length) {
    this.emit('error', err);
  } else {
    console.error('Missing error handler on `socket`.');
    console.error(err.stack);
  }
};


Socket.prototype.onclose = function(reason){
  if (!this.connected) return this;
  debug('closing socket - reason %s', reason);
  this.emit('disconnecting', reason);
  this.leaveAll();
  this.nsp.remove(this);
  this.client.remove(this);
  this.connected = false;
  this.disconnected = true;
  delete this.nsp.connected[this.id];
  this.emit('disconnect', reason);
};


Socket.prototype.error = function(err){
  this.packet({ type: parser.ERROR, data: err });
};


Socket.prototype.disconnect = function(close){
  if (!this.connected) return this;
  if (close) {
    this.client.disconnect();
  } else {
    this.packet({ type: parser.DISCONNECT });
    this.onclose('server namespace disconnect');
  }
  return this;
};


Socket.prototype.compress = function(compress){
  this.flags.compress = compress;
  return this;
};


Socket.prototype.use = function(fn){
  this.fns.push(fn);
  return this;
};

Socket.prototype.run = function(event, fn){
  var fns = this.fns.slice(0);
  if (!fns.length) return fn(null);

  function run(i){
    fns[i](event, function(err){
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