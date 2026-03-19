(function() {
  var path = window.location.pathname;
  var search = window.location.search;
  var hash = window.location.hash;
  
  if (path.match(/^\/(ko|en)(\/|$)/)) {
    return;
  }
  
  // NOTE: Update this list when adding new top-level sections to the site
  var patterns = ['posts', 'about', 'tags', 'search'];
  var shouldRedirect = patterns.some(function(p) {
    return path === '/' + p || path === '/' + p + '/' || path.indexOf('/' + p + '/') === 0;
  });
  
  if (!shouldRedirect) {
    return;
  }
  
  if (path.charAt(path.length - 1) !== '/') {
    path = path + '/';
  }
  
  var lang = (navigator.language || navigator.userLanguage || '').toLowerCase();
  // NOTE: Currently only ko/en supported; defaults to 'en' for all other languages
  var prefix = lang.indexOf('ko') === 0 ? '/ko' : '/en';
  
  window.location.replace(prefix + path + search + hash);
})();
