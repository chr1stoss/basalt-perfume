(function(window){
  'use strict';
  var browserCsrfToken = '';
  function sessionContext() {
    var context = window.BasaltSessionContext;
    if (!context || !/^[a-f0-9]{24,64}$/i.test(String(context.client_id || ''))) return null;
    return {client_id:String(context.client_id),platform:String(context.platform || 'mobile')};
  }
  function addSessionContext(payload) {
    var context = sessionContext();
    if (context) { payload.client_id=context.client_id; payload.platform=context.platform; }
    return payload;
  }
  function secureHeaders(headers) {
    var result = Object.assign({}, headers || {});
    if (browserCsrfToken) result['X-CSRF-Token'] = browserCsrfToken;
    return result;
  }
  function request(action, extra, initData) {
    var payload = Object.assign({}, extra || {});
    payload.action = action;
    payload.initData = initData;
    addSessionContext(payload);
    var controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    var timeoutId = null;
    var requestOptions = {method:'POST',headers:secureHeaders({'Content-Type':'application/json','Accept':'application/json'}),body:JSON.stringify(payload),credentials:'same-origin',cache:'no-store'};
    if (controller) requestOptions.signal = controller.signal;

    // A stalled WebView fetch used to leave the initial screen/catalog on "Loading…" forever.
    // Race against an explicit deadline; AbortController also stops the network request when supported.
    var fetchPromise = fetch('/api.php', requestOptions)
      .then(function (r) {
        return r.text().then(function (text) {
          var j = null;
          try { j = text ? JSON.parse(text) : null; }
          catch (parseError) {
            if (window.console && console.warn) console.warn('Basalt API returned non-JSON response (HTTP ' + r.status + ').');
            var nonJson = new Error(text.trim() ? 'api_non_json' : 'api_empty_response');
            nonJson.code = text.trim() ? 'api_non_json' : 'api_empty_response';
            nonJson.httpStatus = r.status;
            throw nonJson;
          }
          if (!j || typeof j !== 'object') {
            if (window.console && console.warn) console.warn('Basalt API returned an invalid JSON payload (HTTP ' + r.status + ').');
            var invalid = new Error('api_invalid_response');
            invalid.code = 'api_invalid_response';
            invalid.httpStatus = r.status;
            throw invalid;
          }
          if (!r.ok || !j.ok) {
            var data = j.data || {};
            var code = data.error ? String(data.error) : 'api_request_failed';
            var message = data.message ? String(data.message) : code;
            var displayStatus = data.http_status ? Number(data.http_status) : r.status;
            var err = new Error(message);
            err.code = code;
            err.httpStatus = displayStatus;
            err.apiMessage = data.message ? String(data.message) : '';
            err.apiData = data;
            throw err;
          }
          if (action === 'browser_status') browserCsrfToken = j.data && j.data.authenticated && j.data.csrf_token ? String(j.data.csrf_token) : '';
          if (action === 'browser_logout') browserCsrfToken = '';
          return j.data;
        });
      }).catch(function (err) {
        if (err && err.name === 'AbortError') {
          var aborted = new Error('api_timeout');
          aborted.code = 'api_timeout';
          return Promise.reject(aborted);
        }
        if (err instanceof TypeError) {
          var network = new Error('api_network_error');
          network.code = 'api_network_error';
          return Promise.reject(network);
        }
        return Promise.reject(err);
      });

    var deadlinePromise = new Promise(function (_resolve, reject) {
      timeoutId = window.setTimeout(function () {
        if (controller) controller.abort();
        var timeout = new Error('api_timeout');
        timeout.code = 'api_timeout';
        reject(timeout);
      }, 25000);
    });
    return Promise.race([fetchPromise, deadlinePromise]).finally(function () {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    });
  }

  function readErrorResponse(response) {
    return response.text().then(function (text) {
      var payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch (e) {}
      var data = payload && payload.data ? payload.data : {};
      var error = new Error(data.message || data.error || 'api_request_failed');
      error.code = data.error || 'api_request_failed';
      error.httpStatus = data.http_status || response.status;
      throw error;
    });
  }
  function uploadFile(file, initData, onProgress, batchId) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var form = new FormData();
      form.append('action', 'stage_price_list');
      form.append('batch_id', String(batchId || ''));
      form.append('initData', initData || '');
      var context=sessionContext();if(context){form.append('client_id',context.client_id);form.append('platform',context.platform);}
      form.append('price_file', file, file.name);
      xhr.open('POST', '/api.php', true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json');
      if (browserCsrfToken) xhr.setRequestHeader('X-CSRF-Token', browserCsrfToken);
      xhr.timeout = 120000;
      xhr.upload.onprogress = function (event) {
        if (event.lengthComputable && typeof onProgress === 'function') onProgress(Math.max(0, Math.min(100, Math.round(event.loaded / event.total * 100))));
      };
      xhr.onload = function () {
        var payload = null;
        try { payload = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300 && payload && payload.ok) { resolve(payload.data || {}); return; }
        var data = payload && payload.data ? payload.data : {};
        var error = new Error(data.message || data.error || 'upload_failed');
        error.code = data.error || 'upload_failed';
        error.httpStatus = data.http_status || xhr.status;
        error.apiData = data;
        reject(error);
      };
      xhr.onerror = function () { var error = new Error('api_network_error'); error.code = 'api_network_error'; reject(error); };
      xhr.ontimeout = function () { var error = new Error('api_timeout'); error.code = 'api_timeout'; reject(error); };
      xhr.onabort = function () { var error = new Error('upload_aborted'); error.code = 'upload_aborted'; reject(error); };
      xhr.send(form);
    });
  }
  function createDownloadLink(kind, fileId, initData, userId) {
    var payload={action:'create_download_link',kind:String(kind||'file'),initData:initData||''};
    if(fileId)payload.file_id=Number(fileId);
    if(userId)payload.user_id=Number(userId);
    addSessionContext(payload);
    return fetch('/api.php',{method:'POST',headers:secureHeaders({'Content-Type':'application/json','Accept':'application/json'}),body:JSON.stringify(payload),credentials:'same-origin',cache:'no-store'})
      .then(function(response){return response.text().then(function(text){var data=null;try{data=text?JSON.parse(text):null;}catch(e){}if(!response.ok||!data||!data.ok){var detail=data&&data.data?data.data:{};var error=new Error(detail.message||detail.error||'download_link_failed');error.code=detail.error||'download_link_failed';error.httpStatus=detail.http_status||response.status;error.apiData=detail;throw error;}return data.data||{};});});
  }
  window.BasaltApi={request:request,uploadFile:uploadFile,createDownloadLink:createDownloadLink};
})(window);
