// Runs under the site's Content-Security-Policy (script-src 'self'): no inline scripts, handlers or eval.
document.getElementById('year').textContent = String(new Date().getFullYear());
