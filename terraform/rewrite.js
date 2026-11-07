// CloudFront Function (viewer request) for the site's pages. S3 only knows exact file names, so:
//   /view/      -> serves /view/index.html
//   /view       -> redirects to /view/ (so relative links on the page work)
// Anything with a file extension (/css/site.css, /404.html) is served as it is. API calls (/api/*) never run
// through this function. tests/unit/rewrite.test.js runs this file.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.charAt(uri.length - 1) === '/') {
    request.uri = uri + 'index.html';
    return request;
  }

  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (lastSegment.indexOf('.') === -1) {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: uri + '/' } },
    };
  }

  return request;
}
