/**
 * Makasete AI - Spreadsheet Menu & Build Trigger
 */

// Use Script Properties to manage environment-specific values
const scriptProperties = PropertiesService.getScriptProperties();
const PROJECT_ID = scriptProperties.getProperty('PROJECT_ID');
const TRIGGER_NAME = scriptProperties.getProperty('TRIGGER_NAME');

/**
 * Adds a custom menu to the spreadsheet on open.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🤖 Makasete AI')
    .addItem('🚀 スプレッドシートの情報をMakasete AIに反映', 'triggerCloudBuild')
    .addToUi();
}

/**
 * Triggers Google Cloud Build to redeploy the bot.
 */
function triggerCloudBuild() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '確認',
    '最新のスプレッドシートの情報をMakasete AIに反映しますか？\n（完了まで数分〜10分程度かかります）',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  try {
    if (!PROJECT_ID || !TRIGGER_NAME) {
      throw new Error('PROJECT_ID または TRIGGER_NAME がスクリプトプロパティに設定されていません。GASの[設定 > スクリプトプロパティ]を確認してください。');
    }
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
      ui.alert('✅ ビルドを開始しました', '反映まで今しばらくお待ちください。', ui.ButtonSet.OK);
    } else {
      throw new Error(result.error ? result.error.message : 'Unknown error');
    }
  } catch (e) {
    ui.alert('❌ エラー', 'ビルドの起動に失敗しました: ' + e.toString(), ui.ButtonSet.OK);
  }
}
