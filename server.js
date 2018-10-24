'use strict';

const express = require('express');
const app = express();
const http = require('http').Server(app);
const path = require('path');
const io = require('socket.io')(http);

// thanks to https://blog.mudatobunka.org/entry/2015/10/31/222750
function* range(begin, end = null, step = 1)
{
  if (end == null) {
    end = begin;
    begin = 0;
  }
  for (let i = begin; i < end; i += step) yield i;
}

function is_user_alive(game, usridx)
{
  return game.cards[usridx].some((card) => !card[1]);
}

let room_cnt = 0;
function new_room()
{
  return {
    id: 'room-' + room_cnt++,
    sockets: [],
    game: {
      started: false,
      ended: false,
      cards: [],
      current_player_index: 0,
    }
  };
}

let latest_room = null;

app.use('/static', express.static(__dirname + '/static'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '/static/index.html'));
});

io.on('connection', (socket) => {
  if (latest_room == null) {
    latest_room = new_room();
  }
  const room = latest_room;
  const player_index = room.sockets.length;
  const game = room.game;

  room.sockets.push(socket);
  socket.join(room.id);

  // console.log(room);

  if (room.sockets.length == 4) {
    // create new room for next connection
    latest_room = new_room();

    // game starts.
    game.started = true;

    // deal cards
    const cards = [...range(24)];
    for (const i of cards) cards[i] = [cards[i], false];
    game.cards.push(cards.slice(0, 6));
    game.cards.push(cards.slice(6, 12));
    game.cards.push(cards.slice(12, 18));
    game.cards.push(cards.slice(18, 24));

    // send info
    for (const i of range(4)) {
      const cards = [];
      for (const j of range(4)) {
        if (i == j)
          cards.push(game.cards[j]);
        else
          cards.push(game.cards[j].map(c => c[1] ? c : [c[0] % 2, false]));
      }

      const socket = room.sockets[i];
      socket.emit('game-start', {index: i, cards: cards});
    }
  }

  console.log('a user connected');

  socket.on('call', (res) => {
    if (!game.started) {
      socket.emit('err', 'game has not yet started');
      return;
    }
    if (game.ended) {
      socket.emit('err', 'game has already ended');
      return;
    }

    if (player_index != game.current_player_index) {
      socket.emit('err', 'not your turn');
      return;
    }

    const usridx = res.target_user_index, crdidx = res.card_index,
          crdnum = res.card_num;
    if (usridx < 0 || usridx >= 4 || usridx == player_index) {
      socket.emit('err', 'invalid target user index');
      return;
    }
    const card = game.cards[usridx][crdidx];
    if (crdidx < 0 || crdidx >= 6 || card[1]) {
      socket.emit('err', 'invalid card index');
      return;
    }
    if (crdnum < 0 || crdnum >= 12) {
      socket.emit('err', 'invalid card index');
      return;
    }

    const emit_data = {
      target_user_index: usridx,
      card_index: crdidx,
      card_num: crdnum
    };

    if (crdnum == Math.floor(card[0] / 2)) {
      // hit! again your turn
      emit_data.result = 1;

      card[1] = true;

      // if game ended, result = 2
      let game_ended = true;
      for (const usridx in game.cards)
        if (usridx != player_index && is_user_alive(game, usridx))
          game_ended = false;
      if (game_ended) {
        emit_data.result = 2;
        game.ended = true;
      }
    }
    else {
      // miss. turn goes next
      emit_data.result = 0;
      while (true) {
        game.current_player_index = (game.current_player_index + 1) % 4;
        if (is_user_alive(game, game.current_player_index)) break;
      }
      console.log('NEXT: ' + game.current_player_index);
    }

    io.to(room.id).emit('call-result', emit_data);
  });

  socket.on('disconnect', () => {
    console.log('a user disconnected');

    if (!game.started) {
      // automatically leave the room of socket.io.
      room.sockets = room.sockets.filter(soc => soc != socket);
      console.log(room.sockets.length);
      return;
    }

    if (!game.ended) {  // abrupt termination
      io.to(room.id).emit('abrupt-termination');
      game.ended = true;
      return;
    }
  });
});

http.listen(3000, function() {
  console.log('Node.js is listening to PORT:' + http.address().port);
});
