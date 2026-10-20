// Ping IndexNow (Bing, Yandex, Seznam, Naver) after a production deploy.
// Run only once the key file is live: node scripts/indexnow.mjs
const host = 'zucity-aesthetics.vercel.app';
const key = '3e7a11ffb764d796ce88a0d7894582cf';
const keyLocation = `https://${host}/${key}.txt`;

const live = await fetch(keyLocation);
if (!live.ok || (await live.text()).trim() !== key) {
  console.error(`Key file not live at ${keyLocation} (HTTP ${live.status}). Deploy first.`);
  process.exit(1);
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key, keyLocation, urlList: [`https://${host}/`] }),
});
console.log(`IndexNow: HTTP ${res.status} ${res.statusText}`);
if (!res.ok && res.status !== 202) process.exit(1);
