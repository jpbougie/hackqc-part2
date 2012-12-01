var express = require('express')
  , http = require('http')
  , app = express()
  , server = http.createServer(app)
  , io = require('socket.io').listen(server)
  , redisPubSub = require('redis').createClient(process.env.REDIS_PORT || 6379, process.env.REDIS_HOST || "localhost")
  , redis = require('redis').createClient(process.env.REDIS_PORT || 6379, process.env.REDIS_HOST || "localhost")
  , _ = require('underscore');

var pools = {
  available: [],
  playing: []
};

var users = {};

var matches = [];

var matchings = {}

app.use(express.static(__dirname + '/public'));

server.listen(process.env.PORT || 9191);

io.sockets.on('connection', function(socket) {
  var user = {socket: socket, skipped: [], status: "pendingAuth", match: null};
  socket.emit("authChallenge", {});
  socket.on("authResponse", function(message) {
    user.token = message.token;
    user.name = message.name;
    user.status = "authAccepted";
    users[user.token] = user;
    matchmake(user);
  })
  
  socket.on('skip', function(message) {
    match = user.match;
    var opp = opponent(user);
    endMatch(user.match, "left");
  });
  
  socket.on('disconnect', function() {
    console.log("disconnect!")
    console.log(user.status);
    if(user.status == "playing") {
      var opp = opponent(user);
      endMatch(user.match, "left");
      pools.available = _.without(pools.available, user.token);
      console.log(pools);
      matchmake(opp);
    } else {
      pools.available = _.without(pools.available, user.token);
      console.log(pools);
    }
    delete users[user.token];
  });
  
  socket.on("debugPools", function() {
    socket.emit("pools", pools);
  });
});

redisPubSub.on('message', function(channel, message) {
});

redisPubSub.on('ready', function() {
});

endMatch = function(match, reason) {
  console.log(pools.playing);
  pools.playing =  _.without(pools.playing, match.user1.token, match.user2.token);
  console.log(pools.playing)
  pools.available.concat([match.user1.name, match.user2.name]);
  console.log(pools.available);
  match.user1.socket.emit("matchEnded", {reason: reason});
  match.user2.socket.emit("matchEnded", {reason: reason});
}

opponent = function(user) {
  if(user.match.user1 == user) {
    return user.match.user2;
  } else {
    return user.match.user1;
  }
}

matchmake = function(user) {
  matched = pools.available.shift();
  if(typeof(matched) != 'undefined') {
    matched = users[matched];
    match = {user1: user, user2: matched};
    user.match = match;
    matched.match = match;
    user.status = "playing";
    matched.status = "playing";
    pools.playing.unshift(user.token);
    pools.playing.unshift(matched.token);
    match.user1.socket.emit("matchFound", {other: match.user2.name});
    match.user2.socket.emit("matchFound", {other: match.user1.name});
    console.log(pools);
    return match;
  } else {
    user.status = "waiting";
    pools.available.unshift(user.token);
    user.socket.emit("waiting");
    console.log(pools);
  }
}