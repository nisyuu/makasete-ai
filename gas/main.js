/**
 * Makasete AI - Spreadsheet Menu & Build Trigger
 */

// Script Properties for environment-specific values
const scriptProperties = PropertiesService.getScriptProperties();
const PROJECT_ID = scriptProperties.getProperty('PROJECT_ID');
const TRIGGER_ID = scriptProperties.getProperty('TRIGGER_ID');
// Webhook トリガーの呼び出しに使う API キーと認証シークレット。
// これらを持っていてもできるのは「このトリガーを起動する」ことだけ。
const WEBHOOK_API_KEY = scriptProperties.getProperty('WEBHOOK_API_KEY');
const WEBHOOK_SECRET = scriptProperties.getProperty('WEBHOOK_SECRET');

/**
 * Adds a custom menu to the spreadsheet on open.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🤖 Makasete AI')
    .addItem('🚀 スプレッドシートの情報を反映', 'triggerDeploy')
    .addToUi();
}

/**
 * Main trigger function
 */
function triggerDeploy() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    '確認',
    `最新のスプレッドシートの情報を反映しますか？`,
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  triggerCloudBuild();
}

/**
 * Triggers Google Cloud Build to redeploy the makasete-server.
 *
 * Security: ここで `ScriptApp.getOAuthToken()` を使ってはいけない。
 * Cloud Build API を直接呼ぶには cloud-platform スコープ（GCP 全体の操作）が
 * 必要になる。このスクリプトはスプレッドシートに紐付いているため編集者が
 * 誰でも書き換えられ、窃取コードを仕込まれると、メニューを押した管理者の
 * トークンがそのまま外部に渡ってしまう。
 *
 * 代わりに Cloud Build の Webhook トリガーを呼ぶ。この鍵が漏れても、できるのは
 * main のデプロイを走らせることだけで、GCP の他の操作はできない。
 */
function triggerCloudBuild() {
  const ui = SpreadsheetApp.getUi();

  try {
    if (!PROJECT_ID || !TRIGGER_ID || !WEBHOOK_API_KEY || !WEBHOOK_SECRET) {
      throw new Error(
        'PROJECT_ID / TRIGGER_ID / WEBHOOK_API_KEY / WEBHOOK_SECRET がスクリプトプロパティに設定されていません。'
      );
    }

    const url =
      `https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/triggers/${TRIGGER_ID}:webhook` +
      `?key=${encodeURIComponent(WEBHOOK_API_KEY)}&secret=${encodeURIComponent(WEBHOOK_SECRET)}`;

    const options = {
      method: 'post',
      contentType: 'application/json',
      // ビルドする内容（ブランチ・置換変数）はトリガー側で固定している
      payload: '{}',
      muteHttpExceptions: true
    };

    const res = UrlFetchApp.fetch(url, options);
    const status = res.getResponseCode();

    if (status === 200) {
      ui.alert('✅ ビルドを開始しました', 'デプロイを開始しました。\n完了まで数分お待ちください。', ui.ButtonSet.OK);
      return;
    }

    // 応答本文には鍵や内部情報が含まれることがあるため、UI には出さずログにだけ残す
    console.error('Cloud Build webhook failed', status, res.getContentText());
    throw new Error(`Cloud Build が応答コード ${status} を返しました`);
  } catch (e) {
    console.error('triggerCloudBuild failed', e);
    ui.alert(
      '❌ エラー',
      'ビルドの起動に失敗しました。設定を確認してください。\n詳細は Apps Script の実行ログに記録されています。',
      ui.ButtonSet.OK
    );
  }
}
