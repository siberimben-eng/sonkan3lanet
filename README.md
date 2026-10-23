# Crimson Circuit — online kurulum

Dosyalar: `index.html` (oyun), `server.js` (oda sunucusu, bağımlılık yok), `package.json`.

## A) Tek yerde yayınla (en kolayı) — Render
1. Bu klasörü bir GitHub deposuna yükle.
2. render.com → New → Web Service → depoyu seç.
3. Runtime: Node · Build Command: boş bırak · Start Command: `node server.js`
4. Yayına alınca çıkan adres (https://xxxx.onrender.com) hem oyundur hem online sunucusudur. Linki arkadaşlarına gönder, aynı oda kodunu girsinler.
Railway, Fly.io, bir VPS ya da kendi bilgisayarın (`node server.js`, sonra http://localhost:3000) de aynı şekilde çalışır.

## B) Oyun Netlify'da, sunucu Render'da
1. Sunucuyu yukarıdaki gibi Render'a kur.
2. `index.html` içinde `window.CC_WS_URL = '';` satırını `window.CC_WS_URL = 'wss://xxxx.onrender.com';` yap.
3. `index.html` dosyasını Netlify'a sürükle-bırak yükle.

Not: Render'ın ücretsiz katmanı 15 dk kullanılmayınca uyur, ilk bağlantı ~30 sn sürebilir.
Admin girişi: kullanıcı adı `admin`. Şifrenin hash'i `index.html` içindedir.
