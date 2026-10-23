import { InlineKeyboard } from 'grammy';
import type { Lang } from '../../config/index.js';
import { t } from '../i18n/index.js';
import { getButtonIcon, getSettingValue } from './settings.js';
export function addCopyButton(kb:InlineKeyboard,lang:Lang,key:string,target:string,primary=false) {
  const icon=getButtonIcon('copy.'+key),color=getSettingValue('color.copy.'+key);
  let label=t(lang,key);
  if(icon) {
    label=label.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u,'');
    if(!icon.custom_emoji_id)label=icon.unicode+' '+label;
  }
  if(target.startsWith('https://'))kb.url(label,target);else kb.text(label,target);
  if(icon?.custom_emoji_id)kb.icon(icon.custom_emoji_id);
  const style=({green:'success',blue:'primary',red:'danger'} as const)[color as 'green'|'blue'|'red'];
  if(style)kb.style(style);else if(primary&&color!=='none')kb.style('primary');
  return kb;
}
