'use strict';

// thanks to https://blog.mudatobunka.org/entry/2015/10/31/222750
function* range(begin, end = null, step = 1)
{
  if (end == null) {
    end = begin;
    begin = 0;
  }
  for (let i = begin; i < end; i += step) yield i;
}

const socket = io();
const canvas = new fabric.Canvas('canvas');
canvas.backgroundColor = 'green';

const game = {};

function card_image(black, num = -1)
{
  const color = black ? 'b' : 'w';
  const imgid = color + (num == -1 ? '' : num < 10 ? '0' + num : num);
  const img = new fabric.Image(document.getElementById(imgid));

  // disable controls
  img.hasControls = false;
  img.hasBorders = false;
  img.selectable = false;

  return img;
}

class Card {
  constructor(usridx, crdidx, crdnum, visible)
  {
    this.usridx = usridx;
    this.crdidx = crdidx;
    this.crdnum = crdnum;
    this.visible = visible;
    this.black = crdnum % 2 == 0;
    this.mine = usridx == game.index;
  }

  is_black()
  {
    return this.black;
  }

  pos()
  {
    const pidx = this.mine ?
        0 :
        this.usridx > game.index ? this.usridx : this.usridx + 1;
    const cidx = this.crdidx;
    switch (pidx) {
      case 0:
        return {left: cidx * 100 + 200, top: 800};
      case 1:
        return {left: 200, top: cidx * 100 + 200, angle: 90};
      case 2:
        return {left: -cidx * 100 + 800, top: 200, angle: 180};
      case 3:
        return {left: 800, top: 800 - cidx * 100, angle: 270};
    }
  }

  set_image()
  {
    this.img_color = card_image(this.black, -1);
    this.img_color.scale(0.8).set(this.pos());
    this.img_num = card_image(this.black, Math.floor(this.crdnum / 2));
    this.img_num.scale(0.8).set(this.pos());
  }

  draw()
  {
    if (this.img_num) canvas.remove(this.img_num);
    if (this.img_color) canvas.remove(this.img_color);
    this.set_image();

    if (this.visible) {
      canvas.add(this.img_num);
    }
    else {
      canvas.add(this.img_color);

      if (this.mine) {
        this.img_color.on('mouseover', () => {
          canvas.remove(this.img_color);
          canvas.add(this.img_num);
        });
        this.img_num.on('mouseout', () => {
          canvas.remove(this.img_num);
          canvas.add(this.img_color);
        });
      }
    }
  }
}

function is_user_alive(usridx)
{
  return game.cards.some((card) => card.usridx == usridx && !card.visible);
}

function enable_call()
{
  for (const card of game.cards) {
    if (card.mine) continue;
    if (card.visible) continue;

    card.img_color.on('mousedown', () => {
      const img = card.img_color;

      // show selecting box
      const args = {
        left: img.left,
        top: img.top,
        width: img.width,
        height: img.height,
        angle: img.angle,
        stroke: 'blue',
        fill: 'transparent',
        strokeWidth: 10,
        scaleX: img.scaleX,
        scaleY: img.scaleY,
      };
      if (game.selecting_box) canvas.remove(game.selecting_box);
      game.selecting_box = new fabric.Rect(args);
      canvas.add(game.selecting_box);

      // show navi numbers
      let navi_nums = [];
      for (const i of range(12)) {
        const target_card_num = i;
        const nx = i % 6, ny = Math.floor(i / 6);
        let img = card_image(card.black, i);
        img.scale(0.5).set({left: nx * 65 + 300, top: ny * 200 + 350});

        img.on('mousedown', () => {
          // remove navi
          for (const card of game.cards) card.img_color.off('mousedown');
          for (const num of navi_nums) {
            num.off('mousedown');
            canvas.remove(num);
            num.dispose();
          }
          navi_nums = null;
          canvas.remove(game.selecting_box);
          game.selecting_box = null;

          // call
          if (!game.ended)
            socket.emit('call', {
              target_user_index: card.usridx,
              card_index: card.crdidx,
              card_num: target_card_num,
            });
        });

        canvas.add(img);
        navi_nums.push(img);
        img = null;
      }
    });
  }
}

let your_turn_img = new fabric.Image(document.getElementById('your_turn'));
your_turn_img.set({top: 200});
function draw_your_turn()
{
  canvas.add(your_turn_img);
  your_turn_img.animate('left', 100, {
    from: 0,
    duration: 2000,
    onChange: () => canvas.renderAll(),
    onComplete: () => canvas.remove(your_turn_img)
  });
}

let you_lost_img = new fabric.Image(document.getElementById('you_lost'));
you_lost_img.set({top: 200});
function draw_you_lost()
{
  canvas.add(you_lost_img);
  you_lost_img.animate('left', 100, {
    from: 0,
    duration: 2000,
    onChange: () => canvas.renderAll(),
    onComplete: () => canvas.remove(you_lost_img)
  });
}

let you_won_img = new fabric.Image(document.getElementById('you_won'));
you_won_img.set({top: 200});
function draw_you_won()
{
  canvas.add(you_won_img);
  you_won_img.animate('left', 100, {
    from: 0,
    duration: 2000,
    onChange: () => canvas.renderAll(),
    onComplete: () => canvas.remove(you_won_img)
  });
}

socket.on('game-start', (res) => {
  console.log(res);

  game.ended = false;
  game.index = res.index;
  game.current_index = 0;
  game.cards = [];

  for (const usridx of range(res.cards.length)) {
    for (const crdidx of range(res.cards[usridx].length)) {
      const card = res.cards[usridx][crdidx];
      game.cards.push(new Card(usridx, crdidx, card[0], card[1]));
    }
  }

  for (const card of game.cards) card.draw();
  if (game.index == game.current_index) {
    enable_call();
    console.log('YOUR TURN');
    draw_your_turn();
  }
});

socket.on('call-result', (res) => {
  console.log(res);

  if (res.result != 0) {  // hit
    const card = game.cards[res.target_user_index * 6 + res.card_index];
    card.crdnum = res.card_num * 2 + (card.black ? 0 : 1);
    card.visible = true;

    if (!is_user_alive(game.index)) {
      game.ended = true;
      console.log('YOU LOST');
      draw_you_lost();
    }

    if (res.result == 2) {  // game ended
      game.ended = true;
      console.log('GAME OVER');
      if (is_user_alive(game.index)) {
        console.log('YOU WON!');
        draw_you_won();
      }
    }
  }
  else {  // miss
    while (true) {
      game.current_index = (game.current_index + 1) % 4;
      if (is_user_alive(game.current_index)) break;
    }
  }

  for (const card of game.cards) card.draw();
  if (game.index == game.current_index) {
    enable_call();
    console.log('YOUR TURN');
    draw_your_turn();
  }
});

socket.on('err', (res) => {
  console.log(res);
});

socket.on('abrupt-termination', res => {
  console.log('abrupt-termination');
  console.log(res);
  game.ended = true;
});
