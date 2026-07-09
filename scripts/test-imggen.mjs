// Reproduce the REAL 4-cut art generation to see if the prompt gets blocked / rate-limited.
import { generateComicImage } from '../lib/img/comic_card.mjs';
import { deriveFourBeats, fourCutPrompt } from '../lib/img/fourcut.mjs';

const article = {
  sport: 'football',
  titleKo: '아르헨, 8강 축포가 폭력으로',
  bodyKo: '아르헨티나가 8강에서 극적인 역전승을 거뒀지만 경기 후 관중석에서 충돌이 발생했다. 선수들은 환호했고 팬들은 열광했다.',
};
const beats = await deriveFourBeats(
  { sportKey: article.sport, headline: article.titleKo, summary: article.bodyKo, eventType: 'match_result' },
  process.env);
console.log('beats =', JSON.stringify(beats, null, 2));
const prompt = fourCutPrompt(beats);
console.log('\n--- prompt ---\n', prompt, '\n');
const t0 = Date.now();
const { buffer, source } = await generateComicImage(prompt, process.env, { aspectRatio: '1:1' });
console.log('source =', source);
console.log('bytes  =', buffer.length, '| ms =', Date.now() - t0);
