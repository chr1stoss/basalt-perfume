(function(window){
  'use strict';
  function request(action, extra, initData) {
    var payload = Object.assign({}, extra || {});
    payload.action = action;
    payload.initData = initData;
    var controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    var timeoutId = null;
    var requestOptions = {method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload),credentials:'same-origin',cache:'no-store'};
    if (controller) requestOptions.signal = controller.signal;

    // A stalled WebView fetch used to leave the initial screen/catalog on "Loading…" forever.
    // Race against an explicit deadline; AbortController also stops the network request when supported.
    var fetchPromise = fetch('./api.php', requestOptions)
      .then(function (r) {
        return r.text().then(function (text) {
          var j = null;
          try { j = text ? JSON.parse(text) : null; }
          catch (parseError) {
            if (window.console && console.error) console.error('Basalt API returned non-JSON response', r.status, text.slice(0, 1000));
            var nonJson = new Error(text.trim() ? 'api_non_json' : 'api_empty_response');
            nonJson.code = text.trim() ? 'api_non_json' : 'api_empty_response';
            nonJson.httpStatus = r.status;
            throw nonJson;
          }
          if (!j || typeof j !== 'object') {
            if (window.console && console.error) console.error('Basalt API returned empty JSON payload', r.status, text);
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
            throw err;
          }
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
  window.BasaltApi={request:request};
})(window);
