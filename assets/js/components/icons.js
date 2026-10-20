(function(window){
  'use strict';
  function svg(name) {
    var paths={
      home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
      file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
      search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
      bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
      arrow:'<path d="M7 17 17 7M7 7h10v10"/>',
      subscription:'<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18"/><circle cx="15.5" cy="14.5" r="2"/><path d="M17 14.5h2.5m-1.2 0v1.3"/>',
      settings:'<circle cx="12" cy="12" r="3"/><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.08a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.08a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>',
      filter:'<path d="M4 5h16M7 12h10m-7 7h4"/><circle cx="8" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
      check:'<path d="m5 12 4 4L19 6"/>',
      package:'<path d="m12 3 9 5-9 5-9-5z"/><path d="M3 8v9l9 5 9-5V8M12 13v9M7 5.8l9 5"/>',
      help:'<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.2 1.8c-1.2 1-1.8 1.2-1.8 2.7M12 17h.01"/>',
      globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
      refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3"/>',
      megaphone:'<path d="m3 11 17-6v14L3 13z"/><path d="M6 14.1 8 21h4l-2-5.6M20 9a3 3 0 0 1 0 6"/>',
      clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      trash:'<path d="M3 6h18M8 6V4h8v2m-10 0 1 15h10l1-15M10 10v7m4-7v7"/>',
      bottle:'<path d="M9 3h6v4l2 2v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9l2-2z"/><path d="M9 11h6"/>',
      user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
      close:'<path d="m6 6 12 12M18 6 6 18"/>',
      lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/>',
      message:'<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-5.5A7.5 7.5 0 1 1 20 11.5Z"/><path d="M7 10h7M7 13h5"/>',
      telegram:'<path d="M21.5 4.5 18.3 20c-.2 1.1-.8 1.4-1.7.9l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.4-4.9 9-8.2c.4-.4-.1-.6-.6-.2L6.2 13.9l-4.7-1.5c-1-.3-1-1 .2-1.5L20 3.6c.9-.3 1.7.2 1.5.9Z" fill="currentColor" stroke="none"/>',
      wrench:'<path d="M14.5 6.5a5 5 0 0 0-6.7 6.7l-4.5 4.5a2 2 0 0 0 2.8 2.8l4.5-4.5a5 5 0 0 0 6.7-6.7l-3.1 3.1-2.8-2.8z"/>',
      chevron:'<path d="m6 9 6 6 6-6"/>',
      code:'<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
      eye:'<path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
      'eye-off':'<path d="m3 3 18 18M10.6 6.2A10.8 10.8 0 0 1 12 6c6.1 0 9.5 6 9.5 6a15.3 15.3 0 0 1-3.1 3.7M6.2 6.3C3.8 8 2.5 12 2.5 12s3.4 6 9.5 6c1 0 1.9-.2 2.7-.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
      copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h3"/>'
    };
    return '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+(paths[name]||paths.package)+'</svg>';
  }
  window.BasaltIcons={svg:svg};
})(window);
