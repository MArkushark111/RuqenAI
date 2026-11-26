import { mount } from 'ascii.rest';
import * as aurora from 'ascii.rest/pieces/aurora-fjord';
import * as alpine from 'ascii.rest/pieces/alpine-dawn';
import * as tokyo from 'ascii.rest/pieces/tokyo-rain';
import * as coast from 'ascii.rest/pieces/night-coast';
import * as earth from 'ascii.rest/pieces/earthrise';
const pieces = [aurora, alpine, tokyo, coast, earth];
let stop;
window.scene = (index, moving) => {
  stop?.();
  stop = index < 0 ? undefined : mount(document.querySelector('canvas'), pieces[index] || aurora, { fps: moving ? 10 : 0 });
};
window.scene(0, true);
