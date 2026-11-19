(function(){
  'use strict';
  var statusEl=document.getElementById('oidcStatus');
  var retryEl=document.getElementById('oidcRetry');
  function showError(message){statusEl.className='oidc-status error';statusEl.textContent=message;retryEl.hidden=false;}
  function parseJson(response){return response.text().then(function(text){var data=null;try{data=text?JSON.parse(text):null;}catch(e){}if(!data)throw new Error('Сервер вернул некорректный ответ.');return data;});}
  function apiPost(action,payload){
    var body=Object.assign({action:action,initData:''},payload||{});
    return fetch('/api.php',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)})
      .then(parseJson).then(function(result){if(!result.ok){var d=result.data||{};throw new Error(d.message||d.error||'Ошибка проверки на сервере.');}return result.data||{};});
  }
  function safeReturnTo(value){
    if(typeof value!=='string'||!value||value.charAt(0)!=='/'||value.indexOf('//')===0||value.indexOf('\\')!==-1)return '/';
    if(value.indexOf('/telegram-login-callback.html')===0)return '/';
    return value;
  }
  function run(){
    var params=new URLSearchParams(window.location.search||'');
    var code=params.get('code')||'';var state=params.get('state')||'';var oauthError=params.get('error')||'';
    try{history.replaceState({},document.title,window.location.pathname);}catch(e){}
    if(oauthError){showError('Telegram не завершил авторизацию: '+oauthError+'. Вернитесь на сайт и попробуйте ещё раз.');return;}
    if(!code||!state){showError('Telegram вернул страницу без кода авторизации. Начните вход ещё раз.');return;}
    statusEl.innerHTML='<span class="oidc-spinner" aria-hidden="true"></span>Проверяем state и готовим обмен кода…';
    apiPost('telegram_browser_code_prepare',{code:code,state:state}).then(function(flow){
      if(flow.redirect_uri!==window.location.origin+window.location.pathname)throw new Error('Callback не совпадает с адресом, зарегистрированным в BotFather.');
      statusEl.innerHTML='<span class="oidc-spinner" aria-hidden="true"></span>Telegram подтвердил вход. Получаем ID-токен…';
      return fetch(flow.exchange_relay_url,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({code:code,code_verifier:flow.code_verifier,redirect_uri:flow.redirect_uri,client_id:flow.client_id})})
        .then(parseJson).then(function(relayResult){
          if(!relayResult||!relayResult.ok||!relayResult.id_token){var errorCode=relayResult&&relayResult.error?String(relayResult.error):'relay_failed';throw new Error('Не удалось получить ID-токен от Telegram (relay: '+errorCode+').');}
          statusEl.innerHTML='<span class="oidc-spinner" aria-hidden="true"></span>Проверяем подпись Telegram и создаём сессию…';
          return apiPost('telegram_browser_verify',{id_token:relayResult.id_token}).then(function(){
            statusEl.className='oidc-status';statusEl.textContent='Вход подтверждён. Открываем каталог…';
            window.location.replace(safeReturnTo(flow.return_to));
          });
        });
    }).catch(function(error){showError(error&&error.message?error.message:'Не удалось завершить вход. Проверьте настройки relay и повторите попытку.');});
  }
  run();
})();
