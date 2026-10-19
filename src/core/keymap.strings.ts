/**
 * Strings for key labels and action names (CORE-INPUT). Keys `ui.key.*` complement the seeds in i18n/en.ts;
 * `ui.action.<bindingKey>` names every walk / machine action for the controls card and the rebinding list.
 */
const strings = {
  prefix: 'ui.',
  en: {
    'key.none': '—',
    'key.Backspace': 'BKSP', 'key.Delete': 'DEL', 'key.Insert': 'INS', 'key.Home': 'HOME', 'key.End': 'END',
    'key.PageUp': 'PG UP', 'key.PageDown': 'PG DN', 'key.ShiftRight': 'SHIFT', 'key.ControlLeft': 'CTRL',
    'key.ControlRight': 'CTRL', 'key.AltLeft': 'ALT', 'key.AltRight': 'ALT', 'key.CapsLock': 'CAPS',
    // walk
    'action.fwd': 'Move forward', 'action.back': 'Move back', 'action.left': 'Move left', 'action.right': 'Move right',
    'action.sprint': 'Sprint', 'action.crouch': 'Crouch', 'action.interact': 'Interact / sit / stand',
    'action.pause': 'Pause', 'action.scoreboard': 'Scoreboard (hold)', 'action.chat': 'Chat', 'action.give': 'Give coins',
    'action.help': 'Controls card', 'action.debug': 'Debug overlay', 'action.debugColliders': 'Show colliders',
    'action.upgrade': 'Upgrade Ledger', 'action.use': 'Use held item', 'action.place': 'Place / pick up Totem',
    'action.emote': 'Emote', 'action.ping': 'Ping marker', 'action.talk': 'Push to talk (hold)',
    'action.journal': 'JackID card (hold)', 'action.skip': 'Skip cutscene (hold)', 'action.jump': 'Hop',
    'action.fidget': 'Coin trick (walking)', 'action.cheer': 'Cheer', 'action.shrug': 'Shrug', 'action.dance': 'Dance',
    'action.answerPhone': 'Answer the phone (from anywhere)', 'action.phoneOpt1': 'Phone deal 1', 'action.phoneOpt2': 'Phone deal 2', 'action.phoneOpt3': 'Phone deal 3',
    'action.phone': 'Pocket phone (open / close)', 'action.phoneReply1': 'Phone reply 1', 'action.phoneReply2': 'Phone reply 2', 'action.phoneReply3': 'Phone reply 3',
    'action.keepsake': 'Bet the carried keepsake (at a seat)', 'action.floorAct': 'Take the dare or bid (floor event)', 'action.callCheat': 'Call the cheat at a marked table (Crooked Table)', 'action.jokerAsk': 'Ask Loki', 'action.callLiar': 'Call Loki a liar',
    // machine
    'action.m.primary': 'Primary (spin / deal)', 'action.m.secondary': 'Secondary (tap RMB)',
    'action.m.up': 'Up', 'action.m.down': 'Down', 'action.m.left': 'Left', 'action.m.right': 'Right',
    'action.m.betUp': 'Raise bet', 'action.m.betDown': 'Lower bet', 'action.m.betMax': 'Max bet',
    'action.m.confirm': 'Confirm', 'action.m.alt': 'Second action (reroll / jump card)', 'action.m.help': 'Paytable',
    'action.m.exit': 'Stand up', 'action.m.collect': 'Collect / cash out', 'action.m.fast': 'Fast mode',
    'action.m.auto': 'Autoplay menu', 'action.m.camera': 'Cycle camera', 'action.m.clear': 'Clear bets',
    'action.m.double': 'Double bets',
    'action.m.n1': 'Button 1', 'action.m.n2': 'Button 2', 'action.m.n3': 'Button 3', 'action.m.n4': 'Button 4',
    'action.m.n5': 'Button 5', 'action.m.n6': 'Button 6', 'action.m.n7': 'Button 7', 'action.m.n8': 'Button 8',
    'action.m.n9': 'Button 9',
    // controls lane
    'ctl.capture': 'CLICK TO CAPTURE MOUSE',
    'ctl.standAfterRound': 'Standing up after this round',
  },
  tr: {
    'key.none': '—',
    'key.Backspace': 'GERİ SİL', 'key.Delete': 'SİL', 'key.Insert': 'INS', 'key.Home': 'HOME', 'key.End': 'END',
    'key.PageUp': 'PG UP', 'key.PageDown': 'PG DN', 'key.ShiftRight': 'SHIFT', 'key.ControlLeft': 'CTRL',
    'key.ControlRight': 'CTRL', 'key.AltLeft': 'ALT', 'key.AltRight': 'ALT', 'key.CapsLock': 'CAPS',
    // walk
    'action.fwd': 'İleri', 'action.back': 'Geri', 'action.left': 'Sola', 'action.right': 'Sağa',
    'action.sprint': 'Koş', 'action.crouch': 'Çömel', 'action.interact': 'Etkileş / otur / kalk',
    'action.pause': 'Duraklat', 'action.scoreboard': 'Skor tablosu (basılı tut)', 'action.chat': 'Sohbet',
    'action.give': 'Jeton ver', 'action.help': 'Kontrol kartı', 'action.debug': 'Hata ayıklama',
    'action.debugColliders': 'Çarpışmaları göster', 'action.upgrade': 'Yükseltme Defteri',
    'action.use': 'Eldeki eşyayı kullan', 'action.place': 'Totem koy / al', 'action.emote': 'İfade',
    'action.ping': 'İşaret koy', 'action.talk': 'Bas-konuş (basılı tut)', 'action.journal': 'JackID kartı (basılı tut)',
    'action.skip': 'Ara sahneyi atla (basılı tut)', 'action.jump': 'Zıpla', 'action.fidget': 'Jeton hilesi (yürürken)',
    'action.cheer': 'Alkışla', 'action.shrug': 'Omuz silk', 'action.dance': 'Dans et',
    'action.answerPhone': 'Telefonu aç (her yerden)', 'action.phoneOpt1': 'Telefon teklifi 1', 'action.phoneOpt2': 'Telefon teklifi 2', 'action.phoneOpt3': 'Telefon teklifi 3',
    'action.phone': 'Cep telefonu (aç / kapat)', 'action.phoneReply1': 'Telefon yanıtı 1', 'action.phoneReply2': 'Telefon yanıtı 2', 'action.phoneReply3': 'Telefon yanıtı 3',
    'action.keepsake': 'Eşyayı masada bahse koy', 'action.floorAct': 'Bahsi al ya da teklif ver (salon olayı)', 'action.callCheat': 'İşaretli masada hileyi söyle (Hileli Masa)', 'action.jokerAsk': "Loki'ye sor", 'action.callLiar': "Loki'nin yalanını yakala",
    // machine
    'action.m.primary': 'Ana eylem (çevir / dağıt)', 'action.m.secondary': 'İkincil (sağ tık)',
    'action.m.up': 'Yukarı', 'action.m.down': 'Aşağı', 'action.m.left': 'Sol', 'action.m.right': 'Sağ',
    'action.m.betUp': 'Bahsi artır', 'action.m.betDown': 'Bahsi azalt', 'action.m.betMax': 'En yüksek bahis',
    'action.m.confirm': 'Onayla', 'action.m.alt': 'İkinci eylem (yenile / atlama kartı)', 'action.m.help': 'Ödeme tablosu',
    'action.m.exit': 'Ayağa kalk', 'action.m.collect': 'Topla / bozdur', 'action.m.fast': 'Hızlı mod',
    'action.m.auto': 'Otomatik oyun menüsü', 'action.m.camera': 'Kamerayı değiştir', 'action.m.clear': 'Bahisleri temizle',
    'action.m.double': 'Bahisleri ikiye katla',
    'action.m.n1': 'Düğme 1', 'action.m.n2': 'Düğme 2', 'action.m.n3': 'Düğme 3', 'action.m.n4': 'Düğme 4',
    'action.m.n5': 'Düğme 5', 'action.m.n6': 'Düğme 6', 'action.m.n7': 'Düğme 7', 'action.m.n8': 'Düğme 8',
    'action.m.n9': 'Düğme 9',
    // controls lane
    'ctl.capture': 'FAREYİ YAKALAMAK İÇİN TIKLA',
    'ctl.standAfterRound': 'Bu turdan sonra kalkacaksın',
  },
};

export default strings;
