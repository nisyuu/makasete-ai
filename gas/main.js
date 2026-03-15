/**
 * Makasete AI - Spreadsheet Menu & Build Trigger
 */

// Script Properties for environment-specific values
const scriptProperties = PropertiesService.getScriptProperties();
const PROJECT_ID = scriptProperties.getProperty('PROJECT_ID');
const TRIGGER_ID = scriptProperties.getProperty('TRIGGER_ID');

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
 * Triggers Google Cloud Build to redeploy the bot.
 */
function triggerCloudBuild() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    if (!PROJECT_ID || !TRIGGER_ID) {
      throw new Error('PROJECT_ID または TRIGGER_ID がスクリプトプロパティに設定されていません。');
    }
    const token = ScriptApp.getOAuthToken();
    const url = `https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/triggers/${TRIGGER_ID}:run`;
    
    const options = {
      method: 'post',
      headers: {
        Authorization: 'Bearer ' + token
      },
      contentType: 'application/json',
      payload: JSON.stringify({
        branchName: 'main'
        // substitutions are now defined in the trigger itself
      }),
      muteHttpExceptions: true
    };

    const res = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(res.getContentText());

    if (res.getResponseCode() === 200) {
      ui.alert('✅ ビルドを開始しました', `デプロイを開始しました。\n完了まで数分お待ちください。`, ui.ButtonSet.OK);
    } else {
      throw new Error(result.error ? result.error.message : 'Unknown error');
    }
  } catch (e) {
    ui.alert('❌ エラー', 'ビルドの起動に失敗しました: ' + e.toString(), ui.ButtonSet.OK);
  }
}
