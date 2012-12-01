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
  var user = {socket: socket, skipped: [], status: "pendingAuth", match: null, nextSong: null};
  socket.emit("authChallenge", {});
  socket.on("authResponse", function(message) {
    user.token = message.token;
    user.name = message.username;
    user.status = "authAccepted";
    users[user.token] = user;
    matchmake(user);
  })
  
  socket.on('skip', function(message) {
    match = user.match;
    var opp = opponent(user);
    endMatch(user.match, "left");
  });

  socket.on('nextSong', function(songId) {
    console.log("nextSong!")
    console.log(songId)
    user.nextSong = songId;
    if(user.match && user.match.round != user.token) {
      user.match.nextSong = songId
    }
  });

  socket.on("readyForNext", function(songId) {
    user.ready = true;
    if(user.match && opponent(user).ready) {
      var opp = opponent(user);
      user.ready = false;
      opponent(user).ready = false;
      console.log(user.match.nextSong);
      console.log(user.match.round);
      var toPlay = {song: user.match.nextSong, turn: user.match.round };
      if(user.match.round == user.token) {
        user.match.round = opp.token;
      } else {
        user.match.round = user.token;
      }
      socket.emit("play", toPlay);
      opp.socket.emit("play", toPlay);
    }
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
  var msg = JSON.parse(message);
  if(msg.type == "jukes_update") {
    users[msg.user_id].socket.emit("jukesUpdated", msg.jukes)
  }
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
    match = {user1: user, user2: matched, nextSong: matched.nextSong, round: matched.token};
    user.match = match;
    matched.match = match;
    user.status = "playing";
    matched.status = "playing";
    pools.playing.unshift(user.token);
    pools.playing.unshift(matched.token);
    match.user1.socket.emit("matchFound", {other: match.user2.token});
    match.user2.socket.emit("matchFound", {other: match.user1.token});
    console.log(pools);
    return match;
  } else {
    user.status = "waiting";
    pools.available.unshift(user.token);
    user.socket.emit("waiting");
    console.log(pools);
  }
}