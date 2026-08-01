/**
 * ===========================================================
 * クロノロジー PWA用 Service Worker
 * -----------------------------------------------------------
 * 戦略：Cache First（キャッシュ優先）
 *   1. インストール時にアプリの主要ファイル（HTML/manifest/アイコン等）を
 *      キャッシュに事前保存（プリキャッシュ）する。
 *   2. リクエストが来たら、まずキャッシュを確認し、あればそれを返す。
 *      キャッシュが無ければネットワークから取得し、取得できたものは
 *      次回以降のためにキャッシュへ保存する。
 *   3. これにより、ネットワークが無い状態でもアプリ本体（画面）は
 *      開くことができる（Firestoreのデータ同期は別途オンライン時に行う）。
 * ===========================================================
 */

// キャッシュのバージョン名。ファイルを更新した際はこの文字列を変更すると
// 古いキャッシュが破棄され、新しいファイルに置き換わる。
const CACHE_NAME = 'chronology-cache-v1';

// 事前にキャッシュしておく「アプリの土台（アプリシェル）」ファイル一覧。
// ※ Firebase SDKやTailwind等のCDNファイルは、実際にアクセスされたタイミングで
//    fetchイベント内でキャッシュに追加する（プリキャッシュはCORSの都合上省略）。
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.jpg',
  './icons/icon-512.jpg'
];

// -----------------------------------------------------------
// install：Service Worker が初めて登録されたときに発火
// -----------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});

// -----------------------------------------------------------
// activate：新しい Service Worker が有効化されたときに発火
// 古いバージョンのキャッシュを削除して容量を圧迫しないようにする
// -----------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// -----------------------------------------------------------
// fetch：すべてのリクエストをインターセプトし、Cache First で応答する
// -----------------------------------------------------------
self.addEventListener('fetch', (event) => {
  // Firestore/Auth等のFirebase通信（google/firestore APIへのリクエスト）は
  // Service Workerのキャッシュ対象から外し、常にネットワーク（またはFirestore
  // 自身のオフライン永続化機構）に処理させる。
  const url = event.request.url;
  if (
    url.includes('firestore.googleapis.com') ||
    url.includes('identitytoolkit.googleapis.com') ||
    url.includes('securetoken.googleapis.com')
  ) {
    return; // Service Workerでは何もしない＝ブラウザ標準の通信に任せる
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // 1. キャッシュに存在すればそれを即座に返す（Cache First）
      if (cachedResponse) {
        return cachedResponse;
      }

      // 2. キャッシュに無ければネットワークから取得し、成功したらキャッシュに保存
      return fetch(event.request)
        .then((networkResponse) => {
          // opaque（CORS制限のあるCDN等）レスポンスも含めて保存を試みる
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone).catch(() => {
              /* オリジンやレスポンス種別によっては保存できない場合があるが無視する */
            });
          });
          return networkResponse;
        })
        .catch(() => {
          // 3. ネットワークにも失敗した場合（完全オフライン時のナビゲーション等）
          //    HTMLページのリクエストであればキャッシュ済みのindex.htmlを返す
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          // それ以外は失敗のまま返す
          return new Response('', { status: 504, statusText: 'Offline' });
        });
    })
  );
});
