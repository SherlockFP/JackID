// Entry point for `node --test scripts/tests`. Node 21+ no longer accepts a directory argument, so the directory
// resolves to this file, which loads every suite into one run. `node --test` with no arguments also finds the
// *.test.mjs files on its own; both forms run the same tests.
import './rng.test.mjs';
import './tween.test.mjs';
import './timers.test.mjs';
import './i18n.test.mjs';
import './reels.test.mjs';
import './cards.test.mjs';
import './check.test.mjs';
import './circuit.test.mjs';
import './suits.test.mjs';
import './pace.test.mjs';
import './shop.test.mjs';
import './engines.test.mjs';
import './run.wave8.test.mjs';
import './hotline.test.mjs';
import './lootbox.test.mjs';
