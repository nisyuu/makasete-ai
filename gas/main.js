/**
 * Makasete AI - Spreadsheet Menu
 *
 * Security: このスクリプトからデプロイを起動してはいけない。
 *
 * Cloud Build API を呼ぶには cloud-platform スコープ（Google Cloud 全体の操作）が
 * 必要になる。スプレッドシートに紐づいたスクリプトはシートの編集者が誰でも
 * 書き換えられるため、窃取コードを仕込まれると、メニューを押した管理者のトークンが
 * そのまま外部へ渡る。Secret Manager の読み出しやサービスアカウント鍵の作成まで可能になる。
 *
 * Webhook トリガー方式も採らない。サービス名はランダムな UUID から作られ、
 * スプレッドシート ID から導出できないため、呼び出し側がサービス名を指定する必要がある。
 * シークレットはシートの編集者が読めるので、他テナントのサービス名を指定して
 * 自分のスプレッドシートで再デプロイさせることができてしまう。
 *
 * 反映は Makasete AI の管理画面から行う。platform 側が自身のサービスアカウントで
 * ビルドを起動するため、シートの編集者に権限を渡す必要がない。
 * `ScriptApp.getOAuthToken()` や `UrlFetchApp` をここに持ち込まないこと。
 */

// 管理画面の URL。スクリプト プロパティに DASHBOARD_URL を設定すると案内に表示される。
const scriptProperties = PropertiesService.getScriptProperties();
const DASHBOARD_URL = scriptProperties.getProperty('DASHBOARD_URL');

/**
 * Adds a custom menu to the spreadsheet on open.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🤖 Makasete AI')
    .addItem('🚀 編集内容の反映方法', 'showDeployGuide')
    .addToUi();
}

/**
 * 反映の手順を案内する。ここではデプロイを起動しない（理由は冒頭のコメント）。
 */
function showDeployGuide() {
  const ui = SpreadsheetApp.getUi();
  const link = DASHBOARD_URL ? `\n\n管理画面:\n${DASHBOARD_URL}` : '';

  ui.alert(
    '編集内容の反映方法',
    'このシートの編集内容をチャットに反映するには、Makasete AI の管理画面を開き、'
      + '対象サーバーの「再ビルド」を実行してください。\n\n'
      + '反映まで数分かかります。'
      + link,
    ui.ButtonSet.OK,
  );
}
