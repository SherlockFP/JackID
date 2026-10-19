/**
 * ACHIEVEMENTS (src/game/achievements.ts, the toast and the page in achievements.ui.ts). `<id>.name` / `<id>.desc` per achievement;
 * the ending ones name the ending in its own words (story.end.<id>.title). Secret ones show as ??? until unlocked.
 * Loaded by the `*.strings.ts` glob in main.ts.
 */
export default {
  prefix: 'ach.',
  en: {
    'title': 'ACHIEVEMENTS',
    'open': 'ACHIEVEMENTS',
    'toast.head': 'ACHIEVEMENT UNLOCKED',
    'g': '+{g}G',
    'score': '{g} / {total} G',
    'count': '{k} of {total} unlocked',
    'secret.name': '???',
    'secret.desc': 'A secret. Keep playing.',

    'first_win.name': 'Beginner\'s Luck', 'first_win.desc': 'Win a round.',
    'first_jackpot.name': 'Emptied the Vault', 'first_jackpot.desc': 'Hit a jackpot.',
    'night1.name': 'First Installment', 'night1.desc': 'Pay the Night 1 quota.',
    'night5.name': 'Past the Halfway Mark', 'night5.desc': 'Reach Night 5.',
    'night8.name': 'Toward Dawn', 'night8.desc': 'Reach Night 8.',

    'end_kept_pair.name': 'A Word Is a Word', 'end_kept_pair.desc': 'Reach the ending KEPT PAIR.',
    'end_cold_kitchen.name': 'The Soup Went Cold', 'end_cold_kitchen.desc': 'Reach the ending COLD KITCHEN.',
    'end_alone.name': 'Lone Wolf', 'end_alone.desc': 'Reach the ending ALONE.',
    'end_chair.name': 'The Empty Chair', 'end_chair.desc': 'Reach the ending THE CHAIR.',
    'end_kept.name': 'Left in Storage', 'end_kept.desc': 'Reach the ending KEPT.',
    'end_paid_in_full.name': 'Tab Closed', 'end_paid_in_full.desc': 'Reach the ending PAID IN FULL.',
    'end_he_came_home.name': 'Uninvited Guest', 'end_he_came_home.desc': 'Reach the ending HE CAME HOME.',
    'end_descend.name': 'One Floor Down', 'end_descend.desc': 'Reach the ending DESCEND.',
    'end_fall.name': 'Through the Trapdoor', 'end_fall.desc': 'Reach the ending FALL.',

    'loki_lie.name': 'Liar, Liar', 'loki_lie.desc': 'Catch Loki in a lie.',
    'no_loki.name': 'Deaf Sultan', 'no_loki.desc': 'Reach Night 6 without asking Loki anything or calling him a liar.',

    'bond_selim.name': 'Warm Stool', 'bond_selim.desc': 'Take your bond with Selim to 3.',
    'bond_mira.name': 'The Right Number', 'bond_mira.desc': 'Take your bond with Mira to 3.',
    'bond_tamsin.name': 'A Thousand Apologies', 'bond_tamsin.desc': 'Take your bond with Tamsin to 3.',
    'bond_lucan.name': 'Front Row', 'bond_lucan.desc': 'Take your bond with Lucan to 3.',
    'bond_mimosa.name': 'Lost and Found', 'bond_mimosa.desc': 'Take your bond with Mimosa to 3.',
    'bond_vell.name': 'Voice on the Tape', 'bond_vell.desc': 'Take your bond with Vell to 3.',
    'bond_collector.name': 'Zero Interest', 'bond_collector.desc': 'Take your bond with the Collector to 3.',

    'all_machines.name': 'Grand Tour', 'all_machines.desc': 'Play every machine on the floor once.',
    'seal_back.name': 'Second Chance', 'seal_back.desc': 'Lose a seal, then win it back.',
    'four_gods.name': 'Four Corners Covered', 'four_gods.desc': 'Bring all four gods to Favour 3.',
    'five_boons.name': 'Teacher\'s Pet', 'five_boons.desc': 'Keep 5 boons in one run.',

    'broke.name': 'Holes in the Pocket', 'broke.desc': 'Lose your last coin at a table.',
    'wrong_call.name': 'Wrongly Accused', 'wrong_call.desc': 'Call Loki a liar when he told the truth.',
    'hollow.name': 'Behind the Door', 'hollow.desc': 'Step through the Hollow Door.',
  },
  tr: {
    'title': 'BAŞARIMLAR',
    'open': 'BAŞARIMLAR',
    'toast.head': 'BAŞARIM AÇILDI',
    'g': '+{g} puan',
    'score': '{g} / {total} puan',
    'count': '{k} / {total} açıldı',
    'secret.name': '???',
    'secret.desc': 'Gizli başarım. Oynamaya devam et.',

    'first_win.name': 'Acemi Şansı', 'first_win.desc': 'Bir el kazan.',
    'first_jackpot.name': 'Kasa Boşaltan', 'first_jackpot.desc': 'Bir jackpot vur.',
    'night1.name': 'İlk Taksit', 'night1.desc': '1. gece kotasını öde.',
    'night5.name': 'Yarıyı Geçtin', 'night5.desc': '5. geceye ulaş.',
    'night8.name': 'Sabaha Karşı', 'night8.desc': '8. geceye ulaş.',

    'end_kept_pair.name': 'Söz Namustur', 'end_kept_pair.desc': 'SÖZ SÖZE sonuna ulaş.',
    'end_cold_kitchen.name': 'Çorba Soğudu', 'end_cold_kitchen.desc': 'SOĞUK MUTFAK sonuna ulaş.',
    'end_alone.name': 'Yalnız Kurt', 'end_alone.desc': 'YALNIZ sonuna ulaş.',
    'end_chair.name': 'Boş Sandalye', 'end_chair.desc': 'SANDALYE sonuna ulaş.',
    'end_kept.name': 'Emanete Kaldı', 'end_kept.desc': 'SAKLI sonuna ulaş.',
    'end_paid_in_full.name': 'Veresiye Kapandı', 'end_paid_in_full.desc': 'TAMAMI ÖDENDİ sonuna ulaş.',
    'end_he_came_home.name': 'Davetsiz Misafir', 'end_he_came_home.desc': 'EVE DÖNDÜ sonuna ulaş.',
    'end_descend.name': 'Bir Kat Aşağı', 'end_descend.desc': 'İNİŞ sonuna ulaş.',
    'end_fall.name': 'Kapaktan Aşağı', 'end_fall.desc': 'DÜŞÜŞ sonuna ulaş.',

    'loki_lie.name': 'Yalancının Mumu', 'loki_lie.desc': 'Loki\'yi yalanda yakala.',
    'no_loki.name': 'Sağır Sultan', 'no_loki.desc': 'Loki\'ye bir şey sormadan, yalancı demeden 6. geceye ulaş.',

    'bond_selim.name': 'Sıcak Tabure', 'bond_selim.desc': 'Selim\'le dostluğu 3\'e çıkar.',
    'bond_mira.name': 'Doğru Numara', 'bond_mira.desc': 'Mira\'yla dostluğu 3\'e çıkar.',
    'bond_tamsin.name': 'Bin Özür', 'bond_tamsin.desc': 'Tamsin\'le dostluğu 3\'e çıkar.',
    'bond_lucan.name': 'Ön Sıra', 'bond_lucan.desc': 'Lucan\'la dostluğu 3\'e çıkar.',
    'bond_mimosa.name': 'Kayıp Eşya', 'bond_mimosa.desc': 'Mimosa\'yla dostluğu 3\'e çıkar.',
    'bond_vell.name': 'Banttaki Ses', 'bond_vell.desc': 'Vell\'le dostluğu 3\'e çıkar.',
    'bond_collector.name': 'Sıfır Faiz', 'bond_collector.desc': 'Tahsildar\'la dostluğu 3\'e çıkar.',

    'all_machines.name': 'Kumarhane Turu', 'all_machines.desc': 'Katın bütün makinelerinde bir el oyna.',
    'seal_back.name': 'İkinci Şans', 'seal_back.desc': 'Bir mührü kaybet, sonra geri kazan.',
    'four_gods.name': 'Dört Başı Mamur', 'four_gods.desc': 'Dört tanrının hepsini 3. Lütuf\'a çıkar.',
    'five_boons.name': 'Tanrıların Gözdesi', 'five_boons.desc': 'Tek oyunda 5 lütuf tut.',

    'broke.name': 'Cebi Delik', 'broke.desc': 'Son jetonunu masada kaybet.',
    'wrong_call.name': 'Haksız Suçlama', 'wrong_call.desc': 'Doğru söyleyen Loki\'ye yalancı de.',
    'hollow.name': 'Kapının Ardı', 'hollow.desc': 'Gizli kapıdan içeri gir.',
  },
};
