import { Keyboard } from 'grammy';
import { MAIN_MENU_LAYOUT, type Lang } from '../../config/index.js';
import { btn, makeReplyKeyboard } from './helpers.js';

/** The persistent reply keyboard with the layout from config. */
export function mainMenuKeyboard(lang: Lang): Keyboard {
  return makeReplyKeyboard(lang, MAIN_MENU_LAYOUT);
}

/** A single inline "Main Menu" button used as a quick-access launcher. */
export function mainMenuLauncher(lang: Lang): Keyboard {
  return new Keyboard().text(btn(lang, 'main_menu')).resized();
}
