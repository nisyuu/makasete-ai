/**
 * Makasete Bot - Spreadsheet Menu & Build Trigger
 */

// These will be managed via Script Properties or environment later
const PROJECT_ID = 'makasete-ai';
const TRIGGER_NAME = 'redeploy-makasete-ai'; // Manual trigger name

/**
 * Adds a custom menu to the spreadsheet on open.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🤖 Makasete Bot')
    .addItem('🚀 サーバーを再構築 (デプロイ)', 'triggerCloudBuild')
    .addToUi();
}

/**
 * Triggers Google Cloud Build to redeploy the bot.
 */
function triggerCloudBuild() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '確認',
    '最新のソースコードとスプレッドシートの情報でサーバーを再構築しますか？\n（完了まで数分かかります）',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  try {
    const token = ScriptApp.getOAuthToken();
    // Use the REST API to run the trigger
    const url = `https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/triggers/${TRIGGER_NAME}:run`;
    
    const options = {
      method: 'post',
      headers: {
        Authorization: 'Bearer ' + token
      },
      contentType: 'application/json',
      payload: JSON.stringify({
        branchName: 'main'
      }),
      muteHttpExceptions: true
    };

    const res = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(res.getContentText());

    if (res.getResponseCode() === 200) {
      ui.alert('✅ ビルドを開始しました', 'Google Cloud Console の Cloud Build 画面で進捗を確認できます。', ui.ButtonSet.OK);
    } else {
      throw new Error(result.error ? result.error.message : 'Unknown error');
    }
  } catch (e) {
    ui.alert('❌ エラー', 'ビルドの起動に失敗しました: ' + e.toString(), ui.ButtonSet.OK);
  }
}
