import type { MetaResponse } from '@mizunashi/api-types';

/** 施設情報。公式ページに掲載されている内容（DESIGN.md §4.1） */
export const FACILITY: MetaResponse['facility'] = {
  name: { ja: '水無海浜温泉', en: 'Mizunashi Kaihin Onsen' },
  address: '北海道函館市恵山岬町',
  springTemperature: 49.0,
  springQuality: {
    ja: 'ナトリウム－塩化物・硫酸塩温泉（低張性中性高温泉）',
    en: null,
  },
  fee: { ja: '無料', en: 'Free' },
  contact: { department: '函館市椴法華支所産業建設課', tel: '0138-86-2111' },
};
