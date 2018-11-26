'use strict';

var http = require('http').Server;
var io = require('../lib');
var fs = require('fs');
var join = require('path').join;
var exec = require('child_process').exec;
var ioc = require('socket.io-client');
var request = require('supertest');
var expect = require('expect.js');

// Creates a socket.io client for the given server
function client(srv, nsp, opts){
  if ('object' == typeof nsp) {
    opts = nsp;
    nsp = null;
  }
  var addr = srv.address();
  if (!addr) addr = srv.listen().address();
  var url = 'ws://localhost:' + addr.port + (nsp || '');
  return ioc(url, opts);
}

describe('socket.io', function(){

  describe('set', function() {
    it('should be able to set ping timeout to engine.io', function() {
      var srv = io(http());
      srv.set('heartbeat timeout', 10);
      expect(srv.eio.pingTimeout).to.be(10);
    });

    it('should be able to set authorization and send error packet', function(done) {
      var httpSrv = http();
      var srv = io(httpSrv);
      srv.set('authorization', function(o, f) { f(null, false); });

      var socket = client(httpSrv);
      socket.on('connect', function(){
        expect().fail();
      });
      socket.on('error', function(err) {
        expect(err).to.be('Not authorized');
        done();
      });
    });

    it('should be able to set authorization and succeed', function(done) {
      var httpSrv = http();
      var srv = io(httpSrv);
      srv.set('authorization', function(o, f) { f(null, true); });

      srv.on('connection', function(s) {
        s.on('yoyo', function(data) {
          expect(data).to.be('data');
          done();
        });
      });

      var socket = client(httpSrv);
      socket.on('connect', function(){
        socket.emit('yoyo', 'data');
      });

      socket.on('error', function(err) {
        expect().fail();
      });
    });

    it('should set the handshake BC object', function(done){
      var httpSrv = http();
      var srv = io(httpSrv);

      srv.on('connection', function(s) {
        expect(s.handshake).to.not.be(undefined);

        // Headers set and has some valid properties
        expect(s.handshake.headers).to.be.an('object');
        expect(s.handshake.headers['user-agent']).to.be('node-XMLHttpRequest');

        // Time set and is valid looking string
        expect(s.handshake.time).to.be.a('string');
        expect(s.handshake.time.split(' ').length > 0); // Is "multipart" string representation

        // Address, xdomain, secure, issued and url set
        expect(s.handshake.address).to.contain('127.0.0.1');
        expect(s.handshake.xdomain).to.be.a('boolean');
        expect(s.handshake.secure).to.be.a('boolean');
        expect(s.handshake.issued).to.be.a('number');
        expect(s.handshake.url).to.be.a('string');

        // Query set and has some right properties
        expect(s.handshake.query).to.be.an('object');
        expect(s.handshake.query.EIO).to.not.be(undefined);
        expect(s.handshake.query.transport).to.not.be(undefined);
        expect(s.handshake.query.t).to.not.be(undefined);

        done();
      });

      var socket = client(httpSrv);
    });
  });

  describe('server attachment', function(){
    describe('http.Server', function(){
      var clientVersion = require('socket.io-client/package').version;

      it('should serve static files', function(done){
        var srv = http();
        io(srv);
        request(srv)
        .get('/socket.io/socket.io.js')
        .buffer(true)
        .end(function(err, res){
          if (err) return done(err);
          var ctype = res.headers['content-type'];
          expect(ctype).to.be('application/javascript');
          expect(res.headers.etag).to.be('"' + clientVersion + '"');
          expect(res.text).to.match(/engine\.io/);
          expect(res.status).to.be(200);
          done();
        });
      });

      it('should handle 304', function(done){
        var srv = http();
        io(srv);
        request(srv)
        .get('/socket.io/socket.io.js')
        .set('If-None-Match', '"' + clientVersion + '"')
        .end(function(err, res){
          if (err) return done(err);
          expect(res.statusCode).to.be(304);
          done();
        });
      });

      it('should not serve static files', function(done){
        var srv = http();
        io(srv, { serveClient: false });
        request(srv)
        .get('/socket.io/socket.io.js')
        .expect(400, done);
      });

      it('should work with #attach', function(done){
        var srv = http(function(req, res){
          res.writeHead(404);
          res.end();
        });
        var sockets = io();
        sockets.attach(srv);
        request(srv)
        .get('/socket.io/socket.io.js')
        .end(function(err, res){
          if (err) return done(err);
          expect(res.status).to.be(200);
          done();
        });
      });
    });
  });

  describe('namespaces', function(){
    var Socket = require('../lib/socket');
    var Namespace = require('../lib/namespace');

    it('should be accessible through .sockets', function(){
      var sio = io();
      expect(sio.sockets).to.be.a(Namespace);
    });

    it('should be aliased', function(){
      var sio = io();
      expect(sio.use).to.be.a('function');
      expect(sio.to).to.be.a('function');
      expect(sio['in']).to.be.a('function');
      expect(sio.emit).to.be.a('function');
      expect(sio.send).to.be.a('function');
      expect(sio.write).to.be.a('function');
      expect(sio.clients).to.be.a('function');
      expect(sio.compress).to.be.a('function');
      expect(sio.json).to.be(sio);
      expect(sio.volatile).to.be(sio);
      expect(sio.sockets.flags).to.eql({ json: true, volatile: true });
      delete sio.sockets.flags;
    });

    it('should automatically connect', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv);
        socket.on('connect', function(){
          done();
        });
      });
    });

    it('should fire a `connection` event', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv);
        sio.on('connection', function(socket){
          expect(socket).to.be.a(Socket);
          done();
        });
      });
    });

    it('should fire a `connect` event', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv);
        sio.on('connect', function(socket){
          expect(socket).to.be.a(Socket);
          done();
        });
      });
    });

    it('should work with many sockets', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        sio.of('/chat');
        sio.of('/news');
        var chat = client(srv, '/chat');
        var news = client(srv, '/news');
        var total = 2;
        chat.on('connect', function(){
          --total || done();
        });
        news.on('connect', function(){
          --total || done();
        });
      });
    });

    it('should be able to equivalently start with "" or "/" on server', function(done){
      var srv = http();
      var sio = io(srv);
      var total = 2;
      sio.of('').on('connection', function(){
        --total || done();
      });
      sio.of('abc').on('connection', function(){
        --total || done();
      });
      var c1 = client(srv, '/');
      var c2 = client(srv, '/abc');
    });

    it('should be equivalent for "" and "/" on client', function(done){
      var srv = http();
      var sio = io(srv);
      sio.of('/').on('connection', function(){
          done();
      });
      var c1 = client(srv, '');
    });

    it('should work with `of` and many sockets', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var chat = client(srv, '/chat');
        var news = client(srv, '/news');
        var total = 2;
        sio.of('/news').on('connection', function(socket){
          expect(socket).to.be.a(Socket);
          --total || done();
        });
        sio.of('/news').on('connection', function(socket){
          expect(socket).to.be.a(Socket);
          --total || done();
        });
      });
    });

    it('should work with `of` second param', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var chat = client(srv, '/chat');
        var news = client(srv, '/news');
        var total = 2;
        sio.of('/news', function(socket){
          expect(socket).to.be.a(Socket);
          --total || done();
        });
        sio.of('/news', function(socket){
          expect(socket).to.be.a(Socket);
          --total || done();
        });
      });
    });

    it('should disconnect upon transport disconnection', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var chat = client(srv, '/chat');
        var news = client(srv, '/news');
        var total = 2;
        var totald = 2;
        var s;
        sio.of('/news', function(socket){
          socket.on('disconnect', function(reason){
            --totald || done();
          });
          --total || close();
        });
        sio.of('/chat', function(socket){
          s = socket;
          socket.on('disconnect', function(reason){
            --totald || done();
          });
          --total || close();
        });
        function close(){
          s.disconnect(true);
        }
      });
    });

    it('should disconnect both default and custom namespace upon disconnect', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var lolcats = client(srv, '/lolcats');
        var total = 2;
        var totald = 2;
        var s;
        sio.of('/', function(socket){
          socket.on('disconnect', function(reason){
            --totald || done();
          });
          --total || close();
        });
        sio.of('/lolcats', function(socket){
          s = socket;
          socket.on('disconnect', function(reason){
            --totald || done();
          });
          --total || close();
        });
        function close(){
          s.disconnect(true);
        }
      });
    });

    it('should not crash while disconnecting socket', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv,'/ns');
        sio.on('connection', function(socket){
          socket.disconnect();
          done();
        });
      });
    });

    it('should fire a `disconnecting` event just before leaving all rooms', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv);

        sio.on('connection', function(s){
          s.join('a', function(){
            s.disconnect();
          });

          var total = 2;
          s.on('disconnecting', function(reason){
            expect(Object.keys(s.rooms)).to.eql([s.id, 'a']);
            total--;
          });

          s.on('disconnect', function(reason){
            expect(Object.keys(s.rooms)).to.eql([]);
            --total || done();
          });
        });
      });
    });

    it('should return error connecting to non-existent namespace', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv,'/doesnotexist');
        socket.on('error', function(err) {
          expect(err).to.be('Invalid namespace');
          done();
        });
      });
    });
    
    it('should not reuse same-namespace connections', function(done){
      var srv = http();
      var sio = io(srv);
      var connections = 0;

      srv.listen(function() {
        var clientSocket1 = client(srv);
        var clientSocket2 = client(srv);
        sio.on('connection', function() {
          connections++;
          if (connections === 2) {
            done();
          }
        });
      });
    });

    it('should find all clients in a namespace', function(done){
      var srv = http();
      var sio = io(srv);
      var chatSids = [];
      var otherSid = null;
      srv.listen(function(){
        var c1 = client(srv, '/chat');
        var c2 = client(srv, '/chat', {forceNew: true});
        var c3 = client(srv, '/other', {forceNew: true});
        var total = 3;
        sio.of('/chat').on('connection', function(socket){
          chatSids.push(socket.id);
          --total || getClients();
        });
        sio.of('/other').on('connection', function(socket){
          otherSid = socket.id;
          --total || getClients();
        });
      });
      function getClients() {
        sio.of('/chat').clients(function(error, sids) {
          expect(error).to.not.be.ok();
          expect(sids).to.contain(chatSids[0]);
          expect(sids).to.contain(chatSids[1]);
          expect(sids).to.not.contain(otherSid);
          done();
        });
      }
    });

    it('should find all clients in a namespace room', function(done){
      var srv = http();
      var sio = io(srv);
      var chatFooSid = null;
      var chatBarSid = null;
      var otherSid = null;
      srv.listen(function(){
        var c1 = client(srv, '/chat');
        var c2 = client(srv, '/chat', {forceNew: true});
        var c3 = client(srv, '/other', {forceNew: true});
        var chatIndex = 0;
        var total = 3;
        sio.of('/chat').on('connection', function(socket){
          if (chatIndex++) {
            socket.join('foo', function() {
              chatFooSid = socket.id;
              --total || getClients();
            });
          } else {
            socket.join('bar', function() {
              chatBarSid = socket.id;
              --total || getClients();
            });
          }
        });
        sio.of('/other').on('connection', function(socket){
          socket.join('foo', function() {
            otherSid = socket.id;
            --total || getClients();
          });
        });
      });
      function getClients() {
        sio.of('/chat').in('foo').clients(function(error, sids) {
          expect(error).to.not.be.ok();
          expect(sids).to.contain(chatFooSid);
          expect(sids).to.not.contain(chatBarSid);
          expect(sids).to.not.contain(otherSid);
          done();
        });
      }
    });

    it('should find all clients across namespace rooms', function(done){
      var srv = http();
      var sio = io(srv);
      var chatFooSid = null;
      var chatBarSid = null;
      var otherSid = null;
      srv.listen(function(){
        var c1 = client(srv, '/chat');
        var c2 = client(srv, '/chat', {forceNew: true});
        var c3 = client(srv, '/other', {forceNew: true});
        var chatIndex = 0;
        var total = 3;
        sio.of('/chat').on('connection', function(socket){
          if (chatIndex++) {
            socket.join('foo', function() {
              chatFooSid = socket.id;
              --total || getClients();
            });
          } else {
            socket.join('bar', function() {
              chatBarSid = socket.id;
              --total || getClients();
            });
          }
        });
        sio.of('/other').on('connection', function(socket){
          socket.join('foo', function() {
            otherSid = socket.id;
            --total || getClients();
          });
        });
      });
      function getClients() {
        sio.of('/chat').clients(function(error, sids) {
          expect(error).to.not.be.ok();
          expect(sids).to.contain(chatFooSid);
          expect(sids).to.contain(chatBarSid);
          expect(sids).to.not.contain(otherSid);
          done();
        });
      }
    });

    it('should not emit volatile event after regular event', function(done) {
      var srv = http();
      var sio = io(srv);

      var counter = 0;
      srv.listen(function(){
        sio.of('/chat').on('connection', function(s){
          // Wait to make sure there are no packets being sent for opening the connection
          setTimeout(function() {
            sio.of('/chat').emit('ev', 'data');
            sio.of('/chat').volatile.emit('ev', 'data');
          }, 50);
        });

        var socket = client(srv, '/chat');
        socket.on('ev', function() {
          counter++;
        });
      });

      setTimeout(function() {
        expect(counter).to.be(1);
        done();
      }, 500);
    });

    it('should emit volatile event', function(done) {
      var srv = http();
      var sio = io(srv);

      var counter = 0;
      srv.listen(function(){
        sio.of('/chat').on('connection', function(s){
          // Wait to make sure there are no packets being sent for opening the connection
          setTimeout(function() {
            sio.of('/chat').volatile.emit('ev', 'data');
          }, 100);
        });

        var socket = client(srv, '/chat');
        socket.on('ev', function() {
          counter++;
        });
      });

      setTimeout(function() {
        expect(counter).to.be(1);
        done();
      }, 500);
    });

    it('should enable compression by default', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv, '/chat');
        sio.of('/chat').on('connection', function(s){
          s.conn.once('packetCreate', function(packet) {
            expect(packet.options.compress).to.be(true);
            done();
          });
          sio.of('/chat').emit('woot', 'hi');
        });
      });
    });

    it('should disable compression', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv, '/chat');
        sio.of('/chat').on('connection', function(s){
          s.conn.once('packetCreate', function(packet) {
            expect(packet.options.compress).to.be(false);
            done();
          });
          sio.of('/chat').compress(false).emit('woot', 'hi');
        });
      });
    });

    describe('dynamic namespaces', function () {
      it('should allow connections to dynamic namespaces with a regex', function(done){
        const srv = http();
        const sio = io(srv);
        let count = 0;
        srv.listen(function(){
          const socket = client(srv, '/dynamic-101');
          let dynamicNsp = sio.of(/^\/dynamic-\d+$/).on('connect', (socket) => {
            expect(socket.nsp.name).to.be('/dynamic-101');
            dynamicNsp.emit('hello', 1, '2', { 3: '4'});
            if (++count === 4) done();
          }).use((socket, next) => {
            next();
            if (++count === 4) done();
          });
          socket.on('error', function(err) {
            expect().fail();
          });
          socket.on('connect', () => {
            if (++count === 4) done();
          });
          socket.on('hello', (a, b, c) => {
            expect(a).to.eql(1);
            expect(b).to.eql('2');
            expect(c).to.eql({ 3: '4' });
            if (++count === 4) done();
          });
        });
      });

      it('should allow connections to dynamic namespaces with a function', function(done){
        const srv = http();
        const sio = io(srv);
        srv.listen(function(){
          const socket = client(srv, '/dynamic-101');
          sio.of((name, query, next) => next(null, '/dynamic-101' === name));
          socket.on('connect', done);
        });
      });

      it('should disallow connections when no dynamic namespace matches', function(done){
        const srv = http();
        const sio = io(srv);
        srv.listen(function(){
          const socket = client(srv, '/abc');
          sio.of(/^\/dynamic-\d+$/);
          sio.of((name, query, next) => next(null, '/dynamic-101' === name));
          socket.on('error', (err) => {
            expect(err).to.be('Invalid namespace');
            done();
          });
        });
      });
    });
  });

  describe('socket', function(){

    it('should not fire events more than once after manually reconnecting', function(done) {
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var clientSocket = client(srv, { reconnection: false });
        clientSocket.on('connect', function init() {
          clientSocket.removeListener('connect', init);
          clientSocket.io.engine.close();

          clientSocket.connect();
          clientSocket.on('connect', function() {
            done();
          });
        });
      });
    });

    it('should not fire reconnect_failed event more than once when server closed', function(done) {
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var clientSocket = client(srv, { reconnectionAttempts: 3, reconnectionDelay: 10 });
        clientSocket.on('connect', function() {
          srv.close();
        });

        clientSocket.on('reconnect_failed', function() {
          done();
        });
      });
    });

    it('should receive events', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv);
        sio.on('connection', function(s){
          s.on('random', function(a, b, c){
            expect(a).to.be(1);
            expect(b).to.be('2');
            expect(c).to.eql([3]);
            done();
          });
          socket.emit('random', 1, '2', [3]);
        });
      });
    });

    it('should error with null messages', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv);
        sio.on('connection', function(s){
          s.on('message', function(a){
            expect(a).to.be(null);
            done();
          });
          socket.send(null);
        });
      });
    });

    it('should emit events', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv);
        socket.on('woot', function(a){
          expect(a).to.be('tobi');
          done();
        });
        sio.on('connection', function(s){
          s.emit('woot', 'tobi');
        });
      });
    });

    it('should emit message events through `send`', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv);
        socket.on('message', function(a){
          expect(a).to.be('a');
          done();
        });
        sio.on('connection', function(s){
          s.send('a');
        });
      });
    });

    it('should receive event with callbacks', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv);
        sio.on('connection', function(s){
          s.on('woot', function(fn){
            fn(1, 2);
          });
          socket.emit('woot', function(a, b){
            expect(a).to.be(1);
            expect(b).to.be(2);
            done();
          });
        });
      });
    });

    it('should receive all events emitted from namespaced client immediately and in order', function(done) {
      var srv = http();
      var sio = io(srv);
      var total = 0;
      srv.listen(function(){
        sio.of('/chat', function(s){
          s.on('hi', function(letter){
            total++;
            if (total == 2 && letter == 'b') {
              done();
            } else if (total == 1 && letter != 'a') {
              throw new Error('events out of order');
            }
          });
        });

        var chat = client(srv, '/chat');
        chat.emit('hi', 'a');
        setTimeout(function() {
          chat.emit('hi', 'b');
        }, 50);
      });
    });

    it('should emit events with callbacks', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv);
        sio.on('connection', function(s){
          socket.on('hi', function(fn){
            fn();
          });
          s.emit('hi', function(){
            done();
          });
        });
      });
    });

    it('should receive events with args and callback', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv);
        sio.on('connection', function(s){
          s.on('woot', function(a, b, fn){
            expect(a).to.be(1);
            expect(b).to.be(2);
            fn();
          });
          socket.emit('woot', 1, 2, function(){
            done();
          });
        });
      });
    });

    it('should emit events with args and callback', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv);
        sio.on('connection', function(s){
          socket.on('hi', function(a, b, fn){
            expect(a).to.be(1);
            expect(b).to.be(2);
            fn();
          });
          s.emit('hi', 1, 2, function(){
            done();
          });
        });
      });
    });

    it('should have access to the client', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv);
        sio.on('connection', function(s){
          expect(s.client).to.be.an('object');
          done();
        });
      });
    });

    it('should have access to the connection', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv);
        sio.on('connection', function(s){
          expect(s.client.conn).to.be.an('object');
          expect(s.conn).to.be.an('object');
          done();
        });
      });
    });

    it('should have access to the request', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv);
        sio.on('connection', function(s){
          expect(s.client.request.headers).to.be.an('object');
          expect(s.request.headers).to.be.an('object');
          done();
        });
      });
    });

    it('should see query parameters in the request', function(done) {
      var srv = http();
      var sio = io(srv);
      srv.listen(function() {
        var socket = client(srv, {query: {key1: 1, key2: 2}});
        sio.on('connection', function(s) {
          var parsed = require('url').parse(s.request.url);
          var query = require('querystring').parse(parsed.query);
          expect(query.key1).to.be('1');
          expect(query.key2).to.be('2');
          done();
        });
      });
    });
    
    it('should see query parameters sent from secondary namespace connections in handshake object', function(done){
      var srv = http();
      var sio = io(srv);
      var client1 = client(srv);
      var client2 = client(srv, '/connection2', {query: {key1: 'aa', key2: '&=bb'}});
      sio.on('connection', function(s){
      });
      sio.of('/connection2').on('connection', function(s){
        expect(s.handshake.query.key1).to.be('aa');
        expect(s.handshake.query.key2).to.be('&=bb');
        done();
      });


    });

    it('should handle very large json', function(done){
      this.timeout(30000);
      var srv = http();
      var sio = io(srv, { perMessageDeflate: false });
      var received = 0;
      srv.listen(function(){
        var socket = client(srv);
        socket.on('big', function(a){
          expect(Buffer.isBuffer(a.json)).to.be(false);
          if (++received == 3)
            done();
          else
            socket.emit('big', a);
        });
        sio.on('connection', function(s){
          fs.readFile(join(__dirname, 'fixtures', 'big.json'), function(err, data){
            if (err) return done(err);
            data = JSON.parse(data);
            s.emit('big', {hello: 'friend', json: data});
          });
          s.on('big', function(a){
            s.emit('big', a);
          });
        });
      });
    });

    it('should be able to emit after server close and restart', function(done){
      var srv = http();
      var sio = io(srv);

      sio.on('connection', function(socket){
        socket.on('ev', function(data){
          expect(data).to.be('payload');
          done();
        });
      });

      srv.listen(function(){
        var port = srv.address().port;
        var clientSocket = client(srv, { reconnectionAttempts: 10, reconnectionDelay: 100 });
        clientSocket.once('connect', function(){
          srv.close(function(){
            clientSocket.on('reconnect', function(){
              clientSocket.emit('ev', 'payload');
            });
            sio.listen(port);
          });
        });
      });
    });

    it('should enable compression by default', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv, '/chat');
        sio.of('/chat').on('connection', function(s){
          s.conn.once('packetCreate', function(packet) {
            expect(packet.options.compress).to.be(true);
            done();
          });
          sio.of('/chat').emit('woot', 'hi');
        });
      });
    });

    it('should disable compression', function(done){
      var srv = http();
      var sio = io(srv);
      srv.listen(function(){
        var socket = client(srv, '/chat');
        sio.of('/chat').on('connection', function(s){
          s.conn.once('packetCreate', function(packet) {
            expect(packet.options.compress).to.be(false);
            done();
          });
          sio.of('/chat').compress(false).emit('woot', 'hi');
        });
      });
    });

    it('should always trigger the callback (if provided) when joining a room', function(done){
      var srv = http();
      var sio = io(srv);

      srv.listen(function(){
        var socket = client(srv);
        sio.on('connection', function(s){
          s.join('a', function(){
            s.join('a', done);
          });
        });
      });
    });

  });

});